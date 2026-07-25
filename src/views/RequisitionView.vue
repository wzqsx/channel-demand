<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElSelect,
  ElOption,
  ElMessage,
  ElTag,
  ElMessageBox,
} from 'element-plus';
import * as XLSX from 'xlsx';
import { useRequisitionStore } from '../stores/requisition';
import { useChannelStore } from '../stores/channel';
import { useWarehouseStore } from '../stores/warehouse';
import { useProductStore } from '../stores/product';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { useCompanyStore } from '../stores/company';
import type { Requisition, ImportRequisitionData } from '../types';

const requisitionStore = useRequisitionStore();
const channelStore = useChannelStore();
const warehouseStore = useWarehouseStore();
const productStore = useProductStore();
const stockStore = useWarehouseStockStore();
const companyStore = useCompanyStore();

const requisitions = ref<Requisition[]>([]);
const channels = ref<any[]>([]);
const warehouses = ref<any[]>([]);
const companies = ref<any[]>([]);

const form = ref({
  companyId: '',
  channelId: '',
  warehouseIds: [] as string[],
});

const importDialogVisible = ref(false);
const importData = ref<ImportRequisitionData[]>([]);

// 库存检查结果
const stockCheckResults = ref<{
  productCode: string;
  productName: string;
  demandQuantity: number;
  availableStock: number;
  higherPriorityDemand: number;
  status: 'ok' | 'low' | 'short';
  message: string;
}[]>([]);

const filteredChannels = computed(() => {
  if (!form.value.companyId) return channels.value;
  return channelStore.getChannelsByCompany(form.value.companyId);
});

const filteredWarehouses = computed(() => {
  if (!form.value.channelId) return [];
  const channel = channelStore.getChannelById(form.value.channelId);
  if (!channel) return [];
  return warehouseStore.getWarehousesByIds(channel.warehouseIds);
});

onMounted(() => {
  channelStore.initChannels();
  warehouseStore.initWarehouses();
  productStore.initProducts();
  stockStore.initStocks();
  companyStore.initCompanies();
  channels.value = channelStore.channels;
  warehouses.value = warehouseStore.warehouses;
  companies.value = companyStore.companies;
  requisitions.value = requisitionStore.requisitions;
});

const openDialog = () => {
  form.value = {
    companyId: '',
    channelId: '',
    warehouseIds: [],
  };
  importData.value = [];
  stockCheckResults.value = [];
  importDialogVisible.value = true;
};

const handleCompanyChange = () => {
  // 选择主体后，清空渠道和仓库选择
  form.value.channelId = '';
  form.value.warehouseIds = [];
};

const handleChannelChange = () => {
  // 选择渠道后，默认选中所有允许的仓库
  if (form.value.channelId) {
    const channel = channelStore.getChannelById(form.value.channelId);
    if (channel) {
      form.value.warehouseIds = [...channel.warehouseIds];
    }
  } else {
    form.value.warehouseIds = [];
  }
};

const handleImport = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const data = new Uint8Array(e.target?.result as ArrayBuffer);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(sheet);

    const convertedData: ImportRequisitionData[] = [];
    
    jsonData.forEach((item: any) => {
      const productCode = item['商品编码'] || item['code'] || '';
      const productName = item['商品名称'] || item['name'] || '';
      let quantity = Number(item['数量'] || item['quantity'] || 0);
      const remark = item['备注'] || item['remark'] || '';

      // 检查是否为组合商品，如果是，换算成基础商品
      const product = productStore.getProductByCode(productCode);
      if (product && product.combineProductCode && product.combineRatio > 0) {
        quantity = quantity * product.combineRatio;
        convertedData.push({
          productCode: product.combineProductCode,
          productName: productName + ` (组合商品，已换算为${product.combineProductCode})`,
          quantity,
          remark: remark || '组合商品换算',
        });
      } else {
        convertedData.push({
          productCode,
          productName,
          quantity,
          remark,
        });
      }
    });

    importData.value = convertedData;
    ElMessage.success('导入成功');
    (event.target as HTMLInputElement).value = '';
  };
  reader.readAsArrayBuffer(file);
};

// 检查库存可用性
const checkStock = () => {
  if (!form.value.channelId) {
    ElMessage.error('请先选择渠道');
    return [];
  }

  const channel = channelStore.getChannelById(form.value.channelId);
  if (!channel) {
    ElMessage.error('渠道信息不存在');
    return [];
  }

  // 获取更高优先级的渠道
  const higherPriorityChannels = channelStore.getHigherPriorityChannels(form.value.channelId);
  const higherPriorityChannelIds = higherPriorityChannels.map(c => c.id);

  const results: typeof stockCheckResults.value = [];

  importData.value.forEach(item => {
    const product = productStore.getProductByCode(item.productCode);
    if (!product) {
      results.push({
        productCode: item.productCode,
        productName: item.productName,
        demandQuantity: item.quantity,
        availableStock: 0,
        higherPriorityDemand: 0,
        status: 'short',
        message: '商品不存在',
      });
      return;
    }

    // 获取可用库存（当前库存 + 在途库存）
    const availableStock = stockStore.getAvailableStock(item.productCode);
    
    // 获取高优先级渠道的待审批需求
    const higherPriorityDemand = requisitionStore.getPendingDemandByProductAndHigherPriority(
      item.productCode,
      form.value.channelId,
      higherPriorityChannelIds
    ) - requisitionStore.getPendingDemandByProductAndChannel(item.productCode, form.value.channelId);

    // 计算剩余库存
    const remainingStock = availableStock - higherPriorityDemand;
    
    let status: 'ok' | 'low' | 'short' = 'ok';
    let message = '';

    if (remainingStock < item.quantity) {
      // 缺货：扣除高优先级需求后，库存不足以满足当前渠道需求
      status = 'short';
      message = `缺货！可用库存 ${availableStock}，高优先级渠道已占 ${higherPriorityDemand}，当前需求 ${item.quantity}`;
    } else if (availableStock < item.quantity + higherPriorityDemand + product.warningThreshold) {
      // 库存不足：可用库存满足需求，但低于预警值
      status = 'low';
      message = `库存不足！可用库存 ${availableStock}，总需求 ${item.quantity + higherPriorityDemand}，预警阈值 ${product.warningThreshold}`;
    } else {
      // 正常
      status = 'ok';
      message = `库存充足`;
    }

    results.push({
      productCode: item.productCode,
      productName: item.productName,
      demandQuantity: item.quantity,
      availableStock,
      higherPriorityDemand,
      status,
      message,
    });
  });

  return results;
};

const handleSubmit = async () => {
  if (!form.value.companyId) {
    ElMessage.error('请选择所属主体');
    return;
  }

  if (!form.value.channelId) {
    ElMessage.error('请选择渠道');
    return;
  }

  if (form.value.warehouseIds.length === 0) {
    ElMessage.error('请选择仓库');
    return;
  }

  if (importData.value.length === 0) {
    ElMessage.error('请导入要货数据');
    return;
  }

  // 检查库存
  const results = checkStock();
  stockCheckResults.value = results;

  // 检查是否有缺货或库存不足的情况
  const shortItems = results.filter(r => r.status === 'short');
  const lowItems = results.filter(r => r.status === 'low');

  if (shortItems.length > 0) {
    const shortMessage = shortItems.map(r => `${r.productName}: ${r.message}`).join('\n');
    await ElMessageBox.alert(
      `以下商品缺货，无法提交要货单：\n\n${shortMessage}`,
      '库存检查失败',
      { type: 'error' }
    );
    return;
  }

  if (lowItems.length > 0) {
    const lowMessage = lowItems.map(r => `${r.productName}: ${r.message}`).join('\n');
    try {
      await ElMessageBox.confirm(
        `以下商品库存不足，是否继续提交？\n\n${lowMessage}`,
        '库存警告',
        {
          confirmButtonText: '继续提交',
          cancelButtonText: '取消',
          type: 'warning',
        }
      );
    } catch {
      return;
    }
  }

  requisitionStore.addRequisition(form.value.channelId, form.value.warehouseIds, importData.value);
  requisitions.value = requisitionStore.requisitions;
  importDialogVisible.value = false;
  ElMessage.success('提交成功');
};

const handleApprove = (id: string) => {
  requisitionStore.approveRequisition(id);
  requisitions.value = requisitionStore.requisitions;
  ElMessage.success('已审批通过');
};

const handleReject = (id: string) => {
  requisitionStore.rejectRequisition(id);
  requisitions.value = requisitionStore.requisitions;
  ElMessage.success('已拒绝');
};

const handleDelete = (id: string) => {
  requisitionStore.deleteRequisition(id);
  requisitions.value = requisitionStore.requisitions;
  ElMessage.success('删除成功');
};

const getChannelName = (id: string) => {
  const channel = channelStore.getChannelById(id);
  return channel ? channel.name : '';
};

const getWarehouseNames = (ids: string[]) => {
  return ids.map(id => {
    const warehouse = warehouseStore.getWarehouseById(id);
    return warehouse ? warehouse.name : '';
  }).join(', ');
};

const getStatusTag = (status: string) => {
  const tags: Record<string, { label: string; type: 'primary' | 'success' | 'warning' | 'info' | 'danger' }> = {
    pending: { label: '待审批', type: 'warning' },
    approved: { label: '已通过', type: 'success' },
    rejected: { label: '已拒绝', type: 'danger' },
  };
  return tags[status] || { label: status, type: 'info' };
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString('zh-CN');
};
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2>渠道要货管理</h2>
      <div class="header-actions">
        <ElButton type="primary" @click="openDialog()">新建要货单</ElButton>
      </div>
    </div>

    <ElTable :data="requisitions" border>
      <ElTableColumn prop="id" label="单号" width="120" />
      <ElTableColumn label="渠道" width="100">
        <template #default="scope">
          {{ getChannelName(scope.row.channelId) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="仓库">
        <template #default="scope">
          {{ getWarehouseNames(scope.row.warehouseIds) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="商品数量" width="100">
        <template #default="scope">
          {{ scope.row.items.length }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="100">
        <template #default="scope">
          <ElTag :type="getStatusTag(scope.row.status).type">
            {{ getStatusTag(scope.row.status).label }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="创建时间" width="160">
        <template #default="scope">
          {{ formatDate(scope.row.createdAt) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作">
        <template #default="scope">
          <ElButton size="small" v-if="scope.row.status === 'pending'" @click="handleApprove(scope.row.id)">通过</ElButton>
          <ElButton size="small" v-if="scope.row.status === 'pending'" type="danger" @click="handleReject(scope.row.id)">拒绝</ElButton>
          <ElButton size="small" type="danger" @click="handleDelete(scope.row.id)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <ElDialog v-model="importDialogVisible" title="新建要货单" width="900px">
      <ElForm :model="form" label-width="100px">
        <ElFormItem label="选择主体">
          <ElSelect v-model="form.companyId" placeholder="请选择所属主体" @change="handleCompanyChange">
            <ElOption
              v-for="company in companies"
              :key="company.id"
              :label="company.name"
              :value="company.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="选择渠道">
          <ElSelect v-model="form.channelId" placeholder="请选择渠道" @change="handleChannelChange">
            <ElOption
              v-for="channel in filteredChannels"
              :key="channel.id"
              :label="`${channel.name} (P${channel.priority})`"
              :value="channel.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="选择仓库">
          <ElSelect v-model="form.warehouseIds" multiple placeholder="请选择仓库">
            <ElOption
              v-for="warehouse in filteredWarehouses"
              :key="warehouse.id"
              :label="warehouse.name"
              :value="warehouse.id"
            />
          </ElSelect>
          <p v-if="form.channelId && filteredWarehouses.length > 0" style="margin-top: 8px; color: #999; font-size: 12px;">
            默认已选中所有允许的仓库
          </p>
        </ElFormItem>
      </ElForm>

      <div class="import-section">
        <div class="import-header">
          <span>要货数据</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            class="import-input"
            @change="handleImport"
          />
          <ElButton type="primary" size="small" @click="(event: any) => event.target.previousElementSibling.click()">
            导入Excel
          </ElButton>
        </div>

        <ElTable :data="importData" border size="small" v-if="importData.length > 0">
          <ElTableColumn prop="productCode" label="商品编码" />
          <ElTableColumn prop="productName" label="商品名称" />
          <ElTableColumn prop="quantity" label="数量" />
          <ElTableColumn prop="remark" label="备注" />
        </ElTable>
        <div v-else class="empty-tip">
          请导入Excel文件，格式为：商品编码、商品名称、数量、备注
        </div>
      </div>

      <!-- 库存检查结果 -->
      <div v-if="stockCheckResults.length > 0" class="stock-check-section">
        <h4>库存检查结果</h4>
        <ElTable :data="stockCheckResults" border size="small" max-height="200">
          <ElTableColumn prop="productCode" label="商品编码" />
          <ElTableColumn prop="productName" label="商品名称" />
          <ElTableColumn prop="demandQuantity" label="需求数量" />
          <ElTableColumn prop="availableStock" label="可用库存" />
          <ElTableColumn prop="higherPriorityDemand" label="高优先级占用" />
          <ElTableColumn label="状态" width="120">
            <template #default="scope">
              <ElTag :type="scope.row.status === 'short' ? 'danger' : scope.row.status === 'low' ? 'warning' : 'success'">
                {{ scope.row.status === 'short' ? '缺货' : scope.row.status === 'low' ? '库存不足' : '库存充足' }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn prop="message" label="说明" />
        </ElTable>
      </div>

      <template #footer>
        <ElButton @click="importDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="handleSubmit">提交</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.page-container {
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.import-section {
  margin-top: 20px;
}

.import-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.import-input {
  display: none;
}

.empty-tip {
  padding: 40px;
  text-align: center;
  color: #999;
}

.stock-check-section {
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid #eee;
}

.stock-check-section h4 {
  margin-bottom: 10px;
  font-size: 14px;
  color: #666;
}

:deep(.el-select) {
  width: 100%;
}
</style>