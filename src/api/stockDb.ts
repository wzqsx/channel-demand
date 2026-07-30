/** 库存 SQLite 本地 API 客户端（服务未启动时返回 null，走浏览器兜底） */

const DEFAULT_BASE = '';

function baseUrl() {
  // 开发：走 Vite 代理 /api；也可设 VITE_STOCK_API
  return (import.meta.env.VITE_STOCK_API as string | undefined) || DEFAULT_BASE;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `HTTP ${res.status}`);
  }
  return data as T;
}

export type StockDbHealth = {
  ok: boolean;
  engine: string;
  dbPath: string;
  stockCount: number;
};

export async function stockDbHealth(): Promise<StockDbHealth | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const data = await request<StockDbHealth>('/api/health', { signal: ctrl.signal });
    clearTimeout(t);
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}

export async function stockDbLoad() {
  return request<{
    stocks: import('../types').WarehouseStock[];
    customFields: import('../types').CustomFieldConfig[];
  }>('/api/stocks');
}

export async function stockDbImport(body: {
  replaceAll: boolean;
  rows: Array<{
    id?: string;
    warehouseId: string;
    productCode: string;
    stock: number;
    inTransitStock: number;
    customFields?: Record<string, unknown>;
  }>;
  customFields?: import('../types').CustomFieldConfig[];
  reason?: string;
}) {
  return request<{
    imported: number;
    skippedNoCode: number;
    skippedWarehouse: number;
    negativeRows: number;
    total: number;
    preImportBackedUp: boolean;
    backupRowCount: number;
    snapshotSkipped: boolean;
    stockCount: number;
  }>('/api/stocks/import', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function stockDbUpsert(row: {
  id?: string;
  warehouseId: string;
  productCode: string;
  stock: number;
  inTransitStock: number;
  customFields?: Record<string, unknown>;
}) {
  return request<{ stocks: import('../types').WarehouseStock[] }>('/api/stocks/upsert', {
    method: 'POST',
    body: JSON.stringify(row),
  });
}

export async function stockDbDelete(id: string) {
  return request<{ ok: boolean }>(`/api/stocks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function stockDbBackupInfo() {
  return request<{
    available: boolean;
    meta: { at: string; rowCount: number; reason: string } | null;
    rowCount: number;
  }>('/api/stocks/backup');
}

export async function stockDbRestoreBackup() {
  return request<{
    meta: { at: string; rowCount: number; reason: string };
    stocks: import('../types').WarehouseStock[];
    customFields: import('../types').CustomFieldConfig[];
  }>('/api/stocks/restore-backup', { method: 'POST', body: '{}' });
}

export async function stockDbSaveCustomFields(
  customFields: import('../types').CustomFieldConfig[],
) {
  return request<{ customFields: import('../types').CustomFieldConfig[] }>(
    '/api/stocks/custom-fields',
    { method: 'PUT', body: JSON.stringify({ customFields }) },
  );
}

export async function stockDbReplaceAll(
  stocks: import('../types').WarehouseStock[],
  customFields: import('../types').CustomFieldConfig[],
) {
  return request('/api/stocks', {
    method: 'PUT',
    body: JSON.stringify({ stocks, customFields }),
  });
}
