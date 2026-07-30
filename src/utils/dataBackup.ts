import { clearStockIdb, loadSnapshotPersist, loadStockPersist, saveSnapshotPersist, saveStockPersist } from './stockPersist';

/** 业务数据键：小表仍在 localStorage；库存/快照在 IndexedDB */
export const DATA_STORE_KEYS = [
  'company',
  'warehouse',
  'channel',
  'product',
  'warehouseStock',
  'requisition',
  'stockSnapshot',
] as const;

export const LOCAL_STORE_KEYS = [
  'company',
  'warehouse',
  'channel',
  'product',
  'requisition',
] as const;

export type AppDataBackup = {
  version: 1;
  exportedAt: string;
  origin: string;
  stores: Record<string, unknown>;
};

export async function exportAppData(): Promise<AppDataBackup> {
  const stores: Record<string, unknown> = {};
  LOCAL_STORE_KEYS.forEach(key => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      stores[key] = JSON.parse(raw);
    } catch {
      stores[key] = raw;
    }
  });
  const stock = await loadStockPersist();
  if (stock) stores.warehouseStock = stock;
  const snap = await loadSnapshotPersist();
  if (snap) stores.stockSnapshot = snap;

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    origin: typeof location !== 'undefined' ? location.origin : '',
    stores,
  };
}

export async function downloadAppDataBackup() {
  const data = await exportAppData();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `渠道要货数据备份_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return Object.keys(data.stores).length;
}

export async function importAppDataBackup(
  payload: unknown,
): Promise<{ ok: true; keys: string[] } | { ok: false; message: string }> {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '备份文件格式不正确' };
  }
  const data = payload as Partial<AppDataBackup>;
  if (!data.stores || typeof data.stores !== 'object') {
    return { ok: false, message: '备份文件缺少 stores 数据' };
  }
  const keys: string[] = [];
  LOCAL_STORE_KEYS.forEach(key => localStorage.removeItem(key));
  localStorage.removeItem('warehouseStock');
  localStorage.removeItem('stockSnapshot');
  await clearStockIdb();

  for (const key of LOCAL_STORE_KEYS) {
    if (key in data.stores!) {
      localStorage.setItem(key, JSON.stringify(data.stores![key]));
      keys.push(key);
    }
  }
  if (data.stores.warehouseStock) {
    const raw = data.stores.warehouseStock as { stocks?: unknown[]; customFields?: unknown[] };
    await saveStockPersist({
      stocks: Array.isArray(raw.stocks) ? raw.stocks : Array.isArray(raw) ? (raw as unknown[]) : [],
      customFields: Array.isArray(raw.customFields) ? raw.customFields : [],
    });
    keys.push('warehouseStock');
  }
  if (data.stores.stockSnapshot) {
    const raw = data.stores.stockSnapshot as { snapshots?: unknown[] };
    await saveSnapshotPersist({
      snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
    });
    keys.push('stockSnapshot');
  }

  if (!keys.length) return { ok: false, message: '备份中没有可恢复的业务数据' };
  return { ok: true, keys };
}

/** 是否已有持久化数据（防止初始化种子覆盖用户数据） */
export function hasAnyPersistedBusinessData(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
  } catch {
    return false;
  }
  return DATA_STORE_KEYS.some(key => {
    if (key === 'warehouseStock' || key === 'stockSnapshot') return false;
    const raw = localStorage.getItem(key);
    if (!raw || raw === 'null' || raw === '{}' || raw === '[]') return false;
    try {
      return hasMeaningfulPayload(JSON.parse(raw));
    } catch {
      return raw.length > 2;
    }
  });
}

function hasMeaningfulPayload(parsed: unknown): boolean {
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (parsed && typeof parsed === 'object') {
    return Object.values(parsed as Record<string, unknown>).some(hasMeaningfulPayload);
  }
  return false;
}
