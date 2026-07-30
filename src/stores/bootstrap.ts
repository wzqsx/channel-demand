import { useCompanyStore } from './company';
import { useWarehouseStore } from './warehouse';
import { useChannelStore } from './channel';
import { useProductStore } from './product';
import { useWarehouseStockStore } from './warehouseStock';
import { useRequisitionStore } from './requisition';
import { useStockSnapshotStore } from './stockSnapshot';
import { hasAnyPersistedBusinessData } from '../utils/dataBackup';
import { migrateStockStoresToIdb } from '../utils/stockPersist';

/**
 * 统一初始化（异步：先迁 IDB 再 hydrate 大表库存）。
 * 若已有业务数据，绝不写入演示种子。
 */
export async function bootstrapStores() {
  await migrateStockStoresToIdb();

  const company = useCompanyStore();
  const warehouse = useWarehouseStore();
  const channel = useChannelStore();
  const product = useProductStore();
  const stock = useWarehouseStockStore();
  const requisition = useRequisitionStore();
  const snapshot = useStockSnapshotStore();

  await Promise.all([stock.hydrateFromIdb(), snapshot.hydrateFromIdb()]);
  snapshot.compactIfNeeded();

  const hasPersisted = hasAnyPersistedBusinessData() || stock.stocks.length > 0;

  if (!hasPersisted) {
    company.initCompanies();
    warehouse.initWarehouses();
    channel.initChannels();
    product.initProducts();
    stock.initStocks();
  } else {
    company.ensureUniqueIds();
    warehouse.ensureUniqueIds();
    const companyIdMap = company.normalizeCompanies();
    warehouse.remapCompanyIds(companyIdMap);
    channel.remapCompanyIds(companyIdMap);
    requisition.remapCompanyIds(companyIdMap);
    product.initProducts();
    if (channel.channels.length > 0) {
      channel.initChannels();
    }
  }

  requisition.migrateLegacy();
}
