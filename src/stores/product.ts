import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Product } from '../types';

export const useProductStore = defineStore('product', () => {
  const products = ref<Product[]>([]);

  // 模拟初始数据
  const initProducts = () => {
    products.value = [
      { id: '1', code: 'P001', name: '矿泉水500ml', spec: '500ml', bottleUnit: '瓶', boxUnit: '箱', bottlesPerBox: 24, stock: 500, warningThreshold: 100, isCombined: false, combineProductCode: '', combineRatio: 0 },
      { id: '2', code: 'P002', name: '可乐330ml', spec: '330ml', bottleUnit: '瓶', boxUnit: '箱', bottlesPerBox: 24, stock: 50, warningThreshold: 100, isCombined: false, combineProductCode: '', combineRatio: 0 },
      { id: '3', code: 'P003', name: '果汁1L', spec: '1L', bottleUnit: '瓶', boxUnit: '箱', bottlesPerBox: 12, stock: 200, warningThreshold: 50, isCombined: false, combineProductCode: '', combineRatio: 0 },
      { id: '4', code: 'P004', name: '啤酒500ml', spec: '500ml', bottleUnit: '瓶', boxUnit: '箱', bottlesPerBox: 12, stock: 10, warningThreshold: 50, isCombined: false, combineProductCode: '', combineRatio: 0 },
      { id: '5', code: 'P005', name: '牛奶250ml', spec: '250ml', bottleUnit: '盒', boxUnit: '箱', bottlesPerBox: 24, stock: 300, warningThreshold: 80, isCombined: false, combineProductCode: '', combineRatio: 0 },
      { id: '6', code: 'P0012', name: '矿泉水一打', spec: '500ml*12', bottleUnit: '打', boxUnit: '箱', bottlesPerBox: 2, stock: 0, warningThreshold: 10, isCombined: true, combineProductCode: 'P001', combineRatio: 12 },
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

  const addProduct = (product: Omit<Product, 'id'>) => {
    const newProduct: Product = {
      ...product,
      id: Date.now().toString(),
      isCombined: product.isCombined || false,
      combineProductCode: product.combineProductCode || '',
      combineRatio: product.combineRatio || 0,
    };
    products.value.push(newProduct);
  };

  const updateProduct = (id: string, product: Partial<Product>) => {
    const index = products.value.findIndex(p => p.id === id);
    if (index !== -1) {
      products.value[index] = { ...products.value[index], ...product };
    }
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
  };
});