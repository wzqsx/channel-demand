import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // 固定 IPv4，避免只绑 [::1] 时打开 http://127.0.0.1:5173 连不上
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // 开发态前端默认直连 :8787；代理仅作兜底，超时放宽避免大表被掐断
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        timeout: 300000,
        proxyTimeout: 300000,
      },
    },
  },
})
