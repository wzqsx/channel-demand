import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/requisitions' },
    {
      path: '/companies',
      name: 'companies',
      component: () => import('../views/CompanyView.vue'),
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
      path: '/stock-history',
      name: 'stock-history',
      component: () => import('../views/StockHistoryView.vue'),
    },
    {
      path: '/report-accuracy',
      name: 'report-accuracy',
      component: () => import('../views/ReportAccuracyView.vue'),
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
    {
      path: '/sales-compare',
      name: 'sales-compare',
      component: () => import('../views/SalesCompareView.vue'),
    },
    {
      path: '/channel-overview',
      name: 'channel-overview',
      component: () => import('../views/ChannelOverviewView.vue'),
    },
    {
      path: '/shortage-alert',
      name: 'shortage-alert',
      component: () => import('../views/ShortageAlertView.vue'),
    },
  ],
});

export default router;