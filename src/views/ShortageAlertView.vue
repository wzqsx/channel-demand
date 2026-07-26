<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElSelect,
  ElOption,
  ElDatePicker,
  ElRadioGroup,
  ElRadioButton,
  ElTag,
  ElMessage,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import StatCards from '../components/StatCards.vue';
import type { StatItem } from '../components/StatCards.vue';
import { useCompanyStore } from '../stores/company';
import { useWarehouseStore } from '../stores/warehouse';
import { bootstrapStores } from '../stores/bootstrap';
import { weekStartSaturday, weekLabel } from '../utils/week';
import { buildShortageAndWarnings, type AlertKind, type ShortageAlertRow } from '../utils/shortageAlert';
import { exportRows } from '../utils/excel';

const route = useRoute();
const companyStore = useCompanyStore();
const warehouseStore = useWarehouseStore();
const { companies } = storeToRefs(companyStore);

const weekStart = ref(weekStartSaturday());
const companyId = ref('');
const tab = ref<'all' | AlertKind>('all');

onMounted(() => {
  bootstrapStores();

  const qWeek = route.query.week;
  if (typeof qWeek === 'string' && qWeek) weekStart.value = weekStartSaturday(qWeek);
  const qCompany = route.query.companyId;
  if (typeof qCompany === 'string') companyId.value = qCompany;
});

const allRows = computed(() =>
  buildShortageAndWarnings({
    weekStart: weekStart.value,
    companyId: companyId.value || undefined,
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

  const companyList = companyId.value
    ? companies.value.filter(c => c.id === companyId.value)
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

const handleExport = () => {
  const data = filteredRows.value.map(r => ({
    周起始: weekStart.value,
    主体: companyStore.getCompanyById(r.companyId)?.name || r.companyId,
    类型: r.kind === 'shortage' ? '缺货' : '预警',
    商品编码: r.productCode,
    商品名称: r.productName,
    当前库存: r.currentStock,
    在途: r.inTransitStock,
    可用库存: r.availableStock,
    预警阈值: r.warningThreshold,
    要货需求: r.totalDemand,
    缺口: r.shortage,
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
    help="按主体隔离查看（含新增主体，即使暂无数据也会列出）。\n缺货=本周要货需求超过该主体仓库可用库存；预警=该主体仓库可用库存≤商品预警阈值。\n新主体需先建仓库并导入库存/要货后，才会出现缺货或预警明细。"
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
      <ElSelect v-model="companyId" clearable placeholder="全部主体" size="small" style="width: 160px">
        <ElOption
          v-for="c in companies"
          :key="c.id"
          :label="`${c.name}（${c.code}）`"
          :value="c.id"
        />
      </ElSelect>
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
          <ElTable v-else :data="group.rows" border size="small" stripe class="block-table">
            <ElTableColumn label="类型" width="80">
              <template #default="{ row }">
                <ElTag size="small" :type="kindTag((row as ShortageAlertRow).kind).type">
                  {{ kindTag((row as ShortageAlertRow).kind).label }}
                </ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="productCode" label="编码" width="110" />
            <ElTableColumn prop="productName" label="商品" min-width="140" show-overflow-tooltip />
            <ElTableColumn prop="availableStock" label="可用库存" width="90" />
            <ElTableColumn prop="warningThreshold" label="预警线" width="80" />
            <ElTableColumn prop="totalDemand" label="要货需求" width="90" />
            <ElTableColumn prop="shortage" label="缺口" width="80">
              <template #default="{ row }">
                <span :class="{ danger: (row as ShortageAlertRow).shortage > 0 }">
                  {{ (row as ShortageAlertRow).shortage }}
                </span>
              </template>
            </ElTableColumn>
            <ElTableColumn label="渠道" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                {{ (row as ShortageAlertRow).channels.join('、') || '-' }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="仓库范围" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                {{ getWarehouseNames((row as ShortageAlertRow).warehouseIds) }}
              </template>
            </ElTableColumn>
            <ElTableColumn prop="statusText" label="说明" min-width="140" show-overflow-tooltip />
          </ElTable>
        </section>
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
.wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  overflow: hidden;
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.company-block {
  border: 1px solid var(--erp-border);
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}

.company-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: #fafbfc;
  border-bottom: 1px solid var(--erp-border);
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

.danger {
  color: #f56c6c;
  font-weight: 600;
}
</style>
