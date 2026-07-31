/**
 * 同时启动：库存 SQLite 服务 + Vite 前端
 * SQLite 挂了不会拖死前端。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kids = [];
let shuttingDown = false;

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

run('sqlite', process.execPath, [path.join(root, 'server/stock-sqlite.mjs')], {
  critical: false,
});
setTimeout(() => {
  const viteArgs = ['vite', ...process.argv.slice(2)];
  run('vite', 'npx', viteArgs, { critical: true });
}, 300);

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
