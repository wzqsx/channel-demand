import { useProductStore } from '../stores/product';

export type QtyUnits = {
  bottlesPerBox: number;
  boxUnit?: string;
  bottleUnit?: string;
};

/** 瓶数 →「100箱零3瓶」；整箱无零头则「100箱」；不足一箱则「3瓶」 */
export function formatQtyWithUnits(qty: number, units: QtyUnits): string {
  const per = Math.max(1, Math.floor(units.bottlesPerBox || 1));
  const boxUnit = units.boxUnit || '箱';
  const bottleUnit = units.bottleUnit || '瓶';
  const n = Math.round(Number(qty) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const boxes = Math.floor(abs / per);
  const bottles = abs % per;

  if (boxes === 0 && bottles === 0) return `0${bottleUnit}`;
  if (boxes === 0) return `${sign}${bottles}${bottleUnit}`;
  if (bottles === 0) return `${sign}${boxes}${boxUnit}`;
  return `${sign}${boxes}${boxUnit}零${bottles}${bottleUnit}`;
}

export function formatProductQty(qty: number, productCode: string): string {
  const product = useProductStore().getProductByCode(productCode);
  if (!product) return String(Math.round(Number(qty) || 0));
  return formatQtyWithUnits(qty, product);
}
