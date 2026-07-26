import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { StockSnapshot, WarehouseStock } from '../types';

export const useStockSnapshotStore = defineStore('stockSnapshot', () => {
  const snapshots = ref<StockSnapshot[]>([]);

  const createSnapshot = (
    stocks: WarehouseStock[],
    description: string = '',
    weekStart?: string,
  ) => {
    const snapshot: StockSnapshot = {
      id: Date.now().toString(),
      snapshotTime: new Date().toISOString(),
      description: description || `库存备份 ${new Date().toLocaleString('zh-CN')}`,
      weekStart,
      stocks: JSON.parse(JSON.stringify(stocks)),
    };
    snapshots.value.unshift(snapshot);
    return snapshot;
  };

  const getAllSnapshots = () => snapshots.value;

  const getSnapshotById = (id: string) => snapshots.value.find(s => s.id === id);

  const deleteSnapshot = (id: string) => {
    const index = snapshots.value.findIndex(s => s.id === id);
    if (index !== -1) snapshots.value.splice(index, 1);
  };

  const getStockHistory = (productCode: string) => {
    const history: { snapshotTime: string; description: string; stock: number }[] = [];
    snapshots.value.forEach(snapshot => {
      const totalStock = snapshot.stocks
        .filter(s => s.productCode === productCode)
        .reduce((sum, s) => sum + s.stock, 0);
      history.push({
        snapshotTime: snapshot.snapshotTime,
        description: snapshot.description,
        stock: totalStock,
      });
    });
    return history;
  };

  return {
    snapshots,
    createSnapshot,
    getAllSnapshots,
    getSnapshotById,
    deleteSnapshot,
    getStockHistory,
  };
}, { persist: true });
