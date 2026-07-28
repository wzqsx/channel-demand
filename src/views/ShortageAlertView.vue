<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import StatCards from '../components/StatCards.vue';
import type { StatItem } from '../components/StatCards.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import { useCompanyStore } from '../stores/company';
import { useWarehouseStore } from '../stores/warehouse';
import { bootstrapStores } from '../stores/bootstrap';
import { weekStartSaturday, weekLabel } from '../utils/week';
import { buildShortageAndWarnings, type AlertKind, type ShortageAlertRow } from '../utils/shortageAlert';
import { formatProductQty } from '../utils/qtyDisplay';
import { exportRows } from '../utils/excel';

const route = useRoute();
const companyStore = useCompanyStore();
const warehouseStore = useWarehouseStore();
const { companies } = storeToRefs(companyStore);

const weekStart = ref(weekStartSaturday());
const companyIds = ref<string[]>([]);
const tab = ref<'all' | AlertKind>('all');

const companyFilterOptions = computed(() =>
  companies.value.map(c => ({ value: c.id, label: `${c.name}（${c.code}）` })),
);

onMounted(() => {
  bootstrapStores();

  const qWeek = route.query.week;
  if (typeof qWeek === 'string' && qWeek) weekStart.value = weekStartSaturday(qWeek);
  const qCompanies = route.query.companyIds;
  if (typeof qCompanies === 'string' && qCompanies) {
    companyIds.value = qCompanies.split(',').filter(Boolean);
  } else {
    const qCompany = route.query.companyId;
    if (typeof qCompany === 'string' && qCompany) companyIds.value = [qCompany];
  }
});

const allRows = computed(() =>
  buildShortageAndWarnings({
    weekStart: weekStart.value,
    companyIds: companyIds.value.length ? companyIds.value : undefined,
  }),
);

const filteredRows = computed(() => {
  if (tab.value === 'all') return allRows.value;
  return allRows.value.filter(r => r.kind === tab.value);
});

/** 始终按全部主体（或筛选主体）分组；无数据的主体也展示，避免「新增公司看不见」 */
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
    return {
      companyId: c.id,
      companyName: c.name,
      companyCode: c.code,
      warehouseCount: whCount,
      rows,
      shortageCount: rows.filter(x => x.kind === 'shortage').length,
      warningCount: rows.filter(x => x.kind === 'warning').length,
    };
  });
});

const statItems = computed((): StatItem[] => {
  const shortage = allRows.value.filter(r => r.kind === 'shortage').length;
  const warning = allRows.value.filter(r => r.kind === 'warning').length;
  const gap = allRows.value.reduce((s, r) => s + r.shortage, 0);
  return [
    { label: '缺货 SKU', value: shortage, tone: shortage > 0 ? 'danger' : 'default' },
    { label: '预警 SKU', value: warning, tone: warning > 0 ? 'warning' : 'default' },
    { label: '缺口合计', value: gap, tone: gap > 0 ? 'danger' : 'primary' },
    {
      label: '主体数',
      value: companies.value.length,
      tone: 'primary',
    },
  ];
});

const getWarehouseNames = (ids: string[]) =>
  ids.map(id => warehouseStore.getWarehouseById(id)?.name || id).join('、');

const kindTag = (kind: AlertKind) =>
  kind === 'shortage'
    ? { label: '缺货', type: 'danger' as const }
    : { label: '预警', type: 'warning' as const };

const fmtQty = (qty: number, productCode: string) => formatProductQty(qty, productCode);

const handleExport = () => {
  const data = filteredRows.value.map(r => ({
    周起始: weekStart.value,
    主体: companyStore.getCompanyById(r.companyId)?.name || r.companyId,
    类型: r.kind === 'shortage' ? '缺货' : '预警',
    商品编码: r.productCode,
    商品名称: r.productName,
    当前库存: fmtQty(r.currentStock, r.productCode),
    在途: fmtQty(r.inTransitStock, r.productCode),
    可用库存: fmtQty(r.availableStock, r.productCode),
    瓶规自身: fmtQty(r.ownStock, r.productCode),
    箱规折算: fmtQty(r.packStock, r.productCode),
    预警阈值: fmtQty(r.warningThreshold, r.productCode),
    要货需求: fmtQty(r.totalDemand, r.productCode),
    缺口: fmtQty(r.shortage, r.productCode),
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
    help="按主体隔离查看。\n缺货/预警的可用库存 = 瓶规库存 + 箱规库存×换算比例（要货按瓶规口径）。\n箱规商品需在「商品」勾选组合，填写基础瓶规编码与比例。\n数量展示按瓶规「每箱瓶数」换算，如 100箱零3瓶。"
  >
    <template #metrics>
      <StatCards :items="statItems" />
    </template>

    <template #toolbar>
      <ElDatePicker
        v-model="weekStart"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="周起始"
        size="small"
        style="width: 150px"
        @change="(v: string) => { if (v) weekStart = weekStartSaturday(v) }"
      />
      <MultiCheckFilter
        v-model="companyIds"
        :options="companyFilterOptions"
        placeholder="主体(可多选)"
        width="200px"
      />
      <ElRadioGroup v-model="tab" size="small">
        <ElRadioButton value="all">全部</ElRadioButton>
        <ElRadioButton value="shortage">缺货</ElRadioButton>
        <ElRadioButton value="warning">预警</ElRadioButton>
      </ElRadioGroup>
      <span class="week-label">{{ weekLabel(weekStart) }}</span>
      <ElButton size="small" type="primary" @click="handleExport">导出</ElButton>
    </template>

    <div class="wrap">
      <div v-if="!companies.length" class="empty-box">
        尚未维护公司主体，请先到「公司主体」新增。
      </div>

      <div v-else class="groups">
        <section
          v-for="group in groupedByCompany"
          :key="group.companyId"
          class="company-block"
        >
          <div class="company-block__head">
            <div class="company-block__title">
              {{ group.companyName }}
              <span class="company-block__code">{{ group.companyCode }}</span>
            </div>
            <div class="company-block__meta">
              <ElTag size="small" type="info">仓库 {{ group.warehouseCount }}</ElTag>
              <ElTag size="small" type="danger">缺货 {{ group.shortageCount }}</ElTag>
              <ElTag size="small" type="warning">预警 {{ group.warningCount }}</ElTag>
            </div>
          </div>
          <div v-if="!group.rows.length" class="company-block__empty">
            <template v-if="group.warehouseCount === 0">
              该主体暂无仓库，请先在「仓库」挂仓并导入库存后，才会产生预警；有本周要货且库存不足才会产生缺货。
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
          >
            <ElTableColumn label="类型" width="72">
              <template #default="{ row }">
                <ElTag size="small" :type="kindTag((row as ShortageAlertRow).kind).type">
                  {{ kindTag((row as ShortageAlertRow).kind).label }}
                </ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="productCode" label="编码" width="100" />
            <ElTableColumn prop="productName" label="商品" min-width="120" show-overflow-tooltip />
            <ElTableColumn label="可用库存" min-width="110" show-overflow-tooltip>
              <template #default="{ row }">
                {{ fmtQty((row as ShortageAlertRow).availableStock, (row as ShortageAlertRow).productCode) }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="其中箱规折算" min-width="110" show-overflow-tooltip>
              <template #default="{ row }">
                {{
                  (row as ShortageAlertRow).packStock > 0
                    ? fmtQty((row as ShortageAlertRow).packStock, (row as ShortageAlertRow).productCode)
                    : '-'
                }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="预警线" min-width="100" show-overflow-tooltip>
              <template #default="{ row }">
                {{ fmtQty((row as ShortageAlertRow).warningThreshold, (row as ShortageAlertRow).productCode) }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="要货需求" min-width="110" show-overflow-tooltip>
              <template #default="{ row }">
                {{ fmtQty((row as ShortageAlertRow).totalDemand, (row as ShortageAlertRow).productCode) }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="缺口" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                <span :class="{ danger: (row as ShortageAlertRow).shortage > 0 }">
                  {{ fmtQty((row as ShortageAlertRow).shortage, (row as ShortageAlertRow).productCode) }}
                </span>
              </template>
            </ElTableColumn>
            <ElTableColumn label="渠道" min-width="100" show-overflow-tooltip>
              <template #default="{ row }">
                {{ (row as ShortageAlertRow).channels.join('、') || '-' }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="仓库范围" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                {{ getWarehouseNames((row as ShortageAlertRow).warehouseIds) }}
              </template>
            </ElTableColumn>
            <ElTableColumn prop="statusText" label="说明" min-width="120" show-overflow-tooltip />
          </ElTable>
        </section>
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
.wrap {
  padding: 4px 4px 20px;
}

.week-label {
  font-size: 12px;
  color: var(--erp-text-muted);
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
  gap: 16px;
}

/* 禁止被父级 flex 压扁，避免多主体表格叠在一起 */
.company-block {
  flex: 0 0 auto;
  border: 1px solid var(--erp-border);
  border-radius: 10px;
  background: #fff;
  overflow: visible;
  position: relative;
}

.company-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: #fafbfc;
  border-bottom: 1px solid var(--erp-border);
  border-radius: 10px 10px 0 0;
}

.company-block__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--erp-text);
  display: flex;
  align-items: baseline;
  gap: 8px;
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

.danger {
  color: #f56c6c;
  font-weight: 600;
}
</style>
