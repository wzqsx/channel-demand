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
  ElSelect,
  ElOption,
  ElSwitch,
  ElTag,
  ElMessage,
  ElMessageBox,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import HelpTip from '../components/HelpTip.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import { useChannelStore, getChannelCompanyIds, channelBelongsToCompany } from '../stores/channel';
import { useWarehouseStore } from '../stores/warehouse';
import { useCompanyStore } from '../stores/company';
import { useRequisitionStore } from '../stores/requisition';
import { bootstrapStores } from '../stores/bootstrap';
import type { Channel } from '../types';
import { readExcelFromEvent, exportRows, downloadTemplate, cell, cellNum } from '../utils/excel';
import { useRememberedCompanyFilter } from '../composables/useRememberedCompanyFilter';
import { formatCompanyLabel, formatCompanyNameOnly } from '../utils/companyDisplay';

const channelStore = useChannelStore();
const warehouseStore = useWarehouseStore();
const companyStore = useCompanyStore();
const requisitionStore = useRequisitionStore();
const { channels } = storeToRefs(channelStore);
const { companies } = storeToRefs(companyStore);

const filterCompanyIds = useRememberedCompanyFilter('channels');
const dialogVisible = ref(false);
const isEdit = ref(false);
const tableTick = ref(0);
/** 右侧高亮主体（可选）；为空时展示全部已勾选主体的仓库 */
const focusCompanyId = ref('');
const previewOpen = ref(false);
const form = ref({
  code: '',
  name: '',
  warehouseIds: [] as string[],
  priority: 10,
  enabled: true,
  /** 左侧勾选的主体（可多选） */
  companyIds: [] as string[],
});
const editId = ref('');
const importRef = ref<HTMLInputElement | null>(null);

const priorityTier = (p: number) => (p <= 3 ? '高' : p <= 10 ? '中' : '低');
/** 表格与下拉统一：P1（高） */
const getPriorityLabel = (priority: number) => `P${priority}（${priorityTier(priority)}）`;
const priorityOptions = Array.from({ length: 20 }, (_, i) => {
  const p = i + 1;
  return { value: p, label: getPriorityLabel(p) };
});

onMounted(() => {
  bootstrapStores();
});

const openDialog = (channel?: Channel) => {
  previewOpen.value = false;
  if (channel) {
    isEdit.value = true;
    editId.value = channel.id;
    const companyIds = getChannelCompanyIds(channel);
    form.value = {
      code: channel.code || '',
      name: channel.name,
      warehouseIds: [...channel.warehouseIds],
      priority: channel.priority || 10,
      enabled: channel.enabled !== false,
      companyIds: [...companyIds],
    };
    focusCompanyId.value = companyIds[0] || '';
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = {
      code: channelStore.nextChannelCode(),
      name: '',
      warehouseIds: [],
      priority: 10,
      enabled: true,
      companyIds: [],
    };
    focusCompanyId.value = '';
  }
  dialogVisible.value = true;
};

/** 点左侧主体行：勾选该主体并切换高亮（可多选） */
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

const selectedCompanyNames = computed(() =>
  form.value.companyIds
    .map(id => {
      const c = companyStore.getCompanyById(id);
      return c ? formatCompanyNameOnly(c) : id;
    })
    .filter(Boolean)
    .join('、'),
);

const selectedWarehousePreview = computed(() => {
  const rows: { id: string; name: string; code: string; companyName: string }[] = [];
  for (const wid of form.value.warehouseIds) {
    const w = warehouseStore.getWarehouseById(wid);
    if (!w) continue;
    const c = companyStore.getCompanyById(w.companyId);
    rows.push({
      id: w.id,
      name: w.name,
      code: w.code,
      companyName: c ? formatCompanyNameOnly(c) : w.companyId,
    });
  }
  return rows;
});

const removeSelectedWarehouse = (id: string) => {
  form.value.warehouseIds = form.value.warehouseIds.filter(x => x !== id);
};

/** 清空右侧当前展示列表中的已选仓库 */
const clearWarehouses = () => {
  const drop = new Set(filteredWarehouses.value.map(w => w.id));
  if (!drop.size) {
    form.value.warehouseIds = [];
    return;
  }
  form.value.warehouseIds = form.value.warehouseIds.filter(id => !drop.has(id));
};

const toggleWarehouse = (id: string) => {
  if (!id) return;
  const cur = form.value.warehouseIds;
  if (cur.includes(id)) {
    form.value.warehouseIds = cur.filter(x => x !== id);
    return;
  }
  const w = warehouseStore.getWarehouseById(id);
  if (!w) return;
  if (!form.value.companyIds.includes(w.companyId)) {
    form.value.companyIds = [...form.value.companyIds, w.companyId];
  }
  form.value.warehouseIds = [...cur, id];
};

const isWarehouseChecked = (id: string) => form.value.warehouseIds.includes(id);

const handleSubmit = () => {
  const name = form.value.name.trim();
  const code = form.value.code.trim();
  if (!code) return ElMessage.error('请填写渠道编码');
  if (!name) return ElMessage.error('请填写渠道名称');
  if (!form.value.companyIds.length) return ElMessage.error('请至少勾选一个主体');
  if (!form.value.warehouseIds.length) return ElMessage.error('请至少选择一个仓库');

  const companyOfWh = new Set<string>();
  for (const wid of form.value.warehouseIds) {
    const w = warehouseStore.getWarehouseById(wid);
    if (!w) return ElMessage.error('存在无效仓库，请重新勾选');
    companyOfWh.add(w.companyId);
  }
  const companyIds = [...new Set([...form.value.companyIds, ...companyOfWh])];
  for (const cid of companyIds) {
    if (!companyStore.getCompanyById(cid)) {
      return ElMessage.error('存在无效主体，请重新选择');
    }
  }

  const payload = {
    code,
    name,
    companyIds,
    companyId: companyIds[0],
    warehouseIds: [...form.value.warehouseIds],
    priority: form.value.priority,
    enabled: form.value.enabled,
  };

  try {
    if (isEdit.value) {
      channelStore.updateChannel(editId.value, payload);
      // 改主体后若筛选不含任一关联主体，并入以免行消失
      if (filterCompanyIds.value.length) {
        const missing = companyIds.filter(id => !filterCompanyIds.value.includes(id));
        if (missing.length) {
          filterCompanyIds.value = [...filterCompanyIds.value, ...missing];
        }
      }
      tableTick.value += 1;
      ElMessage.success('修改成功');
    } else {
      channelStore.addChannel(payload);
      tableTick.value += 1;
      ElMessage.success('添加成功');
    }
  } catch (e) {
    return ElMessage.error(e instanceof Error ? e.message : '保存失败');
  }
  dialogVisible.value = false;
};

const handleDelete = async (id: string) => {
  const reqCount = requisitionStore.requisitions.filter(r => r.channelId === id).length;
  if (reqCount) {
    ElMessage.warning(`该渠道仍有 ${reqCount} 张要货单，请先删除或改挂后再删渠道`);
    return;
  }
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
  tableTick.value += 1;
  ElMessage.success('删除成功');
};

const handleToggleEnabled = (row: Channel, enabled: boolean) => {
  try {
    channelStore.updateChannel(row.id, { enabled });
    tableTick.value += 1;
    ElMessage.success(enabled ? '已启用' : '已停用（不再参与要货占库存）');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '更新失败');
  }
};

const getCompanyCodes = (ch: Channel) =>
  getChannelCompanyIds(ch)
    .map(id => companyStore.getCompanyById(id)?.code || id)
    .filter(Boolean)
    .join(',');

const getCompanyNames = (ch: Channel) =>
  getChannelCompanyIds(ch)
    .map(id => getCompanyName(id))
    .filter(Boolean)
    .join('、');

const getWarehouseCodes = (ids: string[]) =>
  ids
    .map(id => warehouseStore.getWarehouseById(id)?.code)
    .filter((c): c is string => !!c)
    .join(',');

const handleExport = () => {
  exportRows(
    listRows.value.map(ch => ({
      渠道编码: ch.code,
      渠道名称: ch.name,
      '主体编码(逗号分隔)': getCompanyCodes(ch),
      '仓库编码(逗号分隔)': getWarehouseCodes(ch.warehouseIds),
      优先级: ch.priority,
      状态: ch.enabled !== false ? '启用' : '停用',
    })),
    '渠道',
  );
  ElMessage.success(`已导出 ${listRows.value.length} 条`);
};

const handleTemplate = () => {
  downloadTemplate(
    ['渠道编码', '渠道名称', '主体编码(逗号分隔)', '仓库编码(逗号分隔)', '优先级', '状态'],
    '渠道导入模板',
  );
};

const parseEnabled = (raw: string) => {
  const s = String(raw || '').trim();
  if (!s) return true;
  if (/^(0|否|停用|禁用|false|off|n)$/i.test(s)) return false;
  return true;
};

const handleImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  let n = 0;
  let skipped = 0;
  rows.forEach(row => {
    const code = cell(row, '渠道编码', 'code');
    const name = cell(row, '渠道名称', 'name');
    const companyCodesRaw = cell(
      row,
      '主体编码(逗号分隔)',
      '主体编码',
      'companyCodes',
      'companyCode',
    );
    const warehouseCodesRaw = cell(row, '仓库编码(逗号分隔)', '仓库编码', 'warehouseCodes');
    const priority = cellNum(row, '优先级', 'priority') || 10;
    const enabled = parseEnabled(cell(row, '状态', 'enabled'));
    if (!name) return;

    const companyCodes = companyCodesRaw.split(/[,，]/).map(c => c.trim()).filter(Boolean);
    const companyIds = companyCodes
      .map(c => companyStore.getCompanyByCode(c)?.id)
      .filter((id): id is string => !!id);

    const codes = warehouseCodesRaw.split(/[,，]/).map(c => c.trim()).filter(Boolean);
    const warehouseIds = codes
      .map(c => {
        const byCode = warehouseStore.warehouses.find(w => w.code === c);
        if (byCode) return byCode.id;
        return warehouseStore.warehouses.find(w => w.name === c)?.id;
      })
      .filter((id): id is string => !!id);

    if (!warehouseIds.length) {
      skipped += 1;
      return;
    }

    // 若未写主体编码，由仓库推导
    const finalCompanyIds =
      companyIds.length > 0
        ? companyIds
        : [
            ...new Set(
              warehouseIds
                .map(id => warehouseStore.getWarehouseById(id)?.companyId)
                .filter((id): id is string => !!id),
            ),
          ];
    if (!finalCompanyIds.length) {
      skipped += 1;
      return;
    }

    try {
      channelStore.upsertChannel({
        ...(code ? { code } : {}),
        name,
        companyId: finalCompanyIds[0],
        companyIds: finalCompanyIds,
        warehouseIds,
        priority,
        enabled,
      });
      n += 1;
    } catch {
      skipped += 1;
    }
  });
  ElMessage.success(
    skipped
      ? `导入完成 ${n} 条，跳过 ${skipped} 条（主体/仓库无效或编码冲突）`
      : `导入完成 ${n} 条（按编码或名称覆盖；支持多主体多仓库）`,
  );
};

const getWarehouseNames = (ids: string[]) =>
  ids.map(id => warehouseStore.getWarehouseById(id)?.name || id).join('、');
const getCompanyName = (id: string) => {
  const c = companyStore.getCompanyById(id);
  return c ? formatCompanyNameOnly(c) : id;
};

/** 右侧：汇总已勾选主体下的全部仓库；若点了高亮主体则优先展示该主体（仍保留其它已勾选主体的仓） */
const filteredWarehouses = computed(() => {
  const ids = form.value.companyIds;
  if (!ids.length) return [];
  const list = ids.flatMap(cid => warehouseStore.getWarehousesByCompany(cid));
  const seen = new Set<string>();
  const unique = list.filter(w => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });
  if (!focusCompanyId.value || !ids.includes(focusCompanyId.value)) return unique;
  // 当前高亮主体的仓库排在前面，便于定位
  return [
    ...unique.filter(w => w.companyId === focusCompanyId.value),
    ...unique.filter(w => w.companyId !== focusCompanyId.value),
  ];
});

const currentSelectedCount = computed(() =>
  filteredWarehouses.value.filter(w => form.value.warehouseIds.includes(w.id)).length,
);

const selectAllWarehouses = () => {
  if (!filteredWarehouses.value.length) return;
  const ids = filteredWarehouses.value.map(w => w.id);
  form.value.warehouseIds = [...new Set([...form.value.warehouseIds, ...ids])];
};

const companyFilterOptions = computed(() =>
  companies.value.map(c => ({ value: c.id, label: formatCompanyLabel(c) })),
);

const listRows = computed(() => {
  void tableTick.value;
  const all = channels.value;
  const rows = !filterCompanyIds.value.length
    ? all
    : all.filter(ch => filterCompanyIds.value.some(cid => channelBelongsToCompany(ch, cid)));
  return rows.map(ch => ({ ...ch }));
});
</script>

<template>
  <PageShell
    title="渠道管理"
    help="渠道可关联多个主体与仓库；要货时按所选主体过滤可用仓。优先级数字越小越高（P1最高），在各关联主体内分别参与占库存竞争。停用渠道不参与要货。&#10;本页「导入/导出」仅操作渠道 Excel；整站数据备份请用顶栏「数据备份」。"
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
      <div class="ch-toolbar">
        <div class="ch-toolbar__left">
          <MultiCheckFilter
            v-model="filterCompanyIds"
            :options="companyFilterOptions"
            placeholder="主体筛选(可多选)"
            width="220px"
          />
          <span class="ch-toolbar__hint">仅筛选列表</span>
        </div>
        <div class="ch-toolbar__right">
          <ElButton type="primary" size="small" @click="openDialog()">新增渠道</ElButton>
          <span class="toolbar-sep" aria-hidden="true" />
          <ElButton size="small" @click="importRef?.click()">导入</ElButton>
          <ElButton size="small" @click="handleExport">导出</ElButton>
          <ElButton size="small" @click="handleTemplate">下载模板</ElButton>
        </div>
      </div>
    </template>
    <div class="table-wrap">
      <ElTable
        :key="`ch-table-${tableTick}`"
        :data="listRows"
        border
        size="small"
        stripe
        class="erp-data-table"
        height="100%"
        row-key="id"
      >        <ElTableColumn type="index" label="序号" width="55" fixed="left" />
        <ElTableColumn prop="code" label="渠道编码" width="110" sortable />
        <ElTableColumn prop="name" label="渠道名称" width="140" sortable />
        <ElTableColumn
          label="关联主体"
          width="160"
          sortable
          :sort-method="(a: Channel, b: Channel) => getCompanyNames(a).localeCompare(getCompanyNames(b), 'zh-CN')"
        >
          <template #default="{ row }">{{ getCompanyNames(row as Channel) }}</template>
        </ElTableColumn>
        <ElTableColumn label="可用仓库" min-width="180">
          <template #default="{ row }">{{ getWarehouseNames((row as Channel).warehouseIds) }}</template>
        </ElTableColumn>
        <ElTableColumn prop="priority" label="优先级" width="110" sortable>
          <template #default="{ row }">
            <ElTag
              size="small"
              :type="(row as Channel).priority <= 3 ? 'danger' : (row as Channel).priority <= 10 ? 'warning' : 'info'"
            >
              {{ getPriorityLabel((row as Channel).priority) }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="100" align="center">
          <template #default="{ row }">
            <ElSwitch
              :model-value="(row as Channel).enabled !== false"
              size="small"
              inline-prompt
              active-text="启用"
              inactive-text="停用"
              @change="(v: string | number | boolean) => handleToggleEnabled(row as Channel, !!v)"
            />
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
      :title="isEdit ? '编辑渠道' : '新增渠道'"
      width="760px"
      append-to-body
      align-center
      :close-on-click-modal="false"
      destroy-on-close
    >
      <ElForm :model="form" label-width="88px" size="small" @submit.prevent>
        <ElFormItem label="渠道编码">
          <ElInput
            v-model="form.code"
            clearable
            maxlength="32"
            show-word-limit
            autocomplete="off"
            name="channel_code_field"
            placeholder="唯一编码，如 CH001"
          />
        </ElFormItem>
        <ElFormItem label="渠道名称">
          <ElInput
            v-model="form.name"
            clearable
            maxlength="64"
            show-word-limit
            autocomplete="off"
            name="channel_name_field"
            placeholder="例如：天猫旗舰 / 抖音店 / 经销商A"
          />
        </ElFormItem>
        <ElFormItem label="主体仓库">
          <div class="scope-wrap">
            <div class="scope-summary">
              <div class="scope-summary__main">
                <div class="scope-stat">
                  <span class="scope-stat__num">{{ totalSelectedWarehouses }}</span>
                  <span class="scope-stat__label">已关联仓库</span>
                </div>
                <div class="scope-stat-divider" />
                <div class="scope-stat">
                  <span class="scope-stat__num">{{ form.companyIds.length }}</span>
                  <span class="scope-stat__label">关联主体</span>
                </div>
                <div class="scope-summary__meta">
                  <p v-if="selectedCompanyNames" class="scope-summary__names" :title="selectedCompanyNames">
                    {{ selectedCompanyNames }}
                  </p>
                  <p v-else class="scope-summary__hint">请在下方勾选主体与仓库</p>
                  <p v-if="filteredWarehouses.length" class="scope-summary__list">
                    当前列表已选 {{ currentSelectedCount }} / {{ filteredWarehouses.length }}
                  </p>
                </div>
              </div>
              <ElButton
                link
                type="primary"
                size="small"
                :disabled="!totalSelectedWarehouses"
                @click="previewOpen = !previewOpen"
              >
                {{ previewOpen ? '收起预览' : '展开预览' }}
              </ElButton>
            </div>
            <div v-if="previewOpen && selectedWarehousePreview.length" class="scope-preview">
              <div
                v-for="w in selectedWarehousePreview"
                :key="w.id"
                class="scope-preview__item"
              >
                <span class="scope-preview__text">
                  {{ w.name }}
                  <em>{{ w.code }} · {{ w.companyName }}</em>
                </span>
                <ElButton link type="danger" size="small" @click="removeSelectedWarehouse(w.id)">
                  移除
                </ElButton>
              </div>
            </div>
            <div v-else-if="previewOpen" class="scope-preview scope-preview--empty">
              暂无已选仓库
            </div>

            <div class="scope-card">
              <div class="scope-split">
                <div class="scope-pane scope-pane--left">
                  <div class="scope-pane__head">
                    <span>关联主体</span>
                    <span class="scope-pane__meta">可多选</span>
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
                        <div class="scope-node__title">{{ formatCompanyNameOnly(c) }}</div>
                        <div class="scope-node__sub">
                          {{ c.code }} · {{ warehouseCountOf(c.id) }} 仓
                          <template v-if="selectedWarehouseCountOf(c.id)">
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
                      汇总 {{ currentSelectedCount }}/{{ filteredWarehouses.length }}
                    </span>
                    <ElButton
                      link
                      type="primary"
                      size="small"
                      :disabled="!filteredWarehouses.length"
                      @click="selectAllWarehouses"
                    >
                      全选列表
                    </ElButton>
                    <ElButton link size="small" :disabled="!currentSelectedCount" @click="clearWarehouses">
                      清空列表
                    </ElButton>
                  </div>
                  <div v-if="filteredWarehouses.length" class="scope-pane__body">
                    <div
                      v-for="(w, idx) in filteredWarehouses"
                      :key="`${w.code}__${w.id}__${idx}`"
                      class="scope-node scope-node--leaf"
                      :class="{
                        on: isWarehouseChecked(w.id),
                        active: focusCompanyId === w.companyId,
                      }"
                      @click="toggleWarehouse(w.id)"
                    >
                      <span class="wh-box__check" :class="{ on: isWarehouseChecked(w.id) }" />
                      <div class="scope-node__main">
                        <div class="scope-node__title">{{ w.name }}</div>
                        <div class="scope-node__sub">
                          {{ w.code }} · {{ getCompanyName(w.companyId) }}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-else class="scope-pane__empty">
                    {{ form.companyIds.length ? '已勾选主体下暂无仓库' : '请先在左侧勾选主体' }}
                  </div>
                </div>
              </div>
              <div class="scope-tip">
                勾选左侧主体后，右侧汇总这些主体下的仓库；勾选的仓库全部关联到本渠道（支持多主体发货）。
              </div>
            </div>
          </div>
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <span class="label-with-help">
              优先级
              <HelpTip inline content="数字越小优先级越高：P1（高）最高；渠道关联多主体时，在各主体内分别比较" />
            </span>
          </template>
          <ElSelect v-model="form.priority" style="width: 100%" placeholder="选择优先级">
            <ElOption
              v-for="opt in priorityOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="状态">
          <ElSwitch
            v-model="form.enabled"
            inline-prompt
            active-text="启用"
            inactive-text="停用"
          />
          <span class="form-hint">停用后不参与要货占库存与渠道下拉</span>
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
.ch-toolbar {
  flex: 1;
  min-width: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  flex-wrap: wrap;
}
.ch-toolbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ch-toolbar__hint {
  font-size: 12px;
  color: var(--erp-text-muted);
  white-space: nowrap;
}
.ch-toolbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-wrap: wrap;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  padding: 0 12px;
  overflow: hidden;
}

.toolbar-sep {
  display: inline-block;
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--erp-border);
  vertical-align: middle;
}

.hidden-file {
  display: none;
}

.form-hint {
  margin-left: 10px;
  font-size: 12px;
  color: var(--erp-text-muted);
}

.scope-wrap {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.scope-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: linear-gradient(180deg, #f5f8fc 0%, #eef3f9 100%);
  border: 1px solid #d7e2ef;
}
.scope-summary__main {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1;
}
.scope-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  flex-shrink: 0;
}
.scope-stat__num {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--erp-primary);
  font-variant-numeric: tabular-nums;
}
.scope-stat__label {
  font-size: 11px;
  color: var(--erp-text-muted);
  letter-spacing: 0.02em;
}
.scope-stat-divider {
  width: 1px;
  height: 32px;
  background: #cfd9e6;
  flex-shrink: 0;
}
.scope-summary__meta {
  min-width: 0;
  flex: 1;
  padding-left: 2px;
}
.scope-summary__names {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--erp-text);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scope-summary__hint,
.scope-summary__list {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--erp-text-muted);
  line-height: 1.4;
}
.scope-preview {
  max-height: 140px;
  overflow-y: auto;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #d7e2ef;
  background: #fafcfe;
}
.scope-preview--empty {
  font-size: 12px;
  color: var(--erp-text-muted);
}
.scope-preview__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}
.scope-preview__text {
  min-width: 0;
  color: var(--erp-text);
}
.scope-preview__text em {
  margin-left: 6px;
  font-style: normal;
  color: var(--erp-text-muted);
}

.scope-card {
  border: 1px solid #d7e2ef;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  overflow: hidden;
}
.scope-split {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(180px, 0.9fr) minmax(260px, 1.4fr);
  gap: 0;
  /* 固定可视高度：约 5 行仓库，超出在 pane 内滚动，避免撑高整页弹窗 */
  height: 292px;
  min-height: 292px;
  max-height: 292px;
}
.scope-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.scope-pane--left {
  border-right: 1px solid #e5ebf2;
  background: #f7f9fb;
}
.scope-pane__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--erp-text);
  border-bottom: 1px solid #e5ebf2;
  background: #fbfcfe;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.scope-pane__meta {
  margin-left: auto;
  font-weight: 400;
  color: var(--erp-text-muted);
}
.scope-pane__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px;
  /* 约 5 个仓位高度；多出的条目在此区域滚动 */
  max-height: 236px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.scope-pane__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-size: 12px;
  color: var(--erp-text-muted);
  min-height: 0;
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
  padding: 8px 12px 10px;
  font-size: 11px;
  color: var(--erp-text-muted);
  line-height: 1.45;
  border-top: 1px solid #eef2f6;
  background: #fafbfc;
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

.label-with-help {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
