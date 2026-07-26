import { useCompanyStore } from './company';
import { useWarehouseStore } from './warehouse';
import { useChannelStore } from './channel';
import { useProductStore } from './product';
import { useWarehouseStockStore } from './warehouseStock';
import { useRequisitionStore } from './requisition';

/** 统一初始化：保证各页共享同一份 Pinia 数据，新增主体等全局可见 */
export function bootstrapStores() {
  useCompanyStore().initCompanies();
  useWarehouseStore().initWarehouses();
  useChannelStore().initChannels();
  useProductStore().initProducts();
  useWarehouseStockStore().initStocks();
  useRequisitionStore().migrateLegacy();
}
