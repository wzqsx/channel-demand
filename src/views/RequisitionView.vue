<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
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
  ElDatePicker,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import HelpTip from '../components/HelpTip.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import { useRequisitionStore } from '../stores/requisition';
import { useChannelStore } from '../stores/channel';
import { useWarehouseStore } from '../stores/warehouse';
import { useProductStore } from '../stores/product';
import { useCompanyStore } from '../stores/company';
import { bootstrapStores } from '../stores/bootstrap';
import type { Requisition, ImportRequisitionData, DemandSalesCompareRow } from '../types';
import { weekStartSaturday, weekLabel } from '../utils/week';
import { exportRows, downloadTemplate, readExcelFromEvent, cell, cellNum } from '../utils/excel';
import { assertRequisitionScope, getChannelAllowedWarehouses } from '../utils/companyScope';
import { getBottleEquivalentStock } from '../utils/packStock';
import { formatProductQty } from '../utils/qtyDisplay';

const router = useRouter();
const requisitionStore = useRequisitionStore();
const channelStore = useChannelStore();
const warehouseStore = useWarehouseStore();
const productStore = useProductStore();
const companyStore = useCompanyStore();

const filterWeek = ref(weekStartSaturday());
const filterCompanyIds = ref<string[]>([]);

const form = ref({
  companyId: '',
  channelId: '',
  warehouseIds: [] as string[],
  weekStart: weekStartSaturday(),
});

const importDialogVisible = ref(false);
const importData = ref<ImportRequisitionData[]>([]);
const stockCheckResults = ref<{
  productCode: string;
  productName: string;
  demandQuantity: number;
  availableStock: number;
  packStock: number;
  higherPriorityDemand: number;
  status: 'ok' | 'low' | 'short';
  message: string;
}[]>([]);

const detailVisible = ref(false);
const detailRow = ref<Requisition | null>(null);

const salesDialogVisible = ref(false);
const salesTargetId = ref('');
const salesImportData = ref<ImportRequisitionData[]>([]);
const compareRows = ref<DemandSalesCompareRow[]>([]);

const filteredChannels = computed(() => {
  if (!form.value.companyId) return [];
  return channelStore.getChannelsSortedByPriority(form.value.companyId);
});

/** 渠道可用仓库：强制同主体 */
const filteredWarehouses = computed(() => {
  if (!form.value.channelId || !form.value.companyId) return [];
  return getChannelAllowedWarehouses(form.value.channelId).filter(
    w => w.companyId === form.value.companyId,
  );
});

const listRows = computed(() => {
  return requisitionStore.requisitions.filter(r => {
    if (filterWeek.value && r.weekStart !== filterWeek.value) return false;
    if (filterCompanyIds.value.length && !filterCompanyIds.value.includes(r.companyId)) return false;
    return true;
  });
});

onMounted(() => {
  bootstrapStores();
});

const openDialog = () => {
  form.value = {
    companyId: filterCompanyIds.value.length === 1 ? filterCompanyIds.value[0] : '',
    channelId: '',
    warehouseIds: [],
    weekStart: filterWeek.value || weekStartSaturday(),
  };
  importData.value = [];
  stockCheckResults.value = [];
  importDialogVisible.value = true;
};

const handleCompanyChange = () => {
  form.value.channelId = '';
  form.value.warehouseIds = [];
};

const handleChannelChange = () => {
  // 只切换可选仓库列表，绝不自动勾选；由用户逐个勾
  form.value.warehouseIds = [];
};

const clearWarehouses = () => {
  form.value.warehouseIds = [];
};

const toggleWarehouse = (id: string) => {
  if (!id) return;
  const cur = form.value.warehouseIds;
  form.value.warehouseIds = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
};

const isWarehouseChecked = (id: string) => form.value.warehouseIds.includes(id);

const companyFilterOptions = computed(() =>
  companyStore.companies.map(c => ({ value: c.id, label: c.name })),
);

const parseExcelRows = (jsonData: any[]): ImportRequisitionData[] => {
  const converted: ImportRequisitionData[] = [];
  jsonData.forEach((item: any) => {
    const productCode = cell(item, '商品编码', 'code');
    const productName = cell(item, '商品名称', 'name');
    let quantity = cellNum(item, '数量', 'quantity', '要货数量', '销量');
    const remark = cell(item, '备注', 'remark');
    if (!productCode) return;

    const product = productStore.getProductByCode(productCode);
    if (product?.combineProductCode && product.combineRatio > 0) {
      quantity = quantity * product.combineRatio;
      converted.push({
        productCode: product.combineProductCode,
        productName: (productName || product.name) + ` (组合→${product.combineProductCode})`,
        quantity,
        remark: remark || '组合商品换算',
      });
    } else {
      converted.push({
        productCode,
        productName: productName || product?.name || productCode,
        quantity,
        remark,
      });
    }
  });
  return converted;
};

const handleImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  importData.value = parseExcelRows(rows);
  stockCheckResults.value = [];
  ElMessage.success(`已导入 ${importData.value.length} 行要货`);
};

const handleSalesImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  salesImportData.value = parseExcelRows(rows);
  ElMessage.success(`已导入销货 ${salesImportData.value.length} 行`);
};

const downloadDemandTemplate = () => {
  downloadTemplate(['商品编码', '商品名称', '数量', '备注'], '要货导入模板');
};

const exportList = () => {
  const rows = requisitionStore.exportDemandFlat(filterWeek.value || undefined).map(r => ({
    单号: r['单号'],
    周起始: r['周起始'],
    主体: getCompanyName(r['主体ID']),
    渠道: getChannelName(r['渠道ID']),
    状态: r['状态'],
    商品编码: r['商品编码'],
    商品名称: r['商品名称'],
    要货数量: r['要货数量'],
    备注: r['备注'],
  }));
  if (!rows.length) {
    ElMessage.warning('当前周无要货数据可导出');
    return;
  }
  exportRows(rows, `要货明细_${filterWeek.value || '全部'}`);
  ElMessage.success('已导出');
};

const checkStock = () => {
  if (!form.value.channelId || !form.value.warehouseIds.length) {
    ElMessage.error('请先选择渠道和仓库');
    return [];
  }

  const results: typeof stockCheckResults.value = [];
  importData.value.forEach(item => {
    const product = productStore.getProductByCode(item.productCode);
    if (!product) {
      results.push({
        productCode: item.productCode,
        productName: item.productName,
        demandQuantity: item.quantity,
        availableStock: 0,
        packStock: 0,
        higherPriorityDemand: 0,
        status: 'short',
        message: '商品不存在',
      });
      return;
    }

    // 瓶规可用 = 瓶规库存 + 箱规库存×换算比例（要货按瓶规口径）
    const eq = getBottleEquivalentStock(item.productCode, form.value.warehouseIds);
    const availableStock = eq.availableStock;
    const packStock = eq.packStock + eq.packInTransit;
    const higherPriorityDemand = requisitionStore.getHigherPriorityPendingDemand(
      eq.baseCode,
      form.value.channelId,
      form.value.warehouseIds,
    );
    const baseProduct = productStore.getProductByCode(eq.baseCode) || product;
    const checked = requisitionStore.checkStockAvailability(
      eq.baseCode,
      item.quantity,
      baseProduct.warningThreshold,
      availableStock,
      higherPriorityDemand,
    );
    const packHint = packStock > 0 ? `；含箱规折算 ${formatProductQty(packStock, eq.baseCode)}` : '';
    results.push({
      productCode: eq.baseCode,
      productName: item.productName,
      demandQuantity: item.quantity,
      availableStock,
      packStock,
      higherPriorityDemand,
      status: checked.status,
      message: checked.message + packHint,
    });
  });
  return results;
};

const runStockCheck = () => {
  if (!importData.value.length) {
    ElMessage.warning('请先导入要货数据');
    return;
  }
  stockCheckResults.value = checkStock();
};

const handleSubmit = async () => {
  if (!form.value.companyId) return ElMessage.error('请选择所属主体');
  if (!form.value.channelId) return ElMessage.error('请选择渠道');
  if (!form.value.warehouseIds.length) return ElMessage.error('请选择仓库');
  if (!form.value.weekStart) return ElMessage.error('请选择周起始');
  if (!importData.value.length) return ElMessage.error('请导入要货数据');

  const scope = assertRequisitionScope({
    companyId: form.value.companyId,
    channelId: form.value.channelId,
    warehouseIds: form.value.warehouseIds,
  });
  if (!scope.ok) return ElMessage.error(scope.message);
  form.value.warehouseIds = scope.warehouseIds;

  const results = checkStock();
  stockCheckResults.value = results;
  const shortItems = results.filter(r => r.status === 'short');
  const lowItems = results.filter(r => r.status === 'low');

  if (shortItems.length > 0) {
    await ElMessageBox.alert(
      shortItems.map(r => `${r.productName}: ${r.message}`).join('\n'),
      '库存检查失败（按所选仓库 + 同主体高优先级占用）',
      { type: 'error' },
    );
    return;
  }

  if (lowItems.length > 0) {
    try {
      await ElMessageBox.confirm(
        lowItems.map(r => `${r.productName}: ${r.message}`).join('\n'),
        '库存偏低，是否继续提交？',
        { confirmButtonText: '继续提交', cancelButtonText: '取消', type: 'warning' },
      );
    } catch {
      return;
    }
  }

  try {
    requisitionStore.addRequisition(
      form.value.companyId,
      form.value.channelId,
      form.value.warehouseIds,
      importData.value,
      form.value.weekStart,
    );
  } catch (e: any) {
    return ElMessage.error(e?.message || '提交失败：主体/仓库不匹配');
  }
  importDialogVisible.value = false;
  ElMessage.success('要货单已提交');
};

const handleApprove = (id: string) => {
  requisitionStore.approveRequisition(id);
  ElMessage.success('已通过');
};

const handleReject = (id: string) => {
  requisitionStore.rejectRequisition(id);
  ElMessage.success('已拒绝');
};

const handleDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm('确认删除该要货单？', '提示', { type: 'warning' });
    requisitionStore.deleteRequisition(id);
    ElMessage.success('已删除');
  } catch { /* cancel */ }
};

const openDetail = (row: Requisition) => {
  detailRow.value = row;
  detailVisible.value = true;
};

const openSalesDialog = (row: Requisition) => {
  salesTargetId.value = row.id;
  salesImportData.value = (row.salesItems || []).map(i => ({
    productCode: i.productCode,
    productName: i.productName,
    quantity: i.quantity,
    remark: i.remark,
  }));
  compareRows.value = row.salesItems?.length
    ? requisitionStore.compareDemandVsSales(row.id)
    : [];
  salesDialogVisible.value = true;
};

const saveSales = () => {
  if (!salesImportData.value.length) {
    ElMessage.error('请导入本周实际销货数据');
    return;
  }
  requisitionStore.saveSalesItems(salesTargetId.value, salesImportData.value);
  compareRows.value = requisitionStore.compareDemandVsSales(salesTargetId.value);
  ElMessage.success('销货数据已保存，可查看虚报核对');
};

const refreshCompare = () => {
  if (salesTargetId.value) {
    compareRows.value = requisitionStore.compareDemandVsSales(salesTargetId.value);
  }
};

const getChannelName = (id: string) => channelStore.getChannelById(id)?.name || id;
const getCompanyName = (id: string) => companyStore.getCompanyById(id)?.name || id;
const getWarehouseNames = (ids: string[]) =>
  ids.map(id => warehouseStore.getWarehouseById(id)?.name || id).join('、');

const getStatusTag = (status: string) => {
  const tags: Record<string, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
    pending: { label: '待审批', type: 'warning' },
    approved: { label: '已通过', type: 'success' },
    rejected: { label: '已拒绝', type: 'danger' },
  };
  return tags[status] || { label: status, type: 'info' };
};

const compareStatusTag = (status: DemandSalesCompareRow['status']) => {
  const map: Record<string, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
    accurate: { label: '正常', type: 'success' },
    overclaim: { label: '疑似虚报', type: 'danger' },
    underclaim: { label: '要货偏低', type: 'warning' },
    no_sales: { label: '无销货', type: 'danger' },
    no_demand: { label: '未要货有销', type: 'info' },
  };
  return map[status] || { label: status, type: 'info' };
};

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString('zh-CN');

const goShortageAlert = () => {
  router.push({
    path: '/shortage-alert',
    query: {
      week: filterWeek.value,
      companyId: filterCompanyIds.value.length === 1 ? filterCompanyIds.value[0] : undefined,
      companyIds: filterCompanyIds.value.length > 1 ? filterCompanyIds.value.join(',') : undefined,
    },
  });
};

const triggerFile = (refEl: HTMLInputElement | null) => refEl?.click();
const demandFileRef = ref<HTMLInputElement | null>(null);
const salesFileRef = ref<HTMLInputElement | null>(null);
</script>

<template>
  <PageShell
    title="渠道要货"
    help="按主体分渠道/仓库 · 同主体内优先级占库存 · 审批后可录入本周实际销货做虚报核对\n库存口径：要货按瓶规；箱规编码库存会按「组合比例」折算进瓶规后再验库存\n推荐流程：1.库存导入（全量替换）→ 2.渠道要货 + 验库存 → 3.审批通过 → 4.录入本周实际销货"
  >
    <template #toolbar>
      <ElDatePicker
        v-model="filterWeek"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="周起始(周六)"
        size="small"
        style="width: 150px"
        @change="(v: string) => { if (v) filterWeek = weekStartSaturday(v) }"
      />
      <MultiCheckFilter
        v-model="filterCompanyIds"
        :options="companyFilterOptions"
        placeholder="主体(可多选)"
        width="200px"
      />
      <ElButton type="primary" size="small" @click="openDialog">新建要货</ElButton>
      <ElButton size="small" @click="goShortageAlert">缺货与预警</ElButton>
      <ElButton size="small" @click="exportList">导出明细</ElButton>
      <ElButton size="small" @click="downloadDemandTemplate">要货模板</ElButton>
      <span class="week-label">当前周：{{ weekLabel(filterWeek) }}</span>
    </template>

    <div class="table-wrap">
      <ElTable :data="listRows" border size="small" stripe class="erp-data-table" height="100%">
        <ElTableColumn prop="id" label="单号" width="140" show-overflow-tooltip />
        <ElTableColumn label="周次" width="110">
          <template #default="{ row }">{{ row.weekStart }}</template>
        </ElTableColumn>
        <ElTableColumn label="主体" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ getCompanyName(row.companyId) }}</template>
        </ElTableColumn>
        <ElTableColumn label="渠道" width="100">
          <template #default="{ row }">
            {{ getChannelName(row.channelId) }}
            <ElTag size="small" type="info" style="margin-left: 4px">
              P{{ channelStore.getChannelById(row.channelId)?.priority ?? '-' }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="仓库" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ getWarehouseNames(row.warehouseIds) }}</template>
        </ElTableColumn>
        <ElTableColumn label="SKU数" width="70" align="center">
          <template #default="{ row }">{{ row.items.length }}</template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="90">
          <template #default="{ row }">
            <ElTag size="small" :type="getStatusTag(row.status).type">
              {{ getStatusTag(row.status).label }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="销货" width="90">
          <template #default="{ row }">
            <ElTag v-if="row.salesItems?.length" size="small" type="success">已录入</ElTag>
            <ElTag v-else size="small" type="info">未录</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="创建时间" width="150">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="openDetail(row as Requisition)">明细</ElButton>
            <ElButton
              v-if="row.status === 'pending'"
              link
              type="success"
              size="small"
              @click="handleApprove(row.id)"
            >通过</ElButton>
            <ElButton
              v-if="row.status === 'pending'"
              link
              type="danger"
              size="small"
              @click="handleReject(row.id)"
            >拒绝</ElButton>
            <ElButton
              v-if="row.status === 'approved'"
              link
              type="warning"
              size="small"
              @click="openSalesDialog(row as Requisition)"
            >录销货</ElButton>
            <ElButton link type="info" size="small" @click="handleDelete(row.id)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <!-- 新建要货 -->
    <ElDialog v-model="importDialogVisible" title="新建要货单" width="960px" destroy-on-close>
      <ElForm :model="form" label-width="88px" size="small">
        <div class="form-grid">
          <ElFormItem label="周起始" required>
            <ElDatePicker
              v-model="form.weekStart"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
              @change="(v: string) => { if (v) form.weekStart = weekStartSaturday(v) }"
            />
          </ElFormItem>
          <ElFormItem label="主体" required>
            <ElSelect v-model="form.companyId" placeholder="所属主体" @change="handleCompanyChange" style="width: 100%">
              <ElOption v-for="c in companyStore.companies" :key="c.id" :label="c.name" :value="c.id" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="渠道" required>
            <ElSelect v-model="form.channelId" placeholder="同主体渠道" @change="handleChannelChange" style="width: 100%">
              <ElOption
                v-for="ch in filteredChannels"
                :key="ch.id"
                :label="`${ch.name} (P${ch.priority})`"
                :value="ch.id"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="仓库" required>
            <div class="wh-box">
              <div class="wh-box__bar">
                <span class="wh-box__hint">
                  已选 {{ form.warehouseIds.length }}/{{ filteredWarehouses.length }} · 可逐个勾/取消；旧数据若全勾了，先点清空
                </span>
                <ElButton link size="small" :disabled="!form.warehouseIds.length" @click="clearWarehouses">
                  清空已选
                </ElButton>
              </div>
              <div v-if="filteredWarehouses.length" class="wh-box__list">
                <div
                  v-for="(w, idx) in filteredWarehouses"
                  :key="`${w.code}__${w.id}__${idx}`"
                  class="wh-box__item"
                  role="checkbox"
                  :aria-checked="isWarehouseChecked(w.id)"
                  tabindex="0"
                  @click="toggleWarehouse(w.id)"
                  @keydown.enter.prevent="toggleWarehouse(w.id)"
                  @keydown.space.prevent="toggleWarehouse(w.id)"
                >
                  <span class="wh-box__check" :class="{ on: isWarehouseChecked(w.id) }" />
                  <span class="wh-box__text">{{ w.name }}（{{ w.code }}）</span>
                </div>
              </div>
              <div v-else class="wh-box__empty">
                {{ form.channelId ? '该渠道暂无可用仓库' : '请先选择主体和渠道' }}
              </div>
            </div>
          </ElFormItem>
        </div>
      </ElForm>

      <div class="import-block">
        <div class="import-block__head">
          <span>要货明细</span>
          <div>
            <input ref="demandFileRef" type="file" accept=".xlsx,.xls" class="hidden-file" @change="handleImport" />
            <ElButton size="small" @click="triggerFile(demandFileRef)">导入 Excel</ElButton>
            <HelpTip inline title="Excel 列说明" content="列：商品编码、商品名称、数量、备注" />
            <ElButton size="small" @click="downloadDemandTemplate">下载模板</ElButton>
            <ElButton size="small" type="primary" :disabled="!importData.length" @click="runStockCheck">验库存</ElButton>
            <HelpTip
              inline
              title="验库存说明"
              content="验库存 = 所选仓库(瓶规库存+在途 + 箱规折算) − 同主体更高优先级、且仓库有交集的待审批要货。箱规需在商品里勾选组合并填写基础瓶规编码与换算比例。"
            />
          </div>
        </div>
        <ElTable v-if="importData.length" :data="importData" border size="small" max-height="220">
          <ElTableColumn prop="productCode" label="商品编码" width="120" />
          <ElTableColumn prop="productName" label="商品名称" min-width="160" />
          <ElTableColumn prop="quantity" label="数量" width="90" />
          <ElTableColumn prop="remark" label="备注" min-width="120" />
        </ElTable>
        <div v-else class="empty-tip">请导入要货 Excel</div>
      </div>

      <div v-if="stockCheckResults.length" class="import-block">
        <div class="import-block__head"><span>库存检查</span></div>
        <ElTable :data="stockCheckResults" border size="small" max-height="200">
          <ElTableColumn prop="productCode" label="瓶规编码" width="100" />
          <ElTableColumn prop="productName" label="名称" min-width="120" />
          <ElTableColumn label="需求" width="110" show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatProductQty(row.demandQuantity, row.productCode) }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="可用(含箱规)" width="120" show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatProductQty(row.availableStock, row.productCode) }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="其中箱规折算" width="120" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.packStock > 0 ? formatProductQty(row.packStock, row.productCode) : '-' }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="高优占用" width="110" show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatProductQty(row.higherPriorityDemand, row.productCode) }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="90">
            <template #default="{ row }">
              <ElTag size="small" :type="row.status === 'short' ? 'danger' : row.status === 'low' ? 'warning' : 'success'">
                {{ row.status === 'short' ? '缺货' : row.status === 'low' ? '偏低' : '充足' }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn prop="message" label="说明" min-width="180" show-overflow-tooltip />
        </ElTable>
      </div>

      <template #footer>
        <ElButton size="small" @click="importDialogVisible = false">取消</ElButton>
        <ElButton size="small" type="primary" @click="handleSubmit">提交</ElButton>
      </template>
    </ElDialog>

    <!-- 明细 -->
    <ElDialog v-model="detailVisible" title="要货明细" width="720px" destroy-on-close>
      <template v-if="detailRow">
        <p class="detail-meta" style="margin-bottom: 8px">
          {{ getCompanyName(detailRow.companyId) }} · {{ getChannelName(detailRow.channelId) }} ·
          {{ weekLabel(detailRow.weekStart) }} · {{ getWarehouseNames(detailRow.warehouseIds) }}
        </p>
        <ElTable :data="detailRow.items" border size="small" max-height="400">
          <ElTableColumn prop="productCode" label="编码" width="120" />
          <ElTableColumn prop="productName" label="名称" min-width="160" />
          <ElTableColumn prop="quantity" label="要货数量" width="100" />
          <ElTableColumn prop="remark" label="备注" min-width="120" />
        </ElTable>
      </template>
    </ElDialog>

    <!-- 录销货 -->
    <ElDialog v-model="salesDialogVisible" title="录入本周实际销货" width="960px" destroy-on-close>
      <div class="import-block">
        <div class="import-block__head">
          <span>实际销货明细</span>
          <div>
            <input ref="salesFileRef" type="file" accept=".xlsx,.xls" class="hidden-file" @change="handleSalesImport" />
            <ElButton size="small" @click="triggerFile(salesFileRef)">导入销货 Excel</ElButton>
            <HelpTip
              inline
              title="销货说明"
              content="用于核对渠道是否虚报要货。建议阈值：要货 ≥ 销货 × 1.3 标为「疑似虚报」。\nExcel 列同要货：商品编码、商品名称、数量、备注。"
            />
            <ElButton size="small" type="primary" @click="saveSales">保存并核对</ElButton>
            <ElButton size="small" @click="refreshCompare">刷新核对</ElButton>
          </div>
        </div>
        <ElTable v-if="salesImportData.length" :data="salesImportData" border size="small" max-height="200">
          <ElTableColumn prop="productCode" label="编码" width="120" />
          <ElTableColumn prop="productName" label="名称" min-width="140" />
          <ElTableColumn prop="quantity" label="销货数量" width="100" />
          <ElTableColumn prop="remark" label="备注" />
        </ElTable>
        <div v-else class="empty-tip">请导入本周实际销货</div>
      </div>

      <div v-if="compareRows.length" class="import-block">
        <div class="import-block__head"><span>要货 vs 销货</span></div>
        <ElTable :data="compareRows" border size="small" max-height="280">
          <ElTableColumn prop="productCode" label="编码" width="100" />
          <ElTableColumn prop="productName" label="名称" min-width="120" />
          <ElTableColumn prop="demandQty" label="要货" width="80" />
          <ElTableColumn prop="salesQty" label="销货" width="80" />
          <ElTableColumn prop="overClaim" label="虚报量" width="80">
            <template #default="{ row }">
              <span :class="{ danger: row.overClaim > 0 }">{{ row.overClaim }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="要货/销货" width="100">
            <template #default="{ row }">
              {{ row.ratio === Infinity ? '∞' : row.ratio }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="结论" width="110">
            <template #default="{ row }">
              <ElTag size="small" :type="compareStatusTag(row.status).type">
                {{ compareStatusTag(row.status).label }}
              </ElTag>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </ElDialog>
  </PageShell>
</template>

<style scoped>
.table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 0 0;
  overflow: hidden;
}

.week-label {
  font-size: 13px;
  color: var(--erp-text-muted);
}

.detail-meta {
  font-size: 13px;
  color: var(--erp-text-muted);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

.import-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--erp-border);
}

.import-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}

.hidden-file {
  display: none;
}

.empty-tip {
  padding: 28px;
  text-align: center;
  color: var(--erp-text-muted);
  font-size: 13px;
  background: #fafbfc;
  border-radius: 8px;
}

.danger {
  color: #f56c6c;
  font-weight: 600;
}

.wh-box {
  width: 100%;
  border: 1px solid var(--erp-border);
  border-radius: 6px;
  padding: 8px 10px;
  background: #fafbfc;
}
.wh-box__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.wh-box__hint {
  flex: 1;
  font-size: 11px;
  color: var(--erp-text-muted);
  line-height: 1.4;
}
.wh-box__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
}
.wh-box__item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  margin: 0;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--erp-text);
  user-select: none;
}
.wh-box__item:hover {
  background: #eef3f9;
}
.wh-box__check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 1px solid #c0c6cc;
  border-radius: 3px;
  background: #fff;
  box-sizing: border-box;
  position: relative;
}
.wh-box__check.on {
  border-color: var(--erp-primary);
  background: var(--erp-primary);
}
.wh-box__check.on::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.wh-box__text {
  line-height: 1.3;
}
.wh-box__empty {
  padding: 10px 0;
  font-size: 12px;
  color: var(--erp-text-muted);
}
</style>
