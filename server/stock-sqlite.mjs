/**
 * 本地库存 SQLite 服务（Node 内置 node:sqlite，无需 MySQL）。
 * 启动：npm run server
 * 默认：http://127.0.0.1:8787
 * 要求：Node.js 22.5+
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const major = Number(process.versions.node.split('.')[0] || 0);
if (major < 22) {
  console.error(
    `[stock-sqlite] 需要 Node.js 22+（当前 ${process.versions.node}）。请升级后再启动。`,
  );
  process.exit(1);
}

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (e) {
  console.error('[stock-sqlite] 无法加载 node:sqlite：', e?.message || e);
  console.error('请使用 Node.js 22.5+。');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.STOCK_DATA_DIR
  ? path.resolve(process.env.STOCK_DATA_DIR)
  : path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'stock.db');
const PORT = Number(process.env.STOCK_API_PORT || 8787);
const HOST = process.env.STOCK_API_HOST || '127.0.0.1';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA temp_store = MEMORY;');

db.exec(`
  CREATE TABLE IF NOT EXISTS stocks (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL,
    product_code TEXT NOT NULL,
    stock REAL NOT NULL DEFAULT 0,
    in_transit REAL NOT NULL DEFAULT 0,
    custom_fields TEXT,
    UNIQUE(warehouse_id, product_code)
  );
  CREATE INDEX IF NOT EXISTS idx_stocks_wh ON stocks(warehouse_id);
  CREATE INDEX IF NOT EXISTS idx_stocks_sku ON stocks(product_code);

  CREATE TABLE IF NOT EXISTS custom_fields (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text'
  );

  CREATE TABLE IF NOT EXISTS stocks_backup (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL,
    product_code TEXT NOT NULL,
    stock REAL NOT NULL DEFAULT 0,
    in_transit REAL NOT NULL DEFAULT 0,
    custom_fields TEXT
  );

  CREATE TABLE IF NOT EXISTS custom_fields_backup (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text'
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      // 单次导入保护：约 200MB
      if (size > 200 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function rowToStock(r) {
  let customFields;
  if (r.custom_fields) {
    try {
      customFields = JSON.parse(r.custom_fields);
    } catch {
      customFields = undefined;
    }
  }
  return {
    id: r.id,
    warehouseId: r.warehouse_id,
    productCode: r.product_code,
    stock: Number(r.stock) || 0,
    inTransitStock: Number(r.in_transit) || 0,
    customFields,
  };
}

function getAllStocks() {
  return db.prepare('SELECT * FROM stocks ORDER BY warehouse_id, product_code').all().map(rowToStock);
}

function getCustomFields() {
  return db.prepare('SELECT key, label, type FROM custom_fields ORDER BY key').all().map(r => ({
    key: r.key,
    label: r.label,
    type: r.type,
  }));
}

function setMeta(key, value) {
  db.prepare(
    'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function backupNow(reason = 'import') {
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM stocks').get();
  const count = Number(countRow?.c || 0);
  db.exec('DELETE FROM stocks_backup');
  db.exec('DELETE FROM custom_fields_backup');
  if (count > 0) {
    db.exec(`
      INSERT INTO stocks_backup(id, warehouse_id, product_code, stock, in_transit, custom_fields)
      SELECT id, warehouse_id, product_code, stock, in_transit, custom_fields FROM stocks
    `);
  }
  db.exec(`
    INSERT INTO custom_fields_backup(key, label, type)
    SELECT key, label, type FROM custom_fields
  `);
  const meta = {
    at: new Date().toISOString(),
    rowCount: count,
    reason,
  };
  setMeta('pre_import_backup', JSON.stringify(meta));
  return meta;
}

function restoreBackup() {
  const raw = getMeta('pre_import_backup');
  if (!raw) throw new Error('没有可用的导入前备份');
  const meta = JSON.parse(raw);
  const bakCount = Number(db.prepare('SELECT COUNT(*) AS c FROM stocks_backup').get()?.c || 0);
  if (!bakCount && meta.rowCount > 0) throw new Error('备份表为空');
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM stocks');
    db.exec(`
      INSERT INTO stocks(id, warehouse_id, product_code, stock, in_transit, custom_fields)
      SELECT id, warehouse_id, product_code, stock, in_transit, custom_fields FROM stocks_backup
    `);
    db.exec('DELETE FROM custom_fields');
    db.exec(`
      INSERT INTO custom_fields(key, label, type)
      SELECT key, label, type FROM custom_fields_backup
    `);
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
  return meta;
}

function snapshotDbFile() {
  const bakDir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(bakDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(bakDir, `stock-${stamp}.db`);
  // WAL 模式下先 checkpoint 再拷贝，减少半截文件
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    /* ignore */
  }
  fs.copyFileSync(DB_PATH, dest);
  // 只保留最近 10 份文件备份
  const files = fs
    .readdirSync(bakDir)
    .filter(f => f.startsWith('stock-') && f.endsWith('.db'))
    .map(f => ({ f, t: fs.statSync(path.join(bakDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of files.slice(10)) {
    try {
      fs.unlinkSync(path.join(bakDir, old.f));
    } catch {
      /* ignore */
    }
  }
  return { path: dest, fileName: path.basename(dest) };
}

function replaceCustomFields(fields) {
  db.exec('DELETE FROM custom_fields');
  if (!Array.isArray(fields) || !fields.length) return;
  const ins = db.prepare(
    'INSERT INTO custom_fields(key, label, type) VALUES(?, ?, ?)',
  );
  for (const f of fields) {
    if (!f?.key) continue;
    ins.run(String(f.key), String(f.label || f.key), String(f.type || 'text'));
  }
}

function importRows(body) {
  const replaceAll = !!body.replaceAll;
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const customFields = body.customFields;
  const reason = String(body.reason || 'import');
  // 单行 upsert 不做全表备份（否则每次改一行都卡）
  const skipBackup = reason === 'upsert' || body.skipBackup === true;

  const existing = Number(db.prepare('SELECT COUNT(*) AS c FROM stocks').get()?.c || 0);
  let backupMeta = null;
  if (existing > 0 && !skipBackup) {
    backupMeta = backupNow(reason);
  }

  const upsert = db.prepare(`
    INSERT INTO stocks(id, warehouse_id, product_code, stock, in_transit, custom_fields)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(warehouse_id, product_code) DO UPDATE SET
      stock = excluded.stock,
      in_transit = excluded.in_transit,
      custom_fields = COALESCE(excluded.custom_fields, stocks.custom_fields),
      id = stocks.id
  `);

  let imported = 0;
  let skippedNoCode = 0;
  let negativeRows = 0;
  let idSeq = Date.now();

  db.exec('BEGIN');
  try {
    if (replaceAll) {
      db.exec('DELETE FROM stocks');
    }
    if (Array.isArray(customFields)) {
      replaceCustomFields(customFields);
    }
    for (const item of rows) {
      const warehouseId = String(item.warehouseId || '').trim();
      const productCode = String(item.productCode || '').trim();
      if (!warehouseId || !productCode) {
        skippedNoCode += 1;
        continue;
      }
      const stock = Number(item.stock) || 0;
      const inTransit = Number(item.inTransitStock) || 0;
      if (stock < 0 || inTransit < 0) negativeRows += 1;
      const cf =
        item.customFields && typeof item.customFields === 'object'
          ? JSON.stringify(item.customFields)
          : null;
      idSeq += 1;
      const id = String(item.id || `${idSeq}_${imported}`);
      upsert.run(id, warehouseId, productCode, stock, inTransit, cf);
      imported += 1;
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  return {
    imported,
    skippedNoCode,
    skippedWarehouse: 0,
    negativeRows,
    total: rows.length,
    preImportBackedUp: !!backupMeta,
    backupRowCount: backupMeta?.rowCount || 0,
    snapshotSkipped: true,
    stockCount: Number(db.prepare('SELECT COUNT(*) AS c FROM stocks').get()?.c || 0),
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const p = url.pathname;

  try {
    if (req.method === 'GET' && p === '/api/health') {
      const count = Number(db.prepare('SELECT COUNT(*) AS c FROM stocks').get()?.c || 0);
      return json(res, 200, {
        ok: true,
        engine: 'sqlite',
        dbPath: DB_PATH,
        stockCount: count,
      });
    }

    if (req.method === 'GET' && p === '/api/stocks') {
      return json(res, 200, {
        stocks: getAllStocks(),
        customFields: getCustomFields(),
      });
    }

    if (req.method === 'PUT' && p === '/api/stocks') {
      const body = await readBody(req);
      const rows = Array.isArray(body?.stocks) ? body.stocks : [];
      const result = importRows({
        replaceAll: true,
        rows,
        customFields: body?.customFields,
        reason: 'full-put',
      });
      return json(res, 200, result);
    }

    if (req.method === 'POST' && p === '/api/stocks/import') {
      const body = await readBody(req);
      const result = importRows(body || {});
      return json(res, 200, result);
    }

    if (req.method === 'POST' && p === '/api/stocks/upsert') {
      const body = await readBody(req);
      if (!body?.warehouseId || !body?.productCode) {
        return json(res, 400, { message: '缺少 warehouseId/productCode' });
      }
      const result = importRows({
        replaceAll: false,
        rows: [body],
        reason: 'upsert',
        skipBackup: true,
      });
      return json(res, 200, { ok: true, imported: result.imported });
    }

    if (req.method === 'DELETE' && p.startsWith('/api/stocks/')) {
      const id = decodeURIComponent(p.slice('/api/stocks/'.length));
      db.prepare('DELETE FROM stocks WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/stocks/backup') {
      const body = await readBody(req);
      const meta = backupNow(String(body?.reason || 'manual'));
      return json(res, 200, meta);
    }

    if (req.method === 'GET' && p === '/api/stocks/backup') {
      const raw = getMeta('pre_import_backup');
      const bakCount = Number(db.prepare('SELECT COUNT(*) AS c FROM stocks_backup').get()?.c || 0);
      return json(res, 200, {
        available: bakCount > 0 && !!raw,
        meta: raw ? JSON.parse(raw) : null,
        rowCount: bakCount,
      });
    }

    if (req.method === 'POST' && p === '/api/stocks/restore-backup') {
      const meta = restoreBackup();
      return json(res, 200, {
        meta,
        stocks: getAllStocks(),
        customFields: getCustomFields(),
      });
    }

    if (req.method === 'POST' && p === '/api/stocks/file-backup') {
      const info = snapshotDbFile();
      return json(res, 200, info);
    }

    if (req.method === 'GET' && p === '/api/stocks/file-backups') {
      const bakDir = path.join(DATA_DIR, 'backups');
      if (!fs.existsSync(bakDir)) return json(res, 200, { files: [] });
      const files = fs
        .readdirSync(bakDir)
        .filter(f => f.startsWith('stock-') && f.endsWith('.db'))
        .map(f => {
          const full = path.join(bakDir, f);
          const st = fs.statSync(full);
          return { fileName: f, path: full, size: st.size, mtime: st.mtime.toISOString() };
        })
        .sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
      return json(res, 200, { files });
    }

    if (req.method === 'PUT' && p === '/api/stocks/custom-fields') {
      const body = await readBody(req);
      replaceCustomFields(body?.customFields || body || []);
      return json(res, 200, { customFields: getCustomFields() });
    }

    return json(res, 404, { message: 'not found' });
  } catch (e) {
    console.error(e);
    return json(res, 500, { message: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[stock-sqlite] http://${HOST}:${PORT}`);
  console.log(`[stock-sqlite] db: ${DB_PATH}`);
});
