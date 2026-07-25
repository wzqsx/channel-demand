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
  ElSelect,
  ElOption,
  ElMessage,
} from 'element-plus';
import * as XLSX from 'xlsx';
import { useWarehouseStore } from '../stores/warehouse';
import { useCompanyStore } from '../stores/company';
import type { Warehouse } from '../types';

const store = useWarehouseStore();
const companyStore = useCompanyStore();
const warehouses = ref<Warehouse[]>([]);
const companies = ref<any[]>([]);
const dialogVisible = ref(false);
const isEdit = ref(false);
const form = ref({
  code: '',
  name: '',
  companyId: '',
});
const editId = ref('');
const importInputRef = ref<HTMLInputElement | null>(null);

const triggerImport = () => {
  importInputRef.value?.click();
};

onMounted(() => {
  store.initWarehouses();
  companyStore.initCompanies();
  warehouses.value = store.warehouses;
  companies.value = companyStore.companies;
});

const openDialog = (warehouse?: Warehouse) => {
  if (warehouse) {
    isEdit.value = true;
    editId.value = warehouse.id;
    form.value = {
      code: warehouse.code,
      name: warehouse.name,
      companyId: warehouse.companyId || '',
    };
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = {
      code: '',
      name: '',
      companyId: '',
    };
  }
  dialogVisible.value = true;
};

const handleSubmit = () => {
  if (!form.value.code || !form.value.name) {
    ElMessage.error('请填写仓库编码和名称');
    return;
  }

  if (!form.value.companyId) {
    ElMessage.error('请选择所属主体');
    return;
  }

  if (isEdit.value) {
    store.updateWarehouse(editId.value, form.value);
    ElMessage.success('修改成功');
  } else {
    store.addWarehouse(form.value);
    ElMessage.success('添加成功');
  }

  warehouses.value = store.warehouses;
  dialogVisible.value = false;
};

const handleDelete = (id: string) => {
  store.deleteWarehouse(id);
  warehouses.value = store.warehouses;
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
      // 通过公司编码查找公司ID
      const companyCode = item['公司编码'] || item['companyCode'] || item['所属主体'] || '';
      const company = companyStore.companies.find((c: any) => c.code === companyCode);
      const companyId = company?.id || '';

      const warehouse: Omit<Warehouse, 'id'> = {
        code: item['仓库编码'] || item['code'] || '',
        name: item['仓库名称'] || item['name'] || '',
        companyId,
      };
      if (warehouse.code && warehouse.name) {
        store.addWarehouse(warehouse);
      }
    });

    warehouses.value = store.warehouses;
    ElMessage.success('导入成功');
    (event.target as HTMLInputElement).value = '';
  };
  reader.readAsArrayBuffer(file);
};

const getCompanyName = (id: string) => {
  const company = companyStore.getCompanyById(id);
  return company ? company.name : '';
};
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2>仓库管理</h2>
      <div class="header-actions">
        <input
          type="file"
          accept=".xlsx,.xls"
          class="import-input"
          @change="handleImport"
          ref="importInputRef"
        />
        <ElButton @click="triggerImport()">导入仓库</ElButton>
        <ElButton type="primary" @click="openDialog()">添加仓库</ElButton>
      </div>
    </div>

    <ElTable :data="warehouses" border>
      <ElTableColumn prop="code" label="仓库编码" />
      <ElTableColumn prop="name" label="仓库名称" />
      <ElTableColumn label="所属主体" width="120">
        <template #default="scope">
          {{ getCompanyName((scope.row as Warehouse).companyId) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作">
        <template #default="scope">
          <ElButton size="small" @click="openDialog(scope.row as Warehouse)">编辑</ElButton>
          <ElButton size="small" type="danger" @click="handleDelete((scope.row as Warehouse).id)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑仓库' : '添加仓库'" width="450px">
      <ElForm :model="form" label-width="100px">
        <ElFormItem label="仓库编码">
          <ElInput v-model="form.code" />
        </ElFormItem>
        <ElFormItem label="仓库名称">
          <ElInput v-model="form.name" />
        </ElFormItem>
        <ElFormItem label="所属主体">
          <ElSelect v-model="form.companyId" placeholder="请选择所属主体">
            <ElOption
              v-for="company in companies"
              :key="company.id"
              :label="company.name"
              :value="company.id"
            />
          </ElSelect>
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

:deep(.el-select) {
  width: 100%;
}
</style>