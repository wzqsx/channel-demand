<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
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
  ElInput,
  ElInputNumber,
  ElDatePicker,
  ElMessage,
  ElMessageBox,
  ElTag,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElLoading,
  ElPagination,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import MultiCheckFilter from '../components/MultiCheckFilter.vue';
import ColumnSettings from '../components/ColumnSettings.vue';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { useWarehouseStore } from '../stores/warehouse';
import { useProductStore } from '../stores/product';
import { useCompanyStore } from '../stores/company';
import { useRequisitionStore } from '../stores/requisition';
import { useChannelStore } from '../stores/channel';
import { bootstrapStores } from '../stores/bootstrap';
import type { WarehouseStock, CustomFieldConfig, FieldType, ImportWarehouseStockData } from '../types';
import { weekStartSaturday, weekLabel } from '../utils/week';
import { readExcelFromEvent, exportRows, downloadTemplate, cell, cellNum } from '../utils/excel';
import { formatProductQty } from '../utils/qtyDisplay';
import { useRememberedCompanyFilter } from '../composables/useRememberedCompanyFilter';
import { formatCompanyLabel } from '../utils/companyDisplay';
import { useTableColumnPrefs, type ColumnMeta } from '../composables/useTableColumnPrefs';
import { getBottleEquivalentStock, resolveToBottleBase } from '../utils/packStock';
import { stockDbFileBackup } from '../api/stockDb';
import { yieldToMain } from '../utils/idbKv';

const router = useRouter();
const stockStore = useWarehouseStockStore();
const warehouseStore = useWarehouseStore();
const productStore = useProductStore();
const companyStore = useCompanyStore();
const requisitionStore = useRequisitionStore();
const channelStore = useChannelStore();

const { stocks, customFields, useSqlite, sqliteDbPath } = storeToRefs(stockStore);
const { warehouses } = storeToRefs(warehouseStore);
const { products } = storeToRefs(productStore);

const dialogVisible = ref(false);
const isEdit = ref(false);
const form = ref({
  warehouseId: '',
  productCode: '',
  stock: 0,
  inTransitStock: 0,
  customFields: {} as Record<string, any>,
});
const editId = ref('');

const searchWarehouseIds = ref<string[]>([]);
const searchCompanyIds = useRememberedCompanyFilter('warehouse-stocks');
const importWeekStart = ref(weekStartSaturday());

const importInputRef = ref<HTMLInputElement | null>(null);
const isReplaceMode = ref(false);
const canRestoreBackup = ref(false);

const refreshBackupFlag = async () => {
  try {
    canRestoreBackup.value = await stockStore.hasBackup();
  } catch {
    canRestoreBackup.value = false;
  }
};

const triggerImport = () => {
  isReplaceMode.value = false;
  importInputRef.value?.click();
};

const triggerReplaceImport = async () => {
  try {
    await ElMessageBox.confirm(
      `确认用 Excel「全量替换」本周库存？\n\n周次：${weekLabel(importWeekStart.value)}\n\n安全机制：\n· 导入前自动备份当前库存到本机\n· 新数据先写入成功后再替换界面\n· 失败不会清掉旧数据，可用「恢复导入前备份」\n\n未出现在 Excel 中的 SKU 将被新表覆盖掉。`,
      '每周库存导入',
      {
        confirmButtonText: '确认全量替换',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
    isReplaceMode.value = true;
    importInputRef.value?.click();
  } catch {
    /* cancel */
  }
};

const restorePreImportBackup = async () => {
  try {
    await ElMessageBox.confirm(
      '将用「最近一次导入前」的备份覆盖当前库存。是否继续？',
      '恢复导入前备份',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  const loading = ElLoading.service({ lock: true, text: '正在恢复备份…' });
  try {
    const meta = await stockStore.restoreFromPreImportBackup();
    page.value = 1;
    await refreshBackupFlag();
    ElMessage.success(
      meta
        ? `已恢复备份（${meta.rowCount.toLocaleString()} 行，${meta.at.slice(0, 19).replace('T', ' ')}）`
        : '已恢复导入前备份',
    );
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '恢复失败');
  } finally {
    loading.close();
  }
};

// 字段管理对话框
const fieldDialogVisible = ref(false);
const fieldForm = ref({
  label: '',
  type: 'text' as FieldType,
});
const editingFieldKey = ref('');

const filteredWarehouses = computed(() => {
  if (!searchCompanyIds.value.length) return warehouses.value;
  const set = new Set(searchCompanyIds.value);
  return warehouses.value.filter(w => set.has(w.companyId));
});

const filteredStocks = computed(() => {
  let result = stocks.value;
  if (searchCompanyIds.value.length) {
    const ids = new Set(
      warehouses.value
        .filter(w => searchCompanyIds.value.includes(w.companyId))
        .map(w => w.id),
    );
    result = result.filter(s => ids.has(s.warehouseId));
  }
  if (searchWarehouseIds.value.length) {
    const set = new Set(searchWarehouseIds.value);
    result = result.filter(s => set.has(s.warehouseId));
  }
  return result;
});

const onCompanyFilterChange = () => {
  const allowed = new Set(filteredWarehouses.value.map(w => w.id));
  searchWarehouseIds.value = searchWarehouseIds.value.filter(id => allowed.has(id));
};

const companyFilterOptions = computed(() =>
  companyStore.companies.map(c => ({ value: c.id, label: formatCompanyLabel(c) })),
);
const warehouseFilterOptions = computed(() =>
  filteredWarehouses.value.map(w => ({ value: w.id, label: w.name })),
);

onMounted(() => {
  bootstrapStores();
  void refreshBackupFlag();
});

const openDialog = (stock?: WarehouseStock) => {
  if (stock) {
    isEdit.value = true;
    editId.value = stock.id;
    form.value = {
      warehouseId: stock.warehouseId,
      productCode: stock.productCode,
      stock: stock.stock,
      inTransitStock: stock.inTransitStock,
      customFields: stock.customFields || {},
    };
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = {
      warehouseId: '',
      productCode: '',
      stock: 0,
      inTransitStock: 0,
      customFields: {},
    };
  }
  dialogVisible.value = true;
};

const handleSubmit = () => {
  if (!form.value.warehouseId) {
    ElMessage.error('请选择仓库');
    return;
  }

  if (!form.value.productCode) {
    ElMessage.error('请选择商品');
    return;
  }

  // 允许负库存（与 Excel 导入一致）；列表会显示「负X箱零Y瓶」并标红

  stockStore.upsertStock(
    form.value.warehouseId,
    form.value.productCode,
    form.value.stock,
    form.value.inTransitStock,
    Object.keys(form.value.customFields).length > 0 ? form.value.customFields : undefined
  );
  dialogVisible.value = false;
  ElMessage.success('保存成功');
};

const handleDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm('确认删除该库存行？', '删除库存', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  stockStore.deleteStock(id);
  ElMessage.success('删除成功');
};

/** Excel 中「库存 / 在途库存」均为瓶单位；仓库可用「仓库编码」或「仓库名称」 */
const STOCK_HEADERS = [
  '仓库名称',
  '仓库编码',
  '商品编码',
  '商品名称',
  '库存(瓶)',
  '在途库存(瓶)',
] as const;

const STOCK_HEADER_ALIASES = {
  warehouseName: ['仓库名称', '仓库', 'warehouseName'],
  warehouseCode: ['仓库编码', 'warehouseCode'],
  stock: ['库存(瓶)', '库存', 'stock'],
  inTransit: ['在途库存(瓶)', '在途库存', 'inTransitStock'],
} as const;

const handleImport = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  let loading = ElLoading.service({
    lock: true,
    text: '正在解析 Excel…',
    background: 'rgba(255, 255, 255, 0.72)',
  });

  try {
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    const jsonData = await readExcelFromEvent(event);
    if (!jsonData.length) {
      ElMessage.warning('Excel 无有效数据');
      return;
    }

    if (jsonData.length >= 12000 && !useSqlite.value) {
      loading.close();
      try {
        await ElMessageBox.confirm(
          `本次约 ${jsonData.length.toLocaleString()} 行，当前未连上 SQLite。\n建议先执行 npm run dev（会启动库存库），或拆成每次约 1 万行再导入。\n仍要用浏览器模式继续吗？`,
          '大批量导入提醒',
          { type: 'warning', confirmButtonText: '继续导入', cancelButtonText: '取消' },
        );
      } catch {
        return;
      }
      loading = ElLoading.service({
        lock: true,
        text: `正在导入 ${jsonData.length.toLocaleString()} 行…`,
        background: 'rgba(255, 255, 255, 0.72)',
      });
    }

    if (jsonData.length >= 50000) {
      loading.setText(`大文件 ${jsonData.length.toLocaleString()} 行，解析完成，准备导入…`);
      await new Promise<void>(r => setTimeout(r, 0));
    } else {
      loading.setText(`正在导入 ${jsonData.length.toLocaleString()} 行…`);
      await new Promise<void>(r => setTimeout(r, 0));
    }

    const knownLabels = new Set<string>([...STOCK_HEADERS]);
    const knownAlias = new Set<string>([
      ...STOCK_HEADERS,
      '库存',
      '在途库存',
      '仓库',
      'warehouseCode',
      'warehouseName',
      'productCode',
      'productName',
      'stock',
      'inTransitStock',
    ]);

    const importData: ImportWarehouseStockData[] = [];
    const MAP_CHUNK = 10000;
    for (let offset = 0; offset < jsonData.length; offset += MAP_CHUNK) {
      const slice = jsonData.slice(offset, offset + MAP_CHUNK);
      for (const item of slice) {
        const warehouseName = cell(item, ...STOCK_HEADER_ALIASES.warehouseName);
        const warehouseCode =
          cell(item, ...STOCK_HEADER_ALIASES.warehouseCode) || warehouseName;
        const result: ImportWarehouseStockData = {
          warehouseCode,
          warehouseName,
          productCode: cell(item, '商品编码', 'productCode'),
          productName: cell(item, '商品名称', 'productName'),
          stock: cellNum(item, ...STOCK_HEADER_ALIASES.stock),
          inTransitStock: cellNum(item, ...STOCK_HEADER_ALIASES.inTransit),
        };
        for (const key in item) {
          if (!knownLabels.has(key) && !knownAlias.has(key)) {
            result[key] = item[key];
          }
        }
        importData.push(result);
      }
      loading.setText(`整理数据 ${Math.min(offset + MAP_CHUNK, jsonData.length).toLocaleString()} / ${jsonData.length.toLocaleString()}`);
      await new Promise<void>(r => setTimeout(r, 0));
    }

    const week = weekStartSaturday(importWeekStart.value);
    const description = isReplaceMode.value
      ? `全量替换前备份 · ${week}`
      : `增量导入前备份 · ${week}`;

    const result = await stockStore.importStocks(
      importData,
      isReplaceMode.value,
      description,
      week,
      (done, total, phase) => {
        loading.setText(
          `${phase} ${done.toLocaleString()} / ${total.toLocaleString()}`,
        );
      },
    );

    const skipParts = [
      result.skippedWarehouse ? `仓库名/编码不匹配 ${result.skippedWarehouse}` : '',
      result.skippedNoCode ? `缺仓库或商品编码 ${result.skippedNoCode}` : '',
    ].filter(Boolean);
    const negPart = result.negativeRows ? `，其中负库存 ${result.negativeRows} 行` : '';
    const skipPart = skipParts.length ? `，跳过 ${skipParts.join('、')}` : '';
    const snapPart = result.preImportBackedUp
      ? `（已留导入前备份 ${result.backupRowCount.toLocaleString()} 行，可随时恢复）`
      : '';
    const backendPart =
      result.backend === 'sqlite' ? ' · 已写入本地 SQLite' : ' · 浏览器备份模式（请启动 npm run server）';
    ElMessage.success(
      (isReplaceMode.value
        ? `全量替换完成（成功 ${result.imported}/${result.total}）`
        : `增量导入完成（成功 ${result.imported}/${result.total}）`) +
        negPart +
        skipPart +
        snapPart +
        backendPart +
        ` · ${week}`,
    );
    page.value = 1;
    await refreshBackupFlag();
  } catch (e) {
    console.error(e);
    ElMessage.error(e instanceof Error ? e.message : '导入失败，原库存未改动');
    await refreshBackupFlag();
  } finally {
    loading.close();
    isReplaceMode.value = false;
  }
};

const getWarehouseName = (id: string) => {
  const warehouse = warehouseStore.getWarehouseById(id);
  return warehouse ? warehouse.name : '';
};

const getWarehouseCode = (id: string) => {
  const warehouse = warehouseStore.getWarehouseById(id);
  return warehouse ? warehouse.code : '';
};

const getProductName = (code: string) => {
  const product = productStore.getProductByCode(code);
  return product ? product.name : '';
};

const getProductSpec = (code: string) => {
  const product = productStore.getProductByCode(code);
  return product ? product.spec : '';
};

const getStockStatus = (
  productCode: string,
  stock: number,
  inTransitStock: number,
  demandQty = 0,
  availableOverride?: number,
) => {
  const product = productStore.getProductByCode(productCode);
  if (!product) return { type: 'info' as const, text: '未知' };
  const availableStock =
    availableOverride != null ? availableOverride : stock + inTransitStock;
  const gap = Math.max(0, demandQty - availableStock);
  if (gap > 0) {
    return {
      type: 'danger' as const,
      text: `缺货缺口 ${formatProductQty(gap, productCode)}`,
    };
  }
  if (availableStock < 0 || stock < 0) {
    return { type: 'danger' as const, text: '负库存' };
  }
  if (availableStock <= product.warningThreshold) {
    return { type: 'danger' as const, text: '库存预警' };
  }
  if (stock <= product.warningThreshold) {
    return { type: 'warning' as const, text: '当前库存预警' };
  }
  if (demandQty > 0) {
    return { type: 'success' as const, text: '可满足需求' };
  }
  return { type: 'success' as const, text: '库存充足' };
};

/** 本周需求：按仓均分（多仓要货不重复全额计入每仓）；停用渠道不计；箱规折瓶规 */
const demandMap = computed(() => {
  const week = weekStartSaturday(importWeekStart.value);
  const map = new Map<string, number>();
  requisitionStore.requisitions.forEach(r => {
    if (r.weekStart !== week) return;
    if (r.status !== 'pending' && r.status !== 'approved') return;
    const ch = channelStore.getChannelById(r.channelId);
    if (ch && ch.enabled === false) return;
    const whIds = (r.warehouseIds || []).filter(Boolean);
    if (!whIds.length) return;
    const share = 1 / whIds.length;
    r.items.forEach(item => {
      const { baseCode, factor } = resolveToBottleBase(item.productCode);
      const qty = item.quantity * factor * share;
      whIds.forEach(wid => {
        const key = `${wid}__${baseCode}`;
        map.set(key, (map.get(key) || 0) + qty);
      });
    });
  });
  return map;
});

const getDemandQty = (row: WarehouseStock) => {
  const { baseCode, factor } = resolveToBottleBase(row.productCode);
  // 箱规行：展示折成瓶后的本仓份额；若行本身是瓶规则直接取
  const bottleDemand = demandMap.value.get(`${row.warehouseId}__${baseCode}`) || 0;
  if (factor > 1 && row.productCode !== baseCode) {
    // 箱规 SKU 行：用瓶需求 ÷ 比例，便于对照箱规库存单位
    return Math.round((bottleDemand / factor) * 1000) / 1000;
  }
  return Math.round(bottleDemand * 1000) / 1000;
};

const getAvailableForGap = (row: WarehouseStock) => {
  const { baseCode } = resolveToBottleBase(row.productCode);
  // 瓶规：本仓可用含箱规折算；箱规行：仅看本行库存（单位为箱规）
  if (row.productCode === baseCode) {
    return getBottleEquivalentStock(baseCode, [row.warehouseId]).availableStock;
  }
  return row.stock + row.inTransitStock;
};

const getGapQty = (row: WarehouseStock) => {
  const demand = getDemandQty(row);
  const available = getAvailableForGap(row);
  return Math.max(0, Math.round((demand - available) * 1000) / 1000);
};

const getBalanceQty = (row: WarehouseStock) => {
  const demand = getDemandQty(row);
  return Math.round((getAvailableForGap(row) - demand) * 1000) / 1000;
};

const goShortageAlert = () => {
  router.push({
    path: '/shortage-alert',
    query: {
      week: weekStartSaturday(importWeekStart.value),
      ...(searchCompanyIds.value.length
        ? { companyIds: searchCompanyIds.value.join(',') }
        : {}),
    },
  });
};

const getTotalStock = (productCode: string) => {
  return stockStore.getTotalStock(productCode);
};

const getTotalInTransitStock = (productCode: string) => {
  return stockStore.getTotalInTransitStock(productCode);
};

const getCustomFieldValue = (stock: WarehouseStock, fieldKey: string) => {
  return stock.customFields?.[fieldKey] || '';
};

const stockStatusOf = (row: WarehouseStock) =>
  getStockStatus(
    row.productCode,
    row.stock,
    row.inTransitStock,
    getDemandQty(row),
    getAvailableForGap(row),
  );

const isCustomCol = (key: string) => key.startsWith('custom:');
const customFieldKeyOf = (colKey: string) => colKey.slice('custom:'.length);

const bottlesOf = (row: WarehouseStock) => Number(row.stock) || 0;
const inTransitOf = (row: WarehouseStock) => Number(row.inTransitStock) || 0;
/** 可用库存（瓶）= 当前 + 在途；与展示列一致 */
const availableOf = (row: WarehouseStock) => bottlesOf(row) + inTransitOf(row);

/**
 * 每列独立取值（不依赖 ElTable sortMethod / prop）。
 * Element Plus 动态列会串比较函数，这里完全自管。
 */
const sortValueOf = (row: WarehouseStock, key: string): string | number => {
  switch (key) {
    case 'warehouse':
      return getWarehouseName(row.warehouseId);
    case 'productCode':
      return row.productCode || '';
    case 'productName':
      return getProductName(row.productCode);
    case 'spec':
      return getProductSpec(row.productCode);
    case 'stockDisp':
    case 'stockBottle':
      return bottlesOf(row);
    case 'inTransitDisp':
    case 'inTransitBottle':
      return inTransitOf(row);
    case 'availableDisp':
    case 'availableBottle':
      return availableOf(row);
    case 'demandDisp':
    case 'demandBottle':
      return getDemandQty(row);
    case 'gapDisp':
    case 'gapBottle':
      return getGapQty(row);
    case 'balanceDisp':
      return getBalanceQty(row);
    case 'status':
      return stockStatusOf(row).text;
    case 'totalStockDisp':
    case 'totalStockBottle':
      return getTotalStock(row.productCode);
    case 'totalInTransitDisp':
    case 'totalInTransitBottle':
      return getTotalInTransitStock(row.productCode);
    default:
      if (isCustomCol(key)) {
        return String(getCustomFieldValue(row, customFieldKeyOf(key)) ?? '');
      }
      return '';
  }
};

const compareSortValues = (a: string | number, b: string | number) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
};

const columnCatalog = computed<ColumnMeta[]>(() => {
  const base: ColumnMeta[] = [
    { key: 'warehouse', label: '仓库', minWidth: 140, tooltip: true, sortable: true },
    { key: 'productCode', label: '商品编码', width: 110, sortable: true },
    { key: 'productName', label: '商品名称', width: 150, tooltip: true, sortable: true },
    { key: 'spec', label: '规格', width: 100, tooltip: true, sortable: true },
    { key: 'stockDisp', label: '当前库存', width: 130, sortable: true },
    { key: 'stockBottle', label: '当前库存(瓶)', width: 120, align: 'right', sortable: true },
    { key: 'inTransitDisp', label: '在途库存', width: 120, sortable: true },
    { key: 'inTransitBottle', label: '在途库存(瓶)', width: 120, align: 'right', sortable: true },
    { key: 'availableDisp', label: '可用库存', width: 120, sortable: true },
    { key: 'availableBottle', label: '可用库存(瓶)', width: 120, align: 'right', sortable: true },
    { key: 'demandDisp', label: '本周需求', width: 120, sortable: true },
    { key: 'demandBottle', label: '本周需求(瓶)', width: 120, align: 'right', sortable: true },
    { key: 'gapDisp', label: '缺口', width: 120, sortable: true },
    { key: 'gapBottle', label: '缺口(瓶)', width: 100, align: 'right', sortable: true },
    { key: 'balanceDisp', label: '可用-需求', width: 120, sortable: true },
    { key: 'status', label: '库存状态', width: 140, sortable: true },
  ];
  const customs: ColumnMeta[] = customFields.value.map(f => ({
    key: `custom:${f.key}`,
    label: f.label,
    width: 120,
    sortable: true,
  }));
  const totals: ColumnMeta[] = [
    { key: 'totalStockDisp', label: '总库存', width: 120, sortable: true },
    { key: 'totalStockBottle', label: '总库存(瓶)', width: 110, align: 'right', sortable: true },
    { key: 'totalInTransitDisp', label: '总在途', width: 120, sortable: true },
    { key: 'totalInTransitBottle', label: '总在途(瓶)', width: 110, align: 'right', sortable: true },
    { key: 'actions', label: '操作', width: 120, fixed: 'right', required: true },
  ];
  return [...base, ...customs, ...totals];
});

const {
  settingsList,
  visibleColumns,
  isVisible,
  setVisible,
  moveColumn,
  resetColumns,
  showAll,
} = useTableColumnPrefs('warehouse-stock-columns-v2', columnCatalog);

/** 完全自管排序：表头点击直接传 col.key，不经过 ElTable sort-change / sortMethod */
const sortState = ref<{ key: string; order: 'ascending' | 'descending' | null }>({
  key: '',
  order: null,
});

const toggleColumnSort = (key: string) => {
  if (sortState.value.key !== key) {
    sortState.value = { key, order: 'ascending' };
    return;
  }
  if (sortState.value.order === 'ascending') {
    sortState.value = { key, order: 'descending' };
    return;
  }
  sortState.value = { key: '', order: null };
};

const sortHeaderClass = (key: string) => {
  if (sortState.value.key !== key || !sortState.value.order) return '';
  return sortState.value.order;
};

const displayRows = computed(() => {
  const source = filteredStocks.value;
  const { key, order } = sortState.value;
  if (!key || !order) return source;
  // 先算好排序键再比，避免 sort 比较里反复算缺口/箱规（几万行会卡死）
  const dir = order === 'ascending' ? 1 : -1;
  const decorated = new Array<{ r: WarehouseStock; v: string | number }>(source.length);
  for (let i = 0; i < source.length; i++) {
    decorated[i] = { r: source[i], v: sortValueOf(source[i], key) };
  }
  decorated.sort((a, b) => {
    const r = compareSortValues(a.v, b.v);
    return r === 0 ? String(a.r.id).localeCompare(String(b.r.id)) : r * dir;
  });
  return decorated.map(d => d.r);
});

const page = ref(1);
const pageSize = ref(100);
const totalRows = computed(() => displayRows.value.length);
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return displayRows.value.slice(start, start + pageSize.value);
});
const rowIndexBase = computed(() => (page.value - 1) * pageSize.value);

/** 仅缓存当前页缺口/状态，模板不再对同一行反复重算 */
const pageRowMeta = computed(() => {
  const m = new Map<
    string,
    { demand: number; available: number; gap: number; balance: number; status: ReturnType<typeof stockStatusOf> }
  >();
  for (const row of pagedRows.value) {
    const demand = getDemandQty(row);
    const available = getAvailableForGap(row);
    const gap = Math.max(0, Math.round((demand - available) * 1000) / 1000);
    const balance = Math.round((available - demand) * 1000) / 1000;
    m.set(row.id, {
      demand,
      available,
      gap,
      balance,
      status: getStockStatus(row.productCode, row.stock, row.inTransitStock, demand, available),
    });
  }
  return m;
});

const metaOf = (row: WarehouseStock) =>
  pageRowMeta.value.get(row.id) || {
    demand: getDemandQty(row),
    available: getAvailableForGap(row),
    gap: getGapQty(row),
    balance: getBalanceQty(row),
    status: stockStatusOf(row),
  };

watch([searchCompanyIds, searchWarehouseIds, () => sortState.value.key, () => sortState.value.order], () => {
  page.value = 1;
});

const buildStockExportRow = (stock: WarehouseStock) => {
  const warehouse = warehouseStore.getWarehouseById(stock.warehouseId);
  const available = availableOf(stock);
  const demand = getDemandQty(stock);
  const gap = getGapQty(stock);
  const row: Record<string, string | number> = {
    仓库名称: warehouse?.name || '',
    仓库编码: warehouse?.code || '',
    商品编码: stock.productCode,
    商品名称: getProductName(stock.productCode),
    '库存(瓶)': stock.stock,
    '在途库存(瓶)': stock.inTransitStock,
    '可用库存(瓶)': available,
    '本周需求(瓶)': demand,
    '缺口(瓶)': gap,
    '可用减需求(瓶)': available - demand,
    库存展示: formatProductQty(stock.stock, stock.productCode),
    在途展示: formatProductQty(stock.inTransitStock, stock.productCode),
  };
  customFields.value.forEach(field => {
    row[field.label] = getCustomFieldValue(stock, field.key);
  });
  return row;
};

const handleExport = async () => {
  const list = filteredStocks.value;
  if (list.length >= 20000) {
    try {
      await ElMessageBox.confirm(
        `当前列表约 ${list.length.toLocaleString()} 行，导出可能较慢。建议先按主体/仓库筛选，或分批导出。是否继续？`,
        '导出确认',
        { type: 'warning', confirmButtonText: '继续导出', cancelButtonText: '取消' },
      );
    } catch {
      return;
    }
  }
  const loading = ElLoading.service({ lock: true, text: '正在导出…' });
  try {
    const rows: Record<string, string | number>[] = [];
    const CHUNK = 2000;
    for (let i = 0; i < list.length; i += CHUNK) {
      const slice = list.slice(i, i + CHUNK);
      for (const s of slice) rows.push(buildStockExportRow(s));
      loading.setText(`正在导出 ${Math.min(i + CHUNK, list.length).toLocaleString()} / ${list.length.toLocaleString()}`);
      await yieldToMain();
    }
    exportRows(rows, '库存');
    ElMessage.success(`已导出 ${rows.length} 条`);
  } finally {
    loading.close();
  }
};

const makeFileBackup = async () => {
  if (!useSqlite.value) {
    ElMessage.warning('请先用 npm run dev 启动 SQLite 服务');
    return;
  }
  const loading = ElLoading.service({ lock: true, text: '正在复制库文件…' });
  try {
    const info = await stockDbFileBackup();
    ElMessage.success(`已生成文件备份：data/backups/${info.fileName}`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '文件备份失败');
  } finally {
    loading.close();
  }
};

const handleTemplate = () => {
  const headers = [...STOCK_HEADERS, ...customFields.value.map(f => f.label)];
  downloadTemplate(headers, '库存导入模板');
};

const handleExcelCommand = (cmd: string | number) => {
  if (cmd === 'import') triggerImport();
  else if (cmd === 'export') handleExport();
  else if (cmd === 'template') handleTemplate();
  else if (cmd === 'fields') openFieldDialog();
  else if (cmd === 'shortage') goShortageAlert();
  else if (cmd === 'restore-backup') void restorePreImportBackup();
  else if (cmd === 'file-backup') void makeFileBackup();
};

// 字段管理相关方法
const openFieldDialog = (field?: CustomFieldConfig) => {
  if (field) {
    editingFieldKey.value = field.key;
    fieldForm.value = {
      label: field.label,
      type: field.type,
    };
  } else {
    editingFieldKey.value = '';
    fieldForm.value = {
      label: '',
      type: 'text',
    };
  }
  fieldDialogVisible.value = true;
};

const handleFieldSubmit = () => {
  if (!fieldForm.value.label) {
    ElMessage.error('请输入字段名称');
    return;
  }

  if (editingFieldKey.value) {
    stockStore.updateCustomField(editingFieldKey.value, fieldForm.value);
    ElMessage.success('字段修改成功');
  } else {
    stockStore.addCustomField(fieldForm.value);
    ElMessage.success('字段添加成功');
  }

  fieldDialogVisible.value = false;
};

const handleFieldDelete = (key: string) => {
  stockStore.removeCustomField(key);
  ElMessage.success('字段删除成功');
};
</script>

<template>
  <PageShell
    title="库存导入"
    help-title="库存导入说明"
    help="1. 库存优先写入本地 SQLite（data/stock.db），复制该文件即可整库备份。请用 npm run dev 同时开库服务。&#10;2. 导入前自动安全备份；失败可「更多 → 恢复导入前备份」。建议每次约一万行分批导入。&#10;3. 列表分页展示；本周需求按仓均分，主体缺口见「缺货与预警」。"
  >
    <template #toolbar>
      <div class="stock-toolbar">
        <div class="stock-toolbar__left">
          <span
            class="sqlite-badge"
            :class="useSqlite ? 'is-on' : 'is-off'"
            :title="useSqlite ? sqliteDbPath || 'SQLite 已连接' : '未连接 SQLite，导入将走浏览器兜底'"
          >
            {{ useSqlite ? 'SQLite' : '浏览器库' }}
          </span>
          <ElDatePicker
            v-model="importWeekStart"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="导入归属周"
            size="small"
            class="stock-toolbar__date"
            @change="(v: string) => { if (v) importWeekStart = weekStartSaturday(v) }"
          />
          <MultiCheckFilter
            v-model="searchCompanyIds"
            :options="companyFilterOptions"
            placeholder="主体(可多选)"
            width="180px"
            @update:model-value="onCompanyFilterChange"
          />
          <MultiCheckFilter
            v-model="searchWarehouseIds"
            :options="warehouseFilterOptions"
            placeholder="仓库(可多选)"
            width="180px"
          />
        </div>
        <div class="stock-toolbar__right">
          <input
            type="file"
            accept=".xlsx,.xls"
            class="import-input"
            @change="handleImport"
            ref="importInputRef"
          />
          <ElButton size="small" type="primary" @click="triggerReplaceImport()">本周全量替换</ElButton>
          <ElButton size="small" @click="triggerImport()">增量导入</ElButton>
          <ElButton size="small" @click="handleExport">导出</ElButton>
          <ElButton size="small" @click="openDialog()">手工添加</ElButton>
          <ElDropdown trigger="click" @command="handleExcelCommand">
            <ElButton size="small">
              更多
              <span class="stock-toolbar__caret">▾</span>
            </ElButton>
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem command="template">下载模板</ElDropdownItem>
                <ElDropdownItem command="fields">自定义字段</ElDropdownItem>
                <ElDropdownItem
                  v-if="canRestoreBackup"
                  command="restore-backup"
                  divided
                >
                  恢复导入前备份
                </ElDropdownItem>
                <ElDropdownItem
                  v-if="useSqlite"
                  command="file-backup"
                  :divided="!canRestoreBackup"
                >
                  复制库文件备份
                </ElDropdownItem>
                <ElDropdownItem
                  command="shortage"
                  :divided="!canRestoreBackup && !useSqlite"
                >
                  缺货与预警
                </ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </div>
      </div>
    </template>

    <div class="table-wrap">

    <ElTable
      :data="pagedRows"
      row-key="id"
      border
      size="small"
      stripe
      class="erp-data-table stock-table"
      height="100%"
      :row-class-name="({ row }: { row: WarehouseStock }) => (metaOf(row).gap > 0 ? 'stock-row--alert' : '')"
    >
      <ElTableColumn width="52" fixed="left" align="center" class-name="col-gear-cell">
        <template #header>
          <ColumnSettings
            variant="gear"
            :columns="settingsList"
            :is-visible="isVisible"
            @toggle="setVisible"
            @move="moveColumn"
            @reset="resetColumns"
            @show-all="showAll"
          />
        </template>
        <template #default="{ $index }">
          <span class="row-index">{{ rowIndexBase + $index + 1 }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn
        v-for="col in visibleColumns"
        :key="col.key"
        :label="col.label"
        :width="col.width"
        :min-width="col.minWidth"
        :align="col.align"
        :fixed="col.fixed"
        :show-overflow-tooltip="col.tooltip"
      >
        <template #header>
          <button
            v-if="col.sortable"
            type="button"
            class="th-sort"
            :class="sortHeaderClass(col.key)"
            @click="toggleColumnSort(col.key)"
          >
            <span>{{ col.label }}</span>
            <span class="th-sort-caret" aria-hidden="true">
              <i class="th-sort-caret__up" />
              <i class="th-sort-caret__down" />
            </span>
          </button>
          <span v-else>{{ col.label }}</span>
        </template>
        <template #default="{ row }">
          <template v-if="col.key === 'warehouse'">
            {{ getWarehouseName((row as WarehouseStock).warehouseId) }}
            <span class="wh-code">（{{ getWarehouseCode((row as WarehouseStock).warehouseId) }}）</span>
          </template>
          <template v-else-if="col.key === 'productCode'">
            {{ (row as WarehouseStock).productCode }}
          </template>
          <template v-else-if="col.key === 'productName'">
            {{ getProductName((row as WarehouseStock).productCode) }}
          </template>
          <template v-else-if="col.key === 'spec'">
            {{ getProductSpec((row as WarehouseStock).productCode) }}
          </template>
          <template v-else-if="col.key === 'stockDisp'">
            <span
              :class="{
                'stock-warning':
                  metaOf(row as WarehouseStock).status.type === 'danger' ||
                  metaOf(row as WarehouseStock).status.type === 'warning',
              }"
            >
              {{ formatProductQty(bottlesOf(row as WarehouseStock), (row as WarehouseStock).productCode) }}
            </span>
          </template>
          <template v-else-if="col.key === 'stockBottle'">
            {{ bottlesOf(row as WarehouseStock) }}
          </template>
          <template v-else-if="col.key === 'inTransitDisp'">
            {{ formatProductQty(inTransitOf(row as WarehouseStock), (row as WarehouseStock).productCode) }}
          </template>
          <template v-else-if="col.key === 'inTransitBottle'">
            {{ inTransitOf(row as WarehouseStock) }}
          </template>
          <template v-else-if="col.key === 'availableDisp'">
            {{
              formatProductQty(
                availableOf(row as WarehouseStock),
                (row as WarehouseStock).productCode,
              )
            }}
          </template>
          <template v-else-if="col.key === 'availableBottle'">
            {{ availableOf(row as WarehouseStock) }}
          </template>
          <template v-else-if="col.key === 'demandDisp'">
            <span :class="{ 'muted-zero': !metaOf(row as WarehouseStock).demand }">
              {{
                metaOf(row as WarehouseStock).demand
                  ? formatProductQty(metaOf(row as WarehouseStock).demand, (row as WarehouseStock).productCode)
                  : '—'
              }}
            </span>
          </template>
          <template v-else-if="col.key === 'demandBottle'">
            {{ metaOf(row as WarehouseStock).demand || '—' }}
          </template>
          <template v-else-if="col.key === 'gapDisp'">
            <span :class="{ 'stock-warning': metaOf(row as WarehouseStock).gap > 0 }">
              {{
                metaOf(row as WarehouseStock).gap > 0
                  ? formatProductQty(metaOf(row as WarehouseStock).gap, (row as WarehouseStock).productCode)
                  : '—'
              }}
            </span>
          </template>
          <template v-else-if="col.key === 'gapBottle'">
            <span :class="{ 'stock-warning': metaOf(row as WarehouseStock).gap > 0 }">
              {{ metaOf(row as WarehouseStock).gap || '—' }}
            </span>
          </template>
          <template v-else-if="col.key === 'balanceDisp'">
            <span
              :class="{
                'stock-warning': metaOf(row as WarehouseStock).balance < 0,
                'balance-ok': metaOf(row as WarehouseStock).balance >= 0 && metaOf(row as WarehouseStock).demand > 0,
              }"
            >
              {{
                metaOf(row as WarehouseStock).demand
                  ? formatProductQty(metaOf(row as WarehouseStock).balance, (row as WarehouseStock).productCode)
                  : '—'
              }}
            </span>
          </template>
          <template v-else-if="col.key === 'status'">
            <ElTag :type="metaOf(row as WarehouseStock).status.type">
              {{ metaOf(row as WarehouseStock).status.text }}
            </ElTag>
          </template>
          <template v-else-if="isCustomCol(col.key)">
            {{ getCustomFieldValue(row as WarehouseStock, customFieldKeyOf(col.key)) }}
          </template>
          <template v-else-if="col.key === 'totalStockDisp'">
            {{ formatProductQty(getTotalStock((row as WarehouseStock).productCode), (row as WarehouseStock).productCode) }}
          </template>
          <template v-else-if="col.key === 'totalStockBottle'">
            {{ getTotalStock((row as WarehouseStock).productCode) }}
          </template>
          <template v-else-if="col.key === 'totalInTransitDisp'">
            {{
              formatProductQty(
                getTotalInTransitStock((row as WarehouseStock).productCode),
                (row as WarehouseStock).productCode,
              )
            }}
          </template>
          <template v-else-if="col.key === 'totalInTransitBottle'">
            {{ getTotalInTransitStock((row as WarehouseStock).productCode) }}
          </template>
          <template v-else-if="col.key === 'actions'">
            <ElButton link type="primary" size="small" @click="openDialog(row as WarehouseStock)">编辑</ElButton>
            <ElButton link type="danger" size="small" @click="handleDelete((row as WarehouseStock).id)">删除</ElButton>
          </template>
        </template>
      </ElTableColumn>
    </ElTable>
    <div class="stock-pager">
      <span class="stock-pager__total">共 {{ totalRows.toLocaleString() }} 条</span>
      <ElPagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="totalRows"
        :page-sizes="[50, 100, 200, 500]"
        layout="sizes, prev, pager, next, jumper"
        small
        background
      />
    </div>
    </div>

    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑库存' : '添加库存'" width="560px">
      <ElForm :model="form" label-width="100px" size="small">
        <ElFormItem label="选择仓库">
          <ElSelect v-model="form.warehouseId" placeholder="请选择仓库" style="width: 100%">
            <ElOption
              v-for="warehouse in warehouses"
              :key="warehouse.id"
              :label="warehouse.name"
              :value="warehouse.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="选择商品">
          <ElSelect v-model="form.productCode" placeholder="请选择商品" filterable style="width: 100%">
            <ElOption
              v-for="product in products"
              :key="product.code"
              :label="`${product.code} - ${product.name}`"
              :value="product.code"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="库存数量(瓶)">
          <ElInputNumber v-model="form.stock" style="width: 100%" />
          <div v-if="form.productCode" class="form-hint">
            {{ formatProductQty(form.stock, form.productCode) }}
          </div>
        </ElFormItem>
        <ElFormItem label="在途库存(瓶)">
          <ElInputNumber v-model="form.inTransitStock" style="width: 100%" />
          <div v-if="form.productCode" class="form-hint">
            {{ formatProductQty(form.inTransitStock, form.productCode) }}
          </div>
        </ElFormItem>
        <ElFormItem v-for="field in customFields" :key="field.key" :label="field.label">
          <ElInput v-if="field.type === 'text'" v-model="form.customFields[field.key]" />
          <ElInputNumber v-else-if="field.type === 'number'" v-model="form.customFields[field.key]" :min="0" />
          <ElDatePicker v-else-if="field.type === 'date'" v-model="form.customFields[field.key]" type="date" style="width: 100%" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton size="small" @click="dialogVisible = false">取消</ElButton>
        <ElButton size="small" type="primary" @click="handleSubmit">确定</ElButton>
      </template>
    </ElDialog>

    <ElDialog v-model="fieldDialogVisible" title="字段管理" width="520px">
      <div v-if="editingFieldKey || !customFields.length" style="margin-bottom: 16px">
        <ElForm :model="fieldForm" label-width="88px" size="small">
          <ElFormItem label="字段名称">
            <ElInput v-model="fieldForm.label" placeholder="如：批次号、生产日期" />
          </ElFormItem>
          <ElFormItem label="字段类型">
            <ElSelect v-model="fieldForm.type" placeholder="请选择类型" style="width: 100%">
              <ElOption label="文本" value="text" />
              <ElOption label="数字" value="number" />
              <ElOption label="日期" value="date" />
            </ElSelect>
          </ElFormItem>
        </ElForm>
      </div>
      <div v-else>
        <ElTable :data="customFields" border size="small">
          <ElTableColumn prop="label" label="字段名称" />
          <ElTableColumn prop="type" label="字段类型">
            <template #default="scope">
              {{ (scope.row as CustomFieldConfig).type === 'text' ? '文本' : (scope.row as CustomFieldConfig).type === 'number' ? '数字' : '日期' }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="140">
            <template #default="scope">
              <ElButton link type="primary" size="small" @click="openFieldDialog(scope.row as CustomFieldConfig)">编辑</ElButton>
              <ElButton link type="danger" size="small" @click="handleFieldDelete((scope.row as CustomFieldConfig).key)">删除</ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
      <template #footer>
        <ElButton v-if="editingFieldKey" size="small" @click="editingFieldKey = ''; fieldForm.label = ''; fieldForm.type = 'text'">返回列表</ElButton>
        <ElButton v-if="!editingFieldKey" size="small" type="primary" @click="openFieldDialog()">添加字段</ElButton>
        <ElButton v-if="editingFieldKey" size="small" type="primary" @click="handleFieldSubmit">保存</ElButton>
        <ElButton v-if="!editingFieldKey" size="small" @click="fieldDialogVisible = false">关闭</ElButton>
      </template>
    </ElDialog>
  </PageShell>
</template>

<style scoped>
.stock-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  min-width: 0;
  width: auto;
}
.stock-toolbar__left,
.stock-toolbar__right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.stock-toolbar__right {
  margin-left: auto;
}
.stock-toolbar__date {
  width: 150px;
}
.sqlite-badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}
.sqlite-badge.is-on {
  color: #067647;
  background: #ecfdf3;
}
.sqlite-badge.is-off {
  color: #b54708;
  background: #fffaeb;
}
.stock-toolbar__caret {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.7;
}
.stock-table :deep(.col-gear-cell .cell) {
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.row-index {
  color: var(--erp-text-muted, #909399);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px 0;
  overflow: hidden;
}
.stock-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-shrink: 0;
  padding: 8px 0 12px;
}
.stock-pager__total {
  margin-right: auto;
  font-size: 12px;
  color: var(--erp-text-muted, #909399);
}

.import-input {
  display: none;
}

.stock-warning {
  color: #f56c6c;
  font-weight: 600;
}
.stock-table :deep(.stock-row--alert > td.el-table__cell) {
  background-color: #fff5f5 !important;
}
.stock-table :deep(.stock-row--alert:hover > td.el-table__cell) {
  background-color: #ffecec !important;
}
.stock-table :deep(.el-table__body tr.stock-row--alert.el-table__row--striped > td.el-table__cell) {
  background-color: #fff1f1 !important;
}
.balance-ok {
  color: #67c23a;
}
.muted-zero {
  color: var(--erp-text-muted);
}
.wh-code {
  color: var(--erp-text-muted);
  font-size: 12px;
}
.th-sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  line-height: 1.2;
  text-align: left;
}
.th-sort-caret {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  width: 10px;
  height: 14px;
  flex-shrink: 0;
}
.th-sort-caret__up,
.th-sort-caret__down {
  width: 0;
  height: 0;
  border: 5px solid transparent;
}
.th-sort-caret__up {
  border-bottom-color: #c0c4cc;
  border-top-width: 0;
  margin-bottom: 1px;
}
.th-sort-caret__down {
  border-top-color: #c0c4cc;
  border-bottom-width: 0;
}
.th-sort.ascending .th-sort-caret__up {
  border-bottom-color: var(--el-color-primary, #409eff);
}
.th-sort.descending .th-sort-caret__down {
  border-top-color: var(--el-color-primary, #409eff);
}

.form-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--erp-text-muted);
}
</style>