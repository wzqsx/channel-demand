<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();

const menuItems = [
  { path: '/products', label: '商品管理' },
  { path: '/warehouses', label: '仓库管理' },
  { path: '/warehouse-stocks', label: '库存状况' },
  { path: '/channels', label: '渠道管理' },
  { path: '/requisitions', label: '要货管理' },
];
</script>

<template>
  <div class="app-container">
    <aside class="sidebar">
      <div class="logo">
        <h1>库存计算工具</h1>
      </div>
      <nav class="menu">
        <button
          v-for="item in menuItems"
          :key="item.path"
          :class="['menu-item', { active: route.path === item.path }]"
          @click="router.push(item.path)"
        >
          {{ item.label }}
        </button>
      </nav>
    </aside>
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 200px;
  background-color: #1a1a2e;
  color: #fff;
  display: flex;
  flex-direction: column;
}

.logo {
  padding: 20px;
  border-bottom: 1px solid #333;
}

.logo h1 {
  font-size: 16px;
  margin: 0;
  text-align: center;
}

.menu {
  flex: 1;
  padding: 10px;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 12px 16px;
  margin-bottom: 5px;
  border: none;
  background: none;
  color: #ccc;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
}

.menu-item:hover {
  background-color: #333;
  color: #fff;
}

.menu-item.active {
  background-color: #409eff;
  color: #fff;
}

.main-content {
  flex: 1;
  background-color: #f5f5f5;
  overflow-y: auto;
}
</style>