import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/products',
    },
    {
      path: '/products',
      name: 'products',
      component: () => import('../views/ProductView.vue'),
    },
    {
      path: '/warehouses',
      name: 'warehouses',
      component: () => import('../views/WarehouseView.vue'),
    },
    {
      path: '/warehouse-stocks',
      name: 'warehouse-stocks',
      component: () => import('../views/WarehouseStockView.vue'),
    },
    {
      path: '/channels',
      name: 'channels',
      component: () => import('../views/ChannelView.vue'),
    },
    {
      path: '/requisitions',
      name: 'requisitions',
      component: () => import('../views/RequisitionView.vue'),
    },
  ],
});

export default router;