import { useProductStore } from '../stores/product';

export type QtyUnits = {
  bottlesPerBox: number;
  boxUnit?: string;
  bottleUnit?: string;
};

/** 瓶数 →「100箱零3瓶」；整箱无零头则「100箱」；不足一箱则「3瓶」；负数 →「负10箱零3瓶」 */
export function formatQtyWithUnits(qty: number, units: QtyUnits): string {
  const per = Math.max(1, Math.floor(units.bottlesPerBox || 1));
  const boxUnit = units.boxUnit || '箱';
  const bottleUnit = units.bottleUnit || '瓶';
  const n = Math.round(Number(qty) || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const boxes = Math.floor(abs / per);
  const bottles = abs % per;

  let body = '';
  if (boxes === 0 && bottles === 0) body = `0${bottleUnit}`;
  else if (boxes === 0) body = `${bottles}${bottleUnit}`;
  else if (bottles === 0) body = `${boxes}${boxUnit}`;
  else body = `${boxes}${boxUnit}零${bottles}${bottleUnit}`;

  return neg ? `负${body}` : body;
}

export function formatProductQty(qty: number, productCode: string): string {
  const product = useProductStore().getProductByCode(productCode);
  if (!product) return String(Math.round(Number(qty) || 0));
  return formatQtyWithUnits(qty, product);
}
