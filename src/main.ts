import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import router from './router';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import { bootstrapStores } from './stores/bootstrap';

async function start() {
  const app = createApp(App);
  const pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);

  app.use(pinia);
  app.use(router);
  app.use(ElementPlus);

  try {
    await bootstrapStores();
  } catch (e) {
    console.error('启动初始化失败', e);
  }

  app.mount('#app');
}

void start();
