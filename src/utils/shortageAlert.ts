import { useRequisitionStore } from '../stores/requisition';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { useWarehouseStore } from '../stores/warehouse';
import { useProductStore } from '../stores/product';
import { useChannelStore } from '../stores/channel';
import type { Product } from '../types';

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

type WhAgg = { stock: number; inTransit: number };

function sumProduct(
  index: Map<string, Map<string, WhAgg>>,
  productCode: string,
  warehouseIds: string[],
): WhAgg {
  const wm = index.get(productCode);
  if (!wm || !warehouseIds.length) return { stock: 0, inTransit: 0 };
  let stock = 0;
  let inTransit = 0;
  for (let i = 0; i < warehouseIds.length; i++) {
    const v = wm.get(warehouseIds[i]);
    if (v) {
      stock += v.stock;
      inTransit += v.inTransit;
    }
  }
  return { stock, inTransit };
}

function bottleEq(
  index: Map<string, Map<string, WhAgg>>,
  packsByBase: Map<string, Product[]>,
  productCode: string,
  warehouseIds: string[],
) {
  const packs = packsByBase.get(productCode) || [];
  const own = sumProduct(index, productCode, warehouseIds);
  let packStock = 0;
  let packInTransit = 0;
  for (let i = 0; i < packs.length; i++) {
    const p = packs[i];
    const a = sumProduct(index, p.code, warehouseIds);
    packStock += a.stock * p.combineRatio;
    packInTransit += a.inTransit * p.combineRatio;
  }
  const currentStock = own.stock + packStock;
  const inTransitStock = own.inTransit + packInTransit;
  return {
    ownStock: own.stock + own.inTransit,
    packStock: packStock + packInTransit,
    currentStock,
    inTransitStock,
    availableStock: currentStock + inTransitStock,
  };
}

function hasAnyRows(
  index: Map<string, Map<string, WhAgg>>,
  codes: string[],
  warehouseIds: string[],
): boolean {
  for (let i = 0; i < codes.length; i++) {
    const wm = index.get(codes[i]);
    if (!wm) continue;
    for (let j = 0; j < warehouseIds.length; j++) {
      if (wm.has(warehouseIds[j])) return true;
    }
  }
  return false;
}

/**
 * 按主体汇总缺货与预警。
 * 使用库存索引，复杂度约 O(公司×商品 + 要货行)，不再扫全库存表。
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

  const index = stockStore.productWhIndex as Map<string, Map<string, WhAgg>>;
  const packsByBase = new Map<string, Product[]>();
  for (const p of productStore.products) {
    if (
      p.isCombined
      && p.combineProductCode
      && p.combineRatio > 0
      && p.code !== p.combineProductCode
    ) {
      const list = packsByBase.get(p.combineProductCode) || [];
      list.push(p);
      packsByBase.set(p.combineProductCode, list);
    }
  }

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
    const whIds = (req.warehouseIds || []).filter(id => !!warehouseStore.getWarehouseById(id));
    if (!whIds.length) return;
    const channelName = channelStore.getChannelById(req.channelId)?.name || req.channelId;
    req.items.forEach(item => {
      const raw = productStore.getProductByCode(item.productCode);
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
  const shortageKeys = new Set<string>();

  demandAgg.forEach((agg, key) => {
    const productCode = key.split('__')[1];
    const product = productStore.getProductByCode(productCode);
    if (product?.isCombined) return;

    const whIds = [...agg.warehouseIds];
    const eq = bottleEq(index, packsByBase, productCode, whIds);
    const shortage = Math.max(0, agg.quantity - eq.availableStock);
    const warningThreshold = product?.warningThreshold ?? 0;

    if (shortage > 0) {
      shortageKeys.add(key);
      rows.push({
        companyId: agg.companyId,
        productCode,
        productName: product?.name || productCode,
        warehouseIds: whIds,
        currentStock: eq.currentStock,
        inTransitStock: eq.inTransitStock,
        availableStock: eq.availableStock,
        ownStock: eq.ownStock,
        packStock: eq.packStock,
        warningThreshold,
        totalDemand: agg.quantity,
        shortage,
        channels: [...agg.channels],
        kind: 'shortage',
        statusText: eq.availableStock === 0 ? '库存为0' : '需求超过可用',
      });
    } else if (eq.availableStock <= warningThreshold) {
      seenWarning.add(key);
      const replenish = Math.max(0, warningThreshold - eq.availableStock);
      rows.push({
        companyId: agg.companyId,
        productCode,
        productName: product?.name || productCode,
        warehouseIds: whIds,
        currentStock: eq.currentStock,
        inTransitStock: eq.inTransitStock,
        availableStock: eq.availableStock,
        ownStock: eq.ownStock,
        packStock: eq.packStock,
        warningThreshold,
        totalDemand: agg.quantity,
        shortage: replenish,
        channels: [...agg.channels],
        kind: 'warning',
        statusText: replenish > 0 ? '低于预警，建议补货' : '触及预警线',
      });
    }
  });

  const companyIds = companyFilter
    ? [...companyFilter]
    : [...new Set(warehouseStore.warehouses.map(w => w.companyId))];

  const bottleProducts = productStore.products.filter(p => !p.isCombined);

  companyIds.forEach(companyId => {
    const companyWhIds = warehouseStore.getWarehousesByCompany(companyId).map(w => w.id);
    if (!companyWhIds.length) return;

    for (let i = 0; i < bottleProducts.length; i++) {
      const product = bottleProducts[i];
      const wkey = `${companyId}__${product.code}`;
      if (seenWarning.has(wkey) || shortageKeys.has(wkey)) continue;

      const eq = bottleEq(index, packsByBase, product.code, companyWhIds);
      if (eq.availableStock > product.warningThreshold) continue;

      const packCodes = (packsByBase.get(product.code) || []).map(p => p.code);
      const hasStockRow = hasAnyRows(
        index,
        [product.code, ...packCodes],
        companyWhIds,
      );
      if (!hasStockRow && eq.availableStock === 0 && product.warningThreshold === 0) continue;

      const replenish = Math.max(0, product.warningThreshold - eq.availableStock);
      const demand = demandAgg.get(wkey);
      rows.push({
        companyId,
        productCode: product.code,
        productName: product.name,
        warehouseIds: companyWhIds,
        currentStock: eq.currentStock,
        inTransitStock: eq.inTransitStock,
        availableStock: eq.availableStock,
        ownStock: eq.ownStock,
        packStock: eq.packStock,
        warningThreshold: product.warningThreshold,
        totalDemand: demand?.quantity || 0,
        shortage: replenish,
        channels: demand ? [...demand.channels] : [],
        kind: 'warning',
        statusText: replenish > 0 ? '低于预警，建议补货' : '触及预警线',
      });
    }
  });

  return rows.sort((a, b) => {
    if (a.companyId !== b.companyId) return a.companyId.localeCompare(b.companyId);
    if (a.kind !== b.kind) return a.kind === 'shortage' ? -1 : 1;
    return b.shortage - a.shortage || a.availableStock - b.availableStock;
  });
}
