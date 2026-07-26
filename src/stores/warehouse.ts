import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Warehouse } from '../types';

export const useWarehouseStore = defineStore('warehouse', () => {
  const warehouses = ref<Warehouse[]>([]);

  const initWarehouses = () => {
    if (warehouses.value.length > 0) return;
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
    warehouses.value.push({ ...warehouse, id: Date.now().toString() });
  };

  const updateWarehouse = (id: string, warehouse: Partial<Warehouse>) => {
    const index = warehouses.value.findIndex(w => w.id === id);
    if (index !== -1) {
      warehouses.value[index] = { ...warehouses.value[index], ...warehouse };
    }
  };

  const deleteWarehouse = (id: string) => {
    const index = warehouses.value.findIndex(w => w.id === id);
    if (index !== -1) warehouses.value.splice(index, 1);
  };

  const getWarehouseById = (id: string) => warehouses.value.find(w => w.id === id);

  const getWarehouseByCode = (code: string) => warehouses.value.find(w => w.code === code);

  const getWarehousesByIds = (ids: string[]) =>
    warehouses.value.filter(w => ids.includes(w.id));

  const getWarehousesByCompany = (companyId: string) =>
    warehouses.value.filter(w => w.companyId === companyId);

  const upsertByCode = (data: Omit<Warehouse, 'id'>) => {
    const existing = getWarehouseByCode(data.code);
    if (existing) {
      updateWarehouse(existing.id, data);
      return existing.id;
    }
    addWarehouse(data);
    return warehouses.value[warehouses.value.length - 1]?.id;
  };

  return {
    warehouses,
    initWarehouses,
    addWarehouse,
    updateWarehouse,
    deleteWarehouse,
    getWarehouseById,
    getWarehouseByCode,
    getWarehousesByIds,
    getWarehousesByCompany,
    upsertByCode,
  };
}, { persist: true });
