<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElDialog,
  ElMessage,
  ElMessageBox,
} from 'element-plus';
import PageShell from '../components/PageShell.vue';
import { useStockSnapshotStore } from '../stores/stockSnapshot';
import { useWarehouseStore } from '../stores/warehouse';
import { useProductStore } from '../stores/product';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { bootstrapStores } from '../stores/bootstrap';
import type { StockSnapshot, WarehouseStock } from '../types';
import { exportRows } from '../utils/excel';

const snapshotStore = useStockSnapshotStore();
const warehouseStore = useWarehouseStore();
const productStore = useProductStore();
const stockStore = useWarehouseStockStore();

const { snapshots } = storeToRefs(snapshotStore);
const showDetailDialog = ref(false);
const selectedSnapshot = ref<StockSnapshot | null>(null);

const hasWeekStart = computed(() => snapshots.value.some(s => !!s.weekStart));

onMounted(() => {
  bootstrapStores();
});

const formatTime = (time: string) => {
  return new Date(time).toLocaleString('zh-CN');
};

const getTotalStockCount = (stocks: WarehouseStock[]) => {
  return stocks.reduce((sum, s) => sum + s.stock, 0);
};

const getProductName = (code: string) => {
  const product = productStore.getProductByCode(code);
  return product ? product.name : '';
};

const getWarehouseName = (id: string) => {
  const warehouse = warehouseStore.getWarehouseById(id);
  return warehouse ? warehouse.name : '';
};

const getProductSpec = (code: string) => {
  const product = productStore.getProductByCode(code);
  return product ? product.spec : '';
};

const getProductUnit = (code: string) => {
  const product = productStore.getProductByCode(code);
  return product ? product.bottleUnit : '';
};

const viewSnapshot = (snapshot: StockSnapshot) => {
  selectedSnapshot.value = snapshot;
  showDetailDialog.value = true;
};

const deleteSnapshot = async (id: string) => {
  try {
    await ElMessageBox.confirm('确认删除该快照？删除后不可恢复。', '删除快照', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  snapshotStore.deleteSnapshot(id);
  ElMessage.success('删除成功');
};

const restoreSnapshot = async (snapshot: StockSnapshot) => {
  try {
    await ElMessageBox.confirm(
      `确认用该快照覆盖当前库存？\n\n备份时间：${formatTime(snapshot.snapshotTime)}\n记录数：${snapshot.stocks.length}\n\n当前库存会被替换，建议先到「库存导入」或右上角导出备份。`,
      '恢复库存快照',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  stockStore.restoreFromSnapshot(snapshot);
  ElMessage.success(`已恢复到 ${formatTime(snapshot.snapshotTime)} 的库存数据`);
  showDetailDialog.value = false;
};

const handleExportList = () => {
  exportRows(
    snapshots.value.map(s => ({
      备份时间: formatTime(s.snapshotTime),
      周起始: s.weekStart || '',
      备份描述: s.description,
      库存记录数: s.stocks.length,
      总库存数量: getTotalStockCount(s.stocks),
    })),
    '库存历史快照列表',
  );
  ElMessage.success(`已导出 ${snapshots.value.length} 条快照记录`);
};

const handleExportDetail = () => {
  if (!selectedSnapshot.value) return;
  const snap = selectedSnapshot.value;
  exportRows(
    snap.stocks.map(s => ({
      仓库编码: warehouseStore.getWarehouseById(s.warehouseId)?.code || '',
      仓库名称: getWarehouseName(s.warehouseId),
      商品编码: s.productCode,
      商品名称: getProductName(s.productCode),
      规格: getProductSpec(s.productCode),
      库存: s.stock,
      在途库存: s.inTransitStock,
      可用库存: s.stock + s.inTransitStock,
    })),
    `库存快照明细_${snap.description}`,
  );
  ElMessage.success(`已导出 ${snap.stocks.length} 条明细`);
};
</script>

<template>
  <PageShell
    title="库存历史记录"
    help="每次导入/替换库存时会自动备份，可查看历史数据和恢复"
  >
    <template #toolbar>
      <ElButton size="small" @click="handleExportList">导出快照列表</ElButton>
    </template>
    <div class="table-wrap">
      <ElTable
        :data="snapshots"
        border
        size="small"
        stripe
        class="erp-data-table"
        height="100%"
        v-loading="false"
      >
        <ElTableColumn label="序号" type="index" width="60" />
        <ElTableColumn label="备份时间" width="180">
          <template #default="{ row }">
            {{ formatTime((row as StockSnapshot).snapshotTime) }}
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="hasWeekStart" label="周起始" width="120">
          <template #default="{ row }">
            {{ (row as StockSnapshot).weekStart || '-' }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="备份描述" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ (row as StockSnapshot).description }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="库存记录数" width="110" align="center">
          <template #default="{ row }">
            {{ (row as StockSnapshot).stocks.length }} 条
          </template>
        </ElTableColumn>
        <ElTableColumn label="总库存数量" width="110" align="center">
          <template #default="{ row }">
            {{ getTotalStockCount((row as StockSnapshot).stocks) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" size="small" @click="viewSnapshot(row as StockSnapshot)">查看详情</ElButton>
            <ElButton link type="primary" size="small" @click="restoreSnapshot(row as StockSnapshot)">恢复</ElButton>
            <ElButton link type="danger" size="small" @click="deleteSnapshot((row as StockSnapshot).id)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <ElDialog v-model="showDetailDialog" :title="`库存快照 - ${selectedSnapshot?.description}`" width="900px">
      <ElTable :data="selectedSnapshot?.stocks" border size="small">
        <ElTableColumn label="仓库" width="100">
          <template #default="{ row }">
            {{ getWarehouseName((row as WarehouseStock).warehouseId) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="商品编码" width="100">
          <template #default="{ row }">
            {{ (row as WarehouseStock).productCode }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="商品名称" width="150">
          <template #default="{ row }">
            {{ getProductName((row as WarehouseStock).productCode) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="规格" width="100">
          <template #default="{ row }">
            {{ getProductSpec((row as WarehouseStock).productCode) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="库存数量" width="120">
          <template #default="{ row }">
            {{ (row as WarehouseStock).stock }} {{ getProductUnit((row as WarehouseStock).productCode) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="在途库存" width="120">
          <template #default="{ row }">
            {{ (row as WarehouseStock).inTransitStock }} {{ getProductUnit((row as WarehouseStock).productCode) }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="可用库存" width="120">
          <template #default="{ row }">
            {{ (row as WarehouseStock).stock + (row as WarehouseStock).inTransitStock }} {{ getProductUnit((row as WarehouseStock).productCode) }}
          </template>
        </ElTableColumn>
      </ElTable>
      <template #footer>
        <ElButton size="small" @click="showDetailDialog = false">关闭</ElButton>
        <ElButton size="small" @click="handleExportDetail">导出明细</ElButton>
        <ElButton size="small" type="primary" @click="restoreSnapshot(selectedSnapshot!)">恢复此快照</ElButton>
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
</style>
