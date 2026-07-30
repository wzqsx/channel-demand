import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { StockSnapshot, WarehouseStock } from '../types';
import { loadSnapshotPersist, saveSnapshotPersist } from '../utils/stockPersist';

/** 快照含整表；IDB 下仍限制份数，避免磁盘暴涨 */
const MAX_SNAPSHOTS = 2;
/** 单份快照超过此行数则不落盘（仅内存提示用） */
const MAX_SNAPSHOT_ROWS = 30000;

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
  const hydrated = ref(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleSave = () => {
    if (!hydrated.value) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveSnapshotPersist({ snapshots: snapshots.value }).catch(e =>
        console.error('快照写入 IndexedDB 失败', e),
      );
    }, 400);
  };

  const hydrateFromIdb = async () => {
    const data = await loadSnapshotPersist();
    if (data?.snapshots) {
      snapshots.value = data.snapshots as StockSnapshot[];
    }
    if (snapshots.value.length > MAX_SNAPSHOTS) {
      snapshots.value = snapshots.value.slice(0, MAX_SNAPSHOTS);
    }
    hydrated.value = true;
  };

  watch(snapshots, () => scheduleSave(), { deep: false });

  const createSnapshot = (
    stocks: WarehouseStock[],
    description: string = '',
    weekStart?: string,
  ) => {
    if (stocks.length > MAX_SNAPSHOT_ROWS) {
      console.warn(`库存 ${stocks.length} 行，跳过整表快照落盘`);
      return null;
    }
    const snapshot: StockSnapshot = {
      id: Date.now().toString(),
      snapshotTime: new Date().toISOString(),
      description: description || `库存备份 ${new Date().toLocaleString('zh-CN')}`,
      weekStart,
      stocks: cloneStocks(stocks),
    };
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

  const compactIfNeeded = () => {
    if (snapshots.value.length > MAX_SNAPSHOTS) {
      snapshots.value = snapshots.value.slice(0, MAX_SNAPSHOTS);
    }
  };

  return {
    snapshots,
    hydrated,
    hydrateFromIdb,
    createSnapshot,
    getAllSnapshots,
    getSnapshotById,
    deleteSnapshot,
    getStockHistory,
    compactIfNeeded,
  };
});
