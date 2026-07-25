<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
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
  ElTag,
} from 'element-plus';
import * as XLSX from 'xlsx';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { useWarehouseStore } from '../stores/warehouse';
import { useProductStore } from '../stores/product';
import type { WarehouseStock, CustomFieldConfig } from '../types';

const stockStore = useWarehouseStockStore();
const warehouseStore = useWarehouseStore();
const productStore = useProductStore();

const stocks = ref<WarehouseStock[]>([]);
const warehouses = ref<any[]>([]);
const products = ref<any[]>([]);
const customFields = ref<CustomFieldConfig[]>([]);

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

const searchWarehouseId = ref('');

const importInputRef = ref<HTMLInputElement | null>(null);

const triggerImport = () => {
  importInputRef.value?.click();
};

const filteredStocks = computed(() => {
  let result = stocks.value;
  if (searchWarehouseId.value) {
    result = result.filter(s => s.warehouseId === searchWarehouseId.value);
  }
  return result;
});

onMounted(() => {
  warehouseStore.initWarehouses();
  productStore.initProducts();
  stockStore.initStocks();
  warehouses.value = warehouseStore.warehouses;
  products.value = productStore.products;
  stocks.value = stockStore.stocks;
  customFields.value = stockStore.customFields;
});

// 监听自定义字段变化
watch(() => stockStore.customFields, (newFields) => {
  customFields.value = newFields;
}, { deep: true });

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
  stocks.value = stockStore.stocks;
  dialogVisible.value = false;
  ElMessage.success('保存成功');
};

const handleDelete = (id: string) => {
  stockStore.deleteStock(id);
  stocks.value = stockStore.stocks;
  ElMessage.success('删除成功');
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

    // 支持自定义字段的导入，保留所有原始字段
    const importData = jsonData.map((item: any) => {
      const knownFields = ['warehouseCode', 'productCode', 'productName', 'stock', 'inTransitStock'];
      const result: any = {
        warehouseCode: item['仓库编码'] || item['warehouseCode'] || '',
        productCode: item['商品编码'] || item['productCode'] || '',
        productName: item['商品名称'] || item['productName'] || '',
        stock: Number(item['库存'] || item['stock'] || 0),
        inTransitStock: Number(item['在途库存'] || item['inTransitStock'] || 0),
      };
      
      // 添加自定义字段
      for (const key in item) {
        if (!knownFields.includes(key) && !['仓库编码', '商品编码', '商品名称', '库存', '在途库存'].includes(key)) {
          result[key] = item[key];
        }
      }
      
      return result;
    });

    stockStore.importStocks(importData);
    stocks.value = stockStore.stocks;
    ElMessage.success('导入成功');
    (event.target as HTMLInputElement).value = '';
  };
  reader.readAsArrayBuffer(file);
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
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2>库存状况</h2>
      <div class="header-actions">
        <input
          type="file"
          accept=".xlsx,.xls"
          class="import-input"
          @change="handleImport"
          ref="importInputRef"
        />
        <ElButton @click="triggerImport()">导入库存</ElButton>
        <ElButton type="primary" @click="openDialog()">添加库存</ElButton>
      </div>
    </div>

    <!-- 搜索筛选 -->
    <div class="search-section">
      <ElForm inline>
        <ElFormItem label="仓库">
          <ElSelect v-model="searchWarehouseId" placeholder="请选择仓库" clearable>
            <ElOption
              v-for="warehouse in warehouses"
              :key="warehouse.id"
              :label="warehouse.name"
              :value="warehouse.id"
            />
          </ElSelect>
        </ElFormItem>
      </ElForm>
    </div>

    <ElTable :data="filteredStocks" border>
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
      <ElTableColumn label="操作">
        <template #default="scope">
          <ElButton size="small" @click="openDialog(scope.row as WarehouseStock)">编辑</ElButton>
          <ElButton size="small" type="danger" @click="handleDelete((scope.row as WarehouseStock).id)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑库存' : '添加库存'" width="600px">
      <ElForm :model="form" label-width="120px">
        <ElFormItem label="选择仓库">
          <ElSelect v-model="form.warehouseId" placeholder="请选择仓库">
            <ElOption
              v-for="warehouse in warehouses"
              :key="warehouse.id"
              :label="warehouse.name"
              :value="warehouse.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="选择商品">
          <ElSelect v-model="form.productCode" placeholder="请选择商品">
            <ElOption
              v-for="product in products"
              :key="product.code"
              :label="`${product.code} - ${product.name}`"
              :value="product.code"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="库存数量">
          <ElInputNumber v-model="form.stock" :min="0" />
        </ElFormItem>
        <ElFormItem label="在途库存">
          <ElInputNumber v-model="form.inTransitStock" :min="0" />
          <span style="margin-left: 8px; color: #999; font-size: 12px;">即将到货的数量</span>
        </ElFormItem>
        <!-- 动态自定义字段表单 -->
        <ElFormItem v-for="field in customFields" :key="field.key" :label="field.label">
          <ElInput v-if="field.type === 'text'" v-model="form.customFields[field.key]" />
          <ElInputNumber v-else-if="field.type === 'number'" v-model="form.customFields[field.key]" :min="0" />
          <ElDatePicker v-else-if="field.type === 'date'" v-model="form.customFields[field.key]" type="date" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="handleSubmit">确定</ElButton>
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

.search-section {
  margin-bottom: 15px;
}

.import-input {
  display: none;
}

.stock-warning {
  color: #f56c6c;
  font-weight: bold;
}

:deep(.el-select) {
  width: 200px;
}

:deep(.el-input-number),
:deep(.el-input) {
  width: 100%;
}
</style>