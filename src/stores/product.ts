import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Product } from '../types';

function snapWarningToWholeBoxes(warningBottles: number, bottlesPerBox: number): number {
  const per = Math.max(1, Math.floor(Number(bottlesPerBox) || 1));
  const bottles = Math.max(0, Math.round(Number(warningBottles) || 0));
  return Math.max(0, Math.round(bottles / per)) * per;
}

export const useProductStore = defineStore('product', () => {
  const products = ref<Product[]>([]);

  // 如果已有数据，不再初始化种子；但纠正组合品「每箱瓶数≠换算比例」与单位冲突
  const initProducts = () => {
    if (products.value.length > 0) {
      products.value.forEach((p, i) => {
        let next = { ...p };
        let changed = false;
        if (p.isCombined && p.combineRatio > 0 && p.bottlesPerBox !== p.combineRatio) {
          next.bottlesPerBox = p.combineRatio;
          changed = true;
        }
        const boxUnit = String(next.boxUnit || '箱').trim() || '箱';
        let bottleUnit = String(next.bottleUnit || '瓶').trim() || '瓶';
        if (bottleUnit === '瓶子') {
          bottleUnit = '瓶';
          next.bottleUnit = '瓶';
          changed = true;
        } else if (bottleUnit === '盒子') {
          bottleUnit = '盒';
          next.bottleUnit = '盒';
          changed = true;
        }
        const isDairy = /奶|乳|酸奶|牛奶/.test(next.name || '');
        // 奶类：箱单位=箱，零头单位=盒（彻底避免箱零箱）
        if (isDairy) {
          if (boxUnit !== '箱' || bottleUnit !== '盒') {
            next.boxUnit = '箱';
            next.bottleUnit = '盒';
            changed = true;
          }
        } else if (bottleUnit === boxUnit || /箱|件|托盘?/.test(bottleUnit)) {
          bottleUnit = boxUnit === '瓶' ? '支' : '瓶';
          if (bottleUnit === boxUnit) bottleUnit = '个';
          next.boxUnit = boxUnit;
          next.bottleUnit = bottleUnit;
          changed = true;
        }
        // 预警按「箱」录入，对齐为整箱瓶数，避免表格出现 3箱＋8…
        const snapped = snapWarningToWholeBoxes(next.warningThreshold, next.bottlesPerBox);
        if (snapped !== next.warningThreshold) {
          next.warningThreshold = snapped;
          changed = true;
        }
        if (changed) products.value[i] = next;
      });
      return;
    }
    products.value = [
      { id: '1', code: 'P001', name: '矿泉水500ml', spec: '500ml', bottleUnit: '瓶', boxUnit: '箱', bottlesPerBox: 24, stock: 500, warningThreshold: 96, isCombined: false, combineProductCode: '', combineRatio: 0 },
      { id: '2', code: 'P002', name: '可乐330ml', spec: '330ml', bottleUnit: '瓶', boxUnit: '箱', bottlesPerBox: 24, stock: 50, warningThreshold: 96, isCombined: false, combineProductCode: '', combineRatio: 0 },
      { id: '3', code: 'P003', name: '果汁1L', spec: '1L', bottleUnit: '瓶', boxUnit: '箱', bottlesPerBox: 12, stock: 200, warningThreshold: 48, isCombined: false, combineProductCode: '', combineRatio: 0 },
      { id: '4', code: 'P004', name: '啤酒500ml', spec: '500ml', bottleUnit: '瓶', boxUnit: '箱', bottlesPerBox: 12, stock: 10, warningThreshold: 48, isCombined: false, combineProductCode: '', combineRatio: 0 },
      { id: '5', code: 'P005', name: '牛奶250ml', spec: '250ml', bottleUnit: '盒', boxUnit: '箱', bottlesPerBox: 24, stock: 300, warningThreshold: 72, isCombined: false, combineProductCode: '', combineRatio: 0 },
      { id: '6', code: 'P0012', name: '矿泉水一打', spec: '500ml*12', bottleUnit: '打', boxUnit: '箱', bottlesPerBox: 12, stock: 0, warningThreshold: 12, isCombined: true, combineProductCode: 'P001', combineRatio: 12 },
    ];
  };

  // 获取库存预警商品列表
  const warningProducts = computed(() => {
    return products.value.filter(p => p.stock <= p.warningThreshold);
  });

  // 获取库存预警数量
  const warningCount = computed(() => warningProducts.value.length);

  // 判断商品是否需要预警
  const isWarning = (product: Product) => {
    return product.stock <= product.warningThreshold;
  };

  // 获取基础商品列表（非组合商品）
  const baseProducts = computed(() => {
    return products.value.filter(p => !p.isCombined);
  });

  // 组合商品换算：将组合商品数量换算为基础商品数量
  const convertCombinedQuantity = (productCode: string, quantity: number): { baseCode: string; baseQuantity: number } => {
    const product = getProductByCode(productCode);
    if (product && product.isCombined && product.combineProductCode && product.combineRatio > 0) {
      return {
        baseCode: product.combineProductCode,
        baseQuantity: quantity * product.combineRatio,
      };
    }
    return {
      baseCode: productCode,
      baseQuantity: quantity,
    };
  };

  const updateProduct = (id: string, product: Partial<Product>) => {
    const index = products.value.findIndex(p => p.id === id);
    if (index === -1) return false;
    const next = { ...products.value[index], ...product };
    if (next.isCombined && next.combineRatio > 0) {
      next.bottlesPerBox = next.combineRatio;
    }
    products.value = products.value.map((p, i) => (i === index ? next : p));
    return true;
  };

  const addProduct = (product: Omit<Product, 'id'>) => {
    const bottlesPerBox =
      product.isCombined && product.combineRatio > 0
        ? product.combineRatio
        : product.bottlesPerBox;
    const newProduct: Product = {
      ...product,
      bottlesPerBox,
      id: Date.now().toString(),
      isCombined: product.isCombined || false,
      combineProductCode: product.combineProductCode || '',
      combineRatio: product.combineRatio || 0,
    };
    products.value.push(newProduct);
  };

  const deleteProduct = (id: string) => {
    const index = products.value.findIndex(p => p.id === id);
    if (index !== -1) {
      products.value.splice(index, 1);
    }
  };

  const getProductByCode = (code: string) => {
    return products.value.find(p => p.code === code);
  };

  const upsertByCode = (data: Omit<Product, 'id'>) => {
    const existing = getProductByCode(data.code);
    if (existing) {
      updateProduct(existing.id, data);
      return existing.id;
    }
    addProduct(data);
    return products.value[products.value.length - 1]?.id;
  };

  /** 批量更新；patch 为每条商品生成的字段 */
  const batchUpdate = (ids: string[], patchFn: (product: Product) => Partial<Product>) => {
    let n = 0;
    const idSet = new Set(ids);
    products.value = products.value.map(p => {
      if (!idSet.has(p.id)) return p;
      n += 1;
      const next = { ...p, ...patchFn(p) };
      if (next.isCombined && next.combineRatio > 0) {
        next.bottlesPerBox = next.combineRatio;
      }
      return next;
    });
    return n;
  };

  return {
    products,
    warningProducts,
    warningCount,
    isWarning,
    baseProducts,
    convertCombinedQuantity,
    initProducts,
    addProduct,
    updateProduct,
    deleteProduct,
    getProductByCode,
    upsertByCode,
    batchUpdate,
  };
}, {
  persist: true,
});