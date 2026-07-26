import { useProductStore } from '../stores/product';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import type { Product } from '../types';

/** 指向某瓶规基础编码的箱规/组合商品 */
export function getPackProductsForBase(baseCode: string): Product[] {
  const productStore = useProductStore();
  return productStore.products.filter(
    p =>
      p.isCombined
      && p.combineProductCode === baseCode
      && p.combineRatio > 0
      && p.code !== baseCode,
  );
}

/**
 * 要货/库存口径统一到瓶规：
 * - 瓶规编码：原样
 * - 箱规编码：换成基础瓶规，数量因子=combineRatio
 */
export function resolveToBottleBase(productCode: string): { baseCode: string; factor: number } {
  const product = useProductStore().getProductByCode(productCode);
  if (product?.isCombined && product.combineProductCode && product.combineRatio > 0) {
    return { baseCode: product.combineProductCode, factor: product.combineRatio };
  }
  return { baseCode: productCode, factor: 1 };
}

export type PackStockBreakdown = {
  packCode: string;
  packName: string;
  ratio: number;
  stockUnits: number;
  inTransitUnits: number;
  asBottles: number;
  inTransitAsBottles: number;
};

/**
 * 瓶规等效库存 = 瓶规自身 + Σ(箱规库存 × 换算比例)
 * 业务要货按瓶规编码时，箱规仓存也要算进可用。
 */
export function getBottleEquivalentStock(
  productCode: string,
  warehouseIds?: string[],
): {
  baseCode: string;
  ownStock: number;
  ownInTransit: number;
  packStock: number;
  packInTransit: number;
  currentStock: number;
  inTransitStock: number;
  availableStock: number;
  packs: PackStockBreakdown[];
} {
  const stockStore = useWarehouseStockStore();
  const productStore = useProductStore();
  const { baseCode } = resolveToBottleBase(productCode);

  const ownStock = stockStore.getTotalStock(baseCode, warehouseIds);
  const ownInTransit = stockStore.getTotalInTransitStock(baseCode, warehouseIds);

  const packs: PackStockBreakdown[] = getPackProductsForBase(baseCode).map(pack => {
    const stockUnits = stockStore.getTotalStock(pack.code, warehouseIds);
    const inTransitUnits = stockStore.getTotalInTransitStock(pack.code, warehouseIds);
    return {
      packCode: pack.code,
      packName: pack.name,
      ratio: pack.combineRatio,
      stockUnits,
      inTransitUnits,
      asBottles: stockUnits * pack.combineRatio,
      inTransitAsBottles: inTransitUnits * pack.combineRatio,
    };
  });

  const packStock = packs.reduce((s, p) => s + p.asBottles, 0);
  const packInTransit = packs.reduce((s, p) => s + p.inTransitAsBottles, 0);
  const currentStock = ownStock + packStock;
  const inTransitStock = ownInTransit + packInTransit;

  // 若查的是未建档编码，仍返回自身仓存
  if (!productStore.getProductByCode(baseCode) && !packs.length) {
    const raw = stockStore.getAvailableStockByWarehouses(productCode, warehouseIds);
    const rawStock = stockStore.getTotalStock(productCode, warehouseIds);
    const rawTransit = stockStore.getTotalInTransitStock(productCode, warehouseIds);
    return {
      baseCode: productCode,
      ownStock: rawStock,
      ownInTransit: rawTransit,
      packStock: 0,
      packInTransit: 0,
      currentStock: rawStock,
      inTransitStock: rawTransit,
      availableStock: raw,
      packs: [],
    };
  }

  return {
    baseCode,
    ownStock,
    ownInTransit,
    packStock,
    packInTransit,
    currentStock,
    inTransitStock,
    availableStock: currentStock + inTransitStock,
    packs,
  };
}
