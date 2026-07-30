import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { StockSnapshot, WarehouseStock } from '../types';

/** 本地快照含整表库存，过多会撑爆 localStorage 导致导入卡死 */
const MAX_SNAPSHOTS = 3;

function cloneStocks(stocks: WarehouseStock[]): WarehouseStock[] {
  try {
    if (typeof structuredClone === 'function') return structuredClone(stocks);
  } catch {
    /* fall through */
  }
  return JSON.parse(JSON.stringify(stocks));
}

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
      stocks: cloneStocks(stocks),
    };
    // 先截断再写入，降低一次 persist 体积
    snapshots.value = [snapshot, ...snapshots.value.slice(0, MAX_SNAPSHOTS - 1)];
    return snapshot;
  };

  const getAllSnapshots = () => snapshots.value;

  const getSnapshotById = (id: string) => snapshots.value.find(s => s.id === id);

  const deleteSnapshot = (id: string) => {
    snapshots.value = snapshots.value.filter(s => s.id !== id);
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

  /** 启动时裁剪历史过大快照，避免旧数据继续拖慢写入 */
  const compactIfNeeded = () => {
    if (snapshots.value.length > MAX_SNAPSHOTS) {
      snapshots.value = snapshots.value.slice(0, MAX_SNAPSHOTS);
    }
  };

  return {
    snapshots,
    createSnapshot,
    getAllSnapshots,
    getSnapshotById,
    deleteSnapshot,
    getStockHistory,
    compactIfNeeded,
  };
}, { persist: true });
