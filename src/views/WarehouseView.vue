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
  ElSelect,
  ElOption,
  ElMessage,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import { useWarehouseStore } from '../stores/warehouse';
import { useCompanyStore } from '../stores/company';
import { bootstrapStores } from '../stores/bootstrap';
import type { Warehouse } from '../types';
import { readExcelFromEvent, exportRows, downloadTemplate, cell } from '../utils/excel';

const store = useWarehouseStore();
const companyStore = useCompanyStore();
const { warehouses } = storeToRefs(store);
const { companies } = storeToRefs(companyStore);

const dialogVisible = ref(false);
const isEdit = ref(false);
const form = ref({
  code: '',
  name: '',
  companyId: '',
});
const editId = ref('');
const importRef = ref<HTMLInputElement | null>(null);

onMounted(() => {
  bootstrapStores();
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
  if (!companyStore.getCompanyById(form.value.companyId)) {
    ElMessage.error('所属主体不存在，请重新选择');
    return;
  }

  if (isEdit.value) {
    store.updateWarehouse(editId.value, form.value);
    ElMessage.success('修改成功');
  } else {
    store.addWarehouse(form.value);
    ElMessage.success('添加成功');
  }
  dialogVisible.value = false;
};

const handleDelete = (id: string) => {
  store.deleteWarehouse(id);
  ElMessage.success('删除成功');
};

const getCompanyCode = (id: string) => companyStore.getCompanyById(id)?.code || '';

const handleExport = () => {
  exportRows(
    warehouses.value.map(w => ({
      仓库编码: w.code,
      仓库名称: w.name,
      公司编码: getCompanyCode(w.companyId),
    })),
    '仓库',
  );
  ElMessage.success('已导出');
};

const handleTemplate = () => {
  downloadTemplate(['仓库编码', '仓库名称', '公司编码'], '仓库导入模板');
};

const handleImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  let n = 0;
  let skipped = 0;
  rows.forEach(row => {
    const code = cell(row, '仓库编码', 'code');
    const name = cell(row, '仓库名称', 'name');
    const companyCode = cell(row, '公司编码', 'companyCode', '所属主体');
    if (!code || !name) return;

    const company = companyStore.getCompanyByCode(companyCode);
    if (!company) {
      skipped += 1;
      return;
    }

    store.upsertByCode({ code, name, companyId: company.id });
    n += 1;
  });
  ElMessage.success(
    skipped
      ? `导入完成 ${n} 条，跳过 ${skipped} 条（主体编码不存在）`
      : `导入完成 ${n} 条（按编码覆盖）`,
  );
};

const getCompanyName = (id: string) => companyStore.getCompanyById(id)?.name || '';
</script>

<template>
  <PageShell title="仓库管理" help="按主体维护仓库编码与名称。主体列表与「公司主体」实时同步。">
    <template #toolbar>
      <input ref="importRef" type="file" accept=".xlsx,.xls" class="hidden-file" @change="handleImport" />
      <ElButton type="primary" size="small" @click="openDialog()">添加仓库</ElButton>
      <ElButton size="small" @click="importRef?.click()">导入</ElButton>
      <ElButton size="small" @click="handleExport">导出</ElButton>
      <ElButton size="small" @click="handleTemplate">下载模板</ElButton>
    </template>

    <div class="table-wrap">
      <ElTable :data="warehouses" border size="small" stripe class="erp-data-table" height="100%">
        <ElTableColumn prop="code" label="仓库编码" width="140" />
        <ElTableColumn prop="name" label="仓库名称" min-width="200" />
        <ElTableColumn label="所属主体" width="140">
          <template #default="{ row }">
            {{ getCompanyName((row as Warehouse).companyId) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="openDialog(row as Warehouse)">编辑</ElButton>
            <ElButton link type="danger" size="small" @click="handleDelete((row as Warehouse).id)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑仓库' : '添加仓库'" width="450px">
      <ElForm :model="form" label-width="100px" size="small">
        <ElFormItem label="仓库编码">
          <ElInput v-model="form.code" />
        </ElFormItem>
        <ElFormItem label="仓库名称">
          <ElInput v-model="form.name" />
        </ElFormItem>
        <ElFormItem label="所属主体">
          <ElSelect v-model="form.companyId" placeholder="请选择所属主体" filterable style="width: 100%">
            <ElOption
              v-for="company in companies"
              :key="company.id"
              :label="`${company.name}（${company.code}）`"
              :value="company.id"
            />
          </ElSelect>
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
}

.hidden-file {
  display: none;
}
</style>
