import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import router from './router';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import { bootstrapStores } from './stores/bootstrap';

const app = createApp(App);
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

app.use(pinia);
app.use(router);
app.use(ElementPlus);

// Pinia 就绪后统一初始化，保证各页读到同一份主数据
bootstrapStores();

app.mount('#app');
