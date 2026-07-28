<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { storeToRefs } from 'pinia';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElSelect,
  ElOption,
  ElInput,
  ElInputNumber,
  ElDatePicker,
  ElMessage,
  ElMessageBox,
  ElTag,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import HelpTip from '../components/HelpTip.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { useWarehouseStore } from '../stores/warehouse';
import { useProductStore } from '../stores/product';
import { useCompanyStore } from '../stores/company';
import { bootstrapStores } from '../stores/bootstrap';
import type { WarehouseStock, CustomFieldConfig, FieldType, ImportWarehouseStockData } from '../types';
import { weekStartSaturday, weekLabel } from '../utils/week';
import { readExcelFromEvent, exportRows, downloadTemplate, cell, cellNum } from '../utils/excel';

const stockStore = useWarehouseStockStore();
const warehouseStore = useWarehouseStore();
const productStore = useProductStore();
const companyStore = useCompanyStore();

const { stocks, customFields } = storeToRefs(stockStore);
const { warehouses } = storeToRefs(warehouseStore);
const { products } = storeToRefs(productStore);

const dialogVisible = ref(false);
const isEdit = ref(false);
const form = ref({
  warehouseId: '',
  productCode: '',
  stock: 0,
  inTransitStock: 0,
  customFields: {} as Record<string, any>,
});
const editId = ref('');

const searchWarehouseIds = ref<string[]>([]);
const searchCompanyIds = ref<string[]>([]);
const importWeekStart = ref(weekStartSaturday());

const importInputRef = ref<HTMLInputElement | null>(null);
const isReplaceMode = ref(false);

// 字段管理对话框
const fieldDialogVisible = ref(false);
const fieldForm = ref({
  label: '',
  type: 'text' as FieldType,
});
const editingFieldKey = ref('');

const triggerImport = () => {
  isReplaceMode.value = false;
  importInputRef.value?.click();
};

const triggerReplaceImport = async () => {
  try {
    await ElMessageBox.confirm(
      `确认用 Excel「全量替换」本周库存？\n\n周次：${weekLabel(importWeekStart.value)}\n\n旧数据会先自动快照备份，再清空并写入新数据。\n未出现在 Excel 中的 SKU 库存将丢失。\n\n（本系统未对接万里牛，建议每周固定全量替换一次）`,
      '每周库存导入',
      {
        confirmButtonText: '确认全量替换',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
    isReplaceMode.value = true;
    importInputRef.value?.click();
  } catch {
    /* cancel */
  }
};

const filteredWarehouses = computed(() => {
  if (!searchCompanyIds.value.length) return warehouses.value;
  const set = new Set(searchCompanyIds.value);
  return warehouses.value.filter(w => set.has(w.companyId));
});

const filteredStocks = computed(() => {
  let result = stocks.value;
  if (searchCompanyIds.value.length) {
    const ids = new Set(
      warehouses.value
        .filter(w => searchCompanyIds.value.includes(w.companyId))
        .map(w => w.id),
    );
    result = result.filter(s => ids.has(s.warehouseId));
  }
  if (searchWarehouseIds.value.length) {
    const set = new Set(searchWarehouseIds.value);
    result = result.filter(s => set.has(s.warehouseId));
  }
  return result;
});

const onCompanyFilterChange = () => {
  const allowed = new Set(filteredWarehouses.value.map(w => w.id));
  searchWarehouseIds.value = searchWarehouseIds.value.filter(id => allowed.has(id));
};

const companyFilterOptions = computed(() =>
  companyStore.companies.map(c => ({ value: c.id, label: c.name })),
);
const warehouseFilterOptions = computed(() =>
  filteredWarehouses.value.map(w => ({ value: w.id, label: w.name })),
);

onMounted(() => {
  bootstrapStores();
});

const openDialog = (stock?: WarehouseStock) => {
  if (stock) {
    isEdit.value = true;
    editId.value = stock.id;
    form.value = {
      warehouseId: stock.warehouseId,
      productCode: stock.productCode,
      stock: stock.stock,
      inTransitStock: stock.inTransitStock,
      customFields: stock.customFields || {},
    };
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = {
      warehouseId: '',
      productCode: '',
      stock: 0,
      inTransitStock: 0,
      customFields: {},
    };
  }
  dialogVisible.value = true;
};

const handleSubmit = () => {
  if (!form.value.warehouseId) {
    ElMessage.error('请选择仓库');
    return;
  }

  if (!form.value.productCode) {
    ElMessage.error('请选择商品');
    return;
  }

  if (form.value.stock < 0) {
    ElMessage.error('库存数量不能为负数');
    return;
  }

  if (form.value.inTransitStock < 0) {
    ElMessage.error('在途库存不能为负数');
    return;
  }

  stockStore.upsertStock(
    form.value.warehouseId,
    form.value.productCode,
    form.value.stock,
    form.value.inTransitStock,
    Object.keys(form.value.customFields).length > 0 ? form.value.customFields : undefined
  );
  dialogVisible.value = false;
  ElMessage.success('保存成功');
};

const handleDelete = (id: string) => {
  stockStore.deleteStock(id);
  ElMessage.success('删除成功');
};

const STOCK_HEADERS = ['仓库编码', '商品编码', '商品名称', '库存', '在途库存'] as const;

const handleImport = async (event: Event) => {
  const jsonData = await readExcelFromEvent(event);
  if (!jsonData.length) return;

  const knownLabels = new Set<string>([...STOCK_HEADERS]);
  const importData: ImportWarehouseStockData[] = jsonData.map(item => {
    const result: ImportWarehouseStockData = {
      warehouseCode: cell(item, '仓库编码', 'warehouseCode'),
      productCode: cell(item, '商品编码', 'productCode'),
      productName: cell(item, '商品名称', 'productName'),
      stock: cellNum(item, '库存', 'stock'),
      inTransitStock: cellNum(item, '在途库存', 'inTransitStock'),
    };

    for (const key in item) {
      if (!knownLabels.has(key) && !['warehouseCode', 'productCode', 'productName', 'stock', 'inTransitStock'].includes(key)) {
        result[key] = item[key];
      }
    }

    return result;
  });

  const week = weekStartSaturday(importWeekStart.value);
  const description = isReplaceMode.value
    ? `全量替换前备份 · ${week}`
    : `增量导入前备份 · ${week}`;

  const imported = stockStore.importStocks(importData, isReplaceMode.value, description, week);
  ElMessage.success(
    isReplaceMode.value
      ? `全量替换完成（${imported} 行），已快照备份 · ${week}`
      : `增量导入完成（${imported} 行）· ${week}`,
  );
};

const getWarehouseName = (id: string) => {
  const warehouse = warehouseStore.getWarehouseById(id);
  return warehouse ? warehouse.name : '';
};

const getProductName = (code: string) => {
  const product = productStore.getProductByCode(code);
  return product ? product.name : '';
};

const getProductSpec = (code: string) => {
  const product = productStore.getProductByCode(code);
  return product ? product.spec : '';
};

const getProductUnit = (code: string) => {
  const product = productStore.getProductByCode(code);
  return product ? product.bottleUnit : '';
};

const getStockStatus = (productCode: string, stock: number, inTransitStock: number) => {
  const product = productStore.getProductByCode(productCode);
  if (!product) return { type: 'info' as const, text: '未知' };
  const availableStock = stock + inTransitStock;
  if (availableStock <= product.warningThreshold) {
    return { type: 'danger' as const, text: '库存预警' };
  }
  if (stock <= product.warningThreshold) {
    return { type: 'warning' as const, text: '当前库存预警' };
  }
  return { type: 'success' as const, text: '库存充足' };
};

const getTotalStock = (productCode: string) => {
  return stockStore.getTotalStock(productCode);
};

const getTotalInTransitStock = (productCode: string) => {
  return stockStore.getTotalInTransitStock(productCode);
};

const getCustomFieldValue = (stock: WarehouseStock, fieldKey: string) => {
  return stock.customFields?.[fieldKey] || '';
};

const buildStockExportRow = (stock: WarehouseStock) => {
  const warehouse = warehouseStore.getWarehouseById(stock.warehouseId);
  const row: Record<string, string | number> = {
    仓库编码: warehouse?.code || '',
    商品编码: stock.productCode,
    商品名称: getProductName(stock.productCode),
    库存: stock.stock,
    在途库存: stock.inTransitStock,
  };
  customFields.value.forEach(field => {
    row[field.label] = getCustomFieldValue(stock, field.key);
  });
  return row;
};

const handleExport = () => {
  const rows = filteredStocks.value.map(buildStockExportRow);
  exportRows(rows, '库存');
  ElMessage.success(`已导出 ${rows.length} 条`);
};

const handleTemplate = () => {
  const headers = [...STOCK_HEADERS, ...customFields.value.map(f => f.label)];
  downloadTemplate(headers, '库存导入模板');
};

// 字段管理相关方法
const openFieldDialog = (field?: CustomFieldConfig) => {
  if (field) {
    editingFieldKey.value = field.key;
    fieldForm.value = {
      label: field.label,
      type: field.type,
    };
  } else {
    editingFieldKey.value = '';
    fieldForm.value = {
      label: '',
      type: 'text',
    };
  }
  fieldDialogVisible.value = true;
};

const handleFieldSubmit = () => {
  if (!fieldForm.value.label) {
    ElMessage.error('请输入字段名称');
    return;
  }

  if (editingFieldKey.value) {
    stockStore.updateCustomField(editingFieldKey.value, fieldForm.value);
    ElMessage.success('字段修改成功');
  } else {
    stockStore.addCustomField(fieldForm.value);
    ElMessage.success('字段添加成功');
  }

  fieldDialogVisible.value = false;
};

const handleFieldDelete = (key: string) => {
  stockStore.removeCustomField(key);
  ElMessage.success('字段删除成功');
};
</script>

<template>
  <PageShell
    title="库存导入"
    help="未对接万里牛：每周从线下/ERP 导出库存 Excel，建议「全量替换」并自动快照，再去做渠道要货。\n推荐流程：选周次 → 全量替换导入 → 去「渠道要货」提报 → 周末录实际销货核对\nExcel 列：仓库编码、商品编码、商品名称、库存、在途库存"
  >
    <template #toolbar>
      <ElDatePicker
        v-model="importWeekStart"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="导入归属周"
        size="small"
        style="width: 150px"
        @change="(v: string) => { if (v) importWeekStart = weekStartSaturday(v) }"
      />
      <MultiCheckFilter
        v-model="searchCompanyIds"
        :options="companyFilterOptions"
        placeholder="主体(可多选)"
        width="200px"
        @update:model-value="onCompanyFilterChange"
      />
      <MultiCheckFilter
        v-model="searchWarehouseIds"
        :options="warehouseFilterOptions"
        placeholder="仓库(可多选)"
        width="200px"
      />
      <input
        type="file"
        accept=".xlsx,.xls"
        class="import-input"
        @change="handleImport"
        ref="importInputRef"
      />
      <ElButton size="small" type="primary" @click="triggerReplaceImport()">本周全量替换</ElButton>
      <HelpTip
        inline
        title="全量替换说明"
        content="用 Excel 全量替换本周库存。\n旧数据会先自动快照备份，再清空并写入新数据。\n未出现在 Excel 中的 SKU 库存将丢失。\n建议每周固定全量替换一次。"
      />
      <ElButton size="small" @click="triggerImport()">增量导入</ElButton>
      <ElButton size="small" @click="handleExport">导出</ElButton>
      <ElButton size="small" @click="handleTemplate">下载模板</ElButton>
      <ElButton size="small" @click="openFieldDialog()">字段管理</ElButton>
      <ElButton size="small" @click="openDialog()">手工添加</ElButton>
    </template>

    <div class="table-wrap">

    <ElTable :data="filteredStocks" border size="small" stripe class="erp-data-table" height="100%">
      <ElTableColumn label="仓库编码" width="100">
        <template #default="scope">
          {{ getWarehouseName((scope.row as WarehouseStock).warehouseId) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="商品编码" width="100">
        <template #default="scope">
          {{ (scope.row as WarehouseStock).productCode }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="商品名称" width="150">
        <template #default="scope">
          {{ getProductName((scope.row as WarehouseStock).productCode) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="规格" width="100">
        <template #default="scope">
          {{ getProductSpec((scope.row as WarehouseStock).productCode) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="当前库存" width="120">
        <template #default="scope">
          <span :class="{ 'stock-warning': getStockStatus((scope.row as WarehouseStock).productCode, (scope.row as WarehouseStock).stock, (scope.row as WarehouseStock).inTransitStock).type === 'danger' || getStockStatus((scope.row as WarehouseStock).productCode, (scope.row as WarehouseStock).stock, (scope.row as WarehouseStock).inTransitStock).type === 'warning' }">
            {{ (scope.row as WarehouseStock).stock }} {{ getProductUnit((scope.row as WarehouseStock).productCode) }}
          </span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="在途库存" width="120">
        <template #default="scope">
          {{ (scope.row as WarehouseStock).inTransitStock }} {{ getProductUnit((scope.row as WarehouseStock).productCode) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="可用库存" width="120">
        <template #default="scope">
          {{ (scope.row as WarehouseStock).stock + (scope.row as WarehouseStock).inTransitStock }} {{ getProductUnit((scope.row as WarehouseStock).productCode) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="库存状态" width="120">
        <template #default="scope">
          <ElTag :type="getStockStatus((scope.row as WarehouseStock).productCode, (scope.row as WarehouseStock).stock, (scope.row as WarehouseStock).inTransitStock).type">
            {{ getStockStatus((scope.row as WarehouseStock).productCode, (scope.row as WarehouseStock).stock, (scope.row as WarehouseStock).inTransitStock).text }}
          </ElTag>
        </template>
      </ElTableColumn>
      <!-- 动态自定义字段列 -->
      <ElTableColumn
        v-for="field in customFields"
        :key="field.key"
        :label="field.label"
        width="120"
      >
        <template #default="scope">
          {{ getCustomFieldValue(scope.row as WarehouseStock, field.key) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="总库存" width="100">
        <template #default="scope">
          {{ getTotalStock((scope.row as WarehouseStock).productCode) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="总在途" width="100">
        <template #default="scope">
          {{ getTotalInTransitStock((scope.row as WarehouseStock).productCode) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="120" fixed="right">
        <template #default="scope">
          <ElButton link type="primary" size="small" @click="openDialog(scope.row as WarehouseStock)">编辑</ElButton>
          <ElButton link type="danger" size="small" @click="handleDelete((scope.row as WarehouseStock).id)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>
    </div>

    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑库存' : '添加库存'" width="560px">
      <ElForm :model="form" label-width="100px" size="small">
        <ElFormItem label="选择仓库">
          <ElSelect v-model="form.warehouseId" placeholder="请选择仓库" style="width: 100%">
            <ElOption
              v-for="warehouse in warehouses"
              :key="warehouse.id"
              :label="warehouse.name"
              :value="warehouse.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="选择商品">
          <ElSelect v-model="form.productCode" placeholder="请选择商品" filterable style="width: 100%">
            <ElOption
              v-for="product in products"
              :key="product.code"
              :label="`${product.code} - ${product.name}`"
              :value="product.code"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="库存数量">
          <ElInputNumber v-model="form.stock" :min="0" style="width: 100%" />
        </ElFormItem>
        <ElFormItem label="在途库存">
          <ElInputNumber v-model="form.inTransitStock" :min="0" style="width: 100%" />
        </ElFormItem>
        <ElFormItem v-for="field in customFields" :key="field.key" :label="field.label">
          <ElInput v-if="field.type === 'text'" v-model="form.customFields[field.key]" />
          <ElInputNumber v-else-if="field.type === 'number'" v-model="form.customFields[field.key]" :min="0" />
          <ElDatePicker v-else-if="field.type === 'date'" v-model="form.customFields[field.key]" type="date" style="width: 100%" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton size="small" @click="dialogVisible = false">取消</ElButton>
        <ElButton size="small" type="primary" @click="handleSubmit">确定</ElButton>
      </template>
    </ElDialog>

    <ElDialog v-model="fieldDialogVisible" title="字段管理" width="520px">
      <div v-if="editingFieldKey || !customFields.length" style="margin-bottom: 16px">
        <ElForm :model="fieldForm" label-width="88px" size="small">
          <ElFormItem label="字段名称">
            <ElInput v-model="fieldForm.label" placeholder="如：批次号、生产日期" />
          </ElFormItem>
          <ElFormItem label="字段类型">
            <ElSelect v-model="fieldForm.type" placeholder="请选择类型" style="width: 100%">
              <ElOption label="文本" value="text" />
              <ElOption label="数字" value="number" />
              <ElOption label="日期" value="date" />
            </ElSelect>
          </ElFormItem>
        </ElForm>
      </div>
      <div v-else>
        <ElTable :data="customFields" border size="small">
          <ElTableColumn prop="label" label="字段名称" />
          <ElTableColumn prop="type" label="字段类型">
            <template #default="scope">
              {{ (scope.row as CustomFieldConfig).type === 'text' ? '文本' : (scope.row as CustomFieldConfig).type === 'number' ? '数字' : '日期' }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="140">
            <template #default="scope">
              <ElButton link type="primary" size="small" @click="openFieldDialog(scope.row as CustomFieldConfig)">编辑</ElButton>
              <ElButton link type="danger" size="small" @click="handleFieldDelete((scope.row as CustomFieldConfig).key)">删除</ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
      <template #footer>
        <ElButton v-if="editingFieldKey" size="small" @click="editingFieldKey = ''; fieldForm.label = ''; fieldForm.type = 'text'">返回列表</ElButton>
        <ElButton v-if="!editingFieldKey" size="small" type="primary" @click="openFieldDialog()">添加字段</ElButton>
        <ElButton v-if="editingFieldKey" size="small" type="primary" @click="handleFieldSubmit">保存</ElButton>
        <ElButton v-if="!editingFieldKey" size="small" @click="fieldDialogVisible = false">关闭</ElButton>
      </template>
    </ElDialog>
  </PageShell>
</template>

<style scoped>
.table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px 0;
  overflow: hidden;
}

.import-input {
  display: none;
}

.stock-warning {
  color: #f56c6c;
  font-weight: 600;
}
</style>