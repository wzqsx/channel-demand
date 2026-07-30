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
  ElTag,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
} from 'element-plus';
import type { TableInstance } from 'element-plus';
import PageShell from '../components/PageShell.vue';
import HelpTip from '../components/HelpTip.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import { useWarehouseStore } from '../stores/warehouse';
import { useCompanyStore } from '../stores/company';
import { useChannelStore } from '../stores/channel';
import { useRequisitionStore } from '../stores/requisition';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { bootstrapStores } from '../stores/bootstrap';
import type { Warehouse } from '../types';
import { readExcelFromEvent, exportRows, downloadTemplate, cell } from '../utils/excel';
import { useRememberedCompanyFilter } from '../composables/useRememberedCompanyFilter';
import { formatCompanyLabel, formatCompanyNameOnly } from '../utils/companyDisplay';

const store = useWarehouseStore();
const companyStore = useCompanyStore();
const channelStore = useChannelStore();
const requisitionStore = useRequisitionStore();
const stockStore = useWarehouseStockStore();
const { warehouses } = storeToRefs(store);
const { companies } = storeToRefs(companyStore);

const filterCompanyIds = useRememberedCompanyFilter('warehouses');
const dialogVisible = ref(false);
const isEdit = ref(false);
/** 每次保存后递增，强制表格重挂载以刷新「所属主体」列 */
const tableTick = ref(0);
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
  companies.value.map(c => ({
    value: c.id,
    label: formatCompanyLabel(c),
  })),
);

/** id → 标准主体名称（与下拉同源） */
const companyNameById = computed(() => {
  const map: Record<string, string> = {};
  for (const c of companies.value) {
    map[c.id] = formatCompanyNameOnly(c);
  }
  return map;
});

const listRows = computed(() => {
  void tableTick.value;
  const all = warehouses.value;
  const rows = !filterCompanyIds.value.length
    ? all
    : all.filter(w => filterCompanyIds.value.includes(w.companyId));
  // 新数组 + 新对象，杜绝 ElTable 行缓存
  return rows.map(w => ({
    id: w.id,
    code: w.code,
    name: w.name,
    companyId: w.companyId,
  }));
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

  const payload = {
    code,
    name,
    companyId: String(form.value.companyId),
  };
  if (isEdit.value) {
    const ok = store.updateWarehouse(editId.value, payload);
    if (!ok) {
      ElMessage.error('未找到该仓库，请关闭弹窗后重试');
      return;
    }
    const saved = store.getWarehouseById(editId.value);
    if (!saved || saved.companyId !== payload.companyId) {
      // id 可能已变，按编码再确认
      const byCode = store.getWarehouseByCode(payload.code);
      if (!byCode || byCode.companyId !== payload.companyId) {
        ElMessage.error('主体保存失败，请重试');
        return;
      }
    }
    // 改主体后若当前筛选不含新主体，并入筛选，避免行被滤掉像「没更新」
    if (
      filterCompanyIds.value.length > 0 &&
      !filterCompanyIds.value.includes(payload.companyId)
    ) {
      filterCompanyIds.value = [...filterCompanyIds.value, payload.companyId];
    }
    tableTick.value += 1;
    ElMessage.success('修改成功');
  } else {
    store.addWarehouse(payload);
    tableTick.value += 1;
    ElMessage.success('添加成功');
  }
  dialogVisible.value = false;
};

const warehouseRefCount = (id: string) => {
  const channels = channelStore.channels.filter(c => (c.warehouseIds || []).includes(id)).length;
  const reqs = requisitionStore.requisitions.filter(r => (r.warehouseIds || []).includes(id)).length;
  const stocks = stockStore.stocks.filter(s => s.warehouseId === id).length;
  return { channels, reqs, stocks };
};

const handleDelete = async (id: string) => {
  const ref = warehouseRefCount(id);
  if (ref.channels || ref.reqs || ref.stocks) {
    ElMessage.warning(
      `该仓库仍被 ${ref.channels} 个渠道、${ref.reqs} 张要货、${ref.stocks} 条库存引用，请先解除后再删`,
    );
    return;
  }
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
  tableTick.value += 1;
  ElMessage.success('删除成功');
};

const clearSelection = () => {
  tableRef.value?.clearSelection();
  selectedRows.value = [];
};

const handleBatchDelete = async () => {
  const rows = selectedRows.value;
  if (!rows.length) {
    ElMessage.warning('请先勾选要删除的仓库');
    return;
  }
  const blocked = rows.filter(r => {
    const ref = warehouseRefCount(r.id);
    return ref.channels || ref.reqs || ref.stocks;
  });
  if (blocked.length) {
    ElMessage.warning(`有 ${blocked.length} 个仓库仍被渠道/要货/库存引用，请先处理后再删`);
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认删除已选的 ${rows.length} 个仓库？此操作不可恢复。`,
      '批量删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  rows.forEach(r => store.deleteWarehouse(r.id));
  tableTick.value += 1;
  clearSelection();
  ElMessage.success(`已删除 ${rows.length} 个仓库`);
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
  if (applyCompany && filterCompanyIds.value.length && !filterCompanyIds.value.includes(companyId)) {
    filterCompanyIds.value = [...filterCompanyIds.value, companyId];
  }
  tableTick.value += 1;
  clearSelection();
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

const handleExcelCommand = (cmd: string | number) => {
  if (cmd === 'import') importRef.value?.click();
  else if (cmd === 'export') handleExport();
  else if (cmd === 'template') handleTemplate();
};

const handleToolsCommand = (cmd: string | number) => {
  if (cmd === 'sync-code') handleSyncAllVisible();
};

const isCodeNameAligned = (w: Warehouse) => String(w.code || '').trim() === String(w.name || '').trim();

/** 编码=名称：已平=绿，未平=橙（提醒需对齐） */
const codeNameStatus = (w: Warehouse) =>
  isCodeNameAligned(w)
    ? { text: '已平', type: 'success' as const, effect: 'light' as const }
    : { text: '未平', type: 'warning' as const, effect: 'dark' as const };

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

const getCompanyName = (id: string) => {
  if (companyNameById.value[id]) return companyNameById.value[id];
  const c = companyStore.getCompanyById(id);
  return c ? formatCompanyNameOnly(c) : id || '—';
};
</script>

<template>
  <PageShell
    title="仓库管理"
    help="每个仓库只归属一个主体（编辑时单选）。顶部「主体」筛选可多选，仅过滤列表，不改变仓库归属。&#10;建议「编码=名称」便于库存导入。本页「Excel」仅操作仓库主数据；整站备份请用顶栏「数据备份」。"
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
      <div class="wh-toolbar">
        <div class="wh-toolbar__left">
          <MultiCheckFilter
            v-model="filterCompanyIds"
            :options="companyFilterOptions"
            placeholder="主体筛选(可多选)"
            width="220px"
          />
          <span class="wh-toolbar__hint">仅筛选列表</span>
        </div>
        <div class="wh-toolbar__right">
          <ElButton type="primary" size="small" @click="openDialog()">添加仓库</ElButton>
          <span class="toolbar-sep" aria-hidden="true" />
          <ElDropdown trigger="click" @command="handleExcelCommand">
            <ElButton size="small">
              Excel
              <span class="dropdown-caret">▾</span>
            </ElButton>
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem command="import">导入</ElDropdownItem>
                <ElDropdownItem command="export">导出当前列表</ElDropdownItem>
                <ElDropdownItem command="template" divided>下载模板</ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
          <ElDropdown trigger="click" @command="handleToolsCommand">
            <ElButton size="small">
              工具
              <span class="dropdown-caret">▾</span>
            </ElButton>
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem command="sync-code">编码对齐名称（当前列表）</ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
          <HelpTip
            inline
            title="为何编码=名称"
            content="库存 Excel 往往只有「仓库名称」没有编码。\n把编码改成与名称相同后，库存导入可用名称匹配仓库。\n可在表格勾选后「批量编辑」，或用工具栏「工具 → 编码对齐名称」。"
          />
        </div>
      </div>
    </template>

    <div class="table-wrap">
      <div v-if="selectedRows.length" class="selection-bar">
        已选 <strong>{{ selectedRows.length }}</strong> 个仓库
        <ElButton size="small" type="primary" plain @click="openBatchDialog">批量编辑</ElButton>
        <ElButton size="small" type="danger" plain @click="handleBatchDelete">删除已选</ElButton>
        <ElButton link type="primary" size="small" @click="clearSelection">取消勾选</ElButton>
      </div>
      <ElTable
        :key="`wh-table-${tableTick}`"
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
        <ElTableColumn type="selection" width="48" fixed="left" />
        <ElTableColumn type="index" label="序号" width="55" fixed="left" />
        <ElTableColumn prop="code" label="仓库编码" width="160" sortable show-overflow-tooltip />
        <ElTableColumn prop="name" label="仓库名称" min-width="180" sortable show-overflow-tooltip />
        <ElTableColumn label="编码=名称" width="100" align="center">
          <template #default="{ row }">
            <ElTag
              size="small"
              :type="codeNameStatus(row as Warehouse).type"
              :effect="codeNameStatus(row as Warehouse).effect"
              class="code-name-tag"
              :class="{ 'code-name-tag--ok': isCodeNameAligned(row as Warehouse) }"
            >
              {{ codeNameStatus(row as Warehouse).text }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn
          label="所属主体"
          min-width="140"
          sortable
          :sort-method="(a: Warehouse, b: Warehouse) => getCompanyName(a.companyId).localeCompare(getCompanyName(b.companyId), 'zh-CN')"
        >
          <template #default="{ row }">
            <span :key="`${(row as Warehouse).id}-${(row as Warehouse).companyId}-${tableTick}`">
              {{ getCompanyName((row as Warehouse).companyId) }}
            </span>
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

    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑仓库' : '添加仓库'" width="480px" destroy-on-close>
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
          <ElSelect
            v-model="form.companyId"
            placeholder="请选择一个主体（单选）"
            filterable
            style="width: 100%"
          >
            <ElOption
              v-for="company in companies"
              :key="`${company.id}-${company.name}-${company.code}`"
              :label="formatCompanyLabel(company)"
              :value="company.id"
            />
          </ElSelect>
        </ElFormItem>
        <!-- 与表单项 content 同列对齐（缩进 = label-width 100px） -->
        <p class="form-helper form-helper--indent">一个仓库只能归属一个主体</p>
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
            placeholder="统一改到该主体（单选）"
            filterable
            :disabled="!batchForm.applyCompany"
            style="width: 100%"
          >
            <ElOption
              v-for="company in companies"
              :key="`${company.id}-${company.name}-${company.code}`"
              :label="formatCompanyLabel(company)"
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
.wh-toolbar {
  flex: 1;
  min-width: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  flex-wrap: wrap;
}
.wh-toolbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.wh-toolbar__hint {
  font-size: 12px;
  color: var(--erp-text-muted);
  white-space: nowrap;
}
.wh-toolbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-wrap: wrap;
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

.toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--erp-border);
  margin: 0 2px;
}

.dropdown-caret {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.7;
}

.hidden-file {
  display: none;
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
  font-size: 14px;
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
.form-helper {
  margin: 0;
  padding: 0;
  font-size: 12px;
  line-height: 1.45;
  color: #909399;
  font-weight: 400;
}
/* 与上方输入框左边缘对齐：缩进 = ElForm label-width */
.form-helper--indent {
  margin: -4px 0 4px;
  padding-left: 100px;
  box-sizing: border-box;
}
</style>
