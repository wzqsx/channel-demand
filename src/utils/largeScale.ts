/**
 * 大单量约定（面向几万行库存 / 大批量导入）
 * - 大表用 shallowRef + markRaw，禁止深层响应
 * - 查询走索引（商品×仓 Map），禁止在循环里 filter 全表
 * - 表格只渲染当前页；排序/缺口等重计算只作用在可见数据或预聚合
 * - 导入写库后用本地结果更新内存，禁止再全量 HTTP 回读
 */
export const LARGE_STOCK_SOFT = 5000;
export const LARGE_STOCK_HARD = 20000;
export const UI_PAGE_SIZE = 100;
export const IMPORT_YIELD_CHUNK = 8000;

export function stockRowKey(warehouseId: string, productCode: string) {
  return `${warehouseId}__${productCode}`;
}
