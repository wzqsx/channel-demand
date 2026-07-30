/**
 * 同时启动：库存 SQLite 服务 + Vite 前端
 * Ctrl+C 会一起退出。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kids = [];

function run(name, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  child.on('exit', code => {
    console.log(`[${name}] exit ${code}`);
    for (const k of kids) {
      if (k !== child && !k.killed) k.kill('SIGTERM');
    }
    process.exit(code ?? 0);
  });
  kids.push(child);
  return child;
}

run('sqlite', process.execPath, [path.join(root, 'server/stock-sqlite.mjs')]);
// 稍等端口起来
setTimeout(() => {
  const viteArgs = ['vite', ...process.argv.slice(2)];
  run('vite', 'npx', viteArgs);
}, 400);

process.on('SIGINT', () => {
  for (const k of kids) k.kill('SIGINT');
});
process.on('SIGTERM', () => {
  for (const k of kids) k.kill('SIGTERM');
});
