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
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import HelpTip from '../components/HelpTip.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import { useChannelStore } from '../stores/channel';
import { useWarehouseStore } from '../stores/warehouse';
import { useCompanyStore } from '../stores/company';
import { bootstrapStores } from '../stores/bootstrap';
import type { Channel } from '../types';
import { readExcelFromEvent, exportRows, downloadTemplate, cell, cellNum } from '../utils/excel';
import { useRememberedCompanyFilter } from '../composables/useRememberedCompanyFilter';

const channelStore = useChannelStore();
const warehouseStore = useWarehouseStore();
const companyStore = useCompanyStore();
const { channels } = storeToRefs(channelStore);
const { companies } = storeToRefs(companyStore);

const filterCompanyIds = useRememberedCompanyFilter('channels');
const dialogVisible = ref(false);
const isEdit = ref(false);
/** 右侧当前浏览的主体（点左侧切换，不清空已选仓库） */
const focusCompanyId = ref('');
const form = ref({
  name: '',
  warehouseIds: [] as string[],
  priority: 100,
  /** 左侧勾选的主体（可多选） */
  companyIds: [] as string[],
});
const editId = ref('');
const importRef = ref<HTMLInputElement | null>(null);

onMounted(() => {
  bootstrapStores();
});

const openDialog = (channel?: Channel) => {
  if (channel) {
    isEdit.value = true;
    editId.value = channel.id;
    form.value = {
      name: channel.name,
      warehouseIds: [...channel.warehouseIds],
      priority: channel.priority || 100,
      companyIds: channel.companyId ? [channel.companyId] : [],
    };
    focusCompanyId.value = channel.companyId || '';
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = { name: '', warehouseIds: [], priority: 100, companyIds: [] };
    focusCompanyId.value = '';
  }
  dialogVisible.value = true;
};

/** 点左侧主体：切换右侧列表；已选仓库全部保留 */
const focusCompany = (id: string) => {
  if (!id) return;
  focusCompanyId.value = id;
  if (!form.value.companyIds.includes(id)) {
    form.value.companyIds = [...form.value.companyIds, id];
  }
};

/** 勾/取消主体：取消时去掉该主体下已选仓库 */
const toggleCompanyCheck = (id: string) => {
  if (!id) return;
  const cur = form.value.companyIds;
  if (cur.includes(id)) {
    form.value.companyIds = cur.filter(x => x !== id);
    const drop = new Set(warehouseStore.getWarehousesByCompany(id).map(w => w.id));
    form.value.warehouseIds = form.value.warehouseIds.filter(wid => !drop.has(wid));
    if (focusCompanyId.value === id) {
      focusCompanyId.value = form.value.companyIds[0] || '';
    }
  } else {
    form.value.companyIds = [...cur, id];
    focusCompanyId.value = id;
  }
};

const isCompanyChecked = (id: string) => form.value.companyIds.includes(id);

const warehouseCountOf = (companyId: string) =>
  warehouseStore.getWarehousesByCompany(companyId).length;

const selectedWarehouseCountOf = (companyId: string) => {
  const set = new Set(warehouseStore.getWarehousesByCompany(companyId).map(w => w.id));
  return form.value.warehouseIds.filter(id => set.has(id)).length;
};

const totalSelectedWarehouses = computed(() => form.value.warehouseIds.length);

/** 只清空「当前右侧主体」的已选仓库，其它主体已选保留 */
const clearWarehouses = () => {
  if (!focusCompanyId.value) {
    form.value.warehouseIds = [];
    return;
  }
  const drop = new Set(
    warehouseStore.getWarehousesByCompany(focusCompanyId.value).map(w => w.id),
  );
  form.value.warehouseIds = form.value.warehouseIds.filter(id => !drop.has(id));
};

const toggleWarehouse = (id: string) => {
  if (!id) return;
  const cur = form.value.warehouseIds;
  form.value.warehouseIds = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
};

const isWarehouseChecked = (id: string) => form.value.warehouseIds.includes(id);

const handleSubmit = () => {
  const name = form.value.name.trim();
  if (!name) return ElMessage.error('请填写渠道名称');
  if (!form.value.warehouseIds.length) return ElMessage.error('请至少选择一个仓库');

  const companyOfWh = new Set<string>();
  for (const wid of form.value.warehouseIds) {
    const w = warehouseStore.getWarehouseById(wid);
    if (!w) return ElMessage.error('存在无效仓库，请重新勾选');
    companyOfWh.add(w.companyId);
  }
  if (companyOfWh.size > 1) {
    return ElMessage.error(
      '同一渠道的仓库必须属于同一主体。请取消其它主体下的仓库（左侧可看各主体「已选」数量）',
    );
  }
  const companyId = [...companyOfWh][0];
  if (!companyStore.getCompanyById(companyId)) {
    return ElMessage.error('所属主体不存在，请重新选择');
  }

  const payload = {
    name,
    companyId,
    warehouseIds: [...form.value.warehouseIds],
    priority: form.value.priority,
  };

  if (isEdit.value) {
    channelStore.updateChannel(editId.value, payload);
    ElMessage.success('修改成功');
  } else {
    channelStore.addChannel(payload);
    ElMessage.success('添加成功');
  }
  dialogVisible.value = false;
};

const handleDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm('确认删除该渠道？', '删除渠道', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  channelStore.deleteChannel(id);
  ElMessage.success('删除成功');
};

const getCompanyCode = (id: string) => companyStore.getCompanyById(id)?.code || '';

const getWarehouseCodes = (ids: string[]) =>
  ids
    .map(id => warehouseStore.getWarehouseById(id)?.code)
    .filter((c): c is string => !!c)
    .join(',');

const handleExport = () => {
  exportRows(
    listRows.value.map(ch => ({
      渠道名称: ch.name,
      主体编码: getCompanyCode(ch.companyId),
      '仓库编码(逗号分隔)': getWarehouseCodes(ch.warehouseIds),
      优先级: ch.priority,
    })),
    '渠道',
  );
  ElMessage.success(`已导出 ${listRows.value.length} 条`);
};

const handleTemplate = () => {
  downloadTemplate(['渠道名称', '主体编码', '仓库编码(逗号分隔)', '优先级'], '渠道导入模板');
};

const handleImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  let n = 0;
  let skipped = 0;
  rows.forEach(row => {
    const name = cell(row, '渠道名称', 'name');
    const companyCode = cell(row, '主体编码', 'companyCode');
    const warehouseCodesRaw = cell(row, '仓库编码(逗号分隔)', '仓库编码', 'warehouseCodes');
    const priority = cellNum(row, '优先级', 'priority') || 100;
    if (!name || !companyCode) return;

    const company = companyStore.getCompanyByCode(companyCode);
    if (!company) {
      skipped += 1;
      return;
    }

    const codes = warehouseCodesRaw.split(/[,，]/).map(c => c.trim()).filter(Boolean);
    const companyWarehouses = warehouseStore.getWarehousesByCompany(company.id);
    const warehouseIds = codes
      .map(code => companyWarehouses.find(w => w.code === code)?.id)
      .filter((id): id is string => !!id);
    if (!warehouseIds.length) {
      skipped += 1;
      return;
    }

    channelStore.upsertChannel({
      name,
      companyId: company.id,
      warehouseIds,
      priority,
    });
    n += 1;
  });
  ElMessage.success(
    skipped
      ? `导入完成 ${n} 条，跳过 ${skipped} 条（主体或仓库无效）`
      : `导入完成 ${n} 条（按名称+主体覆盖）`,
  );
};

const getWarehouseNames = (ids: string[]) =>
  ids.map(id => warehouseStore.getWarehouseById(id)?.name || id).join('、');
const getCompanyName = (id: string) => companyStore.getCompanyById(id)?.name || id;
const getPriorityLabel = (priority: number) => {
  if (priority <= 3) return `P${priority} 高`;
  if (priority <= 10) return `P${priority} 中`;
  return `P${priority} 低`;
};
const filteredWarehouses = computed(() =>
  focusCompanyId.value ? warehouseStore.getWarehousesByCompany(focusCompanyId.value) : [],
);

const currentSelectedCount = computed(() =>
  focusCompanyId.value ? selectedWarehouseCountOf(focusCompanyId.value) : 0,
);

const selectAllWarehouses = () => {
  const ids = filteredWarehouses.value.map(w => w.id);
  form.value.warehouseIds = [...new Set([...form.value.warehouseIds, ...ids])];
};

const companyFilterOptions = computed(() =>
  companies.value.map(c => ({ value: c.id, label: `${c.name}（${c.code}）` })),
);

const listRows = computed(() => {
  if (!filterCompanyIds.value.length) return channels.value;
  const set = new Set(filterCompanyIds.value);
  return channels.value.filter(ch => set.has(ch.companyId));
});
</script>

<template>
  <PageShell title="渠道管理" help="按主体隔离；优先级数字越小越高，仅同主体内参与占库存竞争。主体/仓库下拉与主数据实时同步。">
    <template #toolbar>
      <input ref="importRef" type="file" accept=".xlsx,.xls" class="hidden-file" @change="handleImport" />
      <MultiCheckFilter
        v-model="filterCompanyIds"
        :options="companyFilterOptions"
        placeholder="主体(可多选)"
        width="200px"
      />
      <ElButton type="primary" size="small" @click="openDialog()">添加渠道</ElButton>
      <ElButton size="small" @click="importRef?.click()">导入</ElButton>
      <ElButton size="small" @click="handleExport">导出</ElButton>
      <ElButton size="small" @click="handleTemplate">下载模板</ElButton>
    </template>
    <div class="table-wrap">
      <ElTable :data="listRows" border size="small" stripe class="erp-data-table" height="100%">
        <ElTableColumn prop="name" label="渠道" width="140" />
        <ElTableColumn label="主体" width="120">
          <template #default="{ row }">{{ getCompanyName((row as Channel).companyId) }}</template>
        </ElTableColumn>
        <ElTableColumn label="可用仓库" min-width="200">
          <template #default="{ row }">{{ getWarehouseNames((row as Channel).warehouseIds) }}</template>
        </ElTableColumn>
        <ElTableColumn label="优先级" width="110">
          <template #default="{ row }">
            <ElTag
              size="small"
              :type="(row as Channel).priority <= 3 ? 'danger' : (row as Channel).priority <= 10 ? 'warning' : 'info'"
            >
              {{ getPriorityLabel((row as Channel).priority) }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="openDialog(row as Channel)">编辑</ElButton>
            <ElButton link type="danger" size="small" @click="handleDelete((row as Channel).id)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <ElDialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑渠道' : '添加渠道'"
      width="720px"
      append-to-body
      align-center
      :close-on-click-modal="false"
      destroy-on-close
    >
      <ElForm :model="form" label-width="88px" size="small" @submit.prevent>
        <ElFormItem label="渠道名称">
          <ElInput
            v-model="form.name"
            clearable
            maxlength="64"
            show-word-limit
            placeholder="例如：快乐猴（中文无限制）"
          />
        </ElFormItem>
        <ElFormItem label="主体仓库">
          <div class="scope-wrap">
            <div class="scope-total">
              已选仓库合计
              <strong>{{ totalSelectedWarehouses }}</strong>
              个
              <span v-if="focusCompanyId" class="scope-total__sub">
                （当前主体本页 {{ currentSelectedCount }}/{{ filteredWarehouses.length }}）
              </span>
            </div>
            <div class="scope-split">
            <div class="scope-pane scope-pane--left">
              <div class="scope-pane__head">
                <span>主体</span>
                <span class="scope-pane__meta">可多选 · 点行切换</span>
              </div>
              <div v-if="companies.length" class="scope-pane__body">
                <div
                  v-for="(c, idx) in companies"
                  :key="`${c.code}__${c.id}__${idx}`"
                  class="scope-node"
                  :class="{
                    active: focusCompanyId === c.id,
                    on: isCompanyChecked(c.id),
                  }"
                  @click="focusCompany(c.id)"
                >
                  <span
                    class="wh-box__check"
                    :class="{ on: isCompanyChecked(c.id) }"
                    @click.stop="toggleCompanyCheck(c.id)"
                  />
                  <div class="scope-node__main">
                    <div class="scope-node__title">{{ c.name }}</div>
                    <div class="scope-node__sub">
                      {{ c.code }} · {{ warehouseCountOf(c.id) }} 仓
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="scope-pane__empty">暂无主体</div>
            </div>

            <div class="scope-pane scope-pane--right">
              <div class="scope-pane__head">
                <span>可用仓库</span>
                <span class="scope-pane__meta">
                  {{ currentSelectedCount }}/{{ filteredWarehouses.length }}
                </span>
                <ElButton
                  link
                  type="primary"
                  size="small"
                  :disabled="!filteredWarehouses.length"
                  @click="selectAllWarehouses"
                >
                  全选
                </ElButton>
                <ElButton link size="small" :disabled="!currentSelectedCount" @click="clearWarehouses">
                  清空本页
                </ElButton>
              </div>
              <div v-if="filteredWarehouses.length" class="scope-pane__body">
                <div
                  v-for="(w, idx) in filteredWarehouses"
                  :key="`${w.code}__${w.id}__${idx}`"
                  class="scope-node scope-node--leaf"
                  :class="{ on: isWarehouseChecked(w.id) }"
                  @click="toggleWarehouse(w.id)"
                >
                  <span class="wh-box__check" :class="{ on: isWarehouseChecked(w.id) }" />
                  <div class="scope-node__main">
                    <div class="scope-node__title">{{ w.name }}</div>
                    <div class="scope-node__sub">{{ w.code }}</div>
                  </div>
                </div>
              </div>
              <div v-else class="scope-pane__empty">
                {{ focusCompanyId ? '该主体下暂无仓库' : '请先在左侧点选/勾选主体' }}
              </div>
            </div>
          </div>
          <div class="scope-tip">
            左侧点行切换右侧仓库列表；合计显示全部已选仓库数。保存时同一渠道仓库须属于同一主体。
          </div>
          </div>
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <span class="label-with-help">
              优先级
              <HelpTip inline content="数字越小优先级越高（同主体内比较）" />
            </span>
          </template>
          <ElInputNumber v-model="form.priority" :min="1" style="width: 100%" />
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

.scope-wrap {
  width: 100%;
}
.scope-total {
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #f0f5fb;
  border: 1px solid #d6e4f5;
  font-size: 13px;
  color: var(--erp-text);
}
.scope-total strong {
  margin: 0 4px;
  font-size: 16px;
  color: var(--erp-primary);
}
.scope-total__sub {
  margin-left: 8px;
  font-size: 12px;
  color: var(--erp-text-muted);
}

.scope-split {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(180px, 0.9fr) minmax(260px, 1.4fr);
  gap: 0;
  border: 1px solid var(--erp-border);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  min-height: 280px;
}
.scope-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.scope-pane--left {
  border-right: 1px solid var(--erp-border);
  background: #f7f9fb;
}
.scope-pane__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--erp-text);
  border-bottom: 1px solid var(--erp-border);
  background: #fff;
}
.scope-pane__meta {
  margin-left: auto;
  font-weight: 400;
  color: var(--erp-text-muted);
}
.scope-pane__body {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.scope-pane__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-size: 12px;
  color: var(--erp-text-muted);
}
.scope-group {
  margin-bottom: 8px;
}
.scope-group__title {
  padding: 4px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--erp-text-muted);
}
.scope-node {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}
.scope-node:hover {
  background: #eef3f9;
}
.scope-node.active {
  background: #e8f1fb;
}
.scope-node.on {
  background: #eef6ff;
}
.scope-node--leaf {
  padding: 6px 8px;
}
.scope-node__main {
  min-width: 0;
  flex: 1;
}
.scope-node__title {
  font-size: 13px;
  color: var(--erp-text);
  line-height: 1.3;
  word-break: break-all;
}
.scope-node__sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--erp-text-muted);
}
.scope-tip {
  margin-top: 6px;
  font-size: 11px;
  color: var(--erp-text-muted);
  line-height: 1.4;
}

.wh-box__check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 2px;
  border: 1px solid #c0c6cc;
  border-radius: 3px;
  background: #fff;
  box-sizing: border-box;
  position: relative;
}
.wh-box__check.on {
  border-color: var(--erp-primary);
  background: var(--erp-primary);
}
.wh-box__check.on::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
</style>
