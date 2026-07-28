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

export const useWarehouseStockStore = defineStore('warehouseStock', () => {
  const stocks = ref<WarehouseStock[]>([]);
  const customFields = ref<CustomFieldConfig[]>([]);

  const initStocks = () => {
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
      stocks.value[index].stock = stock;
      stocks.value[index].inTransitStock = inTransitStock;
      if (fields) stocks.value[index].customFields = fields;
    } else {
      stocks.value.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
        warehouseId,
        productCode,
        stock,
        inTransitStock,
        customFields: fields,
      });
    }
  };

  const deleteStock = (id: string) => {
    const index = stocks.value.findIndex(s => s.id === id);
    if (index !== -1) stocks.value.splice(index, 1);
  };

  const setCustomFields = (fields: CustomFieldConfig[]) => {
    customFields.value = fields;
  };

  const addCustomField = (field: Omit<CustomFieldConfig, 'key'>) => {
    const key = field.label.replace(/\s+/g, '_').toLowerCase();
    if (!customFields.value.find(f => f.key === key)) {
      customFields.value.push({ key, ...field });
    }
  };

  const updateCustomField = (key: string, field: Partial<CustomFieldConfig>) => {
    const index = customFields.value.findIndex(f => f.key === key);
    if (index !== -1) {
      customFields.value[index] = { ...customFields.value[index], ...field };
    }
  };

  const removeCustomField = (key: string) => {
    const index = customFields.value.findIndex(f => f.key === key);
    if (index !== -1) customFields.value.splice(index, 1);
  };

  /**
   * 导入库存。无万里牛对接时，建议每周「全量替换」一次。
   * 导入前自动快照，便于回滚与周对比。
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
      snapshotStore.createSnapshot(
        stocks.value,
        description || `${replaceAll ? '全量替换' : '增量导入'}前自动备份 · ${week}`,
        week,
      );
    }

    if (replaceAll) stocks.value = [];

    const knownFields = ['warehouseCode', 'productCode', 'productName', 'stock', 'inTransitStock'];
    if (data.length > 0) {
      const firstItem = data[0];
      for (const key in firstItem) {
        if (!knownFields.includes(key) && !customFields.value.find(f => f.key === key)) {
          const value = firstItem[key];
          let type: 'text' | 'number' | 'date' = 'text';
          if (typeof value === 'number') type = 'number';
          else if (typeof value === 'string' && !isNaN(Date.parse(value))) type = 'date';
          customFields.value.push({ key, label: key, type });
        }
      }
    }

    let imported = 0;
    let skippedWarehouse = 0;
    let skippedNoCode = 0;
    let negativeRows = 0;
    data.forEach(item => {
      if (!item.warehouseCode || !item.productCode) {
        skippedNoCode += 1;
        return;
      }
      const warehouse = warehouseStore.warehouses.find(w => w.code === item.warehouseCode);
      if (!warehouse) {
        skippedWarehouse += 1;
        return;
      }
      const stock = Number(item.stock) || 0;
      const inTransit = Number(item.inTransitStock) || 0;
      if (stock < 0 || inTransit < 0) negativeRows += 1;
      const customFieldsData: Record<string, any> = {};
      for (const key in item) {
        if (!knownFields.includes(key)) customFieldsData[key] = item[key];
      }
      upsertStock(
        warehouse.id,
        item.productCode,
        stock,
        inTransit,
        Object.keys(customFieldsData).length > 0 ? customFieldsData : undefined,
      );
      imported += 1;
    });
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
