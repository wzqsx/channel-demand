/**
 * 库存 / 快照大表持久化到 IndexedDB。
 * 从 localStorage 自动迁移一次，避免 9 万行撑爆配额。
 */
import { idbDel, idbGet, idbSet } from './idbKv';

export const STOCK_IDB_KEY = 'warehouseStock';
export const SNAPSHOT_IDB_KEY = 'stockSnapshot';
const MIGRATED_FLAG = 'channel-demand:stock-idb-migrated';

export type StockPersistPayload = {
  stocks: unknown[];
  customFields: unknown[];
};

export type SnapshotPersistPayload = {
  snapshots: unknown[];
};

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 把旧 localStorage 库存/快照迁到 IDB，并删掉 LS 大键 */
export async function migrateStockStoresToIdb(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(MIGRATED_FLAG) === '1') {
    // 仍清理可能残留的大键
    localStorage.removeItem('warehouseStock');
    localStorage.removeItem('stockSnapshot');
    return;
  }

  const stockRaw = localStorage.getItem('warehouseStock');
  if (stockRaw && stockRaw.length > 2) {
    const existing = await idbGet(STOCK_IDB_KEY);
    if (!existing) await idbSet(STOCK_IDB_KEY, stockRaw);
    localStorage.removeItem('warehouseStock');
  }

  const snapRaw = localStorage.getItem('stockSnapshot');
  if (snapRaw && snapRaw.length > 2) {
    const existing = await idbGet(SNAPSHOT_IDB_KEY);
    if (!existing) await idbSet(SNAPSHOT_IDB_KEY, snapRaw);
    localStorage.removeItem('stockSnapshot');
  }

  localStorage.setItem(MIGRATED_FLAG, '1');
}

export async function loadStockPersist(): Promise<StockPersistPayload | null> {
  const raw = await idbGet(STOCK_IDB_KEY);
  const parsed = parseJson<Record<string, unknown>>(raw);
  if (!parsed) return null;
  // pinia persist 形状：{ stocks, customFields } 或整包
  const stocks = (parsed.stocks as unknown[]) || [];
  const customFields = (parsed.customFields as unknown[]) || [];
  if (!Array.isArray(stocks)) return null;
  return { stocks, customFields: Array.isArray(customFields) ? customFields : [] };
}

export async function saveStockPersist(payload: StockPersistPayload): Promise<void> {
  await idbSet(STOCK_IDB_KEY, JSON.stringify(payload));
}

export async function loadSnapshotPersist(): Promise<SnapshotPersistPayload | null> {
  const raw = await idbGet(SNAPSHOT_IDB_KEY);
  const parsed = parseJson<Record<string, unknown>>(raw);
  if (!parsed) return null;
  const snapshots = (parsed.snapshots as unknown[]) || [];
  if (!Array.isArray(snapshots)) return null;
  return { snapshots };
}

export async function saveSnapshotPersist(payload: SnapshotPersistPayload): Promise<void> {
  await idbSet(SNAPSHOT_IDB_KEY, JSON.stringify(payload));
}

export async function clearStockIdb(): Promise<void> {
  await idbDel(STOCK_IDB_KEY);
  await idbDel(SNAPSHOT_IDB_KEY);
}
