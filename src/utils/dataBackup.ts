/** 业务数据 localStorage 键（与 pinia persist store id 一致） */
export const DATA_STORE_KEYS = [
  'company',
  'warehouse',
  'channel',
  'product',
  'warehouseStock',
  'requisition',
  'stockSnapshot',
] as const;

export type AppDataBackup = {
  version: 1;
  exportedAt: string;
  origin: string;
  stores: Record<string, unknown>;
};

export function exportAppData(): AppDataBackup {
  const stores: Record<string, unknown> = {};
  DATA_STORE_KEYS.forEach(key => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      stores[key] = JSON.parse(raw);
    } catch {
      stores[key] = raw;
    }
  });
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    origin: typeof location !== 'undefined' ? location.origin : '',
    stores,
  };
}

export function downloadAppDataBackup() {
  const data = exportAppData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `渠道要货数据备份_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return Object.keys(data.stores).length;
}

export function importAppDataBackup(payload: unknown): { ok: true; keys: string[] } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '备份文件格式不正确' };
  }
  const data = payload as Partial<AppDataBackup>;
  if (!data.stores || typeof data.stores !== 'object') {
    return { ok: false, message: '备份文件缺少 stores 数据' };
  }
  const keys: string[] = [];
  // 先清空全部业务键，避免旧数据残留与备份混在一起
  DATA_STORE_KEYS.forEach(key => localStorage.removeItem(key));
  DATA_STORE_KEYS.forEach(key => {
    if (key in data.stores!) {
      localStorage.setItem(key, JSON.stringify(data.stores![key]));
      keys.push(key);
    }
  });
  if (!keys.length) return { ok: false, message: '备份中没有可恢复的业务数据' };
  return { ok: true, keys };
}

/** 是否已有持久化数据（防止初始化种子覆盖用户数据） */
export function hasAnyPersistedBusinessData(): boolean {
  return DATA_STORE_KEYS.some(key => {
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

