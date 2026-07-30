/**
 * 库存 / 快照大表持久化到 IndexedDB。
 * 导入前强制备份，写入成功后再替换，避免大表导入把数据卡没。
 */
import { idbDel, idbGet, idbSet } from './idbKv';

export const STOCK_IDB_KEY = 'warehouseStock';
export const STOCK_BACKUP_KEY = 'warehouseStock:preImport';
export const STOCK_BACKUP_META_KEY = 'warehouseStock:preImport:meta';
export const SNAPSHOT_IDB_KEY = 'stockSnapshot';
const MIGRATED_FLAG = 'channel-demand:stock-idb-migrated';

export type StockPersistPayload = {
  stocks: unknown[];
  customFields: unknown[];
};

export type SnapshotPersistPayload = {
  snapshots: unknown[];
};

export type StockBackupMeta = {
  at: string;
  rowCount: number;
  reason: string;
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
  const stocks = (parsed.stocks as unknown[]) || [];
  const customFields = (parsed.customFields as unknown[]) || [];
  if (!Array.isArray(stocks)) return null;
  return { stocks, customFields: Array.isArray(customFields) ? customFields : [] };
}

export async function saveStockPersist(payload: StockPersistPayload): Promise<void> {
  const text = JSON.stringify(payload);
  await idbSet(STOCK_IDB_KEY, text);
  // 回读校验，防止「写了但坏了」
  const check = await idbGet(STOCK_IDB_KEY);
  if (!check || check.length < 2) {
    throw new Error('库存写入后校验失败，未覆盖旧数据');
  }
  const parsed = parseJson<StockPersistPayload>(check);
  if (!parsed || !Array.isArray(parsed.stocks)) {
    throw new Error('库存写入后解析失败，未覆盖旧数据');
  }
  if (parsed.stocks.length !== payload.stocks.length) {
    throw new Error(
      `库存写入行数不一致（期望 ${payload.stocks.length}，实际 ${parsed.stocks.length}）`,
    );
  }
}

/**
 * 导入前备份：优先直接复制 IDB 原文（快、省内存），否则序列化内存数据。
 * 有旧数据时若备份失败应中止导入。
 */
export async function savePreImportBackup(
  payload: StockPersistPayload,
  reason: string,
): Promise<StockBackupMeta> {
  const meta: StockBackupMeta = {
    at: new Date().toISOString(),
    rowCount: payload.stocks.length,
    reason,
  };
  const existingRaw = await idbGet(STOCK_IDB_KEY);
  if (existingRaw && existingRaw.length > 2) {
    await idbSet(STOCK_BACKUP_KEY, existingRaw);
  } else {
    await idbSet(STOCK_BACKUP_KEY, JSON.stringify(payload));
  }
  await idbSet(STOCK_BACKUP_META_KEY, JSON.stringify(meta));
  const check = await idbGet(STOCK_BACKUP_KEY);
  if (!check || check.length < 2) {
    throw new Error('导入前备份失败，已中止导入以保护现有库存');
  }
  return meta;
}

export async function loadPreImportBackup(): Promise<{
  payload: StockPersistPayload;
  meta: StockBackupMeta | null;
} | null> {
  const raw = await idbGet(STOCK_BACKUP_KEY);
  const payload = parseJson<StockPersistPayload>(raw);
  if (!payload || !Array.isArray(payload.stocks)) return null;
  const meta = parseJson<StockBackupMeta>(await idbGet(STOCK_BACKUP_META_KEY));
  return { payload, meta };
}

export async function hasPreImportBackup(): Promise<boolean> {
  const raw = await idbGet(STOCK_BACKUP_KEY);
  return !!(raw && raw.length > 2);
}

export async function clearPreImportBackup(): Promise<void> {
  await idbDel(STOCK_BACKUP_KEY);
  await idbDel(STOCK_BACKUP_META_KEY);
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
  await idbDel(STOCK_BACKUP_KEY);
  await idbDel(STOCK_BACKUP_META_KEY);
}
