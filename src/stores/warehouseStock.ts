import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { WarehouseStock, ImportWarehouseStockData, CustomFieldConfig } from '../types';
import { useWarehouseStore } from './warehouse';

export const useWarehouseStockStore = defineStore('warehouseStock', () => {
  const stocks = ref<WarehouseStock[]>([]);
  
  // 自定义字段配置
  const customFields = ref<CustomFieldConfig[]>([]);

  // 模拟初始数据
  const initStocks = () => {
    stocks.value = [
      { id: '1', warehouseId: 'W001', productCode: 'P001', stock: 200, inTransitStock: 50 },
      { id: '2', warehouseId: 'W001', productCode: 'P002', stock: 50, inTransitStock: 100 },
      { id: '3', warehouseId: 'W002', productCode: 'P001', stock: 150, inTransitStock: 0 },
      { id: '4', warehouseId: 'W002', productCode: 'P003', stock: 80, inTransitStock: 20 },
      { id: '5', warehouseId: 'W003', productCode: 'P001', stock: 150, inTransitStock: 30 },
      { id: '6', warehouseId: 'W003', productCode: 'P004', stock: 10, inTransitStock: 0 },
      { id: '7', warehouseId: 'W004', productCode: 'P001', stock: 0, inTransitStock: 80 },
      { id: '8', warehouseId: 'W004', productCode: 'P005', stock: 200, inTransitStock: 40 },
    ];
  };

  // 获取指定仓库的库存
  const getStocksByWarehouse = (warehouseId: string) => {
    return stocks.value.filter(s => s.warehouseId === warehouseId);
  };

  // 获取指定商品在各仓库的库存
  const getStocksByProduct = (productCode: string) => {
    return stocks.value.filter(s => s.productCode === productCode);
  };

  // 获取指定仓库指定商品的库存
  const getStock = (warehouseId: string, productCode: string) => {
    return stocks.value.find(s => s.warehouseId === warehouseId && s.productCode === productCode);
  };

  // 获取指定商品的总库存
  const getTotalStock = (productCode: string) => {
    return stocks.value
      .filter(s => s.productCode === productCode)
      .reduce((sum, s) => sum + s.stock, 0);
  };

  // 获取指定商品的总在途库存
  const getTotalInTransitStock = (productCode: string) => {
    return stocks.value
      .filter(s => s.productCode === productCode)
      .reduce((sum, s) => sum + s.inTransitStock, 0);
  };

  // 获取指定商品的可用库存（当前库存 + 在途库存）
  const getAvailableStock = (productCode: string) => {
    return stocks.value
      .filter(s => s.productCode === productCode)
      .reduce((sum, s) => sum + s.stock + s.inTransitStock, 0);
  };

  // 添加/更新库存
  const upsertStock = (warehouseId: string, productCode: string, stock: number, inTransitStock: number = 0, customFields?: Record<string, any>) => {
    const index = stocks.value.findIndex(s => s.warehouseId === warehouseId && s.productCode === productCode);
    if (index !== -1) {
      stocks.value[index].stock = stock;
      stocks.value[index].inTransitStock = inTransitStock;
      if (customFields) {
        stocks.value[index].customFields = customFields;
      }
    } else {
      stocks.value.push({
        id: Date.now().toString(),
        warehouseId,
        productCode,
        stock,
        inTransitStock,
        customFields,
      });
    }
  };

  // 删除库存记录
  const deleteStock = (id: string) => {
    const index = stocks.value.findIndex(s => s.id === id);
    if (index !== -1) {
      stocks.value.splice(index, 1);
    }
  };

  // 设置自定义字段配置
  const setCustomFields = (fields: CustomFieldConfig[]) => {
    customFields.value = fields;
  };

  // 导入库存数据（支持自定义字段）
  const importStocks = (data: ImportWarehouseStockData[]) => {
    const warehouseStore = useWarehouseStore();
    
    // 识别自定义字段（排除已知字段）
    const knownFields = ['warehouseCode', 'productCode', 'productName', 'stock', 'inTransitStock'];
    const detectedCustomFields: CustomFieldConfig[] = [];
    
    if (data.length > 0) {
      const firstItem = data[0];
      for (const key in firstItem) {
        if (!knownFields.includes(key)) {
          // 根据值的类型推断字段类型
          let type: 'text' | 'number' | 'date' = 'text';
          const value = firstItem[key];
          if (typeof value === 'number') {
            type = 'number';
          } else if (typeof value === 'string' && !isNaN(Date.parse(value))) {
            type = 'date';
          }
          detectedCustomFields.push({ key, label: key, type });
        }
      }
    }
    
    // 更新自定义字段配置
    if (detectedCustomFields.length > 0) {
      // 合并新字段，不覆盖已有的配置
      detectedCustomFields.forEach(newField => {
        const existing = customFields.value.find(f => f.key === newField.key);
        if (!existing) {
          customFields.value.push(newField);
        }
      });
    }
    
    // 导入数据
    data.forEach(item => {
      // 通过仓库编码查找仓库ID
      const warehouse = warehouseStore.warehouses.find(w => w.code === item.warehouseCode);
      if (warehouse) {
        // 提取自定义字段
        const customFieldsData: Record<string, any> = {};
        for (const key in item) {
          if (!knownFields.includes(key)) {
            customFieldsData[key] = item[key];
          }
        }
        
        upsertStock(warehouse.id, item.productCode, item.stock, item.inTransitStock || 0, Object.keys(customFieldsData).length > 0 ? customFieldsData : undefined);
      }
    });
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
    upsertStock,
    deleteStock,
    setCustomFields,
    importStocks,
  };
});