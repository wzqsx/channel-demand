import { useRequisitionStore } from '../stores/requisition';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { useWarehouseStore } from '../stores/warehouse';
import { useProductStore } from '../stores/product';
import { useChannelStore } from '../stores/channel';
import { getBottleEquivalentStock, getPackProductsForBase } from './packStock';

export type AlertKind = 'shortage' | 'warning';

export interface ShortageAlertRow {
  companyId: string;
  productCode: string;
  productName: string;
  warehouseIds: string[];
  currentStock: number;
  inTransitStock: number;
  availableStock: number;
  /** 瓶规自身库存（不含箱规折算） */
  ownStock: number;
  /** 箱规折算进瓶规的数量 */
  packStock: number;
  warningThreshold: number;
  totalDemand: number;
  /**
   * 缺口（瓶）：
   * - 缺货：要货需求 − 可用
   * - 预警：补到预警线所需 = max(0, 预警线 − 可用)
   */
  shortage: number;
  channels: string[];
  /** shortage=缺货（需求>可用）；warning=低于预警 */
  kind: AlertKind;
  statusText: string;
}

/**
 * 按主体汇总缺货与预警。
 * - 缺货：指定周内 pending/approved 要货合计 > 单据所选仓库可用库存（含跨主体绑定仓）
 * - 预警：本主体仓库可用库存 ≤ 商品预警阈值（不依赖是否有要货）
 * 开单时的「高优先占」在提交校验里处理；本页按周合计需求做补货视角，不拆优先级。
 */
export function buildShortageAndWarnings(opts: {
  weekStart: string;
  companyId?: string;
  /** 多主体筛选；优先于 companyId */
  companyIds?: string[];
  /** 要货状态范围，默认待审批+已通过 */
  demandStatuses?: Array<'pending' | 'approved' | 'rejected'>;
}): ShortageAlertRow[] {
  const requisitionStore = useRequisitionStore();
  const stockStore = useWarehouseStockStore();
  const warehouseStore = useWarehouseStore();
  const productStore = useProductStore();
  const channelStore = useChannelStore();

  const companyFilter = opts.companyIds?.length
    ? new Set(opts.companyIds)
    : opts.companyId
      ? new Set([opts.companyId])
      : null;

  const statuses = opts.demandStatuses || ['pending', 'approved'];
  const demands = requisitionStore.requisitions.filter(r => {
    if (r.weekStart !== opts.weekStart) return false;
    if (!statuses.includes(r.status as 'pending' | 'approved')) return false;
    if (companyFilter && !companyFilter.has(r.companyId)) return false;
    const ch = channelStore.getChannelById(r.channelId);
    if (ch && ch.enabled === false) return false;
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
    // 与开单校验一致：单据所选仓（含跨主体绑定仓），仅剔除已删除的仓
    const whIds = (req.warehouseIds || []).filter(id => !!warehouseStore.getWarehouseById(id));
    if (!whIds.length) return;
    const channelName = channelStore.getChannelById(req.channelId)?.name || req.channelId;
    req.items.forEach(item => {
      const raw = productStore.getProductByCode(item.productCode);
      // 箱规编码要货折成瓶规需求
      let productCode = item.productCode;
      let quantity = item.quantity;
      if (raw?.isCombined && raw.combineProductCode && raw.combineRatio > 0) {
        productCode = raw.combineProductCode;
        quantity = item.quantity * raw.combineRatio;
      } else if (raw?.isCombined) {
        return;
      }
      const key = `${companyId}__${productCode}`;
      const prev = demandAgg.get(key);
      if (prev) {
        prev.quantity += quantity;
        prev.channels.add(channelName);
        whIds.forEach(id => prev.warehouseIds.add(id));
      } else {
        demandAgg.set(key, {
          companyId,
          quantity,
          channels: new Set([channelName]),
          warehouseIds: new Set(whIds),
        });
      }
    });
  });

  const rows: ShortageAlertRow[] = [];
  const seenWarning = new Set<string>();

  // 1) 缺货：有需求且缺口 > 0（可用含箱规折算）
  demandAgg.forEach((agg, key) => {
    const productCode = key.split('__')[1];
    const product = productStore.getProductByCode(productCode);
    if (product?.isCombined) return;

    const whIds = [...agg.warehouseIds];
    const eq = getBottleEquivalentStock(productCode, whIds);
    const currentStock = eq.currentStock;
    const inTransitStock = eq.inTransitStock;
    const availableStock = eq.availableStock;
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
        ownStock: eq.ownStock + eq.ownInTransit,
        packStock: eq.packStock + eq.packInTransit,
        warningThreshold,
        totalDemand: agg.quantity,
        shortage,
        channels: [...agg.channels],
        kind: 'shortage',
        statusText: availableStock === 0 ? '库存为0' : '需求超过可用',
      });
    } else if (availableStock <= warningThreshold) {
      const wkey = `${agg.companyId}__${productCode}`;
      seenWarning.add(wkey);
      const replenish = Math.max(0, warningThreshold - availableStock);
      rows.push({
        companyId: agg.companyId,
        productCode,
        productName: product?.name || productCode,
        warehouseIds: whIds,
        currentStock,
        inTransitStock,
        availableStock,
        ownStock: eq.ownStock + eq.ownInTransit,
        packStock: eq.packStock + eq.packInTransit,
        warningThreshold,
        totalDemand: agg.quantity,
        shortage: replenish,
        channels: [...agg.channels],
        kind: 'warning',
        statusText: replenish > 0 ? '低于预警，建议补货' : '触及预警线',
      });
    }
  });

  // 2) 预警：仅看瓶规；可用含箱规折算
  const companyIds = companyFilter
    ? [...companyFilter]
    : [...new Set(warehouseStore.warehouses.map(w => w.companyId))];

  companyIds.forEach(companyId => {
    const companyWhIds = warehouseStore.getWarehousesByCompany(companyId).map(w => w.id);
    if (!companyWhIds.length) return;

    productStore.products.forEach(product => {
      if (product.isCombined) return;
      const wkey = `${companyId}__${product.code}`;
      if (seenWarning.has(wkey)) return;
      if (rows.some(r => r.companyId === companyId && r.productCode === product.code && r.kind === 'shortage')) {
        return;
      }

      const eq = getBottleEquivalentStock(product.code, companyWhIds);
      const currentStock = eq.currentStock;
      const inTransitStock = eq.inTransitStock;
      const availableStock = eq.availableStock;
      if (availableStock <= product.warningThreshold) {
        const hasStockRow = stockStore.stocks.some(
          s =>
            companyWhIds.includes(s.warehouseId)
            && (s.productCode === product.code
              || getPackProductsForBase(product.code).some(p => p.code === s.productCode)),
        );
        if (!hasStockRow && availableStock === 0 && product.warningThreshold === 0) return;

        const replenish = Math.max(0, product.warningThreshold - availableStock);
        rows.push({
          companyId,
          productCode: product.code,
          productName: product.name,
          warehouseIds: companyWhIds,
          currentStock,
          inTransitStock,
          availableStock,
          ownStock: eq.ownStock + eq.ownInTransit,
          packStock: eq.packStock + eq.packInTransit,
          warningThreshold: product.warningThreshold,
          totalDemand: demandAgg.get(wkey)?.quantity || 0,
          shortage: replenish,
          channels: demandAgg.get(wkey) ? [...demandAgg.get(wkey)!.channels] : [],
          kind: 'warning',
          statusText: replenish > 0 ? '低于预警，建议补货' : '触及预警线',
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
