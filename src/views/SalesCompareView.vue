<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElDatePicker,
  ElTag,
  ElDialog,
  ElInputNumber,
  ElInput,
  ElMessage,
  ElMessageBox,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import HelpTip from '../components/HelpTip.vue';
import StatCards from '../components/StatCards.vue';
import type { StatItem } from '../components/StatCards.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import { useRequisitionStore } from '../stores/requisition';
import { useChannelStore } from '../stores/channel';
import { useCompanyStore } from '../stores/company';
import { useProductStore } from '../stores/product';
import { bootstrapStores } from '../stores/bootstrap';
import type { DemandSalesCompareRow, ImportRequisitionData, Requisition } from '../types';
import { weekStartSaturday, weekLabel, disabledFutureWeekDate } from '../utils/week';
import { readExcelFromEvent, exportRows, downloadTemplate, cell, cellNum } from '../utils/excel';
import { formatProductQty } from '../utils/qtyDisplay';
import { useRememberedCompanyFilter } from '../composables/useRememberedCompanyFilter';
import { formatCompanyLabel, formatCompanyNameOnly } from '../utils/companyDisplay';

const route = useRoute();
const requisitionStore = useRequisitionStore();
const channelStore = useChannelStore();
const companyStore = useCompanyStore();
const productStore = useProductStore();

const weekStart = ref(weekStartSaturday());
const companyIds = useRememberedCompanyFilter('sales-compare');

const companyFilterOptions = computed(() =>
  companyStore.companies.map(c => ({ value: c.id, label: formatCompanyLabel(c) })),
);

const detailVisible = ref(false);
const detailRows = ref<DemandSalesCompareRow[]>([]);
const detailTitle = ref('');

const editVisible = ref(false);
const editTarget = ref<Requisition | null>(null);
const salesRows = ref<ImportRequisitionData[]>([]);
const salesFileRef = ref<HTMLInputElement | null>(null);

onMounted(async () => {
  bootstrapStores();
  const qWeek = route.query.week;
  if (typeof qWeek === 'string' && qWeek) weekStart.value = weekStartSaturday(qWeek);
  const qCompanies = route.query.companyIds;
  if (typeof qCompanies === 'string' && qCompanies) {
    companyIds.value = qCompanies.split(',').filter(Boolean);
  } else if (typeof route.query.companyId === 'string' && route.query.companyId) {
    companyIds.value = [route.query.companyId];
  }
  await nextTick();
  const qReq = route.query.requisitionId;
  if (typeof qReq === 'string' && qReq) {
    const hit = summary.value.find(r => r.requisitionId === qReq);
    if (hit) openEditSales(hit);
  }
});

type SummaryRow = {
  requisitionId: string;
  channelId: string;
  companyId: string;
  hasSales: boolean;
  demandTotal: number;
  salesTotal: number;
  overClaimTotal: number;
  overclaimSkus: number;
  fillRate: number;
};

const summary = computed((): SummaryRow[] => {
  let list = requisitionStore.weekOverclaimSummary(weekStart.value);
  if (companyIds.value.length) {
    list = list.filter(r => companyIds.value.includes(r.companyId));
  }
  return list;
});

const approvedCount = computed(
  () =>
    requisitionStore
      .getRequisitionsByWeek(weekStart.value)
      .filter(r => r.status === 'approved' && (!companyIds.value.length || companyIds.value.includes(r.companyId)))
      .length,
);

const totals = computed(() => {
  const demand = summary.value.reduce((s, r) => s + r.demandTotal, 0);
  const sales = summary.value.reduce((s, r) => s + r.salesTotal, 0);
  const over = summary.value.reduce((s, r) => s + r.overClaimTotal, 0);
  const filled = summary.value.filter(r => r.hasSales).length;
  const missing = summary.value.filter(r => !r.hasSales).length;
  const rate = demand > 0 ? Math.round((sales / demand) * 1000) / 10 : 0;
  return { demand, sales, over, filled, missing, rate };
});

const statItems = computed((): StatItem[] => [
  { label: '要货合计', value: totals.value.demand, tone: 'primary' },
  { label: '销货合计', value: totals.value.sales, tone: 'success' },
  { label: '虚报量合计', value: totals.value.over, tone: totals.value.over > 0 ? 'danger' : 'default' },
  { label: '完成率均值', value: `${totals.value.rate}%`, tone: totals.value.rate >= 100 ? 'success' : totals.value.rate >= 80 ? 'primary' : 'warning' },
]);

const getChannelName = (id: string) => channelStore.getChannelById(id)?.name || id;
const getCompanyName = (id: string) => {
  const c = companyStore.getCompanyById(id);
  return c ? formatCompanyNameOnly(c) : id;
};

const openDetail = (row: SummaryRow) => {
  detailTitle.value = `${getChannelName(row.channelId)} · ${weekLabel(weekStart.value)}`;
  detailRows.value = requisitionStore.compareDemandVsSales(row.requisitionId);
  detailVisible.value = true;
};

/** 打开录入/编辑销货：优先带出已录销货，否则用要货明细做底稿（数量先填 0，可改） */
const openEditSales = (row: SummaryRow) => {
  const req = requisitionStore.getRequisitionById(row.requisitionId);
  if (!req) {
    ElMessage.error('要货单不存在');
    return;
  }
  editTarget.value = req;

  if (req.salesItems?.length) {
    salesRows.value = req.salesItems.map(i => ({
      productCode: i.productCode,
      productName: i.productName,
      quantity: i.quantity,
      remark: i.remark || '',
    }));
  } else {
    // 以要货 SKU 为底稿，方便逐行填实际销量
    const map = new Map<string, ImportRequisitionData>();
    req.items.forEach(i => {
      const prev = map.get(i.productCode);
      if (prev) prev.quantity = 0;
      else {
        map.set(i.productCode, {
          productCode: i.productCode,
          productName: i.productName,
          quantity: 0,
          remark: `要货 ${i.quantity}`,
        });
      }
    });
    salesRows.value = [...map.values()];
  }
  editVisible.value = true;
};

const addBlankRow = () => {
  salesRows.value.push({
    productCode: '',
    productName: '',
    quantity: 0,
    remark: '',
  });
};

const removeRow = (idx: number) => {
  salesRows.value.splice(idx, 1);
};

const onProductCodeBlur = (row: ImportRequisitionData) => {
  const code = row.productCode.trim();
  if (!code) return;
  const p = productStore.getProductByCode(code);
  if (p) row.productName = p.name;
};

const handleSalesImport = async (event: Event) => {
  const jsonData = await readExcelFromEvent(event);
  const imported = new Map<string, ImportRequisitionData>();

  jsonData.forEach(item => {
    let productCode = cell(item, '商品编码', 'code');
    if (!productCode) return;
    let quantity = cellNum(item, '数量', 'quantity', '销量', '销货数量');
    let productName = cell(item, '商品名称', 'name');
    const remark = cell(item, '备注', 'remark');

    const product = productStore.getProductByCode(productCode);
    if (product?.combineProductCode && product.combineRatio > 0) {
      quantity = quantity * product.combineRatio;
      productCode = product.combineProductCode;
      productName = (productName || product.name) + ` (组合→${productCode})`;
    } else if (!productName) {
      productName = product?.name || productCode;
    }

    const prev = imported.get(productCode);
    if (prev) prev.quantity += quantity;
    else imported.set(productCode, { productCode, productName, quantity, remark });
  });

  // 以要货 SKU 为底，导入数量按编码覆盖关联；要货有但导入没有的保留 0
  if (editTarget.value) {
    const demandCodes = new Map<string, string>();
    editTarget.value.items.forEach(i => {
      if (!demandCodes.has(i.productCode)) demandCodes.set(i.productCode, i.productName);
    });
    const merged: ImportRequisitionData[] = [];
    demandCodes.forEach((name, code) => {
      const hit = imported.get(code);
      merged.push({
        productCode: code,
        productName: hit?.productName || name,
        quantity: hit?.quantity ?? 0,
        remark: hit?.remark || `要货参考 ${editTarget.value!.items.filter(x => x.productCode === code).reduce((s, x) => s + x.quantity, 0)}`,
      });
      imported.delete(code);
    });
    // 导入里多出来、要货没有的 SKU 也保留
    imported.forEach(v => merged.push(v));
    salesRows.value = merged;
  } else {
    salesRows.value = [...imported.values()];
  }

  ElMessage.success(`已按商品编码导入并关联要货，共 ${salesRows.value.length} 行`);
};

const downloadSalesTemplate = () => {
  downloadTemplate(['商品编码', '商品名称', '数量', '备注'], '销货导入模板');
};

const exportCompare = () => {
  const flat = requisitionStore.exportSalesCompareFlat(weekStart.value).map(r => ({
    单号: r['单号'],
    周起始: r['周起始'],
    主体: getCompanyName(r['主体ID']),
    渠道: getChannelName(r['渠道ID']),
    商品编码: r['商品编码'],
    商品名称: r['商品名称'],
    要货数量: r['要货数量'],
    销货数量: r['销货数量'],
    虚报量: r['虚报量'],
    完成率: r['完成率'],
    结论: r['结论'],
  }));
  if (!flat.length) {
    ElMessage.warning('本周暂无可导出的核对数据');
    return;
  }
  exportRows(flat, `销货核对_${weekStart.value}`);
  ElMessage.success('已导出');
};

const saveSales = () => {
  if (!editTarget.value) return;
  const valid = salesRows.value.filter(r => r.productCode.trim() && r.quantity >= 0);
  if (!valid.length) {
    ElMessage.error('请至少填写一行有效销货（商品编码 + 数量）');
    return;
  }
  const missingQty = valid.filter(r => !r.quantity && r.quantity !== 0);
  if (missingQty.length) {
    ElMessage.error('请填写销货数量');
    return;
  }

  requisitionStore.saveSalesItems(
    editTarget.value.id,
    valid.map(r => ({
      productCode: r.productCode.trim(),
      productName: r.productName || r.productCode,
      quantity: Number(r.quantity) || 0,
      remark: r.remark || '',
    })),
  );
  ElMessage.success('销货已保存，完成度已更新');
  editVisible.value = false;
};

const clearSales = async (row: SummaryRow) => {
  try {
    await ElMessageBox.confirm('确认清空该渠道本周已录销货？', '提示', { type: 'warning' });
  } catch {
    return;
  }
  requisitionStore.saveSalesItems(row.requisitionId, []);
  ElMessage.success('已清空');
};

const statusTag = (row: SummaryRow) => {
  if (!row.hasSales) return { label: '未录销货', type: 'info' as const };
  if (row.overclaimSkus > 0) return { label: `疑似虚报 ${row.overclaimSkus} SKU`, type: 'danger' as const };
  return { label: '基本正常', type: 'success' as const };
};

const compareTag = (status: DemandSalesCompareRow['status']) => {
  const map: Record<string, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
    accurate: { label: '正常', type: 'success' },
    overclaim: { label: '疑似虚报', type: 'danger' },
    underclaim: { label: '要货偏低', type: 'warning' },
    no_sales: { label: '无销货', type: 'danger' },
    no_demand: { label: '未要货有销', type: 'info' },
  };
  return map[status] || { label: status, type: 'info' };
};
</script>

<template>
  <PageShell
    title="销货核对"
    help="按商品编码导入实际销量，自动关联要货并计算完成率（销货÷要货）。可在本页直接录入或编辑。\n怎么填：先在「渠道要货」把本周单审成「已通过」→ 回到本页点录入销货 / 编辑销货 → 可 Excel 导入，也可手工改数量后保存。"
  >
    <template #metrics>
      <StatCards :items="statItems" />
    </template>

    <template #toolbar>
      <ElDatePicker
        v-model="weekStart"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="要货周期"
        size="small"
        style="width: 150px"
        :disabled-date="disabledFutureWeekDate"
        @change="(v: string) => { if (v) weekStart = weekStartSaturday(v) }"
      />
      <MultiCheckFilter
        v-model="companyIds"
        :options="companyFilterOptions"
        placeholder="主体(可多选)"
        width="200px"
      />
      <span class="week-label">要货周期：{{ weekLabel(weekStart) }}</span>
      <ElButton size="small" @click="exportCompare">导出核对</ElButton>
      <ElButton size="small" @click="downloadSalesTemplate">销货模板</ElButton>
    </template>

    <div class="wrap">
      <div v-if="!approvedCount" class="empty-box">
        本周还没有「已通过」的要货单。请先去「渠道要货」提交并审批，再回来录入实际销量。
      </div>

      <ElTable
        v-else
        :data="summary"
        border
        size="small"
        stripe
        class="erp-data-table"
        height="100%"
      >
        <ElTableColumn type="index" label="序号" width="55" fixed="left" />
        <ElTableColumn
          label="主体"
          width="120"
          sortable
          :sort-method="(a: SummaryRow, b: SummaryRow) => getCompanyName(a.companyId).localeCompare(getCompanyName(b.companyId), 'zh-CN')"
        >
          <template #default="{ row }">{{ getCompanyName((row as SummaryRow).companyId) }}</template>
        </ElTableColumn>
        <ElTableColumn
          label="渠道"
          width="120"
          sortable
          :sort-method="(a: SummaryRow, b: SummaryRow) => getChannelName(a.channelId).localeCompare(getChannelName(b.channelId), 'zh-CN')"
        >
          <template #default="{ row }">{{ getChannelName((row as SummaryRow).channelId) }}</template>
        </ElTableColumn>
        <ElTableColumn
          label="要货合计(瓶)"
          width="110"
          sortable
          :sort-method="(a: SummaryRow, b: SummaryRow) => a.demandTotal - b.demandTotal"
        >
          <template #default="{ row }">{{ (row as SummaryRow).demandTotal }}</template>
        </ElTableColumn>
        <ElTableColumn
          label="销货合计(瓶)"
          width="110"
          sortable
          :sort-method="(a: SummaryRow, b: SummaryRow) => a.salesTotal - b.salesTotal"
        >
          <template #default="{ row }">{{ (row as SummaryRow).salesTotal }}</template>
        </ElTableColumn>
        <ElTableColumn
          label="虚报量(瓶)"
          width="100"
          sortable
          :sort-method="(a: SummaryRow, b: SummaryRow) => a.overClaimTotal - b.overClaimTotal"
        >
          <template #default="{ row }">
            <span :class="{ danger: (row as SummaryRow).overClaimTotal > 0 }">
              {{ (row as SummaryRow).overClaimTotal }}
            </span>
          </template>
        </ElTableColumn>
        <ElTableColumn
          label="完成率"
          width="90"
          sortable
          :sort-method="(a: SummaryRow, b: SummaryRow) => a.fillRate - b.fillRate"
        >
          <template #default="{ row }">{{ (row as SummaryRow).fillRate }}%</template>
        </ElTableColumn>
        <ElTableColumn label="结论" min-width="130">
          <template #default="{ row }">
            <ElTag size="small" :type="statusTag(row as SummaryRow).type">
              {{ statusTag(row as SummaryRow).label }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn width="220" fixed="right">
          <template #header>
            <span class="label-with-help">
              操作
              <HelpTip
                inline
                title="录入销货说明"
                content="点击「录入销货」或「编辑销货」打开录入对话框。\n可 Excel 导入实际销量，也可手工填写数量后保存。\n保存后自动关联要货并计算完成率（销货÷要货）。"
              />
            </span>
          </template>
          <template #default="{ row }">
            <ElButton
              link
              type="primary"
              size="small"
              @click="openEditSales(row as SummaryRow)"
            >
              {{ (row as SummaryRow).hasSales ? '编辑销货' : '录入销货' }}
            </ElButton>
            <ElButton
              link
              type="success"
              size="small"
              :disabled="!(row as SummaryRow).hasSales"
              @click="openDetail(row as SummaryRow)"
            >核对明细</ElButton>
            <ElButton
              v-if="(row as SummaryRow).hasSales"
              link
              type="danger"
              size="small"
              @click="clearSales(row as SummaryRow)"
            >清空</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <!-- 录入 / 编辑销货 -->
    <ElDialog
      v-model="editVisible"
      :title="editTarget?.salesItems?.length ? '编辑本周实际销货' : '录入本周实际销货'"
      width="920px"
      destroy-on-close
    >
      <template v-if="editTarget">
        <p class="detail-meta" style="margin-bottom: 10px">
          {{ getCompanyName(editTarget.companyId) }} ·
          {{ getChannelName(editTarget.channelId) }} ·
          {{ weekLabel(editTarget.weekStart) }}
        </p>

        <div class="edit-toolbar">
          <input
            ref="salesFileRef"
            type="file"
            accept=".xlsx,.xls"
            class="hidden-file"
            @change="handleSalesImport"
          />
          <ElButton size="small" @click="salesFileRef?.click()">Excel 导入</ElButton>
          <HelpTip
            inline
            title="Excel 导入说明"
            content="按商品编码导入后自动关联要货并算完成率。\n列：商品编码、商品名称、数量、备注\n完成率 = 销货 ÷ 要货；保存后自动更新。"
          />
          <ElButton size="small" @click="downloadSalesTemplate">下载模板</ElButton>
          <ElButton size="small" @click="addBlankRow">加一行</ElButton>
        </div>

        <ElTable :data="salesRows" border size="small" max-height="380">
          <ElTableColumn type="index" label="序号" width="55" />
          <ElTableColumn label="商品编码" width="140">
            <template #default="{ row }">
              <ElInput
                v-model="(row as ImportRequisitionData).productCode"
                size="small"
                placeholder="编码"
                @blur="onProductCodeBlur(row as ImportRequisitionData)"
              />
            </template>
          </ElTableColumn>
          <ElTableColumn label="商品名称" min-width="160">
            <template #default="{ row }">
              <ElInput v-model="(row as ImportRequisitionData).productName" size="small" placeholder="名称" />
            </template>
          </ElTableColumn>
          <ElTableColumn label="实际销量" width="130">
            <template #default="{ row }">
              <ElInputNumber
                v-model="(row as ImportRequisitionData).quantity"
                :min="0"
                size="small"
                controls-position="right"
                style="width: 100%"
              />
            </template>
          </ElTableColumn>
          <ElTableColumn label="要货参考" width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="demand-ref">{{
                formatProductQty(
                  editTarget?.items
                    .filter(i => i.productCode === (row as ImportRequisitionData).productCode)
                    .reduce((s, i) => s + i.quantity, 0) || 0,
                  (row as ImportRequisitionData).productCode,
                )
              }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="备注" min-width="120">
            <template #default="{ row }">
              <ElInput v-model="(row as ImportRequisitionData).remark" size="small" />
            </template>
          </ElTableColumn>
          <ElTableColumn label="" width="60" fixed="right">
            <template #default="{ $index }">
              <ElButton link type="danger" size="small" @click="removeRow($index)">删</ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </template>

      <template #footer>
        <ElButton size="small" @click="editVisible = false">取消</ElButton>
        <ElButton size="small" type="primary" @click="saveSales">保存销货</ElButton>
      </template>
    </ElDialog>

    <!-- 核对明细只读 -->
    <ElDialog v-model="detailVisible" :title="detailTitle" width="860px">
      <ElTable :data="detailRows" border size="small" max-height="420">
        <ElTableColumn type="index" label="序号" width="55" />
        <ElTableColumn prop="productCode" label="编码" width="110" sortable />
        <ElTableColumn prop="productName" label="名称" min-width="140" sortable />
        <ElTableColumn prop="demandQty" label="要货" width="110" sortable show-overflow-tooltip>
          <template #default="{ row }">
            {{ formatProductQty((row as DemandSalesCompareRow).demandQty, (row as DemandSalesCompareRow).productCode) }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="salesQty" label="销货" width="110" sortable show-overflow-tooltip>
          <template #default="{ row }">
            {{ formatProductQty((row as DemandSalesCompareRow).salesQty, (row as DemandSalesCompareRow).productCode) }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="overClaim" label="虚报量" width="110" sortable show-overflow-tooltip>
          <template #default="{ row }">
            {{ formatProductQty((row as DemandSalesCompareRow).overClaim, (row as DemandSalesCompareRow).productCode) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="要货/销货" width="100">
          <template #default="{ row }">
            {{ (row as DemandSalesCompareRow).ratio === Infinity ? '∞' : (row as DemandSalesCompareRow).ratio }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="结论" width="110">
          <template #default="{ row }">
            <ElTag size="small" :type="compareTag((row as DemandSalesCompareRow).status).type">
              {{ compareTag((row as DemandSalesCompareRow).status).label }}
            </ElTag>
          </template>
        </ElTableColumn>
      </ElTable>
    </ElDialog>
  </PageShell>
</template>

<style scoped>
.week-label {
  font-size: 13px;
  color: var(--erp-text-muted);
}

.detail-meta {
  font-size: 13px;
  color: var(--erp-text-muted);
}

.demand-ref {
  font-size: 12px;
  color: var(--erp-text-muted);
}

.wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px 0;
  overflow: hidden;
}

.danger {
  color: #f56c6c;
  font-weight: 600;
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

.edit-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.hidden-file {
  display: none;
}
</style>
