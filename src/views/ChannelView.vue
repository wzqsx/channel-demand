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
  ElTag,
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

const channelStore = useChannelStore();
const warehouseStore = useWarehouseStore();
const companyStore = useCompanyStore();
const { channels } = storeToRefs(channelStore);
const { companies } = storeToRefs(companyStore);

const filterCompanyIds = ref<string[]>([]);
const dialogVisible = ref(false);
const isEdit = ref(false);
const form = ref({
  name: '',
  warehouseIds: [] as string[],
  priority: 100,
  /** 左侧当前点选的主体（分类）；右侧只展示该主体仓库 */
  companyId: '',
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
      companyId: channel.companyId || '',
    };
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = { name: '', warehouseIds: [], priority: 100, companyId: '' };
  }
  dialogVisible.value = true;
};

/** 左侧点选主体：切换分类，右侧只显示该主体仓库；换主体时清空已选仓库防混选 */
const selectCompany = (id: string) => {
  if (!id || form.value.companyId === id) return;
  form.value.companyId = id;
  form.value.warehouseIds = [];
};

const warehouseCountOf = (companyId: string) =>
  warehouseStore.getWarehousesByCompany(companyId).length;

const selectedWarehouseCountOf = (companyId: string) => {
  if (form.value.companyId !== companyId) return 0;
  return form.value.warehouseIds.length;
};

const clearWarehouses = () => {
  form.value.warehouseIds = [];
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
  if (!form.value.companyId) return ElMessage.error('请先在左侧选择所属主体');
  if (!companyStore.getCompanyById(form.value.companyId)) {
    return ElMessage.error('所属主体不存在，请重新选择');
  }
  if (!form.value.warehouseIds.length) return ElMessage.error('请至少选择一个仓库');

  const companyWarehouseIds = warehouseStore
    .getWarehousesByCompany(form.value.companyId)
    .map(w => w.id);
  if (form.value.warehouseIds.some(id => !companyWarehouseIds.includes(id))) {
    return ElMessage.error('所选仓库必须属于当前主体，不能跨主体');
  }

  const payload = {
    name,
    companyId: form.value.companyId,
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

const handleDelete = (id: string) => {
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
    channels.value.map(ch => ({
      渠道名称: ch.name,
      主体编码: getCompanyCode(ch.companyId),
      '仓库编码(逗号分隔)': getWarehouseCodes(ch.warehouseIds),
      优先级: ch.priority,
    })),
    '渠道',
  );
  ElMessage.success('已导出');
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
  form.value.companyId ? warehouseStore.getWarehousesByCompany(form.value.companyId) : [],
);

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
          <div class="scope-split">
            <div class="scope-pane scope-pane--left">
              <div class="scope-pane__head">
                <span>主体</span>
                <span class="scope-pane__meta">点选分类</span>
              </div>
              <div v-if="companies.length" class="scope-pane__body">
                <div
                  v-for="(c, idx) in companies"
                  :key="`${c.code}__${c.id}__${idx}`"
                  class="scope-node"
                  :class="{ active: form.companyId === c.id }"
                  @click="selectCompany(c.id)"
                >
                  <span class="scope-radio" :class="{ on: form.companyId === c.id }" />
                  <div class="scope-node__main">
                    <div class="scope-node__title">{{ c.name }}</div>
                    <div class="scope-node__sub">
                      {{ c.code }} · {{ warehouseCountOf(c.id) }} 仓
                      <template v-if="form.companyId === c.id && selectedWarehouseCountOf(c.id)">
                        · 已选 {{ selectedWarehouseCountOf(c.id) }}
                      </template>
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
                  {{ form.warehouseIds.length }}/{{ filteredWarehouses.length }}
                </span>
                <ElButton link size="small" :disabled="!form.warehouseIds.length" @click="clearWarehouses">
                  清空
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
                {{ form.companyId ? '该主体下暂无仓库' : '请先在左侧点选主体' }}
              </div>
            </div>
          </div>
          <div class="scope-tip">左侧点选一个主体后，右侧只显示该主体仓库；换主体会清空已选仓库，避免跨主体混选</div>
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
.scope-radio {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 2px;
  border: 1px solid #c0c6cc;
  border-radius: 50%;
  background: #fff;
  box-sizing: border-box;
  position: relative;
}
.scope-radio.on {
  border-color: var(--erp-primary);
}
.scope-radio.on::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--erp-primary);
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
