import { useCompanyStore } from './company';
import { useWarehouseStore } from './warehouse';
import { useChannelStore } from './channel';
import { useProductStore } from './product';
import { useWarehouseStockStore } from './warehouseStock';
import { useRequisitionStore } from './requisition';
import { hasAnyPersistedBusinessData } from '../utils/dataBackup';

/**
 * 统一初始化。
 * 若 localStorage 已有业务数据，绝不写入演示种子，避免覆盖用户录入。
 */
export function bootstrapStores() {
  const hasPersisted = hasAnyPersistedBusinessData();

  // 先取 store 触发 persist 恢复
  const company = useCompanyStore();
  const warehouse = useWarehouseStore();
  const channel = useChannelStore();
  const product = useProductStore();
  const stock = useWarehouseStockStore();
  const requisition = useRequisitionStore();

  if (!hasPersisted) {
    company.initCompanies();
    warehouse.initWarehouses();
    channel.initChannels();
    product.initProducts();
    stock.initStocks();
  } else {
    company.ensureUniqueIds();
    warehouse.ensureUniqueIds();
    // 统一「下级C/子公司C → 下属C」等文案，并合并同代码重复主体
    const companyIdMap = company.normalizeCompanies();
    warehouse.remapCompanyIds(companyIdMap);
    channel.remapCompanyIds(companyIdMap);
    requisition.remapCompanyIds(companyIdMap);
    product.initProducts(); // 纠正组合品每箱瓶数=换算比例
    if (channel.channels.length > 0) {
      channel.initChannels();
    }
  }

  requisition.migrateLegacy();
}
