<script setup lang="ts">
import { ref, onMounted } from 'vue';
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
import * as XLSX from 'xlsx';
import { useProductStore } from '../stores/product';
import type { Product } from '../types';

const store = useProductStore();
const products = ref<Product[]>([]);
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

onMounted(() => {
  store.initProducts();
  products.value = store.products;
  
  // 首次进入页面检查库存预警
  if (store.warningCount > 0) {
    showWarning.value = true;
  }
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

  // 如果是组合商品，必须填写组合商品编码和换算比例
  if (form.value.isCombined && (!form.value.combineProductCode || form.value.combineRatio <= 0)) {
    ElMessage.error('组合商品必须设置基础商品编码和换算比例');
    return;
  }

  // 检查组合商品编码是否存在
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

  products.value = store.products;
  dialogVisible.value = false;
};

const handleDelete = (id: string) => {
  store.deleteProduct(id);
  products.value = store.products;
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

    jsonData.forEach((item: any) => {
      const product: Omit<Product, 'id'> = {
        code: item['商品编码'] || item['code'] || '',
        name: item['商品名称'] || item['name'] || '',
        spec: item['规格'] || item['spec'] || '',
        bottleUnit: item['瓶单位'] || item['bottleUnit'] || '瓶',
        boxUnit: item['箱单位'] || item['boxUnit'] || '箱',
        bottlesPerBox: item['每箱数量'] || item['bottlesPerBox'] || 24,
        stock: item['库存'] || item['stock'] || 0,
        warningThreshold: item['预警阈值'] || item['warningThreshold'] || 100,
        isCombined: item['是否组合'] || item['isCombined'] || false,
        combineProductCode: item['基础商品编码'] || item['combineProductCode'] || '',
        combineRatio: item['换算比例'] || item['combineRatio'] || 0,
      };
      if (product.code && product.name) {
        store.addProduct(product);
      }
    });

    products.value = store.products;
    ElMessage.success('导入成功');
    (event.target as HTMLInputElement).value = '';
  };
  reader.readAsArrayBuffer(file);
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
  <div class="page-container">
    <div class="page-header">
      <h2>商品信息管理</h2>
      <div class="header-actions">
        <input
          type="file"
          accept=".xlsx,.xls"
          class="import-input"
          @change="handleImport"
        />
        <ElButton type="primary" @click="openDialog()">添加商品</ElButton>
      </div>
    </div>

    <!-- 库存预警提示 -->
    <div v-if="showWarning && store.warningCount > 0" class="warning-alert">
      <ElTag type="danger" effect="dark">
        ⚠️ {{ store.warningCount }} 个商品库存低于预警阈值，请及时补货
      </ElTag>
    </div>

    <ElTable :data="products" border>
      <ElTableColumn prop="code" label="商品编码" />
      <ElTableColumn prop="name" label="商品名称" />
      <ElTableColumn prop="spec" label="规格" />
      <ElTableColumn prop="bottleUnit" label="瓶单位" />
      <ElTableColumn prop="boxUnit" label="箱单位" />
      <ElTableColumn prop="bottlesPerBox" label="每箱数量" />
      <ElTableColumn label="当前库存" width="150">
        <template #default="scope">
          <div>
            <span :class="{ 'stock-warning': store.isWarning(scope.row as Product) }">
              {{ (scope.row as Product).stock }} {{ (scope.row as Product).bottleUnit }}
            </span>
            <span class="stock-box">({{ formatBoxStock(scope.row as Product) }})</span>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="预警阈值" width="120">
        <template #default="scope">
          {{ (scope.row as Product).warningThreshold }} {{ (scope.row as Product).bottleUnit }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="库存状态" width="100">
        <template #default="scope">
          <ElTag :type="getStockStatus(scope.row as Product).type">
            {{ getStockStatus(scope.row as Product).text }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="是否组合" width="100">
        <template #default="scope">
          <ElTag :type="(scope.row as Product).isCombined ? 'warning' : 'info'">
            {{ (scope.row as Product).isCombined ? '是' : '否' }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="组合换算" width="200">
        <template #default="scope">
          <span v-if="(scope.row as Product).isCombined">{{ getCombineInfo(scope.row as Product) }}</span>
          <span v-else class="text-muted">-</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作">
        <template #default="scope">
          <ElButton size="small" @click="openDialog(scope.row as Product)">编辑</ElButton>
          <ElButton size="small" type="danger" @click="handleDelete((scope.row as Product).id)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑商品' : '添加商品'" width="600px">
      <ElForm :model="form" label-width="120px">
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
        <ElFormItem label="是否组合商品">
          <ElCheckbox v-model="form.isCombined" />
        </ElFormItem>
        <ElFormItem v-if="form.isCombined" label="基础商品编码">
          <ElSelect v-model="form.combineProductCode" placeholder="请选择基础商品">
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
          <span style="margin-left: 8px;">（1个组合商品 = N个基础商品）</span>
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

.import-input {
  display: none;
}

.warning-alert {
  margin-bottom: 15px;
  padding: 10px;
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