<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
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
  ElMessageBox,
  ElCheckbox,
} from 'element-plus';
import type { TableInstance } from 'element-plus';
import PageShell from '../components/PageShell.vue';
import HelpTip from '../components/HelpTip.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import { useWarehouseStore } from '../stores/warehouse';
import { useCompanyStore } from '../stores/company';
import { bootstrapStores } from '../stores/bootstrap';
import type { Warehouse } from '../types';
import { readExcelFromEvent, exportRows, downloadTemplate, cell } from '../utils/excel';
import { useRememberedCompanyFilter } from '../composables/useRememberedCompanyFilter';

const store = useWarehouseStore();
const companyStore = useCompanyStore();
const { warehouses } = storeToRefs(store);
const { companies } = storeToRefs(companyStore);

const filterCompanyIds = useRememberedCompanyFilter('warehouses');
const dialogVisible = ref(false);
const isEdit = ref(false);
const form = ref({
  code: '',
  name: '',
  companyId: '',
  syncCodeName: true,
});
const editId = ref('');
const importRef = ref<HTMLInputElement | null>(null);
const tableRef = ref<TableInstance>();
const selectedRows = ref<Warehouse[]>([]);

const batchVisible = ref(false);
const batchForm = ref({
  applyCompany: false,
  companyId: '',
  syncCodeToName: true,
});

onMounted(() => {
  bootstrapStores();
});

const companyFilterOptions = computed(() =>
  companies.value.map(c => ({ value: c.id, label: `${c.name}（${c.code}）` })),
);

const listRows = computed(() => {
  if (!filterCompanyIds.value.length) return warehouses.value;
  const set = new Set(filterCompanyIds.value);
  return warehouses.value.filter(w => set.has(w.companyId));
});

watch(
  () => form.value.name,
  name => {
    if (form.value.syncCodeName) form.value.code = name;
  },
);

const onSelectionChange = (rows: Warehouse[]) => {
  selectedRows.value = rows;
};

const openDialog = (warehouse?: Warehouse) => {
  if (warehouse) {
    isEdit.value = true;
    editId.value = warehouse.id;
    const same = warehouse.code === warehouse.name;
    form.value = {
      code: warehouse.code,
      name: warehouse.name,
      companyId: warehouse.companyId || '',
      syncCodeName: same,
    };
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = {
      code: '',
      name: '',
      companyId: '',
      syncCodeName: true,
    };
  }
  dialogVisible.value = true;
};

const handleSubmit = () => {
  const name = form.value.name.trim();
  const code = (form.value.syncCodeName ? name : form.value.code).trim() || name;
  if (!name) {
    ElMessage.error('请填写仓库名称');
    return;
  }
  if (!code) {
    ElMessage.error('请填写仓库编码');
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

  const payload = { code, name, companyId: form.value.companyId };
  if (isEdit.value) {
    store.updateWarehouse(editId.value, payload);
    ElMessage.success('修改成功');
  } else {
    store.addWarehouse(payload);
    ElMessage.success('添加成功');
  }
  dialogVisible.value = false;
};

const handleDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm('确认删除该仓库？', '删除仓库', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  store.deleteWarehouse(id);
  ElMessage.success('删除成功');
};

const openBatchDialog = () => {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先勾选要批量编辑的仓库');
    return;
  }
  batchForm.value = {
    applyCompany: false,
    companyId: '',
    syncCodeToName: true,
  };
  batchVisible.value = true;
};

const handleBatchSubmit = () => {
  const { applyCompany, companyId, syncCodeToName } = batchForm.value;
  if (!applyCompany && !syncCodeToName) {
    ElMessage.warning('请至少勾选一项要修改的内容');
    return;
  }
  if (applyCompany && !companyId) {
    ElMessage.error('请选择所属主体');
    return;
  }
  if (applyCompany && !companyStore.getCompanyById(companyId)) {
    ElMessage.error('所属主体不存在');
    return;
  }

  const ids = selectedRows.value.map(r => r.id);
  const n = store.batchUpdate(ids, w => {
    const patch: Partial<Warehouse> = {};
    if (applyCompany) patch.companyId = companyId;
    if (syncCodeToName) patch.code = w.name;
    return patch;
  });
  tableRef.value?.clearSelection();
  selectedRows.value = [];
  batchVisible.value = false;
  ElMessage.success(
    syncCodeToName
      ? `已更新 ${n} 个仓库（编码已与名称对齐，库存导入可用仓库名匹配）`
      : `已更新 ${n} 个仓库`,
  );
};

const handleSyncAllVisible = async () => {
  const rows = listRows.value;
  if (!rows.length) return;
  try {
    await ElMessageBox.confirm(
      `将当前列表 ${rows.length} 个仓库的「编码」改成与「名称」相同？\n便于库存 Excel 只有仓库名称时也能导入。`,
      '编码对齐名称',
      { type: 'warning', confirmButtonText: '确认对齐', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  const n = store.syncCodeToName(rows.map(r => r.id));
  ElMessage.success(n ? `已对齐 ${n} 个仓库` : '已全部对齐，无需修改');
};

const getCompanyCode = (id: string) => companyStore.getCompanyById(id)?.code || '';

const handleExport = () => {
  exportRows(
    listRows.value.map(w => ({
      仓库编码: w.code,
      仓库名称: w.name,
      公司编码: getCompanyCode(w.companyId),
    })),
    '仓库',
  );
  ElMessage.success(`已导出 ${listRows.value.length} 条`);
};

const handleTemplate = () => {
  downloadTemplate(['仓库名称', '仓库编码', '公司编码'], '仓库导入模板');
};

const handleImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  let n = 0;
  let skipped = 0;
  rows.forEach(row => {
    const name = cell(row, '仓库名称', 'name', '仓库');
    let code = cell(row, '仓库编码', 'code');
    const companyCode = cell(row, '公司编码', 'companyCode', '所属主体', '主体编码');
    // 无编码时用名称当编码（适配你们系统导出）
    if (!code && name) code = name;
    if (!name && code) {
      // 只有编码列时也当名称
    }
    const finalName = name || code;
    const finalCode = code || name;
    if (!finalName || !finalCode) return;

    const company = companyStore.getCompanyByCode(companyCode);
    if (!company) {
      skipped += 1;
      return;
    }

    try {
      store.upsertWarehouse({
        code: finalCode,
        name: finalName,
        companyId: company.id,
      });
      n += 1;
    } catch {
      skipped += 1;
    }
  });
  ElMessage.success(
    skipped
      ? `导入完成 ${n} 条（覆盖已有仓），跳过 ${skipped} 条（主体编码不存在等）`
      : `导入完成 ${n} 条（按编码/名称覆盖已有仓；无编码则编码=名称）`,
  );
};

const getCompanyName = (id: string) => companyStore.getCompanyById(id)?.name || '';
</script>

<template>
  <PageShell
    title="仓库管理"
    help="建议「编码=名称」：你们库存导出常无仓库编码，导入时可用仓库名称匹配。仓库导入按编码或名称覆盖已有仓。"
  >
    <template #toolbar>
      <input ref="importRef" type="file" accept=".xlsx,.xls" class="hidden-file" @change="handleImport" />
      <MultiCheckFilter
        v-model="filterCompanyIds"
        :options="companyFilterOptions"
        placeholder="主体(可多选)"
        width="200px"
      />
      <ElButton type="primary" size="small" @click="openDialog()">添加仓库</ElButton>
      <ElButton size="small" :disabled="!selectedRows.length" @click="openBatchDialog">
        批量编辑{{ selectedRows.length ? `（${selectedRows.length}）` : '' }}
      </ElButton>
      <ElButton size="small" @click="handleSyncAllVisible">编码对齐名称</ElButton>
      <HelpTip
        inline
        title="为何编码=名称"
        content="库存 Excel 往往只有「仓库名称」没有编码。\n把编码改成与名称相同后，库存导入可用名称匹配仓库。\n仓库主数据导入也会按编码/名称覆盖已有仓。"
      />
      <ElButton size="small" @click="importRef?.click()">导入</ElButton>
      <ElButton size="small" @click="handleExport">导出</ElButton>
      <ElButton size="small" @click="handleTemplate">下载模板</ElButton>
    </template>

    <div class="table-wrap">
      <ElTable
        ref="tableRef"
        :data="listRows"
        border
        size="small"
        stripe
        class="erp-data-table"
        height="100%"
        row-key="id"
        @selection-change="onSelectionChange"
      >
        <ElTableColumn type="selection" width="42" fixed="left" />
        <ElTableColumn type="index" label="序号" width="55" fixed="left" />
        <ElTableColumn prop="code" label="仓库编码" width="160" sortable show-overflow-tooltip />
        <ElTableColumn prop="name" label="仓库名称" min-width="180" sortable show-overflow-tooltip />
        <ElTableColumn label="编码=名称" width="100" align="center">
          <template #default="{ row }">
            <span :class="(row as Warehouse).code === (row as Warehouse).name ? 'ok' : 'warn'">
              {{ (row as Warehouse).code === (row as Warehouse).name ? '是' : '否' }}
            </span>
          </template>
        </ElTableColumn>
        <ElTableColumn
          label="所属主体"
          width="140"
          sortable
          :sort-method="(a: Warehouse, b: Warehouse) => getCompanyName(a.companyId).localeCompare(getCompanyName(b.companyId), 'zh-CN')"
        >
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

    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑仓库' : '添加仓库'" width="480px">
      <ElForm :model="form" label-width="100px" size="small">
        <ElFormItem label="仓库名称">
          <ElInput v-model="form.name" placeholder="与系统导出名称保持一致" />
        </ElFormItem>
        <ElFormItem>
          <ElCheckbox v-model="form.syncCodeName">编码与名称相同（推荐，便于库存导入）</ElCheckbox>
        </ElFormItem>
        <ElFormItem label="仓库编码">
          <ElInput v-model="form.code" :disabled="form.syncCodeName" placeholder="默认同名称" />
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

    <ElDialog
      v-model="batchVisible"
      title="批量编辑仓库"
      width="480px"
      append-to-body
      :close-on-click-modal="false"
    >
      <div class="batch-tip">
        已选 <strong>{{ selectedRows.length }}</strong> 个仓库。建议勾选「编码=名称」，方便库存 Excel 用仓库名导入。
      </div>
      <ElForm label-width="140px" size="small">
        <ElFormItem>
          <template #label>
            <ElCheckbox v-model="batchForm.syncCodeToName">编码=名称</ElCheckbox>
          </template>
          <span class="form-hint">把编码改成与各自名称相同</span>
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <ElCheckbox v-model="batchForm.applyCompany">所属主体</ElCheckbox>
          </template>
          <ElSelect
            v-model="batchForm.companyId"
            placeholder="统一改到该主体"
            filterable
            :disabled="!batchForm.applyCompany"
            style="width: 100%"
          >
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
        <ElButton size="small" @click="batchVisible = false">取消</ElButton>
        <ElButton size="small" type="primary" @click="handleBatchSubmit">应用</ElButton>
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

.ok {
  color: #67c23a;
}
.warn {
  color: #e6a23c;
}

.batch-tip {
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #f0f5fb;
  border: 1px solid #d6e4f5;
  font-size: 13px;
}

.form-hint {
  font-size: 12px;
  color: var(--erp-text-muted);
}
</style>
