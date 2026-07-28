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
  /** 弹窗内可多选主体（用于勾选仓库范围）；保存时仍落到单一 companyId */
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
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = { name: '', warehouseIds: [], priority: 100, companyIds: [] };
  }
  dialogVisible.value = true;
};

const clearCompanies = () => {
  form.value.companyIds = [];
  form.value.warehouseIds = [];
};

const toggleCompany = (id: string) => {
  if (!id) return;
  const cur = form.value.companyIds;
  const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
  form.value.companyIds = next;
  const allowed = new Set(
    next.flatMap(cid => warehouseStore.getWarehousesByCompany(cid).map(w => w.id)),
  );
  form.value.warehouseIds = form.value.warehouseIds.filter(wid => allowed.has(wid));
};

const isCompanyChecked = (id: string) => form.value.companyIds.includes(id);

const clearWarehouses = () => {
  form.value.warehouseIds = [];
};

/** 逐个切换；用 id 精确匹配，避免重复 id / 标签嵌套导致「点一个全选」 */
const toggleWarehouse = (id: string) => {
  if (!id) return;
  const cur = form.value.warehouseIds;
  form.value.warehouseIds = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
};

const isWarehouseChecked = (id: string) => form.value.warehouseIds.includes(id);

const handleSubmit = () => {
  const name = form.value.name.trim();
  if (!name) return ElMessage.error('请填写渠道名称');
  if (!form.value.companyIds.length) return ElMessage.error('请至少勾选一个所属主体');
  if (!form.value.warehouseIds.length) return ElMessage.error('请至少选择一个仓库');

  const companyOfWh = new Set<string>();
  for (const wid of form.value.warehouseIds) {
    const w = warehouseStore.getWarehouseById(wid);
    if (!w) return ElMessage.error('存在无效仓库，请重新勾选');
    companyOfWh.add(w.companyId);
  }
  if (companyOfWh.size > 1) {
    return ElMessage.error('同一渠道的仓库必须属于同一主体，不能跨主体混选');
  }
  const companyId = [...companyOfWh][0];
  if (!form.value.companyIds.includes(companyId)) {
    return ElMessage.error('所选仓库不属于已勾选的主体');
  }
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
const filteredWarehouses = computed(() => {
  if (!form.value.companyIds.length) return [];
  const set = new Set(form.value.companyIds);
  return warehouseStore.warehouses.filter(w => set.has(w.companyId));
});

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
      width="520px"
      append-to-body
      align-center
      :close-on-click-modal="false"
      destroy-on-close
    >
      <ElForm :model="form" label-width="100px" size="small" @submit.prevent>
        <ElFormItem label="渠道名称">
          <ElInput
            v-model="form.name"
            clearable
            maxlength="64"
            show-word-limit
            placeholder="例如：快乐猴（中文无限制）"
          />
        </ElFormItem>
        <ElFormItem label="所属主体">
          <div class="wh-box">
            <div class="wh-box__bar">
              <span class="wh-box__hint">
                已选 {{ form.companyIds.length }}/{{ companies.length }} · 可多选；仓库须最终同属一个主体
              </span>
              <ElButton link size="small" :disabled="!form.companyIds.length" @click="clearCompanies">
                清空已选
              </ElButton>
            </div>
            <div v-if="companies.length" class="wh-box__list">
              <div
                v-for="(c, idx) in companies"
                :key="`${c.code}__${c.id}__${idx}`"
                class="wh-box__item"
                role="checkbox"
                :aria-checked="isCompanyChecked(c.id)"
                tabindex="0"
                @click="toggleCompany(c.id)"
                @keydown.enter.prevent="toggleCompany(c.id)"
                @keydown.space.prevent="toggleCompany(c.id)"
              >
                <span class="wh-box__check" :class="{ on: isCompanyChecked(c.id) }" />
                <span class="wh-box__text">{{ c.name }}（{{ c.code }}）</span>
              </div>
            </div>
            <div v-else class="wh-box__empty">暂无主体，请先到「公司主体」新增</div>
          </div>
        </ElFormItem>
        <ElFormItem label="可用仓库">
          <div class="wh-box">
            <div class="wh-box__bar">
              <span class="wh-box__hint">
                已选 {{ form.warehouseIds.length }}/{{ filteredWarehouses.length }} · 可逐个勾/取消；勿跨主体混选仓库
              </span>
              <ElButton link size="small" :disabled="!form.warehouseIds.length" @click="clearWarehouses">
                清空已选
              </ElButton>
            </div>
            <div v-if="filteredWarehouses.length" class="wh-box__list">
              <div
                v-for="(w, idx) in filteredWarehouses"
                :key="`${w.code}__${w.id}__${idx}`"
                class="wh-box__item"
                role="checkbox"
                :aria-checked="isWarehouseChecked(w.id)"
                tabindex="0"
                @click="toggleWarehouse(w.id)"
                @keydown.enter.prevent="toggleWarehouse(w.id)"
                @keydown.space.prevent="toggleWarehouse(w.id)"
              >
                <span class="wh-box__check" :class="{ on: isWarehouseChecked(w.id) }" />
                <span class="wh-box__text">{{ w.name }}（{{ w.code }}）</span>
              </div>
            </div>
            <div v-else class="wh-box__empty">
              {{ form.companyIds.length ? '已选主体下暂无仓库' : '请先勾选所属主体' }}
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
.wh-box {
  width: 100%;
  border: 1px solid var(--erp-border);
  border-radius: 6px;
  padding: 8px 10px;
  background: #fafbfc;
}
.wh-box__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.wh-box__hint {
  flex: 1;
  font-size: 11px;
  color: var(--erp-text-muted);
  line-height: 1.4;
}
.wh-box__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
}
.wh-box__item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  margin: 0;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--erp-text);
  user-select: none;
}
.wh-box__item:hover {
  background: #eef3f9;
}
.wh-box__check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
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
.wh-box__text {
  line-height: 1.3;
}
.wh-box__empty {
  padding: 10px 0;
  font-size: 12px;
  color: var(--erp-text-muted);
}
</style>
