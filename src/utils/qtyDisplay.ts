import { useProductStore } from '../stores/product';

export type QtyUnits = {
  bottlesPerBox: number;
  boxUnit?: string;
  bottleUnit?: string;
  productName?: string;
};

const BOX_LIKE = /^(箱|件|托|托盘)$/;

function cleanUnit(raw: unknown): string {
  let u = String(raw ?? '')
    .normalize('NFC')
    .replace(/[\s\u200b\u200c\u200d\ufeff]/g, '')
    .trim();
  if (u === '瓶子') return '瓶';
  if (u === '盒子') return '盒';
  if (u === '箱子') return '箱';
  return u;
}

function isDairyName(name?: string) {
  return /奶|乳|酸奶|牛奶/.test(String(name || ''));
}

/**
 * 箱单位 ← boxUnit；零头单位 ← bottleUnit（绝不复用箱单位）。
 */
export function resolveQtyUnits(units: QtyUnits): {
  bottlesPerBox: number;
  boxUnit: string;
  bottleUnit: string;
} {
  const per = Math.max(1, Math.floor(Number(units.bottlesPerBox) || 1));
  let boxUnit = cleanUnit(units.boxUnit) || '箱';
  let bottleUnit = cleanUnit(units.bottleUnit);

  if (!bottleUnit && isDairyName(units.productName)) bottleUnit = '盒';
  if (!bottleUnit) bottleUnit = '瓶';

  if (bottleUnit === boxUnit || BOX_LIKE.test(bottleUnit)) {
    if (isDairyName(units.productName)) bottleUnit = '盒';
    else bottleUnit = boxUnit === '瓶' ? '支' : '瓶';
    if (bottleUnit === boxUnit) bottleUnit = '个';
  }

  if (isDairyName(units.productName) && (bottleUnit === boxUnit || BOX_LIKE.test(bottleUnit))) {
    bottleUnit = '盒';
  }

  return { bottlesPerBox: per, boxUnit, bottleUnit };
}

export function normalizeQtyUnits(units: QtyUnits) {
  return resolveQtyUnits(units);
}

export type QtyFormatParts = {
  total: number;
  boxes: number;
  remainder: number;
  boxUnit: string;
  remainderUnit: string;
  smallUnit: string;
  neg: boolean;
  main: string;
  sub: string;
  full: string;
};

/**
 * 库存等「小单位总数」→ 箱 + 零头。
 * 例：300、每箱24、箱/盒 → 12箱＋12盒
 */
export function formatQtyParts(qty: number, units: QtyUnits): QtyFormatParts {
  const { bottlesPerBox: per, boxUnit, bottleUnit: smallUnit } = resolveQtyUnits(units);
  const total = Math.round(Number(qty) || 0);
  const neg = total < 0;
  const abs = Math.abs(total);
  const boxes = Math.floor(abs / per);
  const remainder = abs % per;

  let main: string;
  if (boxes === 0 && remainder === 0) {
    main = `0${smallUnit}`;
  } else if (boxes === 0) {
    main = `${remainder}${smallUnit}`;
  } else if (remainder === 0) {
    main = `${boxes}${boxUnit}`;
  } else {
    main = `${boxes}${boxUnit}＋${remainder}${smallUnit}`;
  }

  if (remainder > 0) {
    const safeSmall = smallUnit === '箱' || BOX_LIKE.test(smallUnit) ? '盒' : smallUnit;
    main = main.replace(/[＋零+](\d+)箱/g, `＋$1${safeSmall}`);
    if (
      new RegExp(`^\\d+${escapeRegExp(boxUnit)}[＋零+]\\d+${escapeRegExp(boxUnit)}$`).test(
        main.replace(/^负/, ''),
      )
    ) {
      main = `${boxes}${boxUnit}＋${remainder}${safeSmall}`;
    }
  }

  if (neg && !main.startsWith('负')) main = `负${main}`;
  const sub = `共${abs}${smallUnit}`;

  return {
    total,
    boxes: neg ? -boxes : boxes,
    remainder,
    boxUnit,
    remainderUnit: smallUnit,
    smallUnit,
    neg,
    main,
    sub,
    full: `${main}（${sub}）`,
  };
}

function escapeRegExp(s: string) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatQtyWithUnits(qty: number, units: QtyUnits): string {
  return formatQtyParts(qty, units).main;
}

export type WarningDisplay = {
  boxes: number;
  boxUnit: string;
  smallUnit: string;
  bottles: number;
  main: string;
  full: string;
};

/**
 * 预警阈值：录入单位是「箱」，展示只显示整箱，禁止再按小单位求余拼成「3箱＋8盒」。
 * 例：输入 3 箱、每箱 24 → 主文案「3箱」，完整「3箱（共72盒）」
 */
export function formatWarningBoxesDisplay(product: {
  warningThreshold: number;
  bottlesPerBox: number;
  boxUnit?: string;
  bottleUnit?: string;
  name?: string;
}): WarningDisplay {
  const { bottlesPerBox: per, boxUnit, bottleUnit: smallUnit } = resolveQtyUnits({
    bottlesPerBox: product.bottlesPerBox,
    boxUnit: product.boxUnit,
    bottleUnit: product.bottleUnit,
    productName: product.name,
  });
  const bottles = Math.max(0, Math.round(Number(product.warningThreshold) || 0));
  // 与弹窗「预警阈值(箱)」一致：按四舍五入整箱展示
  const boxes = Math.max(0, Math.round(bottles / per));
  const main = `${boxes}${boxUnit}`;
  const full = `${main}（共${bottles}${smallUnit}）`;
  return { boxes, boxUnit, smallUnit, bottles, main, full };
}

/** 将预警瓶数对齐为整箱（输入箱 × 每箱），避免 80 这种半箱残留 */
export function snapWarningToWholeBoxes(
  warningBottles: number,
  bottlesPerBox: number,
): number {
  const per = Math.max(1, Math.floor(Number(bottlesPerBox) || 1));
  const bottles = Math.max(0, Math.round(Number(warningBottles) || 0));
  const boxes = Math.max(0, Math.round(bottles / per));
  return boxes * per;
}

export function formatProductStockCell(product: {
  stock: number;
  bottlesPerBox: number;
  boxUnit?: string;
  bottleUnit?: string;
  name?: string;
}): string {
  return formatQtyParts(product.stock, {
    bottlesPerBox: product.bottlesPerBox,
    boxUnit: product.boxUnit,
    bottleUnit: product.bottleUnit,
    productName: product.name,
  }).main;
}

export function formatProductWarningCell(product: {
  warningThreshold: number;
  bottlesPerBox: number;
  boxUnit?: string;
  bottleUnit?: string;
  name?: string;
}): string {
  return formatWarningBoxesDisplay(product).main;
}

export function splitProductQty(
  qty: number,
  product: {
    bottlesPerBox: number;
    boxUnit?: string;
    bottleUnit?: string;
    name?: string;
  },
): QtyFormatParts {
  return formatQtyParts(qty, {
    bottlesPerBox: product.bottlesPerBox,
    boxUnit: product.boxUnit,
    bottleUnit: product.bottleUnit,
    productName: product.name,
  });
}

export function formatProductQty(qty: number, productCode: string): string {
  const product = useProductStore().getProductByCode(productCode);
  if (!product) return String(Math.round(Number(qty) || 0));
  return formatQtyParts(qty, {
    bottlesPerBox: product.bottlesPerBox,
    boxUnit: product.boxUnit,
    bottleUnit: product.bottleUnit,
    productName: product.name,
  }).main;
}

export function formatProductQtyFull(
  qty: number,
  product: {
    bottlesPerBox: number;
    boxUnit?: string;
    bottleUnit?: string;
    name?: string;
  },
): string {
  return formatQtyParts(qty, {
    bottlesPerBox: product.bottlesPerBox,
    boxUnit: product.boxUnit,
    bottleUnit: product.bottleUnit,
    productName: product.name,
  }).full;
}

export function boxesToBottles(boxes: number, bottlesPerBox: number): number {
  const per = Math.max(1, Math.floor(Number(bottlesPerBox) || 1));
  return Math.round((Number(boxes) || 0) * per);
}

export function bottlesToBoxes(bottles: number, bottlesPerBox: number): number {
  const per = Math.max(1, Math.floor(Number(bottlesPerBox) || 1));
  return Math.round(((Number(bottles) || 0) / per) * 1000) / 1000;
}
