import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import router from './router';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import { bootstrapStores } from './stores/bootstrap';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
    p.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      e => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function start() {
  const app = createApp(App);
  const pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);

  app.use(pinia);
  app.use(router);
  app.use(ElementPlus);

  // 先挂载，保证侧栏/菜单立刻可点；库存异步加载
  app.mount('#app');

  try {
    await withTimeout(bootstrapStores(), 45000, '启动初始化');
  } catch (e) {
    console.error('启动初始化失败（页面仍可用，库存可能未就绪）', e);
  }
}

void start();
