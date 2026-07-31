import { defineStore } from 'pinia';
import { markRaw, ref, shallowRef, watch } from 'vue';
import type {
  WarehouseStock,
  ImportWarehouseStockData,
  CustomFieldConfig,
  StockSnapshot,
} from '../types';
import { useWarehouseStore } from './warehouse';
import { useStockSnapshotStore } from './stockSnapshot';
import { weekStartSaturday } from '../utils/week';
import { yieldToMain } from '../utils/idbKv';
import {
  loadStockPersist,
  saveStockPersist,
  savePreImportBackup,
  loadPreImportBackup,
} from '../utils/stockPersist';
import {
  stockDbHealth,
  stockDbLoad,
  stockDbImport,
  stockDbUpsert,
  stockDbDelete,
  stockDbRestoreBackup,
  stockDbSaveCustomFields,
  stockDbReplaceAll,
  stockDbBackupInfo,
} from '../api/stockDb';

const stockKey = (warehouseId: string, productCode: string) =>
  `${warehouseId}__${productCode}`;

export const SKIP_SNAPSHOT_ROWS = 20000;
const IMPORT_CHUNK = 8000;

export type ImportStocksResult = {
  imported: number;
  skippedWarehouse: number;
  skippedNoCode: number;
  negativeRows: number;
  total: number;
  snapshotSkipped: boolean;
  preImportBackedUp: boolean;
  backupRowCount: number;
  /** sqlite | idb */
  backend: 'sqlite' | 'idb';
};

type WhAgg = { stock: number; inTransit: number };

function normalizeRow(s: WarehouseStock): WarehouseStock {
  return markRaw({
    ...s,
    stock: Number(s.stock) || 0,
    inTransitStock: Number(s.inTransitStock) || 0,
  });
}

/** productCode → warehouseId → 汇总（缺货/预警查询用，避免扫全表） */
function buildProductWhIndex(list: WarehouseStock[]): Map<string, Map<string, WhAgg>> {
  const m = new Map<string, Map<string, WhAgg>>();
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let wm = m.get(s.productCode);
    if (!wm) {
      wm = new Map();
      m.set(s.productCode, wm);
    }
    const cur = wm.get(s.warehouseId);
    if (cur) {
      cur.stock += s.stock;
      cur.inTransit += s.inTransitStock;
    } else {
      wm.set(s.warehouseId, { stock: s.stock, inTransit: s.inTransitStock });
    }
  }
  return m;
}

function sumFromIndex(
  index: Map<string, Map<string, WhAgg>>,
  productCode: string,
  warehouseIds?: string[],
): WhAgg {
  const wm = index.get(productCode);
  if (!wm) return { stock: 0, inTransit: 0 };
  if (!warehouseIds) {
    let stock = 0;
    let inTransit = 0;
    for (const v of wm.values()) {
      stock += v.stock;
      inTransit += v.inTransit;
    }
    return { stock, inTransit };
  }
  if (!warehouseIds.length) return { stock: 0, inTransit: 0 };
  let stock = 0;
  let inTransit = 0;
  for (let i = 0; i < warehouseIds.length; i++) {
    const v = wm.get(warehouseIds[i]);
    if (v) {
      stock += v.stock;
      inTransit += v.inTransit;
    }
  }
  return { stock, inTransit };
}

export const useWarehouseStockStore = defineStore('warehouseStock', () => {
  /** shallow：大表不做逐行深层响应，避免打开页面卡死 */
  const stocks = shallowRef<WarehouseStock[]>([]);
  const productWhIndex = shallowRef(new Map<string, Map<string, WhAgg>>());
  /** warehouseId__productCode → 行，单行改删 O(1) */
  const rowByKey = shallowRef(new Map<string, WarehouseStock>());
  const customFields = ref<CustomFieldConfig[]>([]);
  const hydrated = ref(false);
  const importing = ref(false);
  /** 是否已连上本地 SQLite 服务 */
  const useSqlite = ref(false);
  const sqliteDbPath = ref('');
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  let saveQueued = false;

  const rebuildIndex = (list: WarehouseStock[]) => {
    productWhIndex.value = buildProductWhIndex(list);
    const keys = new Map<string, WarehouseStock>();
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      keys.set(stockKey(s.warehouseId, s.productCode), s);
    }
    rowByKey.value = keys;
  };

  const bumpIndexCell = (
    productCode: string,
    warehouseId: string,
    dStock: number,
    dInTransit: number,
  ) => {
    const index = productWhIndex.value;
    let wm = index.get(productCode);
    if (!wm) {
      wm = new Map();
      index.set(productCode, wm);
    }
    const cur = wm.get(warehouseId) || { stock: 0, inTransit: 0 };
    const next = {
      stock: cur.stock + dStock,
      inTransit: cur.inTransit + dInTransit,
    };
    if (next.stock === 0 && next.inTransit === 0) wm.delete(warehouseId);
    else wm.set(warehouseId, next);
    if (wm.size === 0) index.delete(productCode);
    // 触发浅层订阅
    productWhIndex.value = new Map(index);
  };

  const scheduleSave = () => {
    if (!hydrated.value || importing.value || useSqlite.value) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flushSave();
    }, 400);
  };

  const flushSave = async () => {
    if (!hydrated.value || useSqlite.value) return;
    if (saving) {
      saveQueued = true;
      return;
    }
    saving = true;
    try {
      await saveStockPersist({
        stocks: stocks.value,
        customFields: customFields.value,
      });
    } catch (e) {
      console.error('库存写入 IndexedDB 失败', e);
    } finally {
      saving = false;
      if (saveQueued) {
        saveQueued = false;
        scheduleSave();
      }
    }
  };

  const applyLoaded = (
    nextStocks: WarehouseStock[],
    nextFields: CustomFieldConfig[],
  ) => {
    const normalized = (nextStocks || []).map(normalizeRow);
    stocks.value = normalized;
    rebuildIndex(normalized);
    customFields.value = nextFields || [];
  };

  /** 启动：优先 SQLite；空库时把 IDB 迁过去（大表后台迁，不堵界面） */
  const hydrateFromIdb = async () => {
    try {
      const health = await stockDbHealth();
      if (health?.ok) {
        useSqlite.value = true;
        sqliteDbPath.value = health.dbPath || '';
        try {
          // 大表 JSON 解析前让出主线程，避免首屏假死
          await yieldToMain();
          const data = await stockDbLoad();
          await yieldToMain();
          if ((data.stocks?.length || 0) === 0) {
            const idb = await loadStockPersist();
            const idbStocks = (idb?.stocks as WarehouseStock[]) || [];
            const idbFields = (idb?.customFields as CustomFieldConfig[]) || [];
            if (idbStocks.length > 0) {
              // 先展示，再视大小决定同步/后台迁库
              applyLoaded(idbStocks, idbFields);
              hydrated.value = true;
              if (idbStocks.length <= 5000) {
                await stockDbReplaceAll(idbStocks, idbFields);
                const again = await stockDbLoad();
                applyLoaded(again.stocks || [], again.customFields || []);
              } else {
                void stockDbReplaceAll(idbStocks, idbFields)
                  .then(async () => {
                    const again = await stockDbLoad();
                    applyLoaded(again.stocks || [], again.customFields || []);
                    console.info(`[stock] 已将 ${idbStocks.length} 行从浏览器迁入 SQLite`);
                  })
                  .catch(e => console.error('大表迁入 SQLite 失败', e));
              }
            } else {
              applyLoaded([], data.customFields || []);
            }
          } else {
            applyLoaded(data.stocks || [], data.customFields || []);
          }
        } catch (e) {
          console.error('SQLite 读取失败，回退 IndexedDB', e);
          useSqlite.value = false;
          const data = await loadStockPersist();
          if (data) {
            applyLoaded(
              data.stocks as WarehouseStock[],
              data.customFields as CustomFieldConfig[],
            );
          }
        }
      } else {
        useSqlite.value = false;
        const data = await loadStockPersist();
        if (data) {
          applyLoaded(
            data.stocks as WarehouseStock[],
            data.customFields as CustomFieldConfig[],
          );
        }
      }
    } catch (e) {
      console.error('库存 hydrate 失败', e);
      useSqlite.value = false;
    } finally {
      hydrated.value = true;
    }
  };

  watch(stocks, () => scheduleSave(), { deep: false });
  watch(customFields, () => {
    scheduleSave();
    if (useSqlite.value && hydrated.value && !importing.value) {
      void stockDbSaveCustomFields(customFields.value).catch(e =>
        console.error('自定义字段写入 SQLite 失败', e),
      );
    }
  }, { deep: true });

  const initStocks = () => {
    if (stocks.value.length > 0) {
      const normalized = stocks.value.map(normalizeRow);
      stocks.value = normalized;
      rebuildIndex(normalized);
      return;
    }
    const seed = [
      { id: '1', warehouseId: 'W001', productCode: 'P001', stock: 200, inTransitStock: 50 },
      { id: '2', warehouseId: 'W001', productCode: 'P002', stock: 50, inTransitStock: 100 },
      { id: '3', warehouseId: 'W002', productCode: 'P001', stock: 150, inTransitStock: 0 },
      { id: '4', warehouseId: 'W002', productCode: 'P003', stock: 80, inTransitStock: 20 },
      { id: '5', warehouseId: 'W003', productCode: 'P001', stock: 150, inTransitStock: 30 },
      { id: '6', warehouseId: 'W003', productCode: 'P004', stock: 10, inTransitStock: 0 },
      { id: '7', warehouseId: 'W004', productCode: 'P001', stock: 0, inTransitStock: 80 },
      { id: '8', warehouseId: 'W004', productCode: 'P005', stock: 200, inTransitStock: 40 },
      { id: '9', warehouseId: 'W005', productCode: 'P001', stock: 100, inTransitStock: 20 },
      { id: '10', warehouseId: 'W006', productCode: 'P001', stock: 80, inTransitStock: 0 },
      { id: '11', warehouseId: 'W008', productCode: 'P001', stock: 60, inTransitStock: 10 },
      { id: '12', warehouseId: 'W001', productCode: 'P0012', stock: 5, inTransitStock: 0 },
    ].map(normalizeRow);
    stocks.value = seed;
    rebuildIndex(seed);
  };

  const getStocksByWarehouse = (warehouseId: string) =>
    stocks.value.filter(s => s.warehouseId === warehouseId);

  const getStocksByProduct = (productCode: string) => {
    const wm = productWhIndex.value.get(productCode);
    if (!wm) return [] as WarehouseStock[];
    const out: WarehouseStock[] = [];
    for (const whId of wm.keys()) {
      const row = rowByKey.value.get(stockKey(whId, productCode));
      if (row) out.push(row);
    }
    return out;
  };

  const getStock = (warehouseId: string, productCode: string) =>
    rowByKey.value.get(stockKey(warehouseId, productCode));

  const getTotalStock = (productCode: string, warehouseIds?: string[]) =>
    sumFromIndex(productWhIndex.value, productCode, warehouseIds).stock;

  const getTotalInTransitStock = (productCode: string, warehouseIds?: string[]) =>
    sumFromIndex(productWhIndex.value, productCode, warehouseIds).inTransit;

  const getAvailableStock = (productCode: string) =>
    getAvailableStockByWarehouses(productCode);

  const getAvailableStockByWarehouses = (productCode: string, warehouseIds?: string[]) => {
    const a = sumFromIndex(
      productWhIndex.value,
      productCode,
      warehouseIds?.length ? warehouseIds : undefined,
    );
    return a.stock + a.inTransit;
  };

  /** 指定仓内是否存在这些商品编码的任一行（O(仓×码)，不扫全表） */
  const hasAnyStockRows = (productCodes: string[], warehouseIds: string[]) => {
    if (!productCodes.length || !warehouseIds.length) return false;
    const index = productWhIndex.value;
    for (let i = 0; i < productCodes.length; i++) {
      const wm = index.get(productCodes[i]);
      if (!wm) continue;
      for (let j = 0; j < warehouseIds.length; j++) {
        if (wm.has(warehouseIds[j])) return true;
      }
    }
    return false;
  };

  const countByProduct = (productCode: string) => {
    const wm = productWhIndex.value.get(productCode);
    return wm ? wm.size : 0;
  };

  const countByWarehouse = (warehouseId: string) => {
    let n = 0;
    for (const s of stocks.value) {
      if (s.warehouseId === warehouseId) n += 1;
    }
    return n;
  };

  const upsertStock = (
    warehouseId: string,
    productCode: string,
    stock: number,
    inTransitStock: number = 0,
    fields?: Record<string, any>,
  ) => {
    const key = stockKey(warehouseId, productCode);
    const prev = rowByKey.value.get(key);
    let row: WarehouseStock;
    if (prev) {
      bumpIndexCell(
        productCode,
        warehouseId,
        (Number(stock) || 0) - prev.stock,
        (Number(inTransitStock) || 0) - prev.inTransitStock,
      );
      row = normalizeRow({
        ...prev,
        stock,
        inTransitStock,
        customFields: fields !== undefined ? fields : prev.customFields,
      });
      const next = stocks.value.slice();
      const idx = next.findIndex(s => s.warehouseId === warehouseId && s.productCode === productCode);
      if (idx >= 0) next[idx] = row;
      else next.push(row);
      stocks.value = next;
      const keys = new Map(rowByKey.value);
      keys.set(key, row);
      rowByKey.value = keys;
    } else {
      row = normalizeRow({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        warehouseId,
        productCode,
        stock,
        inTransitStock,
        customFields: fields,
      });
      bumpIndexCell(productCode, warehouseId, row.stock, row.inTransitStock);
      stocks.value = [...stocks.value, row];
      const keys = new Map(rowByKey.value);
      keys.set(key, row);
      rowByKey.value = keys;
    }
    if (useSqlite.value) {
      void stockDbUpsert(row).catch(e => console.error('SQLite upsert 失败', e));
    }
  };

  const deleteStock = (id: string) => {
    const prev = stocks.value.find(s => s.id === id);
    if (!prev) return;
    bumpIndexCell(prev.productCode, prev.warehouseId, -prev.stock, -prev.inTransitStock);
    const next = stocks.value.filter(s => s.id !== id);
    stocks.value = next;
    const keys = new Map(rowByKey.value);
    keys.delete(stockKey(prev.warehouseId, prev.productCode));
    rowByKey.value = keys;
    if (useSqlite.value) {
      void stockDbDelete(id).catch(e => console.error('SQLite delete 失败', e));
    }
  };

  const setCustomFields = (fields: CustomFieldConfig[]) => {
    customFields.value = fields;
  };

  const addCustomField = (field: Omit<CustomFieldConfig, 'key'>) => {
    const key = field.label.replace(/\s+/g, '_').toLowerCase();
    if (!customFields.value.find(f => f.key === key)) {
      customFields.value = [...customFields.value, { key, ...field }];
    }
  };

  const updateCustomField = (key: string, field: Partial<CustomFieldConfig>) => {
    customFields.value = customFields.value.map(f =>
      f.key === key ? { ...f, ...field } : f,
    );
  };

  const removeCustomField = (key: string) => {
    customFields.value = customFields.value.filter(f => f.key !== key);
  };

  const buildWarehouseMaps = () => {
    const warehouseStore = useWarehouseStore();
    const norm = (s: string) => String(s || '').trim().toLowerCase();
    const whByCode = new Map<string, (typeof warehouseStore.warehouses)[0]>();
    const whByName = new Map<string, (typeof warehouseStore.warehouses)[0]>();
    for (const w of warehouseStore.warehouses) {
      const c = norm(w.code);
      const n = norm(w.name);
      if (c && !whByCode.has(c)) whByCode.set(c, w);
      if (n && !whByName.has(n)) whByName.set(n, w);
    }
    return {
      resolveWh: (code?: string, name?: string) => {
        const a = norm(code || '');
        const b = norm(name || '');
        if (a) return whByCode.get(a) || whByName.get(a);
        if (b) return whByCode.get(b) || whByName.get(b);
        return undefined;
      },
    };
  };

  const buildResolvedRows = async (
    data: ImportWarehouseStockData[],
    replaceAll: boolean,
    onProgress?: (done: number, total: number, phase: string) => void,
  ) => {
    const knownFields = [
      'warehouseCode',
      'warehouseName',
      'productCode',
      'productName',
      'stock',
      'inTransitStock',
    ];
    const { resolveWh } = buildWarehouseMaps();
    const byKey = new Map<string, WarehouseStock>();
    if (!replaceAll) {
      for (let i = 0; i < stocks.value.length; i++) {
        const s = stocks.value[i];
        byKey.set(stockKey(s.warehouseId, s.productCode), s);
        if (i > 0 && i % 20000 === 0) await yieldToMain();
      }
    }

    let nextCustom = customFields.value.slice();
    if (data.length > 0) {
      const firstItem = data[0];
      for (const key in firstItem) {
        if (!knownFields.includes(key) && !nextCustom.find(f => f.key === key)) {
          const value = firstItem[key];
          let type: 'text' | 'number' | 'date' = 'text';
          if (typeof value === 'number') type = 'number';
          else if (typeof value === 'string' && !isNaN(Date.parse(value))) type = 'date';
          nextCustom.push({ key, label: key, type });
        }
      }
    }

    let imported = 0;
    let skippedWarehouse = 0;
    let skippedNoCode = 0;
    let negativeRows = 0;
    let idSeq = Date.now();
    const touched: WarehouseStock[] = [];

    for (let offset = 0; offset < data.length; offset += IMPORT_CHUNK) {
      const end = Math.min(offset + IMPORT_CHUNK, data.length);
      for (let i = offset; i < end; i++) {
        const item = data[i];
        const whKey = String(item.warehouseCode || item.warehouseName || '').trim();
        const productCode = String(item.productCode || '').trim();
        if (!whKey || !productCode) {
          skippedNoCode += 1;
          continue;
        }
        const warehouse = resolveWh(item.warehouseCode, item.warehouseName);
        if (!warehouse) {
          skippedWarehouse += 1;
          continue;
        }
        const stock = Number(item.stock) || 0;
        const inTransit = Number(item.inTransitStock) || 0;
        if (stock < 0 || inTransit < 0) negativeRows += 1;

        let customFieldsData: Record<string, any> | undefined;
        for (const key in item) {
          if (!knownFields.includes(key)) {
            if (!customFieldsData) customFieldsData = {};
            customFieldsData[key] = item[key];
          }
        }
        const key = stockKey(warehouse.id, productCode);
        const prev = byKey.get(key);
        let row: WarehouseStock;
        if (prev) {
          row = {
            ...prev,
            stock,
            inTransitStock: inTransit,
            customFields: customFieldsData || prev.customFields,
          };
        } else {
          idSeq += 1;
          row = {
            id: `${idSeq}_${imported}`,
            warehouseId: warehouse.id,
            productCode,
            stock,
            inTransitStock: inTransit,
            customFields: customFieldsData,
          };
        }
        byKey.set(key, row);
        touched.push(row);
        imported += 1;
      }
      onProgress?.(end, data.length, '整理');
      await yieldToMain();
    }

    return {
      rows: Array.from(byKey.values()),
      /** 本批 Excel 实际命中的行（增量导入只推这些到 SQLite） */
      touchedRows: touched,
      nextCustom,
      imported,
      skippedWarehouse,
      skippedNoCode,
      negativeRows,
    };
  };

  const importStocks = async (
    data: ImportWarehouseStockData[],
    replaceAll: boolean = false,
    description: string = '',
    weekStart?: string,
    onProgress?: (done: number, total: number, phase: string) => void,
  ): Promise<ImportStocksResult> => {
    const week = weekStart || weekStartSaturday();
    importing.value = true;

    try {
      // 每次导入前再探测一次 SQLite（用户可能刚启动服务）
      if (!useSqlite.value) {
        const health = await stockDbHealth();
        if (health?.ok) {
          useSqlite.value = true;
          sqliteDbPath.value = health.dbPath || '';
        }
      }

      onProgress?.(0, data.length, '解析仓库');
      const built = await buildResolvedRows(data, replaceAll, onProgress);

      if (useSqlite.value) {
        onProgress?.(data.length, data.length, '写入 SQLite');
        const result = await stockDbImport({
          replaceAll,
          rows: replaceAll ? built.rows : built.touchedRows,
          customFields: built.nextCustom,
          reason: description || `${replaceAll ? '全量替换' : '增量导入'} · ${week}`,
        });
        // 大单量：直接用本地整理结果更新内存，禁止再全表 HTTP 回读
        applyLoaded(built.rows, built.nextCustom);
        onProgress?.(data.length, data.length, '完成');
        return {
          imported: result.imported,
          skippedWarehouse: built.skippedWarehouse,
          skippedNoCode: built.skippedNoCode + result.skippedNoCode,
          negativeRows: built.negativeRows,
          total: data.length,
          snapshotSkipped: true,
          preImportBackedUp: result.preImportBackedUp,
          backupRowCount: result.backupRowCount,
          backend: 'sqlite',
        };
      }

      // —— IndexedDB 兜底（服务未启动）——
      let preImportBackedUp = false;
      let backupRowCount = stocks.value.length;
      if (stocks.value.length > 0) {
        onProgress?.(0, data.length, '安全备份');
        const meta = await savePreImportBackup(
          { stocks: stocks.value, customFields: customFields.value },
          description || `${replaceAll ? '全量替换' : '增量导入'}前 · ${week}`,
        );
        preImportBackedUp = true;
        backupRowCount = meta.rowCount;
      }

      const snapshotSkipped =
        data.length >= SKIP_SNAPSHOT_ROWS || stocks.value.length >= SKIP_SNAPSHOT_ROWS;
      if (!snapshotSkipped && stocks.value.length > 0) {
        try {
          useStockSnapshotStore().createSnapshot(
            stocks.value,
            description || `${replaceAll ? '全量替换' : '增量导入'}前自动备份 · ${week}`,
            week,
          );
        } catch {
          /* ignore */
        }
      }

      onProgress?.(data.length, data.length, '安全写入');
      await saveStockPersist({
        stocks: built.rows,
        customFields: built.nextCustom,
      });
      const normalized = built.rows.map(normalizeRow);
      stocks.value = normalized;
      rebuildIndex(normalized);
      customFields.value = built.nextCustom;
      return {
        imported: built.imported,
        skippedWarehouse: built.skippedWarehouse,
        skippedNoCode: built.skippedNoCode,
        negativeRows: built.negativeRows,
        total: data.length,
        snapshotSkipped,
        preImportBackedUp,
        backupRowCount,
        backend: 'idb',
      };
    } finally {
      importing.value = false;
    }
  };

  const restoreFromSnapshot = (snapshot: StockSnapshot) => {
    const next = (JSON.parse(JSON.stringify(snapshot.stocks)) as WarehouseStock[]).map(
      normalizeRow,
    );
    stocks.value = next;
    rebuildIndex(next);
  };

  const restoreFromPreImportBackup = async () => {
    if (useSqlite.value) {
      const data = await stockDbRestoreBackup();
      applyLoaded(data.stocks || [], data.customFields || []);
      return data.meta;
    }
    const bak = await loadPreImportBackup();
    if (!bak) throw new Error('没有可用的导入前备份');
    const stocksArr = bak.payload.stocks as WarehouseStock[];
    const fieldsArr = (bak.payload.customFields || []) as CustomFieldConfig[];
    await saveStockPersist({ stocks: stocksArr, customFields: fieldsArr });
    applyLoaded(stocksArr, fieldsArr);
    return bak.meta;
  };

  const hasBackup = async () => {
    if (useSqlite.value) {
      try {
        const info = await stockDbBackupInfo();
        return !!info.available;
      } catch {
        return false;
      }
    }
    const { hasPreImportBackup } = await import('../utils/stockPersist');
    return hasPreImportBackup();
  };

  return {
    stocks,
    productWhIndex,
    rowByKey,
    customFields,
    hydrated,
    importing,
    useSqlite,
    sqliteDbPath,
    hydrateFromIdb,
    flushSave,
    initStocks,
    getStocksByWarehouse,
    getStocksByProduct,
    getStock,
    getTotalStock,
    getTotalInTransitStock,
    getAvailableStock,
    getAvailableStockByWarehouses,
    hasAnyStockRows,
    countByProduct,
    countByWarehouse,
    upsertStock,
    deleteStock,
    setCustomFields,
    addCustomField,
    updateCustomField,
    removeCustomField,
    importStocks,
    restoreFromSnapshot,
    restoreFromPreImportBackup,
    hasBackup,
  };
});
