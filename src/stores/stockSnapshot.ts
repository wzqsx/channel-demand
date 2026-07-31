import { defineStore } from 'pinia';
import { markRaw, ref, shallowRef, watch } from 'vue';
import type { StockSnapshot, WarehouseStock } from '../types';
import { loadSnapshotPersist, saveSnapshotPersist } from '../utils/stockPersist';
import { LARGE_STOCK_HARD } from '../utils/largeScale';

/** 快照含整表；IDB 下仍限制份数，避免磁盘暴涨 */
const MAX_SNAPSHOTS = 2;

function cloneStocksRaw(stocks: WarehouseStock[]): WarehouseStock[] {
  const out: WarehouseStock[] = new Array(stocks.length);
  for (let i = 0; i < stocks.length; i++) {
    const s = stocks[i];
    out[i] = markRaw({
      id: s.id,
      warehouseId: s.warehouseId,
      productCode: s.productCode,
      stock: Number(s.stock) || 0,
      inTransitStock: Number(s.inTransitStock) || 0,
      customFields: s.customFields,
    });
  }
  return out;
}

function sumStock(stocks: WarehouseStock[]) {
  let n = 0;
  for (let i = 0; i < stocks.length; i++) n += stocks[i].stock;
  return n;
}

export const useStockSnapshotStore = defineStore('stockSnapshot', () => {
  /** shallow：禁止把几万行快照明细做成深层响应 */
  const snapshots = shallowRef<StockSnapshot[]>([]);
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
      snapshots.value = (data.snapshots as StockSnapshot[]).map(s =>
        markRaw({
          ...s,
          stocks: (s.stocks || []).map(row => markRaw({ ...row })),
          totalQty: s.totalQty ?? sumStock(s.stocks || []),
        }),
      );
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
    if (stocks.length > LARGE_STOCK_HARD) {
      console.warn(`库存 ${stocks.length} 行，跳过整表快照落盘`);
      return null;
    }
    const cloned = cloneStocksRaw(stocks);
    const snapshot = markRaw({
      id: Date.now().toString(),
      snapshotTime: new Date().toISOString(),
      description: description || `库存备份 ${new Date().toLocaleString('zh-CN')}`,
      weekStart,
      stocks: cloned,
      totalQty: sumStock(cloned),
    }) as StockSnapshot;
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
      let totalStock = 0;
      const list = snapshot.stocks;
      for (let i = 0; i < list.length; i++) {
        if (list[i].productCode === productCode) totalStock += list[i].stock;
      }
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
