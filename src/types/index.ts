// 公司主体信息
export interface Company {
  id: string;
  name: string; // 公司名称
  code: string; // 公司编码
}

// 商品信息
export interface Product {
  id: string;
  code: string; // 商品编码
  name: string; // 商品名称
  spec: string; // 商品规格
  bottleUnit: string; // 瓶单位
  boxUnit: string; // 箱单位
  bottlesPerBox: number; // 每箱多少瓶
  stock: number; // 当前库存（瓶）
  warningThreshold: number; // 库存预警阈值（瓶）
  isCombined: boolean; // 是否为组合商品
  combineProductCode: string; // 组合商品对应的基础商品编码
  combineRatio: number; // 换算比例（如12表示1个组合商品=12个基础商品）
}

// 仓库信息
export interface Warehouse {
  id: string;
  name: string; // 仓库名称
  code: string; // 仓库编码
  companyId: string; // 所属主体ID
}

// 渠道信息
export interface Channel {
  id: string;
  name: string; // 渠道名称
  warehouseIds: string[]; // 允许选择的仓库ID列表
  priority: number; // 优先级（数字越小优先级越高，默认100）
  companyId: string; // 所属主体ID
}

// 要货单商品
export interface RequisitionItem {
  id: string;
  productCode: string; // 商品编码
  productName: string; // 商品名称
  quantity: number; // 数量
  remark: string; // 备注
}

// 要货单
export interface Requisition {
  id: string;
  channelId: string; // 渠道ID
  warehouseIds: string[]; // 仓库ID列表（多选）
  items: RequisitionItem[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

// 导入的要货数据
export interface ImportRequisitionData {
  productCode: string;
  productName: string;
  quantity: number;
  remark: string;
}

// 仓库库存
export interface WarehouseStock {
  id: string;
  warehouseId: string; // 仓库ID
  productCode: string; // 商品编码
  stock: number; // 库存数量（瓶）
  inTransitStock: number; // 在途库存（瓶）
  customFields?: Record<string, any>; // 自定义字段
}

// 导入的仓库库存数据
export interface ImportWarehouseStockData {
  warehouseCode: string; // 仓库编码
  productCode: string; // 商品编码
  productName: string; // 商品名称
  stock: number; // 库存数量（瓶）
  inTransitStock: number; // 在途库存（瓶）
  [key: string]: any; // 支持自定义字段
}

// 自定义字段配置
export interface CustomFieldConfig {
  key: string; // 字段键名
  label: string; // 显示名称
  type: 'text' | 'number' | 'date'; // 字段类型
}