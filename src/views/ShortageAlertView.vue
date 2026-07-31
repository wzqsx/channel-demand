<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElDatePicker,
  ElRadioGroup,
  ElRadioButton,
  ElTag,
  ElMessage,
  ElInput,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import StatCards from '../components/StatCards.vue';
import type { StatItem } from '../components/StatCards.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import { useCompanyStore } from '../stores/company';
import { useWarehouseStore } from '../stores/warehouse';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { useProductStore } from '../stores/product';
import { useRequisitionStore } from '../stores/requisition';
import { bootstrapStores } from '../stores/bootstrap';
import { weekStartSaturday, weekLabel, disabledFutureWeekDate } from '../utils/week';
import { buildShortageAndWarnings, type AlertKind, type ShortageAlertRow } from '../utils/shortageAlert';
import { formatProductQty } from '../utils/qtyDisplay';
import { exportRows } from '../utils/excel';
import { useRememberedCompanyFilter } from '../composables/useRememberedCompanyFilter';
import { formatCompanyLabel, formatCompanyNameOnly } from '../utils/companyDisplay';
import { yieldToMain } from '../utils/idbKv';

const route = useRoute();
const companyStore = useCompanyStore();
const warehouseStore = useWarehouseStore();
const stockStore = useWarehouseStockStore();
const productStore = useProductStore();
const requisitionStore = useRequisitionStore();
const { companies } = storeToRefs(companyStore);
const { stocks, hydrated, productWhIndex } = storeToRefs(stockStore);

const weekStart = ref(weekStartSaturday());
const companyIds = useRememberedCompanyFilter('shortage-alert');
const tab = ref<'all' | AlertKind>('all');
const keyword = ref('');
/** 折叠的公司 id；默认全部展开 */
const collapsedIds = ref<Set<string>>(new Set());
const allRows = ref<ShortageAlertRow[]>([]);
const computing = ref(false);
let computeSeq = 0;

const companyFilterOptions = computed(() =>
  companies.value.map(c => ({ value: c.id, label: formatCompanyLabel(c) })),
);

const rebuildRows = async () => {
  const seq = ++computeSeq;
  computing.value = true;
  await nextTick();
  await yieldToMain();
  try {
    const rows = buildShortageAndWarnings({
      weekStart: weekStart.value,
      companyIds: companyIds.value.length ? companyIds.value : undefined,
    });
    if (seq !== computeSeq) return;
    allRows.value = rows;
  } catch (e) {
    console.error('缺货预警计算失败', e);
    if (seq === computeSeq) {
      allRows.value = [];
      ElMessage.error('缺货预警计算失败，请稍后重试');
    }
  } finally {
    if (seq === computeSeq) computing.value = false;
  }
};

onMounted(async () => {
  await bootstrapStores();

  const qWeek = route.query.week;
  if (typeof qWeek === 'string' && qWeek) weekStart.value = weekStartSaturday(qWeek);
  const qCompanies = route.query.companyIds;
  if (typeof qCompanies === 'string' && qCompanies) {
    companyIds.value = qCompanies.split(',').filter(Boolean);
  } else {
    const qCompany = route.query.companyId;
    if (typeof qCompany === 'string' && qCompany) companyIds.value = [qCompany];
  }
  await rebuildRows();
});

watch(
  [weekStart, companyIds, hydrated, stocks, productWhIndex, () => productStore.products.length, () => requisitionStore.requisitions.length],
  () => {
    if (!hydrated.value) return;
    void rebuildRows();
  },
);

const keywordNorm = computed(() => keyword.value.trim().toLowerCase());

const filteredRows = computed(() => {
  let rows = allRows.value;
  if (tab.value !== 'all') rows = rows.filter(r => r.kind === tab.value);
  const q = keywordNorm.value;
  if (q) {
    rows = rows.filter(
      r =>
        r.productCode.toLowerCase().includes(q)
        || r.productName.toLowerCase().includes(q),
    );
  }
  return rows;
});

const hasShortageRows = computed(() => filteredRows.value.some(r => r.kind === 'shortage'));
const hasWarningRows = computed(() => filteredRows.value.some(r => r.kind === 'warning'));
/** 筛选结果里同时有缺货+预警时才显示「类型」列，避免全是预警时重复 */
const showKindColumn = computed(() => hasShortageRows.value && hasWarningRows.value);
const showPackColumn = computed(() => filteredRows.value.some(r => r.packStock > 0));
const showDemandColumn = computed(() => filteredRows.value.some(r => r.totalDemand > 0));
const showChannelColumn = computed(() => filteredRows.value.some(r => r.channels.length > 0));

const gapColumnLabel = computed(() => {
  if (hasShortageRows.value && !hasWarningRows.value) return '缺货缺口';
  if (hasWarningRows.value && !hasShortageRows.value) return '补货缺口';
  return '缺口';
});

const groupedByCompany = computed(() => {
  const map = new Map<string, ShortageAlertRow[]>();
  filteredRows.value.forEach(r => {
    const list = map.get(r.companyId) || [];
    list.push(r);
    map.set(r.companyId, list);
  });

  const companyList = companyIds.value.length
    ? companies.value.filter(c => companyIds.value.includes(c.id))
    : companies.value;

  return companyList.map(c => {
    const rows = map.get(c.id) || [];
    const whCount = warehouseStore.getWarehousesByCompany(c.id).length;
    const shortageCount = rows.filter(x => x.kind === 'shortage').length;
    const warningCount = rows.filter(x => x.kind === 'warning').length;
    const gapSum = rows.reduce((s, x) => s + x.shortage, 0);
    return {
      companyId: c.id,
      companyName: formatCompanyNameOnly(c),
      companyCode: c.code,
      warehouseCount: whCount,
      rows,
      shortageCount,
      warningCount,
      gapSum,
      hasAlert: shortageCount + warningCount > 0,
    };
  });
});

const statItems = computed((): StatItem[] => {
  const shortage = allRows.value.filter(r => r.kind === 'shortage').length;
  const warning = allRows.value.filter(r => r.kind === 'warning').length;
  const demandGap = allRows.value
    .filter(r => r.kind === 'shortage')
    .reduce((s, r) => s + r.shortage, 0);
  const replenishGap = allRows.value
    .filter(r => r.kind === 'warning')
    .reduce((s, r) => s + r.shortage, 0);
  return [
    {
      key: 'shortage',
      label: '缺货 SKU',
      value: shortage,
      tone: 'danger',
      badge: '缺货',
      clickable: true,
      sub: shortage > 0 ? '点击筛选缺货，再点取消' : '本周暂无缺货（仍可点击筛选）',
    },
    {
      key: 'warning',
      label: '预警 SKU',
      value: warning,
      tone: 'warning',
      badge: '预警',
      clickable: true,
      sub: warning > 0 ? '点击筛选预警，再点取消' : '暂无库存预警（仍可点击筛选）',
    },
    {
      key: 'gap',
      label: '缺口合计',
      value: Math.round(demandGap + replenishGap),
      tone: demandGap + replenishGap > 0 ? 'danger' : 'primary',
      badge: '缺口',
      sub:
        demandGap > 0 || replenishGap > 0
          ? `缺货 ${Math.round(demandGap)} · 补货 ${Math.round(replenishGap)}（瓶）`
          : '无需补货',
    },
  ];
});

/** 卡片 ↔ 单选双向绑定：同一份 tab 状态 */
const onStatSelect = (key: string) => {
  if (key !== 'shortage' && key !== 'warning') return;
  tab.value = tab.value === key ? 'all' : key;
};

const activeStatKey = computed<'shortage' | 'warning' | null>(() => {
  if (tab.value === 'shortage' || tab.value === 'warning') return tab.value;
  return null;
});

const setTab = (next: 'all' | AlertKind) => {
  tab.value = next;
};

/** 切换筛选时，自动展开有数据的公司块，方便直接看结果 */
watch(tab, () => {
  const next = new Set(collapsedIds.value);
  groupedByCompany.value.forEach(g => {
    if (g.hasAlert) next.delete(g.companyId);
    else next.add(g.companyId);
  });
  collapsedIds.value = next;
});

const getWarehouseNames = (ids: string[]) =>
  ids.map(id => warehouseStore.getWarehouseById(id)?.name || id).join('、');

const kindTag = (kind: AlertKind) =>
  kind === 'shortage'
    ? { label: '缺货', type: 'danger' as const }
    : { label: '预警', type: 'warning' as const };

const gapLabel = (row: ShortageAlertRow) =>
  row.kind === 'shortage' ? '缺货缺口' : '补货缺口';

const fmtQtyStrict = (qty: number, productCode: string) => formatProductQty(qty, productCode);

const rowClassName = ({ row }: { row: ShortageAlertRow }) =>
  row.kind === 'shortage' ? 'row--shortage' : 'row--warning';

const isCollapsed = (companyId: string) => collapsedIds.value.has(companyId);

const toggleCollapse = (companyId: string) => {
  const next = new Set(collapsedIds.value);
  if (next.has(companyId)) next.delete(companyId);
  else next.add(companyId);
  collapsedIds.value = next;
};

const expandAll = () => {
  collapsedIds.value = new Set();
};

const collapseAll = () => {
  collapsedIds.value = new Set(groupedByCompany.value.map(g => g.companyId));
};

const didInitCollapse = ref(false);
watch(
  groupedByCompany,
  groups => {
    if (didInitCollapse.value || !groups.length) return;
    didInitCollapse.value = true;
    collapsedIds.value = new Set(groups.filter(g => !g.hasAlert).map(g => g.companyId));
  },
  { immediate: true },
);

const handleExport = () => {
  const data = filteredRows.value.map(r => ({
    周起始: weekStart.value,
    公司: (() => {
      const c = companyStore.getCompanyById(r.companyId);
      return c ? formatCompanyNameOnly(c) : r.companyId;
    })(),
    类型: r.kind === 'shortage' ? '缺货' : '预警',
    商品编码: r.productCode,
    商品名称: r.productName,
    当前库存: fmtQtyStrict(r.currentStock, r.productCode),
    在途: fmtQtyStrict(r.inTransitStock, r.productCode),
    可用库存: fmtQtyStrict(r.availableStock, r.productCode),
    瓶规自身: fmtQtyStrict(r.ownStock, r.productCode),
    箱规折算: r.packStock > 0 ? fmtQtyStrict(r.packStock, r.productCode) : '',
    预警阈值: fmtQtyStrict(r.warningThreshold, r.productCode),
    要货需求: r.totalDemand > 0 ? fmtQtyStrict(r.totalDemand, r.productCode) : '',
    缺口: r.shortage > 0 ? fmtQtyStrict(r.shortage, r.productCode) : '',
    缺口类型: r.shortage > 0 ? gapLabel(r) : '',
    涉及渠道: r.channels.join('、'),
    仓库: getWarehouseNames(r.warehouseIds),
    说明: r.statusText,
  }));
  if (!data.length) {
    ElMessage.warning('暂无数据可导出');
    return;
  }
  exportRows(data, `缺货与预警_${weekStart.value}`);
  ElMessage.success('已导出');
};
</script>

<template>
  <PageShell
    title="缺货与预警"
    page-scroll
    help="按开单主体汇总。\n缺货：本周要货需求 > 单据所选仓库可用库存（含跨主体绑定仓、箱规折算）。\n预警：本主体仓库可用库存 ≤ 商品预警线；缺口列显示补到预警线所需。\n开单时的高优先占用在提交校验处理；本页按周合计做补货视角。\n数量展示如 3箱＋8盒。"
  >
    <template #metrics>
      <StatCards :items="statItems" :active-key="activeStatKey" @select="onStatSelect" />
    </template>

    <template #toolbar>
      <div class="toolbar">
        <div class="toolbar__left">
          <ElDatePicker
            v-model="weekStart"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="要货周期"
            size="small"
            class="toolbar__date"
            :disabled-date="disabledFutureWeekDate"
            @change="(v: string) => { if (v) weekStart = weekStartSaturday(v) }"
          />
          <MultiCheckFilter
            v-model="companyIds"
            :options="companyFilterOptions"
            placeholder="公司(可多选)"
            width="200px"
          />
          <ElInput
            v-model="keyword"
            clearable
            size="small"
            placeholder="搜索商品编码/名称"
            class="toolbar__search"
          />
          <ElRadioGroup
            :model-value="tab"
            size="small"
            class="toolbar__tabs"
            @update:model-value="(v: string | number | boolean | undefined) => setTab((v as 'all' | AlertKind) || 'all')"
          >
            <ElRadioButton label="all" value="all">全部</ElRadioButton>
            <ElRadioButton label="shortage" value="shortage">缺货</ElRadioButton>
            <ElRadioButton label="warning" value="warning">预警</ElRadioButton>
          </ElRadioGroup>
        </div>
        <div class="toolbar__right">
          <span class="week-label">{{ weekLabel(weekStart) }}</span>
          <ElButton size="small" @click="expandAll">全部展开</ElButton>
          <ElButton size="small" @click="collapseAll">全部折叠</ElButton>
          <ElButton size="small" type="primary" @click="handleExport">导出</ElButton>
        </div>
      </div>
    </template>

    <div class="wrap" v-loading="computing">
      <div v-if="computing && !allRows.length" class="empty-box">
        正在计算缺货与预警…
      </div>

      <div v-else-if="!companies.length" class="empty-box">
        尚未维护公司，请先到「公司主体」新增。
      </div>

      <div v-else-if="keywordNorm && !filteredRows.length" class="empty-box">
        未找到匹配「{{ keyword }}」的缺货/预警商品，可清空搜索或切换筛选。
      </div>

      <div v-else class="groups">
        <section
          v-for="group in groupedByCompany"
          :key="group.companyId"
          class="company-block"
          :class="{
            'company-block--collapsed': isCollapsed(group.companyId),
            'company-block--alert': group.hasAlert,
          }"
        >
          <button
            type="button"
            class="company-block__head"
            :aria-expanded="!isCollapsed(group.companyId)"
            @click="toggleCollapse(group.companyId)"
          >
            <div class="company-block__title">
              <span class="company-block__chevron" aria-hidden="true">
                {{ isCollapsed(group.companyId) ? '▸' : '▾' }}
              </span>
              {{ group.companyName }}
              <span class="company-block__code">{{ group.companyCode }}</span>
            </div>
            <div class="company-block__meta" @click.stop>
              <ElTag size="small" type="info">仓库 {{ group.warehouseCount }}</ElTag>
              <ElTag v-if="group.shortageCount" size="small" type="danger" effect="plain">
                缺货 {{ group.shortageCount }}
              </ElTag>
              <ElTag v-if="group.warningCount" size="small" type="warning" effect="plain">
                预警 {{ group.warningCount }}
              </ElTag>
              <ElTag v-if="!group.hasAlert" size="small" type="success" effect="plain">正常</ElTag>
              <ElTag v-if="group.gapSum > 0" size="small" type="danger">
                缺口 {{ Math.round(group.gapSum) }} 瓶
              </ElTag>
            </div>
          </button>

          <div v-show="!isCollapsed(group.companyId)" class="company-block__body">
            <div v-if="!group.rows.length" class="company-block__empty">
              <template v-if="group.warehouseCount === 0">
                该公司暂无仓库，请先在「仓库」挂仓并导入库存后，才会产生预警；有本周要货且库存不足才会产生缺货。
              </template>
              <template v-else-if="keywordNorm">
                当前搜索下该公司无匹配商品。
              </template>
              <template v-else>
                当前周次/筛选下暂无缺货或预警。
              </template>
            </div>
            <ElTable
              v-else
              :data="group.rows"
              border
              size="small"
              stripe
              class="block-table"
              table-layout="auto"
              row-key="productCode"
              :row-class-name="rowClassName"
            >
              <ElTableColumn type="index" label="序号" width="55" fixed="left" />
              <ElTableColumn
                v-if="showKindColumn"
                label="类型"
                width="76"
                sortable
                :sort-method="(a: ShortageAlertRow, b: ShortageAlertRow) => a.kind.localeCompare(b.kind)"
              >
                <template #default="{ row }">
                  <ElTag size="small" :type="kindTag((row as ShortageAlertRow).kind).type" effect="dark">
                    {{ kindTag((row as ShortageAlertRow).kind).label }}
                  </ElTag>
                </template>
              </ElTableColumn>
              <ElTableColumn prop="productCode" label="编码" width="100" sortable />
              <ElTableColumn prop="productName" label="商品" min-width="120" sortable show-overflow-tooltip />
              <ElTableColumn prop="availableStock" label="可用库存" min-width="110" sortable show-overflow-tooltip>
                <template #default="{ row }">
                  {{ fmtQtyStrict((row as ShortageAlertRow).availableStock, (row as ShortageAlertRow).productCode) }}
                </template>
              </ElTableColumn>
              <ElTableColumn
                v-if="showPackColumn"
                prop="packStock"
                label="其中箱规折算"
                min-width="110"
                sortable
                show-overflow-tooltip
              >
                <template #default="{ row }">
                  {{
                    (row as ShortageAlertRow).packStock > 0
                      ? fmtQtyStrict((row as ShortageAlertRow).packStock, (row as ShortageAlertRow).productCode)
                      : '—'
                  }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="warningThreshold" label="预警线" min-width="100" sortable show-overflow-tooltip>
                <template #default="{ row }">
                  {{ fmtQtyStrict((row as ShortageAlertRow).warningThreshold, (row as ShortageAlertRow).productCode) }}
                </template>
              </ElTableColumn>
              <ElTableColumn
                v-if="showDemandColumn"
                prop="totalDemand"
                label="要货需求"
                min-width="110"
                sortable
                show-overflow-tooltip
              >
                <template #default="{ row }">
                  {{
                    (row as ShortageAlertRow).totalDemand > 0
                      ? fmtQtyStrict((row as ShortageAlertRow).totalDemand, (row as ShortageAlertRow).productCode)
                      : '—'
                  }}
                </template>
              </ElTableColumn>
              <ElTableColumn
                prop="shortage"
                :label="gapColumnLabel"
                min-width="120"
                sortable
                show-overflow-tooltip
              >
                <template #default="{ row }">
                  <span
                    :class="{
                      'gap-qty': true,
                      'gap-qty--danger': (row as ShortageAlertRow).shortage > 0,
                      'gap-qty--warn':
                        (row as ShortageAlertRow).kind === 'warning'
                        && (row as ShortageAlertRow).shortage > 0,
                    }"
                  >
                    {{
                      (row as ShortageAlertRow).shortage > 0
                        ? fmtQtyStrict((row as ShortageAlertRow).shortage, (row as ShortageAlertRow).productCode)
                        : '—'
                    }}
                  </span>
                </template>
              </ElTableColumn>
              <ElTableColumn
                v-if="showChannelColumn"
                label="渠道"
                min-width="100"
                show-overflow-tooltip
              >
                <template #default="{ row }">
                  {{ (row as ShortageAlertRow).channels.join('、') || '—' }}
                </template>
              </ElTableColumn>
              <ElTableColumn label="仓库范围" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">
                  {{ getWarehouseNames((row as ShortageAlertRow).warehouseIds) }}
                </template>
              </ElTableColumn>
            </ElTable>
          </div>
        </section>
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 16px;
  flex-wrap: wrap;
  width: 100%;
}

.toolbar__left,
.toolbar__right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.toolbar__right {
  margin-left: auto;
}

.toolbar__date {
  width: 150px;
}

.toolbar__search {
  width: 200px;
}

.toolbar__tabs {
  flex-shrink: 0;
}

.week-label {
  font-size: 12px;
  color: var(--erp-text-muted);
  white-space: nowrap;
}

@media (max-width: 960px) {
  .toolbar__right {
    margin-left: 0;
    width: 100%;
  }

  .toolbar__search {
    width: min(200px, 100%);
    flex: 1 1 160px;
  }

  .toolbar__date {
    width: 140px;
  }
}

.wrap {
  padding: 4px 4px 20px;
}

.empty-box {
  padding: 48px 24px;
  text-align: center;
  color: var(--erp-text-muted);
  font-size: 13px;
  background: #fafbfc;
  border-radius: 8px;
  border: 1px dashed var(--erp-border);
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.company-block {
  flex: 0 0 auto;
  border: 1px solid var(--erp-border);
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
  position: relative;
}

.company-block--alert {
  border-color: rgba(255, 77, 79, 0.22);
}

.company-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 10px 14px;
  background: #fafbfc;
  border: 0;
  border-bottom: 1px solid var(--erp-border);
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}

.company-block--collapsed .company-block__head {
  border-bottom: 0;
}

.company-block__head:hover {
  background: #f2f3f5;
}

.company-block__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--erp-text);
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.company-block__chevron {
  display: inline-flex;
  width: 14px;
  color: var(--erp-text-muted);
  font-size: 12px;
}

.company-block__code {
  font-size: 12px;
  font-weight: 400;
  color: var(--erp-text-muted);
}

.company-block__meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.company-block__body {
  background: #fff;
}

.company-block__empty {
  padding: 16px 14px;
  font-size: 12px;
  color: var(--erp-text-muted);
  line-height: 1.5;
}

.block-table {
  width: 100%;
}

.block-table :deep(.el-table) {
  --el-table-header-bg-color: #fafbfc;
}

.block-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

.block-table :deep(.row--shortage > td) {
  background: rgba(255, 77, 79, 0.04) !important;
}

.block-table :deep(.row--warning > td) {
  background: rgba(250, 140, 22, 0.04) !important;
}

.gap-qty {
  color: var(--erp-text-muted);
  font-variant-numeric: tabular-nums;
}

.gap-qty--danger {
  color: #cf1322;
  font-weight: 600;
}

.gap-qty--warn {
  color: #d46b08;
  font-weight: 600;
}
</style>
