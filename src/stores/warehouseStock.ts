import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  WarehouseStock,
  ImportWarehouseStockData,
  CustomFieldConfig,
  StockSnapshot,
} from '../types';
import { useWarehouseStore } from './warehouse';
import { useStockSnapshotStore } from './stockSnapshot';
import { weekStartSaturday } from '../utils/week';

const stockKey = (warehouseId: string, productCode: string) =>
  `${warehouseId}__${productCode}`;

export const useWarehouseStockStore = defineStore('warehouseStock', () => {
  const stocks = ref<WarehouseStock[]>([]);
  const customFields = ref<CustomFieldConfig[]>([]);

  const initStocks = () => {
    // 兼容旧本地数据：库存字段可能被存成字符串，导致「可用=库存+在途」变成拼接
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
      // 箱规编码库存：P0012 → P001 ×12，验瓶规要货时计入
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

  /** 全仓合计（兼容旧调用） */
  const getAvailableStock = (productCode: string) =>
    getAvailableStockByWarehouses(productCode);

  /** 按所选仓库汇总：库存 + 在途 */
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
      const cur = stocks.value[index];
      stocks.value[index] = {
        ...cur,
        stock,
        inTransitStock,
        customFields: fields !== undefined ? fields : cur.customFields,
      };
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

  /**
   * 导入库存。无万里牛对接时，建议每周「全量替换」一次。
   * 导入前自动快照；整表批量写入，避免逐行响应式卡死。
   */
  const importStocks = (
    data: ImportWarehouseStockData[],
    replaceAll: boolean = false,
    description: string = '',
    weekStart?: string,
  ) => {
    const warehouseStore = useWarehouseStore();
    const snapshotStore = useStockSnapshotStore();
    const week = weekStart || weekStartSaturday();

    if (stocks.value.length > 0) {
      try {
        snapshotStore.createSnapshot(
          stocks.value,
          description || `${replaceAll ? '全量替换' : '增量导入'}前自动备份 · ${week}`,
          week,
        );
      } catch (e) {
        console.warn('导入前快照失败（可能空间不足），继续导入', e);
      }
    }

    const knownFields = [
      'warehouseCode',
      'warehouseName',
      'productCode',
      'productName',
      'stock',
      'inTransitStock',
    ];

    // 仓库查找表：O(1)
    const norm = (s: string) => String(s || '').trim().toLowerCase();
    const whByCode = new Map<string, (typeof warehouseStore.warehouses)[0]>();
    const whByName = new Map<string, (typeof warehouseStore.warehouses)[0]>();
    for (const w of warehouseStore.warehouses) {
      const c = norm(w.code);
      const n = norm(w.name);
      if (c && !whByCode.has(c)) whByCode.set(c, w);
      if (n && !whByName.has(n)) whByName.set(n, w);
    }
    const resolveWh = (code?: string, name?: string) => {
      const a = norm(code || '');
      const b = norm(name || '');
      if (a) return whByCode.get(a) || whByName.get(a);
      if (b) return whByCode.get(b) || whByName.get(b);
      return undefined;
    };

    // 增量：以现有为底；全量：空表
    const byKey = new Map<string, WarehouseStock>();
    if (!replaceAll) {
      for (const s of stocks.value) {
        byKey.set(stockKey(s.warehouseId, s.productCode), { ...s });
      }
    }

    let nextCustom = [...customFields.value];
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

    for (const item of data) {
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

      const customFieldsData: Record<string, any> = {};
      for (const key in item) {
        if (!knownFields.includes(key)) customFieldsData[key] = item[key];
      }
      const hasCustom = Object.keys(customFieldsData).length > 0;
      const key = stockKey(warehouse.id, productCode);
      const prev = byKey.get(key);
      if (prev) {
        byKey.set(key, {
          ...prev,
          stock,
          inTransitStock: inTransit,
          customFields: hasCustom ? customFieldsData : prev.customFields,
        });
      } else {
        idSeq += 1;
        byKey.set(key, {
          id: `${idSeq}_${imported}`,
          warehouseId: warehouse.id,
          productCode,
          stock,
          inTransitStock: inTransit,
          customFields: hasCustom ? customFieldsData : undefined,
        });
      }
      imported += 1;
    }

    // 一次写入：只触发一次响应式 + 一次 persist
    stocks.value = Array.from(byKey.values());
    if (nextCustom.length !== customFields.value.length) {
      customFields.value = nextCustom;
    }

    return { imported, skippedWarehouse, skippedNoCode, negativeRows, total: data.length };
  };

  const restoreFromSnapshot = (snapshot: StockSnapshot) => {
    stocks.value = JSON.parse(JSON.stringify(snapshot.stocks));
  };

  return {
    stocks,
    customFields,
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
  };
}, { persist: true });
