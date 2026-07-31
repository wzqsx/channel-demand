/** 库存 SQLite 本地 API 客户端（服务未启动时返回 null，走浏览器兜底） */

function baseUrl() {
  // 显式配置优先
  const env = import.meta.env.VITE_STOCK_API as string | undefined;
  if (env) return env.replace(/\/$/, '');
  // 开发态直连 SQLite，绕过 Vite 代理短超时（否则大表加载/导入会被 2s 掐断）
  if (import.meta.env.DEV) return 'http://127.0.0.1:8787';
  return '';
}

async function request<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 15000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const { timeoutMs: _drop, signal: userSignal, ...rest } = init || {};
    if (userSignal) {
      if (userSignal.aborted) ctrl.abort();
      else userSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    const res = await fetch(`${baseUrl()}${path}`, {
      ...rest,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(rest.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { message?: string }).message || `HTTP ${res.status}`);
    }
    return data as T;
  } finally {
    clearTimeout(t);
  }
}

export type StockDbHealth = {
  ok: boolean;
  engine: string;
  dbPath: string;
  stockCount: number;
};

export async function stockDbHealth(): Promise<StockDbHealth | null> {
  try {
    const data = await request<StockDbHealth>('/api/health', { timeoutMs: 800 });
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}

export async function stockDbLoad() {
  return request<{
    stocks: import('../types').WarehouseStock[];
    customFields: import('../types').CustomFieldConfig[];
  }>('/api/stocks', { timeoutMs: 120000 });
}

/** 紧凑汇总行：[warehouseId, productCode, stock, inTransit] */
export async function stockDbLoadAgg() {
  return request<{
    count: number;
    rows: Array<[string, string, number, number]>;
    customFields: import('../types').CustomFieldConfig[];
  }>('/api/stocks/agg', { timeoutMs: 120000 });
}

export async function stockDbQueryPage(params: {
  offset: number;
  limit: number;
  warehouseIds?: string[];
  sort?: string;
  order?: 'asc' | 'desc';
}) {
  const q = new URLSearchParams();
  q.set('offset', String(params.offset));
  q.set('limit', String(params.limit));
  if (params.warehouseIds?.length) q.set('warehouseIds', params.warehouseIds.join(','));
  if (params.sort) q.set('sort', params.sort);
  if (params.order) q.set('order', params.order);
  return request<{
    total: number;
    offset: number;
    limit: number;
    stocks: import('../types').WarehouseStock[];
    customFields: import('../types').CustomFieldConfig[];
  }>(`/api/stocks/page?${q.toString()}`, { timeoutMs: 30000 });
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
    timeoutMs: 300000,
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
  return request<{ ok?: boolean; stocks?: import('../types').WarehouseStock[] }>(
    '/api/stocks/upsert',
    {
      method: 'POST',
      body: JSON.stringify(row),
      timeoutMs: 15000,
    },
  );
}

export async function stockDbDelete(id: string) {
  return request<{ ok: boolean }>(`/api/stocks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    timeoutMs: 15000,
  });
}

export async function stockDbBackupInfo() {
  return request<{
    available: boolean;
    meta: { at: string; rowCount: number; reason: string } | null;
    rowCount: number;
  }>('/api/stocks/backup', { timeoutMs: 10000 });
}

export async function stockDbRestoreBackup() {
  return request<{
    meta: { at: string; rowCount: number; reason: string };
    stocks: import('../types').WarehouseStock[];
    customFields: import('../types').CustomFieldConfig[];
  }>('/api/stocks/restore-backup', {
    method: 'POST',
    body: '{}',
    timeoutMs: 120000,
  });
}

export async function stockDbFileBackup() {
  return request<{ path: string; fileName: string }>('/api/stocks/file-backup', {
    method: 'POST',
    body: '{}',
    timeoutMs: 60000,
  });
}

export async function stockDbSaveCustomFields(
  customFields: import('../types').CustomFieldConfig[],
) {
  return request<{ customFields: import('../types').CustomFieldConfig[] }>(
    '/api/stocks/custom-fields',
    {
      method: 'PUT',
      body: JSON.stringify({ customFields }),
      timeoutMs: 15000,
    },
  );
}

export async function stockDbReplaceAll(
  stocks: import('../types').WarehouseStock[],
  customFields: import('../types').CustomFieldConfig[],
) {
  return request('/api/stocks', {
    method: 'PUT',
    body: JSON.stringify({ stocks, customFields }),
    timeoutMs: 300000,
  });
}
