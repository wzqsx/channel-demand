/**
 * 库存服务冒烟：健康检查 + 写入/读回 + 大包不超时
 * 使用临时目录，绝不碰 data/stock.db
 * 用法：npm run smoke:stock
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.STOCK_API_PORT || '8788';
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = path.join(root, 'data', '.smoke-tmp');

async function waitHealth(ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) {
        const j = await r.json();
        if (j?.ok) return j;
      }
    } catch {
      /* retry */
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('health timeout');
}

async function main() {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const child = spawn(process.execPath, [path.join(root, 'server/stock-sqlite.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      STOCK_API_PORT: PORT,
      STOCK_DATA_DIR: tmpDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', d => {
    stderr += d.toString();
  });

  try {
    const health = await waitHealth();
    console.log('✓ health', health.engine, 'rows=', health.stockCount);

    const rows = [];
    for (let i = 0; i < 3000; i++) {
      rows.push({
        id: `smoke_${i}`,
        warehouseId: 'W001',
        productCode: `SKU${i}`,
        stock: i,
        inTransitStock: 0,
      });
    }
    const t0 = Date.now();
    const imp = await fetch(`${BASE}/api/stocks/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replaceAll: true, rows, reason: 'smoke' }),
      signal: AbortSignal.timeout(120000),
    });
    if (!imp.ok) throw new Error(`import HTTP ${imp.status}`);
    const impBody = await imp.json();
    console.log('✓ import', impBody.imported, 'in', Date.now() - t0, 'ms');

    const t1 = Date.now();
    const load = await fetch(`${BASE}/api/stocks`, { signal: AbortSignal.timeout(120000) });
    if (!load.ok) throw new Error(`load HTTP ${load.status}`);
    const data = await load.json();
    console.log('✓ load', data.stocks?.length, 'in', Date.now() - t1, 'ms');

    if ((data.stocks?.length || 0) !== 3000) {
      throw new Error(`期望 3000 行，实际 ${data.stocks?.length}`);
    }

    const up = await fetch(`${BASE}/api/stocks/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouseId: 'W001',
        productCode: 'SKU0',
        stock: 99,
        inTransitStock: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const upText = await up.text();
    if (upText.length > 5000) {
      throw new Error(`upsert 响应过大 (${upText.length} bytes)，疑似回传了全表`);
    }
    console.log('✓ upsert 响应体', upText.length, 'bytes');
    console.log('\n冒烟通过（临时库，未改 data/stock.db）');
  } catch (e) {
    console.error('\n冒烟失败:', e?.message || e);
    if (stderr) console.error(stderr.slice(-800));
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main();
