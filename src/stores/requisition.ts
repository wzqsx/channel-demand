import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Requisition, RequisitionItem, ImportRequisitionData } from '../types';

// 库存检查结果类型
export interface StockCheckResult {
  productCode: string;
  productName: string;
  demandQuantity: number; // 当前渠道要货数量
  totalDemandQuantity: number; // 含高优先级渠道的总需求数量
  availableStock: number; // 可用库存（当前+在途）
  warningThreshold: number; // 预警阈值
  status: 'ok' | 'low' | 'short'; // ok:正常, low:库存不足, short:缺货
  message: string;
}

export const useRequisitionStore = defineStore('requisition', () => {
  const requisitions = ref<Requisition[]>([]);

  const addRequisition = (channelId: string, warehouseIds: string[], items: ImportRequisitionData[]) => {
    const requisitionItems: RequisitionItem[] = items.map(item => ({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      productCode: item.productCode,
      productName: item.productName,
      quantity: item.quantity,
      remark: item.remark,
    }));

    const newRequisition: Requisition = {
      id: Date.now().toString(),
      channelId,
      warehouseIds,
      items: requisitionItems,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    requisitions.value.unshift(newRequisition);
    return newRequisition;
  };

  const approveRequisition = (id: string) => {
    const index = requisitions.value.findIndex(r => r.id === id);
    if (index !== -1) {
      requisitions.value[index].status = 'approved';
    }
  };

  const rejectRequisition = (id: string) => {
    const index = requisitions.value.findIndex(r => r.id === id);
    if (index !== -1) {
      requisitions.value[index].status = 'rejected';
    }
  };

  const deleteRequisition = (id: string) => {
    const index = requisitions.value.findIndex(r => r.id === id);
    if (index !== -1) {
      requisitions.value.splice(index, 1);
    }
  };

  const getRequisitionById = (id: string) => {
    return requisitions.value.find(r => r.id === id);
  };

  const getRequisitionsByChannel = (channelId: string) => {
    return requisitions.value.filter(r => r.channelId === channelId);
  };

  // 获取待审批的要货单中某商品的总需求数量
  const getPendingDemandByProduct = (productCode: string) => {
    return requisitions.value
      .filter(r => r.status === 'pending')
      .flatMap(r => r.items)
      .filter(item => item.productCode === productCode)
      .reduce((sum, item) => sum + item.quantity, 0);
  };

  // 获取指定渠道待审批的要货单中某商品的需求数量
  const getPendingDemandByProductAndChannel = (productCode: string, channelId: string) => {
    return requisitions.value
      .filter(r => r.status === 'pending' && r.channelId === channelId)
      .flatMap(r => r.items)
      .filter(item => item.productCode === productCode)
      .reduce((sum, item) => sum + item.quantity, 0);
  };

  // 获取指定渠道及其更高优先级渠道的待审批要货单中某商品的需求数量
  const getPendingDemandByProductAndHigherPriority = (productCode: string, channelId: string, higherPriorityChannelIds: string[]) => {
    const allChannelIds = [channelId, ...higherPriorityChannelIds];
    return requisitions.value
      .filter(r => r.status === 'pending' && allChannelIds.includes(r.channelId))
      .flatMap(r => r.items)
      .filter(item => item.productCode === productCode)
      .reduce((sum, item) => sum + item.quantity, 0);
  };

  // 检查库存是否足够
  const checkStockAvailability = (
    productCode: string,
    demandQuantity: number,
    warningThreshold: number,
    availableStock: number,
    higherPriorityDemand: number = 0
  ): StockCheckResult => {
    // 计算扣除高优先级渠道需求后的剩余库存
    const remainingStock = availableStock - higherPriorityDemand;
    
    const totalDemand = demandQuantity + higherPriorityDemand;
    
    let status: 'ok' | 'low' | 'short' = 'ok';
    let message = '';

    if (remainingStock < demandQuantity) {
      // 缺货：扣除高优先级需求后，库存不足以满足当前渠道需求
      status = 'short';
      message = `缺货！可用库存 ${availableStock}，高优先级渠道已占 ${higherPriorityDemand}，当前渠道需求 ${demandQuantity}`;
    } else if (availableStock < totalDemand + warningThreshold) {
      // 库存不足：可用库存满足需求，但低于预警值
      status = 'low';
      message = `库存不足！可用库存 ${availableStock}，需求 ${totalDemand}，预警阈值 ${warningThreshold}`;
    } else {
      // 正常
      status = 'ok';
      message = `库存充足，可用库存 ${availableStock}，需求 ${totalDemand}`;
    }

    return {
      productCode,
      productName: '',
      demandQuantity,
      totalDemandQuantity: totalDemand,
      availableStock,
      warningThreshold,
      status,
      message,
    };
  };

  return {
    requisitions,
    addRequisition,
    approveRequisition,
    rejectRequisition,
    deleteRequisition,
    getRequisitionById,
    getRequisitionsByChannel,
    getPendingDemandByProduct,
    getPendingDemandByProductAndChannel,
    getPendingDemandByProductAndHigherPriority,
    checkStockAvailability,
  };
});