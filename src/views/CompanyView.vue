<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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
import type { TableInstance } from 'element-plus';
import PageShell from '../components/PageShell.vue';
import { useCompanyStore } from '../stores/company';
import { useWarehouseStore } from '../stores/warehouse';
import { useChannelStore, getChannelCompanyIds } from '../stores/channel';
import { useRequisitionStore } from '../stores/requisition';
import { bootstrapStores } from '../stores/bootstrap';
import type { Company } from '../types';
import { readExcelFromEvent, exportRows, downloadTemplate, cell } from '../utils/excel';
import { formatCompanyNameOnly, canonicalCompanyName } from '../utils/companyDisplay';

const companyStore = useCompanyStore();
const warehouseStore = useWarehouseStore();
const channelStore = useChannelStore();
const requisitionStore = useRequisitionStore();
const { companies } = storeToRefs(companyStore);

const dialogVisible = ref(false);
const isEdit = ref(false);
const form = ref({ name: '', code: '' });
const editId = ref('');
const importRef = ref<HTMLInputElement | null>(null);
const keyword = ref('');
const tableRef = ref<TableInstance>();
const selectedRows = ref<Company[]>([]);

onMounted(() => {
  bootstrapStores();
});

const filteredCompanies = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return companies.value;
  return companies.value.filter(c => {
    const display = formatCompanyNameOnly(c).toLowerCase();
    return (
      c.code.toLowerCase().includes(q)
      || c.name.toLowerCase().includes(q)
      || display.includes(q)
    );
  });
});

const companyRefCount = (id: string) => {
  const wh = warehouseStore.warehouses.filter(w => w.companyId === id).length;
  const ch = channelStore.channels.filter(c => getChannelCompanyIds(c).includes(id)).length;
  const req = requisitionStore.requisitions.filter(r => r.companyId === id).length;
  return { wh, ch, req };
};

const openDialog = (company?: Company) => {
  if (company) {
    isEdit.value = true;
    editId.value = company.id;
    form.value = {
      name: formatCompanyNameOnly(company),
      code: company.code,
    };
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = { name: '', code: '' };
  }
  dialogVisible.value = true;
};

const handleSubmit = () => {
  if (!form.value.name.trim() || !form.value.code.trim()) {
    ElMessage.error('请填写公司名称和主体代码');
    return;
  }
  const code = form.value.code.trim();
  const name = canonicalCompanyName(form.value.name.trim(), code);
  if (!isEdit.value && companyStore.getCompanyByCode(code)) {
    ElMessage.error('该主体代码已存在');
    return;
  }
  if (isEdit.value) {
    const other = companyStore.companies.find(c => c.code === code && c.id !== editId.value);
    if (other) {
      ElMessage.error('该主体代码已存在');
      return;
    }
    companyStore.updateCompany(editId.value, { code, name });
    ElMessage.success('修改成功');
  } else {
    companyStore.addCompany({ code, name });
    ElMessage.success('新增成功');
  }
  dialogVisible.value = false;
};

const handleDelete = async (id: string) => {
  const { wh, ch, req } = companyRefCount(id);
  if (wh || ch || req) {
    ElMessage.warning(
      `该主体仍有 ${wh} 个仓库、${ch} 个渠道、${req} 张要货，请先改挂或删除后再删主体`,
    );
    return;
  }
  try {
    await ElMessageBox.confirm(
      '确认删除该公司？删除后不可恢复。',
      '删除公司',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    );
  } catch {
    return;
  }
  companyStore.deleteCompany(id);
  selectedRows.value = selectedRows.value.filter(r => r.id !== id);
  ElMessage.success('删除成功');
};

const onSelectionChange = (rows: Company[]) => {
  selectedRows.value = rows;
};

const handleBatchDelete = async () => {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先勾选要删除的公司');
    return;
  }
  const blocked = selectedRows.value.filter(c => {
    const r = companyRefCount(c.id);
    return r.wh > 0 || r.ch > 0 || r.req > 0;
  });
  if (blocked.length) {
    ElMessage.warning(
      `有 ${blocked.length} 家主体仍挂有仓库、渠道或要货，请先处理后再删`,
    );
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认删除已选 ${selectedRows.value.length} 家公司？删除后不可恢复。`,
      '批量删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  const ids = selectedRows.value.map(r => r.id);
  ids.forEach(id => companyStore.deleteCompany(id));
  selectedRows.value = [];
  tableRef.value?.clearSelection();
  ElMessage.success(`已删除 ${ids.length} 家`);
};

const exportCompanies = (rows: Company[]) => {
  if (!rows.length) {
    ElMessage.warning('暂无数据可导出');
    return;
  }
  exportRows(
    rows.map(c => ({ 主体代码: c.code, 公司名称: formatCompanyNameOnly(c) })),
    '公司主体',
  );
  ElMessage.success(`已导出 ${rows.length} 条`);
};

const handleExport = () => {
  exportCompanies(filteredCompanies.value);
};

const handleBatchExport = () => {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先勾选要导出的公司');
    return;
  }
  exportCompanies(selectedRows.value);
};

const handleTemplate = () => {
  downloadTemplate(['主体代码', '公司名称'], '公司主体导入模板');
};

const handleImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  let n = 0;
  rows.forEach(row => {
    const code = cell(row, '主体代码', '公司简称', '公司编码', 'code', '简称');
    const name = cell(row, '公司名称', 'name', '名称');
    if (!code || !name) return;
    companyStore.upsertByCode({ code, name });
    n += 1;
  });
  ElMessage.success(`导入完成 ${n} 条（按主体代码覆盖）`);
};
</script>

<template>
  <PageShell
    title="公司主体"
    help="维护经营公司。主体代码可用中文简称（如零碳、南非）或字母（如 ZC2）。渠道与仓库按公司隔离。&#10;本页「导入/导出」仅操作公司 Excel；整站数据备份请用顶栏「数据备份」。"
  >
    <template #toolbar>
      <input
        ref="importRef"
        type="file"
        accept=".xlsx,.xls"
        class="hidden-file"
        autocomplete="off"
        @change="handleImport"
      />
      <ElInput
        v-model="keyword"
        clearable
        size="small"
        class="toolbar-search"
        placeholder="请输入公司名称或编码搜索"
        autocomplete="off"
        name="company-search"
      />
      <ElButton type="primary" size="small" @click="openDialog()">新增主体</ElButton>
      <ElButton size="small" :disabled="!selectedRows.length" @click="handleBatchExport">
        导出已选{{ selectedRows.length ? ` (${selectedRows.length})` : '' }}
      </ElButton>
      <ElButton
        size="small"
        type="danger"
        plain
        :disabled="!selectedRows.length"
        @click="handleBatchDelete"
      >
        删除已选{{ selectedRows.length ? ` (${selectedRows.length})` : '' }}
      </ElButton>
      <span class="toolbar-sep" aria-hidden="true" />
      <ElButton size="small" @click="importRef?.click()">导入</ElButton>
      <ElButton size="small" @click="handleExport">导出</ElButton>
      <ElButton size="small" @click="handleTemplate">下载模板</ElButton>
    </template>

    <div class="table-wrap">
      <div v-if="selectedRows.length" class="selection-bar">
        已选 <strong>{{ selectedRows.length }}</strong> 家公司
        <ElButton link type="primary" size="small" @click="tableRef?.clearSelection()">取消勾选</ElButton>
      </div>
      <ElTable
        ref="tableRef"
        :data="filteredCompanies"
        border
        size="small"
        stripe
        class="erp-data-table"
        height="100%"
        row-key="id"
        @selection-change="onSelectionChange"
      >
        <ElTableColumn type="selection" width="48" fixed="left" />
        <ElTableColumn type="index" label="序号" width="55" />
        <ElTableColumn
          prop="code"
          label="主体代码"
          width="160"
          sortable
          show-overflow-tooltip
        />
        <ElTableColumn
          prop="name"
          label="公司名称"
          min-width="220"
          sortable
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ formatCompanyNameOnly(row as Company) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="openDialog(row as Company)">编辑</ElButton>
            <ElButton link type="danger" size="small" @click="handleDelete((row as Company).id)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div v-if="keyword.trim() && !filteredCompanies.length" class="empty-hint">
        未找到匹配「{{ keyword }}」的公司
      </div>
    </div>

    <ElDialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑主体' : '新增主体'"
      width="440px"
      destroy-on-close
    >
      <ElForm :model="form" label-width="96px" size="small" autocomplete="off">
        <ElFormItem label="主体代码" required>
          <ElInput
            v-model="form.code"
            placeholder="如：零碳、南非、ZC2"
            autocomplete="off"
            name="company-code"
          />
        </ElFormItem>
        <ElFormItem label="公司名称" required>
          <ElInput
            v-model="form.name"
            placeholder="完整公司名称"
            autocomplete="off"
            name="company-name"
          />
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
.toolbar-search {
  width: 240px;
}

.toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--erp-border);
  margin: 0 2px;
}

.table-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 0 12px 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.selection-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--erp-text-muted);
  background: #f0f5ff;
  border: 1px solid #d6e4ff;
  border-radius: 6px;
}

.selection-bar strong {
  color: var(--erp-primary);
}

.empty-hint {
  position: absolute;
  left: 50%;
  top: 48%;
  transform: translate(-50%, -50%);
  font-size: 13px;
  color: var(--erp-text-muted);
  pointer-events: none;
}

.hidden-file {
  display: none;
}
</style>
