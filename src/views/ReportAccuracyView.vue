<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { storeToRefs } from 'pinia';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElDialog,
  ElTag,
  ElSelect,
  ElOption,
  ElMessage,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import { useStockSnapshotStore } from '../stores/stockSnapshot';
import { useProductStore } from '../stores/product';
import { useRequisitionStore } from '../stores/requisition';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { bootstrapStores } from '../stores/bootstrap';
import type { StockSnapshot } from '../types';
import { exportRows } from '../utils/excel';

const snapshotStore = useStockSnapshotStore();
const productStore = useProductStore();
const requisitionStore = useRequisitionStore();
const stockStore = useWarehouseStockStore();

const { snapshots } = storeToRefs(snapshotStore);
const selectedSnapshotId = ref('');
const accuracyResults = ref<{
  productCode: string;
  productName: string;
  reportedQuantity: number;
  actualStock: number;
  accuracy: number;
  status: 'accurate' | 'inaccurate' | 'excess' | 'no_report';
}[]>([]);
const showDetailDialog = ref(false);

onMounted(() => {
  bootstrapStores();
});

const formatTime = (time: string) => {
  return new Date(time).toLocaleString('zh-CN');
};

const calculateAccuracy = () => {
  if (!selectedSnapshotId.value) return;

  const snapshot = snapshotStore.getSnapshotById(selectedSnapshotId.value);
  if (!snapshot) return;

  const results: typeof accuracyResults.value = [];

  const snapshotTime = new Date(snapshot.snapshotTime).getTime();

  const beforeStockMap = new Map<string, number>();
  const beforeInTransitMap = new Map<string, number>();
  snapshot.stocks.forEach(s => {
    beforeStockMap.set(s.productCode, (beforeStockMap.get(s.productCode) || 0) + s.stock);
    beforeInTransitMap.set(s.productCode, (beforeInTransitMap.get(s.productCode) || 0) + s.inTransitStock);
  });

  const allSnapshots = [...snapshotStore.getAllSnapshots()].sort((a, b) =>
    new Date(a.snapshotTime).getTime() - new Date(b.snapshotTime).getTime()
  );
  const currentIndex = allSnapshots.findIndex(s => s.id === selectedSnapshotId.value);
  const nextSnapshot = currentIndex < allSnapshots.length - 1 ? allSnapshots[currentIndex + 1] : null;

  const afterStockMap = new Map<string, number>();
  const afterInTransitMap = new Map<string, number>();

  if (nextSnapshot) {
    nextSnapshot.stocks.forEach(s => {
      afterStockMap.set(s.productCode, (afterStockMap.get(s.productCode) || 0) + s.stock);
      afterInTransitMap.set(s.productCode, (afterInTransitMap.get(s.productCode) || 0) + s.inTransitStock);
    });
  } else {
    stockStore.stocks.forEach(s => {
      afterStockMap.set(s.productCode, (afterStockMap.get(s.productCode) || 0) + s.stock);
      afterInTransitMap.set(s.productCode, (afterInTransitMap.get(s.productCode) || 0) + s.inTransitStock);
    });
  }

  const afterTime = nextSnapshot ? new Date(nextSnapshot.snapshotTime).getTime() : Date.now();
  const relatedRequisitions = requisitionStore.requisitions.filter(req => {
    const reqTime = new Date(req.createdAt).getTime();
    return reqTime >= snapshotTime && reqTime <= afterTime && req.status === 'approved';
  });

  const approvedMap = new Map<string, number>();
  relatedRequisitions.forEach(req => {
    req.items.forEach(item => {
      approvedMap.set(item.productCode, (approvedMap.get(item.productCode) || 0) + item.quantity);
    });
  });

  productStore.products.forEach(product => {
    const approvedQuantity = approvedMap.get(product.code) || 0;
    const beforeStock = beforeStockMap.get(product.code) || 0;
    const beforeInTransit = beforeInTransitMap.get(product.code) || 0;
    const afterStock = afterStockMap.get(product.code) || 0;
    const afterInTransit = afterInTransitMap.get(product.code) || 0;

    const actualArrival = (afterStock + afterInTransit) - (beforeStock + beforeInTransit);

    let accuracy = 0;
    let status: 'accurate' | 'inaccurate' | 'excess' | 'no_report' = 'no_report';

    if (approvedQuantity > 0) {
      if (actualArrival >= 0) {
        accuracy = Math.round((actualArrival / approvedQuantity) * 100);
        if (accuracy >= 80 && accuracy <= 120) {
          status = 'accurate';
        } else if (accuracy < 80) {
          status = 'inaccurate';
        } else {
          status = 'excess';
        }
      } else {
        status = 'inaccurate';
      }
    }

    results.push({
      productCode: product.code,
      productName: product.name,
      reportedQuantity: approvedQuantity,
      actualStock: actualArrival >= 0 ? actualArrival : 0,
      accuracy,
      status,
    });
  });

  accuracyResults.value = results;
  showDetailDialog.value = true;
};

const getStatusTag = (status: 'accurate' | 'inaccurate' | 'excess' | 'no_report') => {
  switch (status) {
    case 'accurate':
      return { label: '准确', type: 'success' as const };
    case 'inaccurate':
      return { label: '不准确', type: 'danger' as const };
    case 'excess':
      return { label: '超报', type: 'warning' as const };
    case 'no_report':
      return { label: '未提报', type: 'info' as const };
    default:
      return { label: status, type: 'info' as const };
  }
};

const overallAccuracy = computed(() => {
  const reportedResults = accuracyResults.value.filter(r => r.reportedQuantity > 0);
  if (reportedResults.length === 0) return 0;
  const total = reportedResults.reduce((sum, r) => sum + r.accuracy, 0);
  return Math.round(total / reportedResults.length);
});

const accurateCount = computed(() => {
  return accuracyResults.value.filter(r => r.status === 'accurate').length;
});

const inaccurateCount = computed(() => {
  return accuracyResults.value.filter(r => r.status === 'inaccurate' || r.status === 'excess').length;
});

const noReportCount = computed(() => {
  return accuracyResults.value.filter(r => r.status === 'no_report').length;
});

const handleExportResults = () => {
  if (!accuracyResults.value.length) {
    ElMessage.warning('请先执行统计分析');
    return;
  }
  const snapshot = selectedSnapshotId.value
    ? snapshotStore.getSnapshotById(selectedSnapshotId.value)
    : null;
  const suffix = snapshot ? `_${snapshot.description}` : '';
  exportRows(
    accuracyResults.value.map(r => ({
      商品编码: r.productCode,
      商品名称: r.productName,
      提报数量: r.reportedQuantity,
      实际到货: r.actualStock,
      准确率: `${r.accuracy}%`,
      状态: getStatusTag(r.status).label,
    })),
    `提报准确性分析${suffix}`,
  );
  ElMessage.success(`已导出 ${accuracyResults.value.length} 条分析结果`);
};
</script>

<template>
  <PageShell
    title="提报准确性统计"
    help="【注意】本页用「相邻库存快照差额」估算到货，并非销货核对。库存为周快照、审批不扣库存，准确率仅供参考。完整率请看「销货核对 / 渠道要货总览」。"
  >
    <template #toolbar>
      <ElSelect
        v-model="selectedSnapshotId"
        placeholder="请选择提报记录"
        size="small"
        style="width: 300px"
      >
        <ElOption
          v-for="snapshot in snapshots"
          :key="snapshot.id"
          :label="`${snapshot.description} - ${formatTime(snapshot.snapshotTime)}`"
          :value="snapshot.id"
        />
      </ElSelect>
      <ElButton type="primary" size="small" :disabled="!selectedSnapshotId" @click="calculateAccuracy()">
        统计分析
      </ElButton>
      <ElButton size="small" :disabled="!accuracyResults.length" @click="handleExportResults">导出分析</ElButton>
    </template>

    <div class="table-wrap">
      <div v-if="snapshots.length === 0" class="empty-tip">
        暂无提报记录，请先导入库存数据
      </div>

      <ElTable
        v-else
        :data="snapshots"
        border
        size="small"
        stripe
        class="erp-data-table"
        height="100%"
      >
        <ElTableColumn label="序号" type="index" width="60" />
        <ElTableColumn label="提报时间" width="180">
          <template #default="{ row }">
            {{ formatTime((row as StockSnapshot).snapshotTime) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="提报描述" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ (row as StockSnapshot).description }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="商品数量" width="100" align="center">
          <template #default="{ row }">
            {{ (row as StockSnapshot).stocks.length }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <ElButton
              link
              type="primary"
              size="small"
              @click="selectedSnapshotId = (row as StockSnapshot).id; calculateAccuracy()"
            >
              分析
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <ElDialog v-model="showDetailDialog" title="提报准确性分析" width="900px">
      <div class="stats-overview">
        <div>
          <p class="stats-label">整体准确率</p>
          <p class="stats-value stats-value--primary">{{ overallAccuracy }}%</p>
        </div>
        <div>
          <p class="stats-label">准确提报</p>
          <p class="stats-value stats-value--success">{{ accurateCount }} 件</p>
        </div>
        <div>
          <p class="stats-label">不准确</p>
          <p class="stats-value stats-value--danger">{{ inaccurateCount }} 件</p>
        </div>
        <div>
          <p class="stats-label">未提报</p>
          <p class="stats-value stats-value--muted">{{ noReportCount }} 件</p>
        </div>
      </div>

      <ElTable :data="accuracyResults" border size="small">
        <ElTableColumn type="index" label="序号" width="55" />
        <ElTableColumn prop="productCode" label="商品编码" width="100" sortable />
        <ElTableColumn prop="productName" label="商品名称" width="150" sortable />
        <ElTableColumn prop="reportedQuantity" label="提报数量" width="100" sortable>
          <template #default="{ row }">
            {{ row.reportedQuantity }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="actualStock" label="实际到货" width="100" sortable>
          <template #default="{ row }">
            {{ row.actualStock }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="accuracy" label="准确率" width="100" sortable>
          <template #default="{ row }">
            <span :class="{ 'accuracy-high': row.accuracy >= 80, 'accuracy-low': row.accuracy < 80 }">
              {{ row.accuracy }}%
            </span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="100">
          <template #default="{ row }">
            <ElTag size="small" :type="getStatusTag(row.status).type">
              {{ getStatusTag(row.status).label }}
            </ElTag>
          </template>
        </ElTableColumn>
      </ElTable>

      <template #footer>
        <ElButton size="small" @click="showDetailDialog = false">关闭</ElButton>
        <ElButton size="small" @click="handleExportResults">导出分析</ElButton>
      </template>
    </ElDialog>
  </PageShell>
</template>

<style scoped>
.table-wrap {
  flex: 1;
  min-height: 0;
  padding: 0 12px;
  overflow: hidden;
}

.empty-tip {
  padding: 40px;
  text-align: center;
  color: #999;
}

.stats-overview {
  display: flex;
  gap: 30px;
  margin-bottom: 20px;
  padding: 15px;
  background: #f5f7fa;
  border-radius: 4px;
}

.stats-label {
  margin: 0;
  color: #999;
  font-size: 12px;
}

.stats-value {
  margin: 4px 0 0;
  font-size: 24px;
  font-weight: bold;
}

.stats-value--primary {
  color: #409eff;
}

.stats-value--success {
  color: #67c23a;
}

.stats-value--danger {
  color: #f56c6c;
}

.stats-value--muted {
  color: #909399;
}

.accuracy-high {
  color: #67c23a;
  font-weight: bold;
}

.accuracy-low {
  color: #f56c6c;
  font-weight: bold;
}
</style>
