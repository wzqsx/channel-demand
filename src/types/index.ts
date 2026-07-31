// 公司主体信息
export interface Company {
  id: string;
  name: string;
  code: string;
}

// 商品信息
export interface Product {
  id: string;
  code: string;
  name: string;
  spec: string;
  bottleUnit: string;
  boxUnit: string;
  bottlesPerBox: number;
  stock: number;
  warningThreshold: number;
  isCombined: boolean;
  combineProductCode: string;
  combineRatio: number;
}

// 仓库信息
export interface Warehouse {
  id: string;
  name: string;
  code: string;
  companyId: string;
}

// 渠道信息
export interface Channel {
  id: string;
  /** 渠道编码，唯一标识 */
  code: string;
  name: string;
  warehouseIds: string[];
  /** 1–20，数字越小优先级越高；在各关联主体内分别参与占库存竞争 */
  priority: number;
  /**
   * 关联主体（可多选）。由勾选仓库推导并与表单勾选合并。
   * 旧数据可能只有 companyId，读取时请用 getChannelCompanyIds。
   */
  companyIds: string[];
  /**
   * 主主体（兼容字段，一般为 companyIds[0]）。
   * 要货单仍按单主体开单；筛选时用「渠道是否包含该主体」。
   */
  companyId: string;
  /** 停用后不参与要货占库存与渠道下拉 */
  enabled: boolean;
}

// 要货/销货明细行
export interface RequisitionItem {
  id: string;
  productCode: string;
  productName: string;
  quantity: number;
  remark: string;
}

// 要货单
export interface Requisition {
  id: string;
  companyId: string;
  channelId: string;
  warehouseIds: string[];
  /** 周起始（周六 YYYY-MM-DD） */
  weekStart: string;
  items: RequisitionItem[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  /** 本周实际销货（审批后录入，用于核对是否虚报） */
  salesItems?: RequisitionItem[];
  salesFilledAt?: string;
}

export interface ImportRequisitionData {
  /** 主体编码（与名称填一个即可） */
  companyCode?: string;
  /** 主体名称（与编码填一个即可） */
  companyName?: string;
  /** 渠道编码（与名称填一个即可） */
  channelCode?: string;
  /** 渠道名称（与编码填一个即可） */
  channelName?: string;
  /** 仓库编码或名称，逗号分隔（可选；空则自动勾选渠道全部绑定仓） */
  warehouseCodes?: string;
  productCode: string;
  productName: string;
  quantity: number;
  remark: string;
}

export interface WarehouseStock {
  id: string;
  warehouseId: string;
  productCode: string;
  stock: number;
  inTransitStock: number;
  customFields?: Record<string, any>;
}

export interface ImportWarehouseStockData {
  /** 仓库编码；也可填仓库名称（导出无编码时） */
  warehouseCode: string;
  /** 仓库名称（可选；与编码二选一或同时提供） */
  warehouseName?: string;
  productCode: string;
  productName: string;
  stock: number;
  inTransitStock: number;
  [key: string]: any;
}

export interface CustomFieldConfig {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
}

export type FieldType = 'text' | 'number' | 'date';

export interface StockSnapshot {
  id: string;
  snapshotTime: string;
  description: string;
  /** 关联周起始（可选） */
  weekStart?: string;
  stocks: WarehouseStock[];
  /** 创建时缓存的库存数量合计，避免列表反复 reduce */
  totalQty?: number;
}

/** 要货 vs 实际销货对比行 */
export interface DemandSalesCompareRow {
  productCode: string;
  productName: string;
  demandQty: number;
  salesQty: number;
  /** 虚报量 = max(0, 要货 - 销货) */
  overClaim: number;
  /** 要货/销货 比率；销货为 0 时为 Infinity */
  ratio: number;
  /** accurate | overclaim | underclaim | no_sales | no_demand */
  status: 'accurate' | 'overclaim' | 'underclaim' | 'no_sales' | 'no_demand';
}

export interface RequisitionAnalysis {
  productCode: string;
  productName: string;
  availableStock: number;
  requestedQuantity: number;
  shortage: number;
  status: 'can_supply' | 'cannot_supply' | 'insufficient';
  channels: string[];
}
