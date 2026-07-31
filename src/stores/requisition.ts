import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  Requisition,
  RequisitionItem,
  ImportRequisitionData,
  DemandSalesCompareRow,
} from '../types';
import { useChannelStore } from './channel';
import { useWarehouseStore } from './warehouse';
import { weekStartSaturday, periodKey, completionRate, type PeriodGrain } from '../utils/week';
import { assertRequisitionScope } from '../utils/companyScope';

export interface StockCheckResult {
  productCode: string;
  productName: string;
  demandQuantity: number;
  totalDemandQuantity: number;
  availableStock: number;
  higherPriorityDemand: number;
  warningThreshold: number;
  status: 'ok' | 'low' | 'short';
  message: string;
}

function overlaps(a: string[], b: string[]) {
  if (!a.length || !b.length) return true;
  return a.some(id => b.includes(id));
}

export const useRequisitionStore = defineStore('requisition', () => {
  const requisitions = ref<Requisition[]>([]);

  /** 兼容旧本地数据：补 companyId / weekStart；保留渠道绑定内的跨主体仓 */
  const migrateLegacy = () => {
    const channelStore = useChannelStore();
    let changed = false;
    requisitions.value.forEach(r => {
      const anyRow = r as Requisition & { companyId?: string; weekStart?: string };
      if (!anyRow.companyId) {
        anyRow.companyId = channelStore.getChannelById(r.channelId)?.companyId || '';
        changed = true;
      }
      if (!anyRow.weekStart) {
        anyRow.weekStart = weekStartSaturday(r.createdAt);
        changed = true;
      }
      // 仅清理无效仓 ID；不再按主体过滤（多主体发货合法）
      if (anyRow.warehouseIds?.length) {
        const whStore = useWarehouseStore();
        const valid = anyRow.warehouseIds.filter(id => !!whStore.getWarehouseById(id));
        if (valid.length !== anyRow.warehouseIds.length) {
          anyRow.warehouseIds = valid;
          changed = true;
        }
      }
    });
    return changed;
  };

  const addRequisition = (
    companyId: string,
    channelId: string,
    warehouseIds: string[],
    items: ImportRequisitionData[],
    weekStart?: string,
  ) => {
    const scope = assertRequisitionScope({ companyId, channelId, warehouseIds });
    if (!scope.ok) {
      throw new Error(scope.message);
    }

    const requisitionItems: RequisitionItem[] = items.map(item => ({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 9),
      productCode: item.productCode,
      productName: item.productName,
      quantity: item.quantity,
      remark: item.remark,
    }));

    const newRequisition: Requisition = {
      id: 'RQ' + Date.now().toString(),
      companyId,
      channelId,
      warehouseIds: scope.warehouseIds,
      weekStart: weekStart || weekStartSaturday(),
      items: requisitionItems,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    requisitions.value.unshift(newRequisition);
    return newRequisition;
  };

  const approveRequisition = (id: string) => {
    const row = requisitions.value.find(r => r.id === id);
    if (row) row.status = 'approved';
  };

  const rejectRequisition = (id: string) => {
    const row = requisitions.value.find(r => r.id === id);
    if (row) row.status = 'rejected';
  };

  const deleteRequisition = (id: string) => {
    const index = requisitions.value.findIndex(r => r.id === id);
    if (index !== -1) requisitions.value.splice(index, 1);
  };

  const getRequisitionById = (id: string) => requisitions.value.find(r => r.id === id);

  const getRequisitionsByChannel = (channelId: string) =>
    requisitions.value.filter(r => r.channelId === channelId);

  const getRequisitionsByWeek = (weekStart: string) =>
    requisitions.value.filter(r => r.weekStart === weekStart);

  /** 待审批中某商品总需求（可选限定仓库重叠） */
  const getPendingDemandByProduct = (productCode: string, warehouseIds?: string[]) =>
    requisitions.value
      .filter(r => r.status === 'pending' && (!warehouseIds || overlaps(r.warehouseIds, warehouseIds)))
      .flatMap(r => r.items)
      .filter(item => item.productCode === productCode)
      .reduce((sum, item) => sum + item.quantity, 0);

  const getPendingDemandByProductAndChannel = (
    productCode: string,
    channelId: string,
    warehouseIds?: string[],
  ) =>
    requisitions.value
      .filter(
        r =>
          r.status === 'pending' &&
          r.channelId === channelId &&
          (!warehouseIds || overlaps(r.warehouseIds, warehouseIds)),
      )
      .flatMap(r => r.items)
      .filter(item => item.productCode === productCode)
      .reduce((sum, item) => sum + item.quantity, 0);

  /**
   * 同主体更高优先级渠道的占用（待审批+已通过；仓库有交集才算竞争同一库存池）
   * 不含当前渠道自身已提报量。停用渠道不参与。
   * 一次扫要货列表累加，避免 items 多次 flatMap。
   */
  const getHigherPriorityPendingDemand = (
    productCode: string,
    channelId: string,
    warehouseIds: string[],
    companyId?: string,
  ) => {
    const channelStore = useChannelStore();
    const higher = channelStore.getHigherPriorityChannels(channelId, companyId);
    if (!higher.length) return 0;
    const higherIds = new Set(higher.map(c => c.id));
    let sum = 0;
    const list = requisitions.value;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.status !== 'pending' && r.status !== 'approved') continue;
      if (!higherIds.has(r.channelId)) continue;
      if (companyId && r.companyId !== companyId) continue;
      if (!overlaps(r.warehouseIds, warehouseIds)) continue;
      const items = r.items;
      for (let j = 0; j < items.length; j++) {
        if (items[j].productCode === productCode) sum += items[j].quantity;
      }
    }
    return sum;
  };

  const checkStockAvailability = (
    productCode: string,
    demandQuantity: number,
    warningThreshold: number,
    availableStock: number,
    higherPriorityDemand: number = 0,
  ): StockCheckResult => {
    const remainingStock = availableStock - higherPriorityDemand;
    const totalDemand = demandQuantity + higherPriorityDemand;
    let status: 'ok' | 'low' | 'short' = 'ok';
    let message = '';

    if (remainingStock < demandQuantity) {
      status = 'short';
      message = `缺货！可用 ${availableStock}，高优已占 ${higherPriorityDemand}，本渠需求 ${demandQuantity}`;
    } else if (availableStock < totalDemand + warningThreshold) {
      status = 'low';
      message = `库存偏低！可用 ${availableStock}，需求合计 ${totalDemand}，预警 ${warningThreshold}`;
    } else {
      status = 'ok';
      message = `库存充足，可用 ${availableStock}`;
    }

    return {
      productCode,
      productName: '',
      demandQuantity,
      totalDemandQuantity: totalDemand,
      availableStock,
      higherPriorityDemand,
      warningThreshold,
      status,
      message,
    };
  };

  /** 录入 / 更新本周实际销货 */
  const saveSalesItems = (id: string, sales: ImportRequisitionData[]) => {
    const row = requisitions.value.find(r => r.id === id);
    if (!row) return false;
    row.salesItems = sales.map(item => ({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 9),
      productCode: item.productCode,
      productName: item.productName,
      quantity: item.quantity,
      remark: item.remark || '',
    }));
    row.salesFilledAt = new Date().toISOString();
    return true;
  };

  /**
   * 要货 vs 实际销货对比。
   * overclaimThreshold: 要货超过销货的比例（如 1.3 = 超 30% 判虚报）
   */
  const compareDemandVsSales = (
    requisitionId: string,
    overclaimThreshold = 1.3,
  ): DemandSalesCompareRow[] => {
    const row = getRequisitionById(requisitionId);
    if (!row) return [];

    const demandMap = new Map<string, { name: string; qty: number }>();
    row.items.forEach(it => {
      const prev = demandMap.get(it.productCode);
      if (prev) prev.qty += it.quantity;
      else demandMap.set(it.productCode, { name: it.productName, qty: it.quantity });
    });

    const salesMap = new Map<string, { name: string; qty: number }>();
    (row.salesItems || []).forEach(it => {
      const prev = salesMap.get(it.productCode);
      if (prev) prev.qty += it.quantity;
      else salesMap.set(it.productCode, { name: it.productName, qty: it.quantity });
    });

    const codes = new Set([...demandMap.keys(), ...salesMap.keys()]);
    const results: DemandSalesCompareRow[] = [];

    codes.forEach(code => {
      const demandQty = demandMap.get(code)?.qty || 0;
      const salesQty = salesMap.get(code)?.qty || 0;
      const name = demandMap.get(code)?.name || salesMap.get(code)?.name || code;
      const overClaim = Math.max(0, demandQty - salesQty);
      const ratio = salesQty > 0 ? demandQty / salesQty : demandQty > 0 ? Infinity : 1;

      let status: DemandSalesCompareRow['status'] = 'accurate';
      if (demandQty === 0 && salesQty > 0) status = 'no_demand';
      else if (salesQty === 0 && demandQty > 0) status = 'no_sales';
      else if (ratio >= overclaimThreshold) status = 'overclaim';
      else if (salesQty > demandQty * 1.2) status = 'underclaim';
      else status = 'accurate';

      results.push({
        productCode: code,
        productName: name,
        demandQty,
        salesQty,
        overClaim,
        ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : Infinity,
        status,
      });
    });

    return results.sort((a, b) => b.overClaim - a.overClaim);
  };

  /** 按周汇总虚报概况 */
  const weekOverclaimSummary = (weekStart: string, overclaimThreshold = 1.3) => {
    const list = getRequisitionsByWeek(weekStart).filter(r => r.status === 'approved');
    return list.map(r => {
      const rows = compareDemandVsSales(r.id, overclaimThreshold);
      const demandTotal = rows.reduce((s, x) => s + x.demandQty, 0);
      const salesTotal = rows.reduce((s, x) => s + x.salesQty, 0);
      const overClaimTotal = rows.reduce((s, x) => s + x.overClaim, 0);
      const overclaimSkus = rows.filter(x => x.status === 'overclaim' || x.status === 'no_sales').length;
      return {
        requisitionId: r.id,
        channelId: r.channelId,
        companyId: r.companyId,
        hasSales: !!(r.salesItems && r.salesItems.length),
        demandTotal,
        salesTotal,
        overClaimTotal,
        overclaimSkus,
        fillRate: demandTotal > 0 ? Math.round((salesTotal / demandTotal) * 1000) / 10 : 0,
        /** 完成率 = 销货/要货（与 fillRate 同值，统一命名） */
        completionRate: demandTotal > 0 ? Math.round((salesTotal / demandTotal) * 1000) / 10 : 0,
      };
    });
  };

  /**
   * 渠道要货总览：按周/月/季/年汇总各渠道完成率
   * 完成率 = 实际销货 ÷ 要货；>100% 为超额完成
   */
  const channelOverview = (opts: {
    grain: PeriodGrain;
    year?: number;
    companyId?: string;
    /** 多主体筛选；优先于 companyId */
    companyIds?: string[];
    /** 仅统计已录销货的单据；false 则含未录（销货按0） */
    onlyWithSales?: boolean;
  }) => {
    const grain = opts.grain;
    const onlyWithSales = opts.onlyWithSales !== false;
    const year = opts.year;
    const companySet = opts.companyIds?.length
      ? new Set(opts.companyIds)
      : opts.companyId
        ? new Set([opts.companyId])
        : null;

    type Agg = {
      period: string;
      channelId: string;
      companyId: string;
      demandTotal: number;
      salesTotal: number;
      requisitionCount: number;
      withSalesCount: number;
    };
    const map = new Map<string, Agg>();

    requisitions.value
      .filter(r => r.status === 'approved')
      .filter(r => !companySet || companySet.has(r.companyId))
      .forEach(r => {
        const y = new Date(r.weekStart + 'T00:00:00').getFullYear();
        if (year && y !== year) return;
        const hasSales = !!(r.salesItems && r.salesItems.length);
        if (onlyWithSales && !hasSales) return;

        const period = periodKey(r.weekStart, grain);
        const key = `${period}__${r.channelId}`;
        const demand = r.items.reduce((s, i) => s + i.quantity, 0);
        const sales = (r.salesItems || []).reduce((s, i) => s + i.quantity, 0);

        const prev = map.get(key);
        if (prev) {
          prev.demandTotal += demand;
          prev.salesTotal += sales;
          prev.requisitionCount += 1;
          if (hasSales) prev.withSalesCount += 1;
        } else {
          map.set(key, {
            period,
            channelId: r.channelId,
            companyId: r.companyId,
            demandTotal: demand,
            salesTotal: sales,
            requisitionCount: 1,
            withSalesCount: hasSales ? 1 : 0,
          });
        }
      });

    return [...map.values()]
      .map(row => {
        const rate = completionRate(row.salesTotal, row.demandTotal);
        const excess = Math.max(0, row.salesTotal - row.demandTotal);
        const shortfall = Math.max(0, row.demandTotal - row.salesTotal);
        let rankTag: 'top' | 'excess' | 'normal' | 'low' = 'normal';
        if (rate >= 100) rankTag = 'excess';
        else if (rate >= 80) rankTag = 'normal';
        else rankTag = 'low';
        return {
          ...row,
          completionRate: rate,
          excessQty: excess,
          shortfallQty: shortfall,
          isExcess: rate > 100,
          rankTag,
        };
      })
      .sort((a, b) => {
        if (a.period !== b.period) return a.period < b.period ? 1 : -1;
        return b.completionRate - a.completionRate;
      });
  };

  /** 导出用：要货单扁平明细 */
  const exportDemandFlat = (weekStart?: string) => {
    const list = weekStart ? getRequisitionsByWeek(weekStart) : requisitions.value;
    const rows: Record<string, any>[] = [];
    list.forEach(r => {
      r.items.forEach(it => {
        rows.push({
          单号: r.id,
          周起始: r.weekStart,
          主体ID: r.companyId,
          渠道ID: r.channelId,
          状态: r.status,
          商品编码: it.productCode,
          商品名称: it.productName,
          要货数量: it.quantity,
          备注: it.remark || '',
        });
      });
    });
    return rows;
  };

  /** 导出用：要货+销货+完成率 */
  const exportSalesCompareFlat = (weekStart?: string) => {
    const list = (weekStart ? getRequisitionsByWeek(weekStart) : requisitions.value).filter(
      r => r.status === 'approved',
    );
    const rows: Record<string, any>[] = [];
    list.forEach(r => {
      const compare = compareDemandVsSales(r.id);
      compare.forEach(c => {
        rows.push({
          单号: r.id,
          周起始: r.weekStart,
          主体ID: r.companyId,
          渠道ID: r.channelId,
          商品编码: c.productCode,
          商品名称: c.productName,
          要货数量: c.demandQty,
          销货数量: c.salesQty,
          虚报量: c.overClaim,
          完成率: c.demandQty > 0 ? completionRate(c.salesQty, c.demandQty) + '%' : '-',
          结论: c.status,
        });
      });
    });
    return rows;
  };

  /** 主体去重后，把要货单上的旧 companyId 映射到标准 id */
  const remapCompanyIds = (idMap: Record<string, string>) => {
    let n = 0;
    requisitions.value = requisitions.value.map(r => {
      const nextId = idMap[r.companyId];
      if (!nextId || nextId === r.companyId) return r;
      n += 1;
      return { ...r, companyId: nextId };
    });
    return n;
  };

  return {
    requisitions,
    migrateLegacy,
    remapCompanyIds,
    addRequisition,
    approveRequisition,
    rejectRequisition,
    deleteRequisition,
    getRequisitionById,
    getRequisitionsByChannel,
    getRequisitionsByWeek,
    getPendingDemandByProduct,
    getPendingDemandByProductAndChannel,
    getHigherPriorityPendingDemand,
    checkStockAvailability,
    saveSalesItems,
    compareDemandVsSales,
    weekOverclaimSummary,
    channelOverview,
    exportDemandFlat,
    exportSalesCompareFlat,
  };
}, { persist: true });
