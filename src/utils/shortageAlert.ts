import { useRequisitionStore } from '../stores/requisition';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { useWarehouseStore } from '../stores/warehouse';
import { useProductStore } from '../stores/product';
import { useChannelStore } from '../stores/channel';
import { filterWarehouseIdsByCompany } from './companyScope';

export type AlertKind = 'shortage' | 'warning';

export interface ShortageAlertRow {
  companyId: string;
  productCode: string;
  productName: string;
  warehouseIds: string[];
  currentStock: number;
  inTransitStock: number;
  availableStock: number;
  warningThreshold: number;
  totalDemand: number;
  shortage: number;
  channels: string[];
  /** shortage=缺货（需求>可用）；warning=低于预警 */
  kind: AlertKind;
  statusText: string;
}

/**
 * 按主体计算缺货与预警。
 * - 缺货：指定周内 pending/approved 要货合计 > 本主体相关仓库可用库存
 * - 预警：本主体仓库可用库存 ≤ 商品预警阈值（不依赖是否有要货）
 * 库存与需求均严格按主体仓库隔离，不跨主体混算。
 */
export function buildShortageAndWarnings(opts: {
  weekStart: string;
  companyId?: string;
  /** 要货状态范围，默认待审批+已通过 */
  demandStatuses?: Array<'pending' | 'approved' | 'rejected'>;
}): ShortageAlertRow[] {
  const requisitionStore = useRequisitionStore();
  const stockStore = useWarehouseStockStore();
  const warehouseStore = useWarehouseStore();
  const productStore = useProductStore();
  const channelStore = useChannelStore();

  const statuses = opts.demandStatuses || ['pending', 'approved'];
  const demands = requisitionStore.requisitions.filter(r => {
    if (r.weekStart !== opts.weekStart) return false;
    if (!statuses.includes(r.status as 'pending' | 'approved')) return false;
    if (opts.companyId && r.companyId !== opts.companyId) return false;
    return true;
  });

  // companyId -> productCode -> agg
  type Agg = {
    companyId: string;
    quantity: number;
    channels: Set<string>;
    warehouseIds: Set<string>;
  };
  const demandAgg = new Map<string, Agg>();

  demands.forEach(req => {
    const companyId = req.companyId;
    if (!companyId) return;
    const whIds = filterWarehouseIdsByCompany(req.warehouseIds || [], companyId);
    if (!whIds.length) return;
    const channelName = channelStore.getChannelById(req.channelId)?.name || req.channelId;
    req.items.forEach(item => {
      const key = `${companyId}__${item.productCode}`;
      const prev = demandAgg.get(key);
      if (prev) {
        prev.quantity += item.quantity;
        prev.channels.add(channelName);
        whIds.forEach(id => prev.warehouseIds.add(id));
      } else {
        demandAgg.set(key, {
          companyId,
          quantity: item.quantity,
          channels: new Set([channelName]),
          warehouseIds: new Set(whIds),
        });
      }
    });
  });

  const rows: ShortageAlertRow[] = [];
  const seenWarning = new Set<string>();

  // 1) 缺货：有需求且缺口 > 0
  demandAgg.forEach((agg, key) => {
    const productCode = key.split('__')[1];
    const product = productStore.getProductByCode(productCode);
    const whIds = [...agg.warehouseIds];
    const currentStock = stockStore.getTotalStock(productCode, whIds);
    const inTransitStock = stockStore.getTotalInTransitStock(productCode, whIds);
    const availableStock = currentStock + inTransitStock;
    const shortage = Math.max(0, agg.quantity - availableStock);
    const warningThreshold = product?.warningThreshold ?? 0;

    if (shortage > 0) {
      rows.push({
        companyId: agg.companyId,
        productCode,
        productName: product?.name || productCode,
        warehouseIds: whIds,
        currentStock,
        inTransitStock,
        availableStock,
        warningThreshold,
        totalDemand: agg.quantity,
        shortage,
        channels: [...agg.channels],
        kind: 'shortage',
        statusText: availableStock === 0 ? '缺货（库存为0）' : '缺货（需求超过可用）',
      });
    } else if (availableStock <= warningThreshold) {
      // 有要货且可用已低于预警，归入预警（同时记入避免重复）
      const wkey = `${agg.companyId}__${productCode}`;
      seenWarning.add(wkey);
      rows.push({
        companyId: agg.companyId,
        productCode,
        productName: product?.name || productCode,
        warehouseIds: whIds,
        currentStock,
        inTransitStock,
        availableStock,
        warningThreshold,
        totalDemand: agg.quantity,
        shortage: 0,
        channels: [...agg.channels],
        kind: 'warning',
        statusText: '低于库存预警',
      });
    }
  });

  // 2) 预警：本主体各仓 SKU 可用 ≤ 预警，即使没有要货
  const companyIds = opts.companyId
    ? [opts.companyId]
    : [...new Set(warehouseStore.warehouses.map(w => w.companyId))];

  companyIds.forEach(companyId => {
    const companyWhIds = warehouseStore.getWarehousesByCompany(companyId).map(w => w.id);
    if (!companyWhIds.length) return;

    productStore.products.forEach(product => {
      if (product.isCombined) return;
      const wkey = `${companyId}__${product.code}`;
      if (seenWarning.has(wkey)) return;
      // 若已有缺货行，不再重复加预警
      if (rows.some(r => r.companyId === companyId && r.productCode === product.code && r.kind === 'shortage')) {
        return;
      }

      const currentStock = stockStore.getTotalStock(product.code, companyWhIds);
      const inTransitStock = stockStore.getTotalInTransitStock(product.code, companyWhIds);
      const availableStock = currentStock + inTransitStock;
      if (availableStock <= product.warningThreshold) {
        // 完全无库存记录且阈值为0时跳过噪音
        const hasStockRow = stockStore.stocks.some(
          s => s.productCode === product.code && companyWhIds.includes(s.warehouseId),
        );
        if (!hasStockRow && availableStock === 0 && product.warningThreshold === 0) return;

        rows.push({
          companyId,
          productCode: product.code,
          productName: product.name,
          warehouseIds: companyWhIds,
          currentStock,
          inTransitStock,
          availableStock,
          warningThreshold: product.warningThreshold,
          totalDemand: demandAgg.get(wkey)?.quantity || 0,
          shortage: 0,
          channels: demandAgg.get(wkey) ? [...demandAgg.get(wkey)!.channels] : [],
          kind: 'warning',
          statusText: '低于库存预警',
        });
      }
    });
  });

  return rows.sort((a, b) => {
    if (a.companyId !== b.companyId) return a.companyId.localeCompare(b.companyId);
    if (a.kind !== b.kind) return a.kind === 'shortage' ? -1 : 1;
    return b.shortage - a.shortage || a.availableStock - b.availableStock;
  });
}
