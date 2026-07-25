import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Warehouse } from '../types';

export const useWarehouseStore = defineStore('warehouse', () => {
  const warehouses = ref<Warehouse[]>([]);

  // 模拟初始数据
  const initWarehouses = () => {
    warehouses.value = [
      { id: 'W001', name: 'A仓', code: 'A', companyId: 'COMP001' },
      { id: 'W002', name: 'B仓', code: 'B', companyId: 'COMP001' },
      { id: 'W003', name: 'C仓', code: 'C', companyId: 'COMP001' },
      { id: 'W004', name: 'D仓', code: 'D', companyId: 'COMP001' },
      { id: 'W005', name: 'E仓', code: 'E', companyId: 'COMP002' },
      { id: 'W006', name: 'F仓', code: 'F', companyId: 'COMP003' },
      { id: 'W007', name: 'G仓', code: 'G', companyId: 'COMP003' },
      { id: 'W008', name: 'H仓', code: 'H', companyId: 'COMP004' },
    ];
  };

  const addWarehouse = (warehouse: Omit<Warehouse, 'id'>) => {
    const newWarehouse: Warehouse = {
      ...warehouse,
      id: Date.now().toString(),
    };
    warehouses.value.push(newWarehouse);
  };

  const updateWarehouse = (id: string, warehouse: Partial<Warehouse>) => {
    const index = warehouses.value.findIndex(w => w.id === id);
    if (index !== -1) {
      warehouses.value[index] = { ...warehouses.value[index], ...warehouse };
    }
  };

  const deleteWarehouse = (id: string) => {
    const index = warehouses.value.findIndex(w => w.id === id);
    if (index !== -1) {
      warehouses.value.splice(index, 1);
    }
  };

  const getWarehouseById = (id: string) => {
    return warehouses.value.find(w => w.id === id);
  };

  const getWarehousesByIds = (ids: string[]) => {
    return warehouses.value.filter(w => ids.includes(w.id));
  };

  // 获取指定主体下的仓库列表
  const getWarehousesByCompany = (companyId: string) => {
    return warehouses.value.filter(w => w.companyId === companyId);
  };

  return {
    warehouses,
    initWarehouses,
    addWarehouse,
    updateWarehouse,
    deleteWarehouse,
    getWarehouseById,
    getWarehousesByIds,
    getWarehousesByCompany,
  };
});