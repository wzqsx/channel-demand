import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
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

const stockKey = (warehouseId: string, productCode: string) =>
  `${warehouseId}__${productCode}`;

/** 超过此行数跳过 Pinia 多份历史快照；导入前 IDB 安全备份仍会做 */
export const SKIP_SNAPSHOT_ROWS = 20000;
const IMPORT_CHUNK = 8000;

export type ImportStocksResult = {
  imported: number;
  skippedWarehouse: number;
  skippedNoCode: number;
  negativeRows: number;
  total: number;
  snapshotSkipped: boolean;
  /** 已写入导入前安全备份，可一键回滚 */
  preImportBackedUp: boolean;
  backupRowCount: number;
};

export const useWarehouseStockStore = defineStore('warehouseStock', () => {
  const stocks = ref<WarehouseStock[]>([]);
  const customFields = ref<CustomFieldConfig[]>([]);
  const hydrated = ref(false);
  /** 导入进行中：禁止自动 persist 半成品 */
  const importing = ref(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  let saveQueued = false;

  const scheduleSave = () => {
    if (!hydrated.value || importing.value) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flushSave();
    }, 400);
  };

  const flushSave = async () => {
    if (!hydrated.value) return;
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

  /** 启动时从 IDB 恢复 */
  const hydrateFromIdb = async () => {
    const data = await loadStockPersist();
    if (data) {
      stocks.value = (data.stocks as WarehouseStock[]).map(s => ({
        ...s,
        stock: Number(s.stock) || 0,
        inTransitStock: Number(s.inTransitStock) || 0,
      }));
      customFields.value = (data.customFields as CustomFieldConfig[]) || [];
    }
    hydrated.value = true;
  };

  watch(stocks, () => scheduleSave(), { deep: false });
  watch(customFields, () => scheduleSave(), { deep: true });

  const initStocks = () => {
    stocks.value = stocks.value.map(s => ({
      ...s,
      stock: Number(s.stock) || 0,
      inTransitStock: Number(s.inTransitStock) || 0,
    }));
    if (stocks.value.length > 0) return;
    stocks.value = [
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
    ];
  };

  const getStocksByWarehouse = (warehouseId: string) =>
    stocks.value.filter(s => s.warehouseId === warehouseId);

  const getStocksByProduct = (productCode: string) =>
    stocks.value.filter(s => s.productCode === productCode);

  const getStock = (warehouseId: string, productCode: string) =>
    stocks.value.find(s => s.warehouseId === warehouseId && s.productCode === productCode);

  const getTotalStock = (productCode: string, warehouseIds?: string[]) =>
    stocks.value
      .filter(s => s.productCode === productCode && (!warehouseIds || warehouseIds.includes(s.warehouseId)))
      .reduce((sum, s) => sum + s.stock, 0);

  const getTotalInTransitStock = (productCode: string, warehouseIds?: string[]) =>
    stocks.value
      .filter(s => s.productCode === productCode && (!warehouseIds || warehouseIds.includes(s.warehouseId)))
      .reduce((sum, s) => sum + s.inTransitStock, 0);

  const getAvailableStock = (productCode: string) =>
    getAvailableStockByWarehouses(productCode);

  const getAvailableStockByWarehouses = (productCode: string, warehouseIds?: string[]) =>
    stocks.value
      .filter(s => s.productCode === productCode && (!warehouseIds?.length || warehouseIds.includes(s.warehouseId)))
      .reduce((sum, s) => sum + s.stock + s.inTransitStock, 0);

  const upsertStock = (
    warehouseId: string,
    productCode: string,
    stock: number,
    inTransitStock: number = 0,
    fields?: Record<string, any>,
  ) => {
    const index = stocks.value.findIndex(
      s => s.warehouseId === warehouseId && s.productCode === productCode,
    );
    if (index !== -1) {
      const next = stocks.value.slice();
      const cur = next[index];
      next[index] = {
        ...cur,
        stock,
        inTransitStock,
        customFields: fields !== undefined ? fields : cur.customFields,
      };
      stocks.value = next;
    } else {
      stocks.value = [
        ...stocks.value,
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          warehouseId,
          productCode,
          stock,
          inTransitStock,
          customFields: fields,
        },
      ];
    }
  };

  const deleteStock = (id: string) => {
    stocks.value = stocks.value.filter(s => s.id !== id);
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

  /**
   * 安全导入：
   * 1) 有旧数据则先写 IDB「导入前备份」
   * 2) 仅在内存拼装新表，不碰 stocks
   * 3) 先把新表写入 IDB 并校验行数
   * 4) 成功后再替换内存；失败则保持旧内存，并可从备份恢复
   */
  const importStocks = async (
    data: ImportWarehouseStockData[],
    replaceAll: boolean = false,
    description: string = '',
    weekStart?: string,
    onProgress?: (done: number, total: number, phase: string) => void,
  ): Promise<ImportStocksResult> => {
    const snapshotStore = useStockSnapshotStore();
    const week = weekStart || weekStartSaturday();
    const knownFields = [
      'warehouseCode',
      'warehouseName',
      'productCode',
      'productName',
      'stock',
      'inTransitStock',
    ];

    importing.value = true;
    let preImportBackedUp = false;
    let backupRowCount = stocks.value.length;

    try {
      // —— 1. 导入前强制备份（保护现有数据）——
      if (stocks.value.length > 0) {
        onProgress?.(0, data.length, '安全备份');
        try {
          const meta = await savePreImportBackup(
            { stocks: stocks.value, customFields: customFields.value },
            description || `${replaceAll ? '全量替换' : '增量导入'}前 · ${week}`,
          );
          preImportBackedUp = true;
          backupRowCount = meta.rowCount;
        } catch (e) {
          throw new Error(
            e instanceof Error
              ? e.message
              : '导入前备份失败，已中止导入，原库存未改动',
          );
        }
        await yieldToMain();
      }

      const snapshotSkipped =
        data.length >= SKIP_SNAPSHOT_ROWS || stocks.value.length >= SKIP_SNAPSHOT_ROWS;
      if (!snapshotSkipped && stocks.value.length > 0) {
        try {
          snapshotStore.createSnapshot(
            stocks.value,
            description || `${replaceAll ? '全量替换' : '增量导入'}前自动备份 · ${week}`,
            week,
          );
          await yieldToMain();
        } catch (e) {
          console.warn('历史快照写入跳过（已有安全备份）', e);
        }
      }

      // —— 2. 内存拼装（不改 stocks.value）——
      const { resolveWh } = buildWarehouseMaps();
      const byKey = new Map<string, WarehouseStock>();
      if (!replaceAll) {
        onProgress?.(0, data.length, '准备');
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
          if (prev) {
            if (
              prev.stock !== stock ||
              prev.inTransitStock !== inTransit ||
              customFieldsData
            ) {
              byKey.set(key, {
                ...prev,
                stock,
                inTransitStock: inTransit,
                customFields: customFieldsData || prev.customFields,
              });
            }
          } else {
            idSeq += 1;
            byKey.set(key, {
              id: `${idSeq}_${imported}`,
              warehouseId: warehouse.id,
              productCode,
              stock,
              inTransitStock: inTransit,
              customFields: customFieldsData,
            });
          }
          imported += 1;
        }
        onProgress?.(end, data.length, '整理');
        await yieldToMain();
      }

      const nextStocks = Array.from(byKey.values());
      const nextPayload = {
        stocks: nextStocks,
        customFields: nextCustom,
      };

      // —— 3. 先落盘新数据并校验（失败则内存仍是旧数据）——
      onProgress?.(data.length, data.length, '安全写入');
      try {
        await saveStockPersist(nextPayload);
      } catch (e) {
        throw new Error(
          (e instanceof Error ? e.message : '写入失败') +
            '。原库存未改动' +
            (preImportBackedUp ? '，可从「恢复导入前备份」找回。' : '。'),
        );
      }

      // —— 4. 落盘成功后再换内存 ——
      onProgress?.(data.length, data.length, '刷新界面');
      stocks.value = nextStocks;
      customFields.value = nextCustom;

      return {
        imported,
        skippedWarehouse,
        skippedNoCode,
        negativeRows,
        total: data.length,
        snapshotSkipped,
        preImportBackedUp,
        backupRowCount,
      };
    } finally {
      importing.value = false;
    }
  };

  const restoreFromSnapshot = (snapshot: StockSnapshot) => {
    stocks.value = JSON.parse(JSON.stringify(snapshot.stocks));
  };

  /** 从导入前安全备份恢复（防数据卡没） */
  const restoreFromPreImportBackup = async () => {
    const bak = await loadPreImportBackup();
    if (!bak) throw new Error('没有可用的导入前备份');
    const stocksArr = bak.payload.stocks as WarehouseStock[];
    const fieldsArr = (bak.payload.customFields || []) as CustomFieldConfig[];
    await saveStockPersist({ stocks: stocksArr, customFields: fieldsArr });
    stocks.value = stocksArr.map(s => ({
      ...s,
      stock: Number(s.stock) || 0,
      inTransitStock: Number(s.inTransitStock) || 0,
    }));
    customFields.value = fieldsArr;
    return bak.meta;
  };

  return {
    stocks,
    customFields,
    hydrated,
    importing,
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
    upsertStock,
    deleteStock,
    setCustomFields,
    addCustomField,
    updateCustomField,
    removeCustomField,
    importStocks,
    restoreFromSnapshot,
    restoreFromPreImportBackup,
  };
});
