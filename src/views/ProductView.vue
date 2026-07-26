<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElTag,
  ElCheckbox,
  ElSelect,
  ElOption,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import { useProductStore } from '../stores/product';
import { bootstrapStores } from '../stores/bootstrap';
import type { Product } from '../types';
import { readExcelFromEvent, exportRows, downloadTemplate, cell, cellNum } from '../utils/excel';

const store = useProductStore();
const { products } = storeToRefs(store);
const dialogVisible = ref(false);
const isEdit = ref(false);
const form = ref({
  code: '',
  name: '',
  spec: '',
  bottleUnit: '瓶',
  boxUnit: '箱',
  bottlesPerBox: 24,
  stock: 0,
  warningThreshold: 100,
  isCombined: false,
  combineProductCode: '',
  combineRatio: 0,
});
const editId = ref('');
const showWarning = ref(false);
const importRef = ref<HTMLInputElement | null>(null);

const PRODUCT_HEADERS = [
  '商品编码', '商品名称', '规格', '瓶单位', '箱单位', '每箱瓶数', '预警阈值',
  '是否组合(是/否)', '组合基础编码', '组合比例',
] as const;

const parseCombined = (row: Record<string, unknown>) => {
  const v = cell(row, '是否组合(是/否)', '是否组合', 'isCombined');
  return v === '是' || v === 'true' || v === '1' || v === 'yes' || v === 'Y';
};

onMounted(() => {
  bootstrapStores();
  if (store.warningCount > 0) showWarning.value = true;
});

const openDialog = (product?: Product) => {
  if (product) {
    isEdit.value = true;
    editId.value = product.id;
    form.value = {
      code: product.code,
      name: product.name,
      spec: product.spec,
      bottleUnit: product.bottleUnit,
      boxUnit: product.boxUnit,
      bottlesPerBox: product.bottlesPerBox,
      stock: product.stock,
      warningThreshold: product.warningThreshold,
      isCombined: product.isCombined || false,
      combineProductCode: product.combineProductCode || '',
      combineRatio: product.combineRatio || 0,
    };
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = {
      code: '',
      name: '',
      spec: '',
      bottleUnit: '瓶',
      boxUnit: '箱',
      bottlesPerBox: 24,
      stock: 0,
      warningThreshold: 100,
      isCombined: false,
      combineProductCode: '',
      combineRatio: 0,
    };
  }
  dialogVisible.value = true;
};

const handleSubmit = () => {
  if (!form.value.code || !form.value.name) {
    ElMessage.error('请填写商品编码和名称');
    return;
  }

  if (form.value.isCombined && (!form.value.combineProductCode || form.value.combineRatio <= 0)) {
    ElMessage.error('组合商品必须设置基础商品编码和换算比例');
    return;
  }

  if (form.value.isCombined) {
    const baseProduct = store.getProductByCode(form.value.combineProductCode);
    if (!baseProduct) {
      ElMessage.error('基础商品编码不存在');
      return;
    }
    if (baseProduct.isCombined) {
      ElMessage.error('基础商品不能是组合商品');
      return;
    }
  }

  if (isEdit.value) {
    store.updateProduct(editId.value, form.value);
    ElMessage.success('修改成功');
  } else {
    store.addProduct(form.value);
    ElMessage.success('添加成功');
  }

  dialogVisible.value = false;
};

const handleDelete = (id: string) => {
  store.deleteProduct(id);
  ElMessage.success('删除成功');
};

const handleExport = () => {
  exportRows(
    products.value.map(p => ({
      商品编码: p.code,
      商品名称: p.name,
      规格: p.spec,
      瓶单位: p.bottleUnit,
      箱单位: p.boxUnit,
      每箱瓶数: p.bottlesPerBox,
      预警阈值: p.warningThreshold,
      '是否组合(是/否)': p.isCombined ? '是' : '否',
      组合基础编码: p.combineProductCode,
      组合比例: p.combineRatio,
    })),
    '商品',
  );
  ElMessage.success('已导出');
};

const handleTemplate = () => {
  downloadTemplate([...PRODUCT_HEADERS], '商品导入模板');
};

const handleImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  let n = 0;
  rows.forEach(row => {
    const code = cell(row, '商品编码', 'code');
    const name = cell(row, '商品名称', 'name');
    if (!code || !name) return;

    const existing = store.getProductByCode(code);
    const isCombined = parseCombined(row);
    const combineProductCode = cell(row, '组合基础编码', 'combineProductCode', '基础商品编码');
    const combineRatio = cellNum(row, '组合比例', 'combineRatio', '换算比例');

    store.upsertByCode({
      code,
      name,
      spec: cell(row, '规格', 'spec'),
      bottleUnit: cell(row, '瓶单位', 'bottleUnit') || '瓶',
      boxUnit: cell(row, '箱单位', 'boxUnit') || '箱',
      bottlesPerBox: cellNum(row, '每箱瓶数', '每箱数量', 'bottlesPerBox') || 24,
      stock: existing?.stock ?? 0,
      warningThreshold: cellNum(row, '预警阈值', 'warningThreshold') || 100,
      isCombined,
      combineProductCode: isCombined ? combineProductCode : '',
      combineRatio: isCombined ? combineRatio : 0,
    });
    n += 1;
  });
  ElMessage.success(`导入完成 ${n} 条（按编码覆盖）`);
};

const getStockStatus = (product: Product) => {
  if (product.stock <= product.warningThreshold) {
    return { type: 'danger' as const, text: '库存预警' };
  }
  return { type: 'success' as const, text: '库存充足' };
};

const formatBoxStock = (product: Product) => {
  const boxes = Math.floor(product.stock / product.bottlesPerBox);
  const bottles = product.stock % product.bottlesPerBox;
  return `${boxes}箱 ${bottles}${product.bottleUnit}`;
};

const getCombineInfo = (product: Product) => {
  if (!product.isCombined || !product.combineProductCode) return '';
  const baseProduct = store.getProductByCode(product.combineProductCode);
  const baseName = baseProduct ? baseProduct.name : product.combineProductCode;
  return `${product.code} = ${product.combineRatio} × ${baseName}`;
};
</script>

<template>
  <PageShell
    title="商品信息管理"
    help="瓶规=要货主编码；箱规勾选「组合商品」并填写基础瓶规编码与换算比例（1个箱规单位=几瓶）。验库存/缺货时箱规库存会折算进瓶规。"
  >
    <template #toolbar>
      <input ref="importRef" type="file" accept=".xlsx,.xls" class="hidden-file" @change="handleImport" />
      <ElButton type="primary" size="small" @click="openDialog()">添加商品</ElButton>
      <ElButton size="small" @click="importRef?.click()">导入</ElButton>
      <ElButton size="small" @click="handleExport">导出</ElButton>
      <ElButton size="small" @click="handleTemplate">下载模板</ElButton>
    </template>

    <div class="table-wrap">
      <div v-if="showWarning && store.warningCount > 0" class="warning-alert">
        <ElTag type="danger" effect="dark">
          ⚠️ {{ store.warningCount }} 个商品库存低于预警阈值，请及时补货
        </ElTag>
      </div>

      <ElTable
        :data="products"
        border
        size="small"
        stripe
        class="erp-data-table"
        height="100%"
        :style="showWarning && store.warningCount > 0 ? { marginTop: '8px' } : undefined"
      >
        <ElTableColumn prop="code" label="商品编码" width="120" show-overflow-tooltip />
        <ElTableColumn prop="name" label="商品名称" min-width="140" show-overflow-tooltip />
        <ElTableColumn prop="spec" label="规格" width="100" show-overflow-tooltip />
        <ElTableColumn prop="bottleUnit" label="瓶单位" width="80" />
        <ElTableColumn prop="boxUnit" label="箱单位" width="80" />
        <ElTableColumn prop="bottlesPerBox" label="每箱数量" width="90" align="center" />
        <ElTableColumn label="当前库存" width="150">
          <template #default="{ row }">
            <div>
              <span :class="{ 'stock-warning': store.isWarning(row as Product) }">
                {{ (row as Product).stock }} {{ (row as Product).bottleUnit }}
              </span>
              <span class="stock-box">({{ formatBoxStock(row as Product) }})</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="预警阈值" width="100">
          <template #default="{ row }">
            {{ (row as Product).warningThreshold }} {{ (row as Product).bottleUnit }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="库存状态" width="100">
          <template #default="{ row }">
            <ElTag size="small" :type="getStockStatus(row as Product).type">
              {{ getStockStatus(row as Product).text }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="箱规" width="70" align="center">
          <template #default="{ row }">
            <ElTag size="small" :type="(row as Product).isCombined ? 'warning' : 'info'">
              {{ (row as Product).isCombined ? '是' : '否' }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="箱→瓶换算" width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="(row as Product).isCombined">{{ getCombineInfo(row as Product) }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="openDialog(row as Product)">编辑</ElButton>
            <ElButton link type="danger" size="small" @click="handleDelete((row as Product).id)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑商品' : '添加商品'" width="600px">
      <ElForm :model="form" label-width="120px" size="small">
        <ElFormItem label="商品编码">
          <ElInput v-model="form.code" />
        </ElFormItem>
        <ElFormItem label="商品名称">
          <ElInput v-model="form.name" />
        </ElFormItem>
        <ElFormItem label="规格">
          <ElInput v-model="form.spec" />
        </ElFormItem>
        <ElFormItem label="瓶单位">
          <ElInput v-model="form.bottleUnit" />
        </ElFormItem>
        <ElFormItem label="箱单位">
          <ElInput v-model="form.boxUnit" />
        </ElFormItem>
        <ElFormItem label="每箱数量">
          <ElInputNumber v-model="form.bottlesPerBox" :min="1" />
        </ElFormItem>
        <ElFormItem label="当前库存">
          <ElInputNumber v-model="form.stock" :min="0" />
        </ElFormItem>
        <ElFormItem label="预警阈值">
          <ElInputNumber v-model="form.warningThreshold" :min="0" />
        </ElFormItem>
        <ElFormItem label="箱规/组合">
          <ElCheckbox v-model="form.isCombined" />
        </ElFormItem>
        <ElFormItem v-if="form.isCombined" label="基础瓶规编码">
          <ElSelect v-model="form.combineProductCode" placeholder="请选择基础瓶规商品">
            <ElOption
              v-for="product in store.baseProducts"
              :key="product.code"
              :label="`${product.code} - ${product.name}`"
              :value="product.code"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem v-if="form.isCombined" label="换算比例">
          <ElInputNumber v-model="form.combineRatio" :min="1" />
          <span style="margin-left: 8px;">（1箱规 = N瓶规）</span>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton size="small" @click="dialogVisible = false">取消</ElButton>
        <ElButton size="small" type="primary" @click="handleSubmit">确定</ElButton>
      </template>
    </ElDialog>
  </PageShell>
</template>

<style scoped>
.table-wrap {
  flex: 1;
  min-height: 0;
  padding: 0 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.import-input,
.hidden-file {
  display: none;
}

.warning-alert {
  flex-shrink: 0;
  margin-top: 12px;
  padding: 8px 12px;
  background-color: #fef0f0;
  border-radius: 4px;
}

.stock-warning {
  color: #f56c6c;
  font-weight: bold;
}

.stock-box {
  margin-left: 8px;
  color: #999;
  font-size: 12px;
}

.text-muted {
  color: #999;
}

:deep(.el-input-number) {
  width: 100%;
}

:deep(.el-select) {
  width: 100%;
}
</style>
