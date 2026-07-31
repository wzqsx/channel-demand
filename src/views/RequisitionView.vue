<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElMessage,
  ElTag,
  ElMessageBox,
  ElDatePicker,
  ElEmpty,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import HelpTip from '../components/HelpTip.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import { useRequisitionStore } from '../stores/requisition';
import { useChannelStore } from '../stores/channel';
import { useWarehouseStore } from '../stores/warehouse';
import { useProductStore } from '../stores/product';
import { useCompanyStore } from '../stores/company';
import { bootstrapStores } from '../stores/bootstrap';
import type { Requisition, ImportRequisitionData } from '../types';
import { weekLabel, weekEnd, isFutureWeek, currentWeekStart, toDateKey } from '../utils/week';
import { exportRows, downloadTemplate, readExcelFromEvent, cell, cellNum } from '../utils/excel';
import { assertRequisitionScope, getChannelAllowedWarehouses } from '../utils/companyScope';
import { getBottleEquivalentStock } from '../utils/packStock';
import { formatProductQty } from '../utils/qtyDisplay';
import { useRememberedCompanyFilter } from '../composables/useRememberedCompanyFilter';
import { formatCompanyLabel, formatCompanyNameOnly } from '../utils/companyDisplay';

const router = useRouter();
const requisitionStore = useRequisitionStore();
const channelStore = useChannelStore();
const warehouseStore = useWarehouseStore();
const productStore = useProductStore();
const companyStore = useCompanyStore();

const filterWeek = ref(toDateKey());
const filterCompanyIds = useRememberedCompanyFilter('requisitions');

const form = ref({
  weekStart: toDateKey(),
});

const importDialogVisible = ref(false);
const importData = ref<ImportRequisitionData[]>([]);
const previewVisible = ref(false);
const previewData = ref<ImportRequisitionData[]>([]);
const stockCheckResults = ref<{
  productCode: string;
  productName: string;
  channelLabel: string;
  demandQuantity: number;
  availableStock: number;
  packStock: number;
  higherPriorityDemand: number;
  status: 'ok' | 'low' | 'short';
  message: string;
}[]>([]);

const detailVisible = ref(false);
const detailRow = ref<Requisition | null>(null);

const stockCheckSummary = computed(() => {
  const rows = stockCheckResults.value;
  return {
    total: rows.length,
    short: rows.filter(r => r.status === 'short').length,
    low: rows.filter(r => r.status === 'low').length,
    ok: rows.filter(r => r.status === 'ok').length,
  };
});

const listRows = computed(() => {
  return requisitionStore.requisitions.filter(r => {
    if (filterWeek.value && r.weekStart !== filterWeek.value) return false;
    if (filterCompanyIds.value.length && !filterCompanyIds.value.includes(r.companyId)) return false;
    return true;
  });
});

onMounted(() => {
  bootstrapStores();
});

const openDialog = () => {
  const w = toDateKey(filterWeek.value || new Date());
  form.value = {
    weekStart: w,
  };
  importData.value = [];
  previewData.value = [];
  previewVisible.value = false;
  stockCheckResults.value = [];
  importDialogVisible.value = true;
};

const setPeriodStart = (target: 'filter' | 'form', raw?: string | null) => {
  if (!raw) return;
  const start = toDateKey(raw);
  if (target === 'filter') filterWeek.value = start;
  else form.value.weekStart = start;
};

const formWeekHint = computed(() => {
  const w = form.value.weekStart;
  if (!w) return '';
  if (isFutureWeek(w)) return '尚未到提报日，提交时会确认';
  if (w < currentWeekStart()) return '历史周期';
  if (w === currentWeekStart()) return '从今天起算';
  return '';
});

const formWeekEndText = computed(() => {
  const w = form.value.weekStart;
  if (!w) return '—';
  const end = weekEnd(w);
  const d = new Date(end + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日`;
});

const onFormStartChange = (v: string | null) => {
  if (v) form.value.weekStart = toDateKey(v);
};

const filterPeriodRange = computed({
  get: (): [string, string] | null => {
    const s = filterWeek.value;
    if (!s) return null;
    return [s, weekEnd(s)];
  },
  set: (v: [string, string] | null) => {
    if (v?.[0]) filterWeek.value = toDateKey(v[0]);
  },
});

const goChannelManage = () => {
  importDialogVisible.value = false;
  router.push('/channels');
};

const companyFilterOptions = computed(() =>
  companyStore.companies.map(c => ({ value: c.id, label: formatCompanyLabel(c) })),
);

const parseExcelRows = (jsonData: any[]): ImportRequisitionData[] => {
  const converted: ImportRequisitionData[] = [];
  jsonData.forEach((item: any) => {
    const companyCode = cell(item, '主体编码', '公司编码', 'companyCode', 'company');
    const companyName = cell(item, '主体名称', '公司名称', 'companyName');
    const channelCode = cell(item, '渠道编码', 'channelCode', 'channel');
    const channelName = cell(item, '渠道名称', 'channelName');
    const warehouseCodes = cell(
      item,
      '仓库编码(逗号分隔)',
      '仓库编码',
      '仓库名称(逗号分隔)',
      '仓库名称',
      'warehouseCodes',
      'warehouseCode',
    );
    const productCodeRaw = cell(item, '商品编码', 'code');
    const productNameRaw = cell(item, '商品名称', 'name');
    let quantity = cellNum(item, '数量', 'quantity', '要货数量', '销量');
    const remark = cell(item, '备注', 'remark');

    // 商品：编码或名称填一个即可（名称写在编码列也认）
    const product = productStore.resolveProduct(productCodeRaw, productNameRaw);
    const productCode = product?.code || String(productCodeRaw || '').trim();
    const productName = product?.name || String(productNameRaw || productCode || '').trim();
    if (!productCode && !productName) return;
    if (!product && !productCode) return; // 只有名称且未匹配到档案则跳过

    const baseMeta = {
      companyCode: companyCode || undefined,
      companyName: companyName || undefined,
      channelCode: channelCode || undefined,
      channelName: channelName || undefined,
      warehouseCodes: warehouseCodes || undefined,
    };

    if (product?.combineProductCode && product.combineRatio > 0) {
      quantity = quantity * product.combineRatio;
      converted.push({
        ...baseMeta,
        productCode: product.combineProductCode,
        productName: (productName || product.name) + ` (组合→${product.combineProductCode})`,
        quantity,
        remark: remark || '组合商品换算',
      });
    } else {
      converted.push({
        ...baseMeta,
        productCode: productCode || product?.code || '',
        productName: productName || product?.name || productCode,
        quantity,
        remark,
      });
    }
  });
  return converted;
};

/** 渠道：编码/名称列任一有值，按编码或名称匹配 */
const resolveChannelFromRow = (row: ImportRequisitionData, companyId?: string) =>
  channelStore.resolveChannel(row.channelCode, row.channelName, companyId);

const resolveCompanyIdFromRow = (row: ImportRequisitionData, channelId?: string) => {
  const c = companyStore.resolveCompany(row.companyCode, row.companyName);
  if (c) return c.id;
  if (channelId) {
    const ch = channelStore.getChannelById(channelId);
    if (ch?.companyId) return ch.companyId;
    if (ch?.companyIds?.length) return ch.companyIds[0];
  }
  return '';
};

const resolveWarehouseIdsFromRow = (row: ImportRequisitionData, channelId: string) => {
  const allowed = getChannelAllowedWarehouses(channelId);
  if (!row.warehouseCodes?.trim()) return allowed.map(w => w.id);
  const tokens = row.warehouseCodes.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const ids: string[] = [];
  const allowedSet = new Set(allowed.map(w => w.id));
  for (const token of tokens) {
    const w =
      warehouseStore.resolveWarehouse(token)
      || warehouseStore.warehouses.find(x => x.id === token);
    if (w && allowedSet.has(w.id) && !ids.includes(w.id)) ids.push(w.id);
  }
  return ids.length ? ids : allowed.map(w => w.id);
};

/** 按 Excel 行解析主体/渠道/仓库；不依赖顶部选择 */
const enrichImportRows = (rows: ImportRequisitionData[]): ImportRequisitionData[] =>
  rows.map(row => {
    const tip = [row.channelCode, row.channelName].filter(Boolean).join('/') || '（空）';
    if (!row.channelCode && !row.channelName) {
      return { ...row, resolveError: '缺少渠道编码/名称' };
    }
    let companyId = resolveCompanyIdFromRow(row);
    const ch = resolveChannelFromRow(row, companyId || undefined);
    if (!ch) {
      return { ...row, resolveError: `找不到渠道：${tip}` };
    }
    if (!companyId) companyId = resolveCompanyIdFromRow(row, ch.id);
    if (!companyId) {
      return {
        ...row,
        resolvedChannelId: ch.id,
        resolvedChannelLabel: `${ch.name}（P${ch.priority}）`,
        resolveError: '无法确定主体（请填主体编码/名称，或先在渠道上绑定主体）',
      };
    }
    const warehouseIds = resolveWarehouseIdsFromRow(row, ch.id);
    if (!warehouseIds.length) {
      return {
        ...row,
        resolvedCompanyId: companyId,
        resolvedChannelId: ch.id,
        resolvedCompanyLabel: (() => {
          const c = companyStore.getCompanyById(companyId);
          return c ? formatCompanyNameOnly(c) : companyId;
        })(),
        resolvedChannelLabel: `${ch.name}（P${ch.priority}）`,
        resolveError: `渠道「${ch.name}」未绑定仓库`,
      };
    }
    const scope = assertRequisitionScope({ companyId, channelId: ch.id, warehouseIds });
    if (!scope.ok) {
      return {
        ...row,
        resolvedCompanyId: companyId,
        resolvedChannelId: ch.id,
        resolvedWarehouseIds: warehouseIds,
        resolvedCompanyLabel: (() => {
          const c = companyStore.getCompanyById(companyId);
          return c ? formatCompanyNameOnly(c) : companyId;
        })(),
        resolvedChannelLabel: `${ch.name}（P${ch.priority}）`,
        resolveError: scope.message,
      };
    }
    const co = companyStore.getCompanyById(companyId);
    return {
      ...row,
      resolvedCompanyId: companyId,
      resolvedChannelId: ch.id,
      resolvedWarehouseIds: scope.warehouseIds,
      resolvedCompanyLabel: co ? formatCompanyNameOnly(co) : companyId,
      resolvedChannelLabel: `${ch.name}（P${ch.priority}）`,
      resolvedWarehouseLabel: scope.warehouseIds
        .map(id => warehouseStore.getWarehouseById(id)?.name || id)
        .join('、'),
      resolveError: undefined,
    };
  });

const importOkRows = computed(() => importData.value.filter(r => !r.resolveError));
const importBadRows = computed(() => importData.value.filter(r => !!r.resolveError));
const importChannelSummary = computed(() => {
  const m = new Map<string, number>();
  for (const r of importOkRows.value) {
    const key = r.resolvedChannelLabel || r.resolvedChannelId || '—';
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()].map(([label, n]) => `${label}×${n}`).join('；');
});

const previewOkRows = computed(() => previewData.value.filter(r => !r.resolveError));
const previewBadRows = computed(() => previewData.value.filter(r => !!r.resolveError));
const previewChannelSummary = computed(() => {
  const m = new Map<string, number>();
  for (const r of previewOkRows.value) {
    const key = r.resolvedChannelLabel || r.resolvedChannelId || '—';
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()].map(([label, n]) => `${label}×${n}`).join('；');
});

const handleImport = async (event: Event) => {
  const input = event.target as HTMLInputElement | null;
  try {
    const rows = await readExcelFromEvent(event);
    const parsed = parseExcelRows(rows);
    if (!parsed.length) {
      ElMessage.warning('未解析到有效要货行（商品编码或名称填一个即可，需能匹配商品档案）');
      return;
    }
    previewData.value = enrichImportRows(parsed);
    previewVisible.value = true;
  } finally {
    if (input) input.value = '';
  }
};

const confirmPreviewImport = () => {
  if (!previewData.value.length) {
    ElMessage.warning('预览无数据可导入');
    return;
  }
  importData.value = previewData.value;
  stockCheckResults.value = [];
  previewVisible.value = false;
  const bad = importBadRows.value.length;
  const ok = importOkRows.value.length;
  const channels = new Set(importOkRows.value.map(r => r.resolvedChannelId).filter(Boolean)).size;
  if (bad) {
    ElMessage.warning(`已确认导入 ${ok + bad} 行：成功匹配 ${ok} 行（${channels} 个渠道），${bad} 行待修正`);
  } else {
    ElMessage.success(`已确认导入 ${ok} 行，将按 ${channels} 个渠道分别开单`);
  }
};

const cancelPreviewImport = () => {
  previewVisible.value = false;
  previewData.value = [];
  ElMessage.info('已取消本次导入');
};

const downloadDemandTemplate = () => {
  downloadTemplate(
    [
      '主体编码',
      '主体名称',
      '渠道编码',
      '渠道名称',
      '仓库编码(逗号分隔)',
      '商品编码',
      '商品名称',
      '数量',
      '备注',
    ],
    '要货导入模板',
  );
};

const exportList = () => {
  let rows = requisitionStore.exportDemandFlat(filterWeek.value || undefined);
  if (filterCompanyIds.value.length) {
    const set = new Set(filterCompanyIds.value);
    rows = rows.filter(r => set.has(r['主体ID']));
  }
  const mapped = rows.map(r => ({
    单号: r['单号'],
    要货周期: r['要货周期'] || weekLabel(r['周起始']),
    周起始: r['周起始'],
    周结束: r['周结束'] || weekEnd(r['周起始']),
    主体: getCompanyName(r['主体ID']),
    渠道: getChannelName(r['渠道ID']),
    状态: r['状态'],
    商品编码: r['商品编码'],
    商品名称: r['商品名称'],
    要货数量: r['要货数量'],
    备注: r['备注'],
  }));
  if (!mapped.length) {
    ElMessage.warning('当前筛选下无要货数据可导出');
    return;
  }
  exportRows(mapped, `要货明细_${filterWeek.value || '全部'}`);
  ElMessage.success(`已导出 ${mapped.length} 行`);
};

const checkStock = () => {
  const results: typeof stockCheckResults.value = [];
  for (const item of importData.value) {
    const channelLabel = item.resolvedChannelLabel || item.channelCode || item.channelName || '—';
    if (item.resolveError) {
      results.push({
        productCode: item.productCode,
        productName: item.productName,
        channelLabel,
        demandQuantity: item.quantity,
        availableStock: 0,
        packStock: 0,
        higherPriorityDemand: 0,
        status: 'short',
        message: item.resolveError,
      });
      continue;
    }
    const companyId = item.resolvedCompanyId!;
    const channelId = item.resolvedChannelId!;
    const warehouseIds = item.resolvedWarehouseIds || [];
    const product = productStore.getProductByCode(item.productCode);
    if (!product) {
      results.push({
        productCode: item.productCode,
        productName: item.productName,
        channelLabel,
        demandQuantity: item.quantity,
        availableStock: 0,
        packStock: 0,
        higherPriorityDemand: 0,
        status: 'short',
        message: '商品不存在',
      });
      continue;
    }

    const eq = getBottleEquivalentStock(item.productCode, warehouseIds);
    const availableStock = eq.availableStock;
    const packStock = eq.packStock + eq.packInTransit;
    const higherPriorityDemand = requisitionStore.getHigherPriorityPendingDemand(
      eq.baseCode,
      channelId,
      warehouseIds,
      companyId,
    );
    const baseProduct = productStore.getProductByCode(eq.baseCode) || product;
    const checked = requisitionStore.checkStockAvailability(
      eq.baseCode,
      item.quantity,
      baseProduct.warningThreshold,
      availableStock,
      higherPriorityDemand,
    );
    const packHint = packStock > 0 ? `；含箱规折算 ${formatProductQty(packStock, eq.baseCode)}` : '';
    results.push({
      productCode: eq.baseCode,
      productName: item.productName,
      channelLabel,
      demandQuantity: item.quantity,
      availableStock,
      packStock,
      higherPriorityDemand,
      status: checked.status,
      message: checked.message + packHint,
    });
  }
  return results;
};

const runStockCheck = () => {
  if (!importData.value.length) {
    ElMessage.warning('请先导入或填写要货数据后再进行库存校验');
    return;
  }
  stockCheckResults.value = checkStock();
  const { short, low, ok, total } = stockCheckSummary.value;
  if (!total) {
    ElMessage.warning('没有可校验的明细行');
    return;
  }
  if (short > 0) {
    ElMessage.warning(`验库存完成：共 ${total} 行 · 缺货 ${short} · 偏低 ${low} · 充足 ${ok}（仅供参考，不拦提交）`);
  } else if (low > 0) {
    ElMessage.warning(`验库存完成：共 ${total} 行 · 偏低 ${low} · 充足 ${ok}（仅供参考，不拦提交）`);
  } else {
    ElMessage.success(`验库存完成：共 ${total} 行全部充足（仅供参考，不拦提交）`);
  }
};

/** 同一主体+渠道+仓库集合 → 一张要货单 */
const groupImportRowsForSubmit = (rows: ImportRequisitionData[]) => {
  const groups = new Map<
    string,
    {
      companyId: string;
      channelId: string;
      warehouseIds: string[];
      items: ImportRequisitionData[];
      label: string;
    }
  >();
  for (const row of rows) {
    const companyId = row.resolvedCompanyId!;
    const channelId = row.resolvedChannelId!;
    const warehouseIds = [...(row.resolvedWarehouseIds || [])].sort();
    const key = `${companyId}|${channelId}|${warehouseIds.join(',')}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        companyId,
        channelId,
        warehouseIds,
        items: [],
        label: `${row.resolvedCompanyLabel || companyId} / ${row.resolvedChannelLabel || channelId}`,
      };
      groups.set(key, g);
    }
    g.items.push(row);
  }
  return [...groups.values()];
};

/** 导入行里尚未建档的商品编码（去重） */
const missingProductEntries = (rows: ImportRequisitionData[]) => {
  const map = new Map<string, string>();
  for (const row of rows) {
    const code = String(row.productCode || '').trim();
    if (!code) continue;
    if (productStore.getProductByCode(code)) continue;
    if (!map.has(code)) map.set(code, row.productName || code);
  }
  return [...map.entries()].map(([code, name]) => ({ code, name }));
};

const quickAddMissingProducts = (entries: { code: string; name: string }[]) => {
  for (const { code, name } of entries) {
    productStore.upsertByCode({
      code,
      name: name || code,
      spec: '',
      bottleUnit: '瓶',
      boxUnit: '箱',
      bottlesPerBox: 24,
      stock: 0,
      warningThreshold: 0,
      isCombined: false,
      combineProductCode: '',
      combineRatio: 0,
    });
  }
};

const goProductManage = () => {
  importDialogVisible.value = false;
  router.push('/products');
};

const handleSubmit = async () => {
  if (!form.value.weekStart) return ElMessage.error('请选择要货周期');
  if (!importData.value.length) return ElMessage.error('请导入要货数据');
  if (importBadRows.value.length) {
    return ElMessage.error(
      `还有 ${importBadRows.value.length} 行未能匹配主体/渠道/仓库，请修正 Excel 后重新导入`,
    );
  }
  const groups = groupImportRowsForSubmit(importOkRows.value);
  if (!groups.length) return ElMessage.error('没有可提交的要货行');

  // 提前选未来周 = 提报下周计划：二次确认
  if (isFutureWeek(form.value.weekStart)) {
    try {
      await ElMessageBox.confirm(
        `当前要货周期「${weekLabel(form.value.weekStart)}」尚未到提报日期（起始日晚于今天）。\n今天起默认周期为「${weekLabel(currentWeekStart())}」。\n\n确认要提前提报该周期计划吗？`,
        '未到提报日期',
        {
          type: 'warning',
          confirmButtonText: '确认提报',
          cancelButtonText: '取消',
        },
      );
    } catch {
      return;
    }
  }

  // 仅校验商品档案：库存不足不拦截提交（验库存按钮仍可手工查看）
  const missing = missingProductEntries(importOkRows.value);
  if (missing.length) {
    const list = missing.map(m => `${m.code}　${m.name}`).join('\n');
    try {
      await ElMessageBox.confirm(
        `以下商品编码在「商品管理」中不存在：\n\n${list}\n\n可快速用导入的编码/名称建档后继续提交，或先去商品管理新增。`,
        '无此商品编码',
        {
          type: 'warning',
          confirmButtonText: '快速新增并提交',
          cancelButtonText: '去商品管理',
          distinguishCancelAndClose: true,
          dangerouslyUseHTMLString: false,
        },
      );
      quickAddMissingProducts(missing);
      ElMessage.success(`已新增 ${missing.length} 个商品档案`);
    } catch (action) {
      if (action === 'cancel') {
        goProductManage();
      }
      return;
    }
  }

  let created = 0;
  try {
    for (const g of groups) {
      requisitionStore.addRequisition(
        g.companyId,
        g.channelId,
        g.warehouseIds,
        g.items,
        form.value.weekStart,
      );
      created += 1;
    }
  } catch (e: any) {
    return ElMessage.error(e?.message || '提交失败：主体/仓库不匹配');
  }
  importDialogVisible.value = false;
  ElMessage.success(`已提交 ${created} 张要货单（共 ${importOkRows.value.length} 行明细）`);
};

const handleApprove = (id: string) => {
  requisitionStore.approveRequisition(id);
  ElMessage.success('已通过');
};

const handleReject = (id: string) => {
  requisitionStore.rejectRequisition(id);
  ElMessage.success('已拒绝');
};

const handleDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm('确认删除该要货单？', '提示', { type: 'warning' });
    requisitionStore.deleteRequisition(id);
    ElMessage.success('已删除');
  } catch { /* cancel */ }
};

const openDetail = (row: Requisition) => {
  detailRow.value = row;
  detailVisible.value = true;
};

const goSalesCompare = (row: Requisition) => {
  router.push({
    path: '/sales-compare',
    query: {
      week: row.weekStart,
      companyId: row.companyId || undefined,
      requisitionId: row.id,
    },
  });
};

const getChannelName = (id: string) => channelStore.getChannelById(id)?.name || id;
const getCompanyName = (id: string) => {
  const c = companyStore.getCompanyById(id);
  return c ? formatCompanyNameOnly(c) : id;
};
const getWarehouseNames = (ids: string[]) =>
  ids.map(id => warehouseStore.getWarehouseById(id)?.name || id).join('、');

const getStatusTag = (status: string) => {
  const tags: Record<string, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
    pending: { label: '待审批', type: 'warning' },
    approved: { label: '已通过', type: 'success' },
    rejected: { label: '已拒绝', type: 'danger' },
  };
  return tags[status] || { label: status, type: 'info' };
};

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString('zh-CN');

const goShortageAlert = () => {
  router.push({
    path: '/shortage-alert',
    query: {
      week: filterWeek.value,
      companyId: filterCompanyIds.value.length === 1 ? filterCompanyIds.value[0] : undefined,
      companyIds: filterCompanyIds.value.length > 1 ? filterCompanyIds.value.join(',') : undefined,
    },
  });
};

const triggerFile = (refEl: HTMLInputElement | null) => refEl?.click();
const demandFileRef = ref<HTMLInputElement | null>(null);
</script>

<template>
  <PageShell
    title="渠道要货"
    help="按主体分渠道/仓库 · 同主体内优先级占库存 · 审批后可录入本周实际销货做虚报核对\n库存口径：要货按瓶规；箱规编码库存会按「组合比例」折算进瓶规（验库存仅供参考，不拦提交）\n推荐流程：1.库存导入 → 2.渠道要货（Excel 按行分渠道开单）→ 3.审批通过 → 4.录入本周实际销货"
  >
    <template #toolbar>
      <ElDatePicker
        v-model="filterPeriodRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="起始日"
        end-placeholder="结束日"
        size="small"
        style="width: 260px"
        :clearable="false"
        :editable="false"
        @change="(v: [string, string] | null) => { if (v?.[0]) setPeriodStart('filter', v[0]) }"
      />
      <MultiCheckFilter
        v-model="filterCompanyIds"
        :options="companyFilterOptions"
        placeholder="主体(可多选)"
        width="200px"
      />
      <ElButton type="primary" size="small" @click="openDialog">新建要货</ElButton>
      <ElButton type="warning" size="small" class="btn-template" @click="downloadDemandTemplate">
        ⬇ 下载要货模板
      </ElButton>
      <ElButton size="small" @click="goShortageAlert">缺货与预警</ElButton>
      <ElButton size="small" @click="exportList">导出明细</ElButton>
      <span class="week-label">
        要货周期：{{ weekLabel(filterWeek) }}
        <template v-if="isFutureWeek(filterWeek)">（提前）</template>
        · 自选起始日，共 7 天
      </span>
    </template>

    <div class="table-wrap">
      <ElTable :data="listRows" border size="small" stripe class="erp-data-table" height="100%">
        <template #empty>
          <div class="list-empty">
            <ElEmpty :image-size="88">
              <template #description>
                <p class="list-empty__title">当前周期暂无要货单</p>
                <p class="list-empty__desc">
                  可点击上方「新建要货」，或先「下载要货模板」按规范填写后导入 Excel 快速开始
                </p>
              </template>
              <div class="list-empty__actions">
                <ElButton type="primary" size="small" @click="openDialog">新建要货</ElButton>
                <ElButton type="warning" size="small" plain @click="downloadDemandTemplate">下载要货模板</ElButton>
              </div>
            </ElEmpty>
          </div>
        </template>
        <ElTableColumn type="index" label="序号" width="55" fixed="left" />
        <ElTableColumn prop="id" label="单号" width="140" sortable show-overflow-tooltip />
        <ElTableColumn prop="weekStart" label="要货周期" width="160" sortable>
          <template #default="{ row }">{{ weekLabel(row.weekStart) }}</template>
        </ElTableColumn>
        <ElTableColumn
          label="主体"
          width="110"
          show-overflow-tooltip
          sortable
          :sort-method="(a: Requisition, b: Requisition) => getCompanyName(a.companyId).localeCompare(getCompanyName(b.companyId), 'zh-CN')"
        >
          <template #default="{ row }">{{ getCompanyName(row.companyId) }}</template>
        </ElTableColumn>
        <ElTableColumn
          label="渠道"
          width="100"
          sortable
          :sort-method="(a: Requisition, b: Requisition) => getChannelName(a.channelId).localeCompare(getChannelName(b.channelId), 'zh-CN')"
        >
          <template #default="{ row }">
            {{ getChannelName(row.channelId) }}
            <ElTag size="small" type="info" style="margin-left: 4px">
              P{{ channelStore.getChannelById(row.channelId)?.priority ?? '-' }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="仓库" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ getWarehouseNames(row.warehouseIds) }}</template>
        </ElTableColumn>
        <ElTableColumn
          label="SKU数"
          width="70"
          align="center"
          sortable
          :sort-method="(a: Requisition, b: Requisition) => a.items.length - b.items.length"
        >
          <template #default="{ row }">{{ row.items.length }}</template>
        </ElTableColumn>
        <ElTableColumn prop="status" label="状态" width="90" sortable>
          <template #default="{ row }">
            <ElTag size="small" :type="getStatusTag(row.status).type">
              {{ getStatusTag(row.status).label }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="销货" width="90">
          <template #default="{ row }">
            <ElTag v-if="row.salesItems?.length" size="small" type="success">已录入</ElTag>
            <ElTag v-else size="small" type="info">未录</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="createdAt" label="创建时间" width="150" sortable>
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="openDetail(row as Requisition)">明细</ElButton>
            <ElButton
              v-if="row.status === 'pending'"
              link
              type="success"
              size="small"
              @click="handleApprove(row.id)"
            >通过</ElButton>
            <ElButton
              v-if="row.status === 'pending'"
              link
              type="danger"
              size="small"
              @click="handleReject(row.id)"
            >拒绝</ElButton>
            <ElButton
              v-if="row.status === 'approved'"
              link
              type="warning"
              size="small"
              @click="goSalesCompare(row as Requisition)"
            >录销货</ElButton>
            <ElButton link type="info" size="small" @click="handleDelete(row.id)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <!-- 新建要货 -->
    <ElDialog
      v-model="importDialogVisible"
      title="新建要货单"
      width="960px"
      destroy-on-close
      class="req-dialog"
      align-center
    >
      <ElForm :model="form" label-width="88px" size="small" class="req-form">
        <div class="form-grid">
          <ElFormItem label="要货周期" required class="form-cell form-cell--full">
            <div class="period-row">
              <ElDatePicker
                v-model="form.weekStart"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="起始日"
                class="req-control period-start"
                :clearable="false"
                :editable="false"
                @change="onFormStartChange"
              />
              <span class="period-sep">至</span>
              <div
                class="period-end"
                title="结束日由起始日自动加 6 天生成，不可单独修改"
              >
                <span class="period-end__date">{{ formWeekEndText }}</span>
                <span class="period-end__tag">自动 +6 天</span>
              </div>
              <HelpTip
                inline
                title="要货周期说明"
                content="只需选择起始日；结束日自动为起始日后第 6 天（共 7 天）。\n例：选 7月30日 → 7月30日 — 8月5日。\n无需选手动主体/渠道：导入 Excel 后按每行渠道自动开单（多渠道会拆成多张要货单）。"
              />
              <span
                v-if="formWeekHint"
                class="week-pick__label"
                :class="{ 'is-future': isFutureWeek(form.weekStart) }"
              >
                {{ formWeekHint }}
              </span>
            </div>
          </ElFormItem>
        </div>
      </ElForm>

      <div class="import-block">
        <div class="import-block__head">
          <span class="import-block__title">
            要货明细
            <HelpTip
              inline
              title="导入说明"
              content="请先下载模板，按规范填写渠道及 SKU 数量后上传。\n编码或名称填一个即可；导入后会弹出数据预览供核对。\n验库存仅供参考，不拦截提交。"
            />
          </span>
          <div class="import-block__actions">
            <input ref="demandFileRef" type="file" accept=".xlsx,.xls" class="hidden-file" @change="handleImport" />
            <ElButton type="warning" size="small" class="btn-template" @click="downloadDemandTemplate">
              ⬇ 下载要货模板
            </ElButton>
            <ElButton type="primary" size="small" @click="triggerFile(demandFileRef)">导入 Excel</ElButton>
            <ElButton size="small" :disabled="!importData.length" @click="runStockCheck">验库存</ElButton>
          </div>
        </div>

        <template v-if="importData.length">
          <div class="import-meta">
            已确认导入 {{ importOkRows.length }} 行
            <template v-if="importChannelSummary">（{{ importChannelSummary }}）</template>
            <template v-if="importBadRows.length">；{{ importBadRows.length }} 行匹配失败，提交前需修正</template>
            <ElButton
              v-if="importBadRows.length"
              link
              type="primary"
              size="small"
              @click="goChannelManage"
            >去渠道管理</ElButton>
          </div>
          <ElTable :data="importData" border size="small" max-height="280">
            <ElTableColumn type="index" label="序号" width="55" />
            <ElTableColumn label="主体" min-width="110" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.resolvedCompanyLabel || row.companyCode || row.companyName || '—' }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="渠道" min-width="130" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.resolvedChannelLabel || row.channelCode || row.channelName || '—' }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="仓库" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.resolvedWarehouseLabel || row.warehouseCodes || '（渠道全部绑定仓）' }}
              </template>
            </ElTableColumn>
            <ElTableColumn prop="productCode" label="商品编码" width="110" sortable />
            <ElTableColumn prop="productName" label="商品名称" min-width="140" sortable />
            <ElTableColumn prop="quantity" label="数量" width="110" sortable show-overflow-tooltip>
              <template #default="{ row }">
                {{ formatProductQty(row.quantity, row.productCode) }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="匹配" width="110">
              <template #default="{ row }">
                <ElTag v-if="row.resolveError" size="small" type="danger">失败</ElTag>
                <ElTag
                  v-else-if="row.productCode && !productStore.getProductByCode(row.productCode)"
                  size="small"
                  type="warning"
                >无商品</ElTag>
                <ElTag v-else size="small" type="success">OK</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn label="说明" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                {{
                  row.resolveError
                    || (row.productCode && !productStore.getProductByCode(row.productCode)
                      ? '无此商品编码，提交时可快速新增或去商品管理'
                      : (row.remark || ''))
                }}
              </template>
            </ElTableColumn>
          </ElTable>
        </template>

        <div
          v-else
          class="import-drop"
          role="button"
          tabindex="0"
          @click="triggerFile(demandFileRef)"
          @keydown.enter.prevent="triggerFile(demandFileRef)"
        >
          <p class="import-drop__text">点击此处或上方「导入 Excel」上传文件</p>
          <p class="import-drop__sub">请先下载模板，按规范填写渠道及 SKU 后上传</p>
        </div>
      </div>

      <div v-if="stockCheckResults.length" class="import-block">
        <div class="import-block__head">
          <span>库存检查</span>
          <span class="stock-summary">
            缺货 <b class="is-short">{{ stockCheckSummary.short }}</b>
            · 偏低 <b class="is-low">{{ stockCheckSummary.low }}</b>
            · 充足 <b class="is-ok">{{ stockCheckSummary.ok }}</b>
          </span>
        </div>
        <ElTable :data="stockCheckResults" border size="small" max-height="200">
          <ElTableColumn type="index" label="序号" width="55" />
          <ElTableColumn prop="channelLabel" label="渠道" min-width="120" show-overflow-tooltip />
          <ElTableColumn prop="productCode" label="瓶规编码" width="100" sortable />
          <ElTableColumn prop="productName" label="名称" min-width="120" sortable />
          <ElTableColumn prop="demandQuantity" label="需求" width="110" sortable show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatProductQty(row.demandQuantity, row.productCode) }}
            </template>
          </ElTableColumn>
          <ElTableColumn prop="availableStock" label="可用(含箱规)" width="120" sortable show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatProductQty(row.availableStock, row.productCode) }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="其中箱规折算" width="120" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.packStock > 0 ? formatProductQty(row.packStock, row.productCode) : '-' }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="高优占用" width="110" show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatProductQty(row.higherPriorityDemand, row.productCode) }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="90">
            <template #default="{ row }">
              <ElTag size="small" :type="row.status === 'short' ? 'danger' : row.status === 'low' ? 'warning' : 'success'">
                {{ row.status === 'short' ? '缺货' : row.status === 'low' ? '偏低' : '充足' }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn prop="message" label="说明" min-width="180" show-overflow-tooltip />
        </ElTable>
      </div>

      <template #footer>
        <ElButton size="small" @click="importDialogVisible = false">取消</ElButton>
        <ElButton size="small" type="primary" :disabled="!importOkRows.length" @click="handleSubmit">提交</ElButton>
      </template>
    </ElDialog>

    <!-- 导入数据预览：确认后再写入明细 -->
    <ElDialog
      v-model="previewVisible"
      title="导入数据预览"
      width="920px"
      align-center
      append-to-body
      :close-on-click-modal="false"
      class="preview-dialog"
      @closed="previewData = []"
    >
      <p class="preview-lead">
        请核对系统解析出的<strong>渠道</strong>与<strong>要货明细</strong>，确认无误后再写入新建单。
      </p>
      <div class="preview-meta">
        共 {{ previewData.length }} 行
        · 可提交 {{ previewOkRows.length }}
        <template v-if="previewBadRows.length"> · 待修正 {{ previewBadRows.length }}</template>
        <template v-if="previewChannelSummary"> · 渠道：{{ previewChannelSummary }}</template>
      </div>
      <ElTable :data="previewData" border size="small" max-height="420">
        <ElTableColumn type="index" label="序号" width="55" />
        <ElTableColumn label="主体" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.resolvedCompanyLabel || row.companyCode || row.companyName || '—' }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="渠道" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.resolvedChannelLabel || row.channelCode || row.channelName || '—' }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="仓库" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.resolvedWarehouseLabel || row.warehouseCodes || '（渠道全部绑定仓）' }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="productCode" label="商品编码" width="110" />
        <ElTableColumn prop="productName" label="商品名称" min-width="140" show-overflow-tooltip />
        <ElTableColumn prop="quantity" label="数量" width="100" show-overflow-tooltip>
          <template #default="{ row }">
            {{ formatProductQty(row.quantity, row.productCode) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="匹配" width="100">
          <template #default="{ row }">
            <ElTag v-if="row.resolveError" size="small" type="danger">失败</ElTag>
            <ElTag
              v-else-if="row.productCode && !productStore.getProductByCode(row.productCode)"
              size="small"
              type="warning"
            >无商品</ElTag>
            <ElTag v-else size="small" type="success">OK</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="说明" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.resolveError || row.remark || '' }}
          </template>
        </ElTableColumn>
      </ElTable>
      <template #footer>
        <ElButton size="small" @click="cancelPreviewImport">取消</ElButton>
        <ElButton
          size="small"
          type="primary"
          :disabled="!previewData.length"
          @click="confirmPreviewImport"
        >
          确认导入明细
        </ElButton>
      </template>
    </ElDialog>

    <!-- 明细 -->
    <ElDialog v-model="detailVisible" title="要货明细" width="720px" destroy-on-close>
      <template v-if="detailRow">
        <p class="detail-meta" style="margin-bottom: 8px">
          {{ getCompanyName(detailRow.companyId) }} · {{ getChannelName(detailRow.channelId) }} ·
          {{ weekLabel(detailRow.weekStart) }} · {{ getWarehouseNames(detailRow.warehouseIds) }}
        </p>
        <ElTable :data="detailRow.items" border size="small" max-height="400">
          <ElTableColumn type="index" label="序号" width="55" />
          <ElTableColumn prop="productCode" label="编码" width="120" sortable />
          <ElTableColumn prop="productName" label="名称" min-width="160" sortable />
          <ElTableColumn prop="quantity" label="要货数量" width="120" sortable show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatProductQty(row.quantity, row.productCode) }}
            </template>
          </ElTableColumn>
          <ElTableColumn prop="remark" label="备注" min-width="120" />
        </ElTable>
      </template>
    </ElDialog>
  </PageShell>
</template>

<style scoped>
.table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 0 0;
  overflow: hidden;
}

.week-label {
  font-size: 13px;
  color: var(--erp-text-muted);
}

.week-pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.week-pick__label {
  font-size: 13px;
  color: var(--erp-text-muted);
  white-space: nowrap;
}

.week-pick__label.is-future {
  color: #b45309;
}

.period-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.period-start {
  width: 160px !important;
  flex-shrink: 0;
}

.period-sep {
  font-size: 13px;
  color: var(--erp-text-muted);
  flex-shrink: 0;
}

.period-end {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--erp-border, #e5e7eb);
  background: #f3f4f6;
  color: #6b7280;
  cursor: default;
  user-select: none;
  flex-shrink: 0;
}

.period-end__date {
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
}

.period-end__tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #e5e7eb;
  color: #6b7280;
}

.period-hint {
  display: none;
}

.import-block__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.import-meta {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--erp-text-muted);
  line-height: 1.5;
}

.import-drop {
  padding: 36px 16px;
  text-align: center;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
  background: #fafbfc;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.import-drop:hover {
  border-color: #f59e0b;
  background: #fffbeb;
}

.import-drop__text {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--erp-text, #303133);
}

.import-drop__sub {
  margin: 0;
  font-size: 12px;
  color: var(--erp-text-muted, #909399);
}

.import-drop__actions {
  display: none;
}

.detail-meta {
  font-size: 13px;
  color: var(--erp-text-muted);
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 16px;
  row-gap: 0;
  align-items: start;
  width: 100%;
  box-sizing: border-box;
}

.form-cell {
  margin-bottom: 14px;
  min-width: 0;
  max-width: 100%;
}

.form-cell--full {
  grid-column: 1 / -1;
}

.req-form {
  width: 100%;
  box-sizing: border-box;
}

.req-form :deep(.el-form-item) {
  align-items: flex-start;
  margin-right: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.req-form :deep(.el-form-item__label) {
  height: 32px;
  line-height: 32px;
  padding-right: 8px;
  box-sizing: border-box;
}

.req-form :deep(.el-form-item__content) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  line-height: normal;
  min-width: 0;
  max-width: 100%;
  flex: 1;
  overflow: visible;
  box-sizing: border-box;
}

.form-empty-hint {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  color: #b45309;
  line-height: 1.5;
}

/* 统一输入控件：保证边框完整、宽度不溢出裁切 */
.req-form :deep(.req-control) {
  width: 100% !important;
  max-width: 100%;
  box-sizing: border-box;
}

.req-form :deep(.req-control .el-select__wrapper),
.req-form :deep(.req-control .el-input__wrapper),
.req-form :deep(.req-control.el-date-editor) {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.req-form :deep(.req-control--range.el-date-editor) {
  width: min(340px, 100%) !important;
  max-width: 100%;
}

.req-form :deep(.wh-box) {
  line-height: 1.4;
  width: 100%;
  box-sizing: border-box;
}

.import-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--erp-border);
}

.import-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}

.import-block__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.import-drop {
  padding: 36px 16px;
  text-align: center;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
  background: #fafbfc;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.import-drop:hover {
  border-color: #f59e0b;
  background: #fffbeb;
}

.import-drop__text {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--erp-text, #303133);
}

.import-drop__sub {
  margin: 0;
  font-size: 12px;
  color: var(--erp-text-muted, #909399);
}

.btn-template {
  font-weight: 700 !important;
  letter-spacing: 0.02em;
}

.list-empty {
  padding: 36px 16px 48px;
}

.list-empty__title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--erp-text, #303133);
}

.list-empty__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--erp-text-muted, #909399);
}

.list-empty__actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}

.import-empty {
  padding: 12px 8px 20px;
  background: #fafbfc;
  border-radius: 8px;
}

.stock-summary {
  font-size: 12px;
  font-weight: 500;
  color: var(--erp-text-muted);
}

.stock-summary .is-short {
  color: #dc2626;
}

.stock-summary .is-low {
  color: #d97706;
}

.stock-summary .is-ok {
  color: #16a34a;
}

.preview-lead {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--erp-text, #303133);
  line-height: 1.5;
}

.preview-meta {
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--erp-text-muted);
}

.hidden-file {
  display: none;
}

.empty-tip {
  padding: 28px;
  text-align: center;
  color: var(--erp-text-muted);
  font-size: 13px;
  background: #fafbfc;
  border-radius: 8px;
}

.danger {
  color: #f56c6c;
  font-weight: 600;
}

.wh-box {
  width: 100%;
  border: 1px solid var(--erp-border);
  border-radius: 6px;
  padding: 8px 10px;
  background: #fafbfc;
}
.wh-box--locked {
  opacity: 0.72;
}
.wh-box__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.wh-box__hint {
  flex: 1;
  font-size: 12px;
  color: var(--erp-text-muted);
  line-height: 1.45;
}
.wh-box__hint strong {
  margin: 0 2px;
  color: var(--erp-text);
  font-weight: 600;
}
.wh-box__hint-ok {
  color: var(--erp-primary) !important;
}
.wh-box__hint-warn {
  color: #b88230 !important;
}
.wh-box__bar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.wh-box__meta {
  margin-top: 6px;
  font-size: 11px;
  color: var(--erp-text-muted);
}
.wh-box__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}
.wh-box__item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  margin: 0;
  padding: 4px 6px;
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
.wh-box__check.muted {
  background: #ebeef5;
  border-color: #dcdfe6;
}
.wh-box__text {
  line-height: 1.3;
  flex-shrink: 0;
}
.wh-box__tag {
  margin-left: auto;
  flex-shrink: 1;
  max-width: 55%;
}
.wh-box__empty {
  padding: 10px 0;
  font-size: 12px;
  color: var(--erp-text-muted);
}
</style>

<!-- dialog 挂到 body，需非 scoped 才能作用到外层，避免右侧边框被裁切 -->
<style>
.req-dialog.el-dialog {
  overflow: visible;
}
.req-dialog .el-dialog__body {
  overflow: visible;
  padding-right: 20px;
  padding-left: 20px;
  box-sizing: border-box;
}
.req-dialog .el-dialog__header {
  padding-right: 20px;
  padding-left: 20px;
}
.req-dialog .req-form .el-select__wrapper,
.req-dialog .req-form .el-input__wrapper {
  box-sizing: border-box;
  min-height: 32px;
}
</style>
