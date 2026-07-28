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
  ElMessage,
  ElMessageBox,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import { useCompanyStore } from '../stores/company';
import { bootstrapStores } from '../stores/bootstrap';
import type { Company } from '../types';
import { readExcelFromEvent, exportRows, downloadTemplate, cell } from '../utils/excel';

const companyStore = useCompanyStore();
const { companies } = storeToRefs(companyStore);

const dialogVisible = ref(false);
const isEdit = ref(false);
const form = ref({ name: '', code: '' });
const editId = ref('');
const importRef = ref<HTMLInputElement | null>(null);

onMounted(() => {
  bootstrapStores();
});

const openDialog = (company?: Company) => {
  if (company) {
    isEdit.value = true;
    editId.value = company.id;
    form.value = { name: company.name, code: company.code };
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = { name: '', code: '' };
  }
  dialogVisible.value = true;
};

const handleSubmit = () => {
  if (!form.value.name || !form.value.code) {
    ElMessage.error('请填写公司名称和编码');
    return;
  }
  const code = form.value.code.trim();
  const name = form.value.name.trim();
  if (!isEdit.value && companyStore.getCompanyByCode(code)) {
    ElMessage.error('公司编码已存在');
    return;
  }
  if (isEdit.value) {
    const other = companyStore.companies.find(c => c.code === code && c.id !== editId.value);
    if (other) {
      ElMessage.error('公司编码已存在');
      return;
    }
    companyStore.updateCompany(editId.value, { code, name });
    ElMessage.success('修改成功');
  } else {
    companyStore.addCompany({ code, name });
    ElMessage.success('添加成功');
  }
  dialogVisible.value = false;
};

const handleDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm('确认删除该主体？相关渠道/仓库仍会保留，但归属会异常，请谨慎。', '删除主体', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  companyStore.deleteCompany(id);
  ElMessage.success('删除成功');
};

const handleExport = () => {
  exportRows(
    companies.value.map(c => ({ 公司编码: c.code, 公司名称: c.name })),
    '公司主体',
  );
  ElMessage.success('已导出');
};

const handleTemplate = () => {
  downloadTemplate(['公司编码', '公司名称'], '公司主体导入模板');
};

const handleImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  let n = 0;
  rows.forEach(row => {
    const code = cell(row, '公司编码', 'code');
    const name = cell(row, '公司名称', 'name');
    if (!code || !name) return;
    companyStore.upsertByCode({ code, name });
    n += 1;
  });
  ElMessage.success(`导入完成 ${n} 条（按编码覆盖）`);
};
</script>

<template>
  <PageShell title="公司主体" help="渠道与仓库均按主体隔离。新增主体后，仓库/渠道/要货等页面下拉会立即可见。">
    <template #toolbar>
      <input ref="importRef" type="file" accept=".xlsx,.xls" class="hidden-file" @change="handleImport" />
      <ElButton type="primary" size="small" @click="openDialog()">添加主体</ElButton>
      <ElButton size="small" @click="importRef?.click()">导入</ElButton>
      <ElButton size="small" @click="handleExport">导出</ElButton>
      <ElButton size="small" @click="handleTemplate">下载模板</ElButton>
    </template>
    <div class="table-wrap">
      <ElTable :data="companies" border size="small" stripe class="erp-data-table" height="100%">
        <ElTableColumn prop="code" label="编码" width="140" />
        <ElTableColumn prop="name" label="名称" min-width="200" />
        <ElTableColumn label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="openDialog(row as Company)">编辑</ElButton>
            <ElButton link type="danger" size="small" @click="handleDelete((row as Company).id)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>
    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑主体' : '添加主体'" width="420px">
      <ElForm :model="form" label-width="88px" size="small">
        <ElFormItem label="编码"><ElInput v-model="form.code" /></ElFormItem>
        <ElFormItem label="名称"><ElInput v-model="form.name" /></ElFormItem>
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
