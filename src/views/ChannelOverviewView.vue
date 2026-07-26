<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElSelect,
  ElOption,
  ElRadioGroup,
  ElRadioButton,
  ElTag,
  ElMessage,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import StatCards from '../components/StatCards.vue';
import type { StatItem } from '../components/StatCards.vue';
import { useRequisitionStore } from '../stores/requisition';
import { useChannelStore } from '../stores/channel';
import { useCompanyStore } from '../stores/company';
import { bootstrapStores } from '../stores/bootstrap';
import { exportRows } from '../utils/excel';
import { periodLabel, type PeriodGrain } from '../utils/week';

const requisitionStore = useRequisitionStore();
const channelStore = useChannelStore();
const companyStore = useCompanyStore();

const grain = ref<PeriodGrain>('week');
const year = ref(new Date().getFullYear());
const companyId = ref('');
const onlyWithSales = ref(true);
const rankFilter = ref<'all' | 'excess' | 'top' | 'low'>('all');

onMounted(() => {
  bootstrapStores();
});

const yearOptions = computed(() => {
  const ys = new Set<number>();
  ys.add(new Date().getFullYear());
  requisitionStore.requisitions.forEach(r => {
    ys.add(new Date(r.weekStart + 'T00:00:00').getFullYear());
  });
  return [...ys].sort((a, b) => b - a);
});

const rows = computed(() => {
  let list = requisitionStore.channelOverview({
    grain: grain.value,
    year: year.value,
    companyId: companyId.value || undefined,
    onlyWithSales: onlyWithSales.value,
  });
  if (rankFilter.value === 'excess') list = list.filter(r => r.isExcess);
  else if (rankFilter.value === 'top') list = list.filter(r => r.completionRate >= 80);
  else if (rankFilter.value === 'low') list = list.filter(r => r.completionRate < 80);
  return list;
});

/** 每个周期内按完成率排名 */
const rankedRows = computed(() => {
  const byPeriod = new Map<string, typeof rows.value>();
  rows.value.forEach(r => {
    const arr = byPeriod.get(r.period) || [];
    arr.push(r);
    byPeriod.set(r.period, arr);
  });
  const out: (typeof rows.value[0] & { rankInPeriod: number })[] = [];
  byPeriod.forEach(list => {
    list
      .slice()
      .sort((a, b) => b.completionRate - a.completionRate)
      .forEach((r, i) => out.push({ ...r, rankInPeriod: i + 1 }));
  });
  return out.sort((a, b) => {
    if (a.period !== b.period) return a.period < b.period ? 1 : -1;
    return a.rankInPeriod - b.rankInPeriod;
  });
});

const topChannel = computed(() => rankedRows.value[0] || null);

const excessCount = computed(() => rankedRows.value.filter(r => r.isExcess).length);

const getChannelName = (id: string) => channelStore.getChannelById(id)?.name || id;
const getCompanyName = (id: string) => companyStore.getCompanyById(id)?.name || id;

const statItems = computed((): StatItem[] => {
  const items: StatItem[] = [
    { label: '记录数', value: rankedRows.value.length, tone: 'primary' },
    { label: '超额完成', value: excessCount.value, tone: excessCount.value > 0 ? 'success' : 'default' },
  ];
  if (topChannel.value) {
    items.push({
      label: '最高完成率',
      value: `${topChannel.value.completionRate}%`,
      sub: getChannelName(topChannel.value.channelId),
      tone: topChannel.value.completionRate >= 100 ? 'success' : 'primary',
    });
  }
  const avgDemand = rankedRows.value.reduce((s, r) => s + r.demandTotal, 0);
  const avgSales = rankedRows.value.reduce((s, r) => s + r.salesTotal, 0);
  const avgRate = avgDemand > 0 ? Math.round((avgSales / avgDemand) * 1000) / 10 : 0;
  items.push({
    label: '整体完成率',
    value: `${avgRate}%`,
    tone: avgRate >= 100 ? 'success' : avgRate >= 80 ? 'primary' : 'warning',
  });
  return items;
});

const rateType = (rate: number): 'success' | 'warning' | 'danger' | 'info' => {
  if (rate > 100) return 'success';
  if (rate >= 80) return 'info';
  if (rate >= 50) return 'warning';
  return 'danger';
};

const handleExport = () => {
  const data = rankedRows.value.map(r => ({
    周期: periodLabel(r.period, grain.value),
    周期内排名: r.rankInPeriod,
    主体: getCompanyName(r.companyId),
    渠道: getChannelName(r.channelId),
    要货合计: r.demandTotal,
    销货合计: r.salesTotal,
    完成率: r.completionRate + '%',
    超额数量: r.excessQty,
    缺口数量: r.shortfallQty,
    要货单数: r.requisitionCount,
    已录销货单数: r.withSalesCount,
    是否超额: r.isExcess ? '是' : '否',
  }));
  if (!data.length) {
    ElMessage.warning('暂无数据可导出');
    return;
  }
  exportRows(data, `渠道要货总览_${grain.value}_${year.value}`);
  ElMessage.success('已导出');
};
</script>

<template>
  <PageShell
    title="渠道要货总览"
    help="按周 / 月 / 季 / 年看各渠道完成率排行。完成率 = 实际销货 ÷ 要货；超过 100% 为超额完成。\n完成率越高越好；虚报是「要货远高于销货」。本页看谁卖得好、谁超额完成；虚报请到「销货核对」看明细。"
  >
    <template #metrics>
      <StatCards :items="statItems" />
    </template>

    <template #toolbar>
      <ElRadioGroup v-model="grain" size="small">
        <ElRadioButton value="week">按周</ElRadioButton>
        <ElRadioButton value="month">按月</ElRadioButton>
        <ElRadioButton value="quarter">按季</ElRadioButton>
        <ElRadioButton value="year">按年</ElRadioButton>
      </ElRadioGroup>
      <ElSelect v-model="year" size="small" style="width: 110px">
        <ElOption v-for="y in yearOptions" :key="y" :label="`${y}年`" :value="y" />
      </ElSelect>
      <ElSelect v-model="companyId" clearable placeholder="全部主体" size="small" style="width: 130px">
        <ElOption
          v-for="c in companyStore.companies"
          :key="c.id"
          :label="c.name"
          :value="c.id"
        />
      </ElSelect>
      <ElSelect v-model="rankFilter" size="small" style="width: 120px">
        <ElOption label="全部" value="all" />
        <ElOption label="超额完成" value="excess" />
        <ElOption label="完成≥80%" value="top" />
        <ElOption label="完成&lt;80%" value="low" />
      </ElSelect>
      <ElSelect v-model="onlyWithSales" size="small" style="width: 130px">
        <ElOption :value="true" label="仅已录销货" />
        <ElOption :value="false" label="含未录销货" />
      </ElSelect>
      <ElButton size="small" type="primary" @click="handleExport">导出报表</ElButton>
    </template>

    <div class="wrap">
      <ElTable
        :data="rankedRows"
        border
        size="small"
        stripe
        class="erp-data-table"
        height="100%"
      >
        <ElTableColumn label="周期" width="160">
          <template #default="{ row }">{{ periodLabel(row.period, grain) }}</template>
        </ElTableColumn>
        <ElTableColumn label="排名" width="70" align="center">
          <template #default="{ row }">
            <ElTag v-if="row.rankInPeriod <= 3" size="small" type="success">#{{ row.rankInPeriod }}</ElTag>
            <span v-else>#{{ row.rankInPeriod }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="主体" width="110">
          <template #default="{ row }">{{ getCompanyName(row.companyId) }}</template>
        </ElTableColumn>
        <ElTableColumn label="渠道" width="120">
          <template #default="{ row }">{{ getChannelName(row.channelId) }}</template>
        </ElTableColumn>
        <ElTableColumn prop="demandTotal" label="要货合计" width="100" />
        <ElTableColumn prop="salesTotal" label="销货合计" width="100" />
        <ElTableColumn label="完成率" width="110">
          <template #default="{ row }">
            <ElTag size="small" :type="rateType(row.completionRate)">
              {{ row.completionRate }}%
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="超额" width="90">
          <template #default="{ row }">
            <span :class="{ ok: row.excessQty > 0 }">{{ row.excessQty }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="shortfallQty" label="缺口" width="90" />
        <ElTableColumn label="状态" width="100">
          <template #default="{ row }">
            <ElTag v-if="row.isExcess" size="small" type="success">超额完成</ElTag>
            <ElTag v-else-if="row.completionRate >= 80" size="small">达标</ElTag>
            <ElTag v-else size="small" type="warning">偏低</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="requisitionCount" label="单数" width="70" />
      </ElTable>
    </div>
  </PageShell>
</template>

<style scoped>
.wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px 0;
  overflow: hidden;
}

.ok {
  color: #67c23a;
  font-weight: 600;
}
</style>
