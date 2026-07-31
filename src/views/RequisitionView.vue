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
  ElSelect,
  ElOption,
  ElMessage,
  ElTag,
  ElMessageBox,
  ElDatePicker,
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
import { weekStartSaturday, weekLabel } from '../utils/week';
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

const filterWeek = ref(weekStartSaturday());
const filterCompanyIds = useRememberedCompanyFilter('requisitions');

const form = ref({
  companyId: '',
  channelId: '',
  warehouseIds: [] as string[],
  weekStart: weekStartSaturday(),
});

const importDialogVisible = ref(false);
const importData = ref<ImportRequisitionData[]>([]);
const stockCheckResults = ref<{
  productCode: string;
  productName: string;
  demandQuantity: number;
  availableStock: number;
  packStock: number;
  higherPriorityDemand: number;
  status: 'ok' | 'low' | 'short';
  message: string;
}[]>([]);

const detailVisible = ref(false);
const detailRow = ref<Requisition | null>(null);

const filteredChannels = computed(() => {
  if (!form.value.companyId) return [];
  return channelStore.getChannelsSortedByPriority(form.value.companyId);
});

const noChannelHint = computed(() => {
  if (!form.value.companyId) return '请先选择主体';
  if (filteredChannels.value.length) return '';
  const all = channelStore.channels.filter(c => c.enabled !== false).length;
  if (!all) return '尚未维护渠道，请先到「渠道管理」新增或导入';
  return '该主体下没有关联渠道（渠道未绑此主体，或主体 id 未同步）。请到「渠道管理」编辑渠道勾选该主体，或重新导入渠道。';
});

const selectedChannel = computed(() =>
  form.value.channelId ? channelStore.getChannelById(form.value.channelId) : undefined,
);

/**
 * 渠道全部绑定仓均可选（支持多主体发货）。
 */
const filteredWarehouses = computed(() => {
  if (!form.value.channelId) return [];
  if (!selectedChannel.value) return [];
  return getChannelAllowedWarehouses(form.value.channelId);
});

type WhListRow = {
  id: string;
  name: string;
  code: string;
  companyId: string;
  companyName: string;
};

/** 展示用：全部绑定仓，并标注所属主体 */
const channelWarehouseRows = computed((): WhListRow[] => {
  return filteredWarehouses.value.map(w => {
    const c = companyStore.getCompanyById(w.companyId);
    return {
      id: w.id,
      name: w.name,
      code: w.code,
      companyId: w.companyId,
      companyName: c ? formatCompanyNameOnly(c) : w.companyId,
    };
  });
});

const multiCompanyBound = computed(() => {
  const ids = new Set(channelWarehouseRows.value.map(r => r.companyId));
  return ids.size > 1;
});

/** 渠道绑定仓总数（下拉文案） */
const channelBoundWhCount = (channelId: string) =>
  getChannelAllowedWarehouses(channelId).length;

const channelOptionLabel = (ch: { id: string; name: string; priority: number; warehouseIds?: string[] }) => {
  const total = channelBoundWhCount(ch.id);
  return `${ch.name}（P${ch.priority} · 绑定${total}仓）`;
};

const channelWarehouseHint = computed(() => {
  const ch = selectedChannel.value;
  if (!ch) return '请先选择渠道；选中后将自动勾选该渠道已绑定的全部仓库';
  const total = channelWarehouseRows.value.length;
  if (!total) {
    return `渠道「${ch.name}」尚未绑定仓库，请先到「渠道管理」勾选`;
  }
  if (multiCompanyBound.value) {
    return `已自动勾选渠道「${ch.name}」绑定的全部 ${total} 个仓库（含多主体仓，可按需取消）`;
  }
  return `已按渠道「${ch.name}」自动勾选绑定仓库（共 ${total} 个，可按需取消）`;
});

const selectAllBoundWarehouses = () => {
  form.value.warehouseIds = filteredWarehouses.value.map(w => w.id);
};

const selectedSelectableCount = computed(
  () => form.value.warehouseIds.filter(id => filteredWarehouses.value.some(w => w.id === id)).length,
);

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
  form.value = {
    companyId: filterCompanyIds.value.length === 1 ? filterCompanyIds.value[0] : '',
    channelId: '',
    warehouseIds: [],
    weekStart: filterWeek.value || weekStartSaturday(),
  };
  importData.value = [];
  stockCheckResults.value = [];
  importDialogVisible.value = true;
};

const handleCompanyChange = () => {
  form.value.channelId = '';
  form.value.warehouseIds = [];
};

const handleChannelChange = () => {
  // 自动勾选渠道已绑定的全部仓库（可含多主体仓，可按需取消）
  selectAllBoundWarehouses();
};

const clearWarehouses = () => {
  form.value.warehouseIds = [];
};

const toggleWarehouse = (id: string) => {
  if (!id) return;
  // 禁止勾选渠道外仓库
  if (!filteredWarehouses.value.some(w => w.id === id)) return;
  const cur = form.value.warehouseIds;
  form.value.warehouseIds = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
};

const isWarehouseChecked = (id: string) => form.value.warehouseIds.includes(id);

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
    const channelCode = cell(item, '渠道编码', 'channelCode', 'channel');
    const channelName = cell(item, '渠道名称', 'channelName');
    const warehouseCodes = cell(
      item,
      '仓库编码(逗号分隔)',
      '仓库编码',
      'warehouseCodes',
      'warehouseCode',
    );
    const productCode = cell(item, '商品编码', 'code');
    const productName = cell(item, '商品名称', 'name');
    let quantity = cellNum(item, '数量', 'quantity', '要货数量', '销量');
    const remark = cell(item, '备注', 'remark');
    if (!productCode) return;

    const baseMeta = {
      companyCode: companyCode || undefined,
      channelCode: channelCode || undefined,
      channelName: channelName || undefined,
      warehouseCodes: warehouseCodes || undefined,
    };

    const product = productStore.getProductByCode(productCode);
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
        productCode,
        productName: productName || product?.name || productCode,
        quantity,
        remark,
      });
    }
  });
  return converted;
};

/** 从导入行解析渠道：编码优先，其次名称（可限定主体） */
const resolveChannelFromRow = (row: ImportRequisitionData, companyId?: string) => {
  if (row.channelCode) {
    const byCode = channelStore.getChannelByCode(row.channelCode);
    if (byCode && byCode.enabled !== false) return byCode;
  }
  if (row.channelName) {
    const name = row.channelName.trim();
    if (companyId) {
      const hit = channelStore.getChannelByName(name, companyId);
      if (hit && hit.enabled !== false) return hit;
    }
    const any = channelStore.channels.find(c => c.enabled !== false && c.name === name);
    if (any) return any;
  }
  return undefined;
};

const resolveCompanyIdFromRow = (row: ImportRequisitionData, channelId?: string) => {
  if (row.companyCode) {
    const c = companyStore.getCompanyByCode(row.companyCode);
    if (c) return c.id;
  }
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
  const codes = row.warehouseCodes.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const ids: string[] = [];
  const allowedSet = new Set(allowed.map(w => w.id));
  for (const code of codes) {
    const w =
      warehouseStore.getWarehouseByCode(code)
      || warehouseStore.warehouses.find(x => x.name === code || x.id === code);
    if (w && allowedSet.has(w.id) && !ids.includes(w.id)) ids.push(w.id);
  }
  return ids.length ? ids : allowed.map(w => w.id);
};

/** 导入后：用 Excel 里的渠道自动带出主体/渠道/仓库 */
const applyImportHeaderFromRows = (rows: ImportRequisitionData[]) => {
  const withChannel = rows.find(r => r.channelCode || r.channelName);
  if (!withChannel) {
    ElMessage.warning('Excel 未识别到渠道编码/名称，请在上方手工选择渠道，或使用新模板');
    return;
  }
  let companyId = resolveCompanyIdFromRow(withChannel);
  const ch = resolveChannelFromRow(withChannel, companyId || undefined);
  if (!ch) {
    ElMessage.error(
      `找不到渠道：${withChannel.channelCode || withChannel.channelName || ''}，请检查编码/名称或先到渠道管理维护`,
    );
    return;
  }
  if (!companyId) companyId = resolveCompanyIdFromRow(withChannel, ch.id);
  if (!companyId) {
    ElMessage.error('无法确定主体，请在 Excel 填写主体编码，或先在渠道上绑定主体');
    return;
  }
  form.value.companyId = companyId;
  form.value.channelId = ch.id;
  form.value.warehouseIds = resolveWarehouseIdsFromRow(withChannel, ch.id);
  if (!form.value.warehouseIds.length) {
    ElMessage.warning(`渠道「${ch.name}」未绑定仓库，请到渠道管理勾选`);
  }
};

const handleImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  importData.value = parseExcelRows(rows);
  stockCheckResults.value = [];
  if (!importData.value.length) {
    ElMessage.warning('未解析到有效要货行（需要商品编码）');
    return;
  }
  applyImportHeaderFromRows(importData.value);
  ElMessage.success(`已导入 ${importData.value.length} 行要货`);
};

const downloadDemandTemplate = () => {
  downloadTemplate(
    [
      '主体编码',
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
    周起始: r['周起始'],
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
  if (!form.value.channelId || !form.value.warehouseIds.length) {
    ElMessage.error('请先选择渠道和仓库');
    return [];
  }

  const results: typeof stockCheckResults.value = [];
  importData.value.forEach(item => {
    const product = productStore.getProductByCode(item.productCode);
    if (!product) {
      results.push({
        productCode: item.productCode,
        productName: item.productName,
        demandQuantity: item.quantity,
        availableStock: 0,
        packStock: 0,
        higherPriorityDemand: 0,
        status: 'short',
        message: '商品不存在',
      });
      return;
    }

    // 瓶规可用 = 瓶规库存 + 箱规库存×换算比例（要货按瓶规口径）
    const eq = getBottleEquivalentStock(item.productCode, form.value.warehouseIds);
    const availableStock = eq.availableStock;
    const packStock = eq.packStock + eq.packInTransit;
    const higherPriorityDemand = requisitionStore.getHigherPriorityPendingDemand(
      eq.baseCode,
      form.value.channelId,
      form.value.warehouseIds,
      form.value.companyId,
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
      demandQuantity: item.quantity,
      availableStock,
      packStock,
      higherPriorityDemand,
      status: checked.status,
      message: checked.message + packHint,
    });
  });
  return results;
};

const runStockCheck = () => {
  if (!importData.value.length) {
    ElMessage.warning('请先导入要货数据');
    return;
  }
  stockCheckResults.value = checkStock();
};

const handleSubmit = async () => {
  if (!form.value.companyId) return ElMessage.error('请选择所属主体');
  if (!form.value.channelId) return ElMessage.error('请选择渠道');
  // 提交前剔除渠道外仓库，防止脏数据
  const allowed = new Set(filteredWarehouses.value.map(w => w.id));
  form.value.warehouseIds = form.value.warehouseIds.filter(id => allowed.has(id));
  if (!filteredWarehouses.value.length) {
    return ElMessage.error('该渠道未绑定仓库，请先到「渠道管理」勾选仓库');
  }
  if (!form.value.warehouseIds.length) return ElMessage.error('请从渠道已绑定仓库中选择');
  if (!form.value.weekStart) return ElMessage.error('请选择周起始');
  if (!importData.value.length) return ElMessage.error('请导入要货数据');

  const scope = assertRequisitionScope({
    companyId: form.value.companyId,
    channelId: form.value.channelId,
    warehouseIds: form.value.warehouseIds,
  });
  if (!scope.ok) return ElMessage.error(scope.message);
  form.value.warehouseIds = scope.warehouseIds;

  const results = checkStock();
  stockCheckResults.value = results;
  const shortItems = results.filter(r => r.status === 'short');
  const lowItems = results.filter(r => r.status === 'low');

  if (shortItems.length > 0) {
    await ElMessageBox.alert(
      shortItems.map(r => `${r.productName}: ${r.message}`).join('\n'),
      '库存检查失败（按所选仓库 + 同主体高优先级占用）',
      { type: 'error' },
    );
    return;
  }

  if (lowItems.length > 0) {
    try {
      await ElMessageBox.confirm(
        lowItems.map(r => `${r.productName}: ${r.message}`).join('\n'),
        '库存偏低，是否继续提交？',
        { confirmButtonText: '继续提交', cancelButtonText: '取消', type: 'warning' },
      );
    } catch {
      return;
    }
  }

  try {
    requisitionStore.addRequisition(
      form.value.companyId,
      form.value.channelId,
      form.value.warehouseIds,
      importData.value,
      form.value.weekStart,
    );
  } catch (e: any) {
    return ElMessage.error(e?.message || '提交失败：主体/仓库不匹配');
  }
  importDialogVisible.value = false;
  ElMessage.success('要货单已提交');
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
    help="按主体分渠道/仓库 · 同主体内优先级占库存 · 审批后可录入本周实际销货做虚报核对\n库存口径：要货按瓶规；箱规编码库存会按「组合比例」折算进瓶规后再验库存\n推荐流程：1.库存导入（全量替换）→ 2.渠道要货 + 验库存 → 3.审批通过 → 4.录入本周实际销货"
  >
    <template #toolbar>
      <ElDatePicker
        v-model="filterWeek"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="周起始(周六)"
        size="small"
        style="width: 150px"
        @change="(v: string) => { if (v) filterWeek = weekStartSaturday(v) }"
      />
      <MultiCheckFilter
        v-model="filterCompanyIds"
        :options="companyFilterOptions"
        placeholder="主体(可多选)"
        width="200px"
      />
      <ElButton type="primary" size="small" @click="openDialog">新建要货</ElButton>
      <ElButton size="small" @click="goShortageAlert">缺货与预警</ElButton>
      <ElButton size="small" @click="exportList">导出明细</ElButton>
      <ElButton size="small" @click="downloadDemandTemplate">要货模板</ElButton>
      <span class="week-label">当前周：{{ weekLabel(filterWeek) }}</span>
    </template>

    <div class="table-wrap">
      <ElTable :data="listRows" border size="small" stripe class="erp-data-table" height="100%">
        <ElTableColumn type="index" label="序号" width="55" fixed="left" />
        <ElTableColumn prop="id" label="单号" width="140" sortable show-overflow-tooltip />
        <ElTableColumn prop="weekStart" label="周次" width="110" sortable>
          <template #default="{ row }">{{ row.weekStart }}</template>
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
          <ElFormItem label="周起始" required class="form-cell">
            <ElDatePicker
              v-model="form.weekStart"
              type="date"
              value-format="YYYY-MM-DD"
              class="req-control"
              @change="(v: string) => { if (v) form.weekStart = weekStartSaturday(v) }"
            />
          </ElFormItem>
          <ElFormItem label="主体" required class="form-cell">
            <ElSelect
              v-model="form.companyId"
              placeholder="所属主体"
              filterable
              class="req-control"
              @change="handleCompanyChange"
            >
              <ElOption
                v-for="c in companyStore.companies"
                :key="c.id"
                :label="formatCompanyLabel(c)"
                :value="c.id"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="渠道" required class="form-cell form-cell--full">
            <ElSelect
              v-model="form.channelId"
              placeholder="请选择同公司渠道"
              filterable
              class="req-control"
              :disabled="!form.companyId"
              @change="handleChannelChange"
            >
              <ElOption
                v-for="ch in filteredChannels"
                :key="ch.id"
                :label="channelOptionLabel(ch)"
                :value="ch.id"
              />
            </ElSelect>
            <div v-if="form.companyId && !filteredChannels.length" class="form-empty-hint">
              {{ noChannelHint }}
              <ElButton link type="primary" size="small" @click="goChannelManage">去渠道管理</ElButton>
            </div>
          </ElFormItem>
          <ElFormItem label="仓库" required class="form-cell form-cell--full">
            <div class="wh-box" :class="{ 'wh-box--locked': !form.channelId }">
              <div class="wh-box__bar">
                <div class="wh-box__hint">{{ channelWarehouseHint }}</div>
                <div class="wh-box__bar-actions">
                  <ElButton
                    link
                    type="primary"
                    size="small"
                    :disabled="!filteredWarehouses.length"
                    @click="selectAllBoundWarehouses"
                  >
                    全选绑定仓
                  </ElButton>
                  <ElButton
                    link
                    size="small"
                    :disabled="!form.warehouseIds.length"
                    @click="clearWarehouses"
                  >
                    清空
                  </ElButton>
                </div>
              </div>
              <div v-if="channelWarehouseRows.length" class="wh-box__list">
                <div
                  v-for="(w, idx) in channelWarehouseRows"
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
                  <ElTag
                    v-if="multiCompanyBound"
                    size="small"
                    type="info"
                    effect="plain"
                    class="wh-box__tag"
                  >
                    {{ w.companyName }}
                  </ElTag>
                </div>
              </div>
              <div v-else class="wh-box__empty">
                <template v-if="!form.companyId || !form.channelId">
                  请先选择主体和渠道
                </template>
                <template v-else>
                  该渠道在「渠道管理」中未绑定仓库，无法在此勾选。
                  <ElButton link type="primary" size="small" @click="goChannelManage">去渠道管理绑定</ElButton>
                </template>
              </div>
              <div v-if="channelWarehouseRows.length" class="wh-box__meta">
                已选 {{ selectedSelectableCount }} / {{ channelWarehouseRows.length }}
              </div>
            </div>
          </ElFormItem>
        </div>
      </ElForm>

      <div class="import-block">
        <div class="import-block__head">
          <span>要货明细</span>
          <div>
            <input ref="demandFileRef" type="file" accept=".xlsx,.xls" class="hidden-file" @change="handleImport" />
            <ElButton size="small" @click="triggerFile(demandFileRef)">导入 Excel</ElButton>
            <HelpTip
              inline
              title="Excel 列说明"
              content="列：主体编码、渠道编码、渠道名称、仓库编码(逗号分隔)、商品编码、商品名称、数量、备注。渠道编码优先；无编码可用渠道名称。仓库列可空=自动勾选该渠道全部绑定仓。"
            />
            <ElButton size="small" @click="downloadDemandTemplate">下载模板</ElButton>
            <ElButton size="small" type="primary" :disabled="!importData.length" @click="runStockCheck">验库存</ElButton>
            <HelpTip
              inline
              title="验库存说明"
              content="验库存 = 所选仓库(瓶规库存+在途 + 箱规折算) − 同主体更高优先级、且仓库有交集的「待审批+已通过」要货。停用渠道不参与。箱规需在商品里勾选组合并填写基础瓶规编码与换算比例。"
            />
          </div>
        </div>
        <ElTable v-if="importData.length" :data="importData" border size="small" max-height="220">
          <ElTableColumn type="index" label="序号" width="55" />
          <ElTableColumn label="渠道" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.channelCode || row.channelName || '—' }}
            </template>
          </ElTableColumn>
          <ElTableColumn prop="productCode" label="商品编码" width="120" sortable />
          <ElTableColumn prop="productName" label="商品名称" min-width="160" sortable />
          <ElTableColumn prop="quantity" label="数量" width="120" sortable show-overflow-tooltip>
            <template #default="{ row }">
              {{ formatProductQty(row.quantity, row.productCode) }}
            </template>
          </ElTableColumn>
          <ElTableColumn prop="remark" label="备注" min-width="120" />
        </ElTable>
        <div v-else class="empty-tip">请导入要货 Excel</div>
      </div>

      <div v-if="stockCheckResults.length" class="import-block">
        <div class="import-block__head"><span>库存检查</span></div>
        <ElTable :data="stockCheckResults" border size="small" max-height="200">
          <ElTableColumn type="index" label="序号" width="55" />
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
        <ElButton size="small" type="primary" @click="handleSubmit">提交</ElButton>
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
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
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
