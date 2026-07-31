/**
 * 同时启动：库存 SQLite 服务 + Vite 前端
 * - Node < 22 直接报错退出（需要内置 node:sqlite）
 * - 等 SQLite 健康检查通过再开 Vite，避免首屏连不上库
 * - SQLite 挂了不会拖死前端
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kids = [];
let shuttingDown = false;

const major = Number(process.versions.node.split('.')[0] || 0);
if (major < 22) {
  console.error(
    `\n[启动失败] 本项目库存库需要 Node.js 22+（当前 ${process.versions.node}）。\n` +
      `请执行：brew install node  或到 https://nodejs.org 安装最新 LTS，然后重开终端。\n`,
  );
  process.exit(1);
}

// 确认能加载内置 sqlite
try {
  await import('node:sqlite');
} catch (e) {
  console.error('\n[启动失败] 当前 Node 无法使用 node:sqlite：', e?.message || e);
  console.error('请升级到 Node.js 22.5+ 后再试。\n');
  process.exit(1);
}

function run(name, command, args, { critical = false } = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  child.on('exit', code => {
    console.log(`[${name}] exit ${code}`);
    if (shuttingDown) return;
    if (critical) {
      shuttingDown = true;
      for (const k of kids) {
        if (k !== child && !k.killed) k.kill('SIGTERM');
      }
      process.exit(code ?? 0);
    } else {
      console.warn(`[${name}] 已退出，前端继续跑（库存将回退浏览器模式）`);
    }
  });
  kids.push(child);
  return child;
}

async function waitSqlite(ms = 10000) {
  const port = process.env.STOCK_API_PORT || '8787';
  const url = `http://127.0.0.1:${port}/api/health`;
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.ok) return true;
      }
    } catch {
      /* retry */
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

run('sqlite', process.execPath, [path.join(root, 'server/stock-sqlite.mjs')], {
  critical: false,
});

const ready = await waitSqlite(10000);
if (ready) {
  console.log('[sqlite] 健康检查通过，启动前端…');
} else {
  console.warn('[sqlite] 10 秒内未就绪，仍启动前端（库存将回退浏览器模式）');
}

run('vite', 'npx', ['vite', ...process.argv.slice(2)], { critical: true });

function shutdown() {
  shuttingDown = true;
  for (const k of kids) {
    try {
      k.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
