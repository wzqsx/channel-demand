import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Warehouse } from '../types';

function newWarehouseId() {
  return `W_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function norm(s: string) {
  return String(s || '').trim();
}

export const useWarehouseStore = defineStore('warehouse', () => {
  const warehouses = ref<Warehouse[]>([]);

  const initWarehouses = () => {
    if (warehouses.value.length > 0) return;
    warehouses.value = [
      { id: 'W001', name: 'A仓', code: 'A仓', companyId: 'COMP001' },
      { id: 'W002', name: 'B仓', code: 'B仓', companyId: 'COMP001' },
      { id: 'W003', name: 'C仓', code: 'C仓', companyId: 'COMP001' },
      { id: 'W004', name: 'D仓', code: 'D仓', companyId: 'COMP001' },
      { id: 'W005', name: 'E仓', code: 'E仓', companyId: 'COMP002' },
      { id: 'W006', name: 'F仓', code: 'F仓', companyId: 'COMP003' },
      { id: 'W007', name: 'G仓', code: 'G仓', companyId: 'COMP003' },
      { id: 'W008', name: 'H仓', code: 'H仓', companyId: 'COMP004' },
    ];
  };

  /**
   * 修复历史导入造成的重复 id（同一毫秒 Date.now 撞车）。
   * 重复 id 会导致勾选一个仓库时界面像「全选」。
   */
  const ensureUniqueIds = () => {
    const seen = new Set<string>();
    let fixed = 0;
    warehouses.value = warehouses.value.map(w => {
      const id = String(w.id || '').trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        return id === w.id ? w : { ...w, id };
      }
      const nextId = newWarehouseId();
      seen.add(nextId);
      fixed += 1;
      return { ...w, id: nextId };
    });
    return fixed;
  };

  const addWarehouse = (warehouse: Omit<Warehouse, 'id'>) => {
    warehouses.value.push({ ...warehouse, id: newWarehouseId() });
  };

  const updateWarehouse = (id: string, patch: Partial<Warehouse>) => {
    const tid = String(id || '').trim();
    let index = warehouses.value.findIndex(w => String(w.id) === tid);
    // 兜底：历史重复 id 时按编码定位
    if (index === -1 && patch.code) {
      const c = norm(patch.code);
      index = warehouses.value.findIndex(w => norm(w.code) === c);
    }
    if (index === -1) return false;
    const next = { ...warehouses.value[index], ...patch };
    // 整表替换，避免 ElTable / computed 同引用不刷新
    warehouses.value = warehouses.value.map((w, i) => (i === index ? next : w));
    return true;
  };

  const deleteWarehouse = (id: string) => {
    const index = warehouses.value.findIndex(w => w.id === id);
    if (index !== -1) warehouses.value.splice(index, 1);
  };

  const getWarehouseById = (id: string) => warehouses.value.find(w => w.id === id);

  const getWarehouseByCode = (code: string) => {
    const c = norm(code);
    if (!c) return undefined;
    return warehouses.value.find(w => norm(w.code) === c);
  };

  const getWarehouseByName = (name: string, companyId?: string) => {
    const n = norm(name);
    if (!n) return undefined;
    return warehouses.value.find(
      w => norm(w.name) === n && (!companyId || w.companyId === companyId),
    );
  };

  /** 库存导入常用：编码或名称任一命中即可（你们导出往往只有仓库名称） */
  const resolveWarehouse = (codeOrName: string, fallbackName?: string) => {
    const a = norm(codeOrName);
    const b = norm(fallbackName || '');
    if (a) {
      const byCode = getWarehouseByCode(a);
      if (byCode) return byCode;
      const byName = getWarehouseByName(a);
      if (byName) return byName;
    }
    if (b && b !== a) {
      const byCode = getWarehouseByCode(b);
      if (byCode) return byCode;
      const byName = getWarehouseByName(b);
      if (byName) return byName;
    }
    return undefined;
  };

  const getWarehousesByIds = (ids: string[]) => {
    const set = new Set((ids || []).map(String));
    const seen = new Set<string>();
    const out: Warehouse[] = [];
    for (const w of warehouses.value) {
      if (!set.has(w.id) || seen.has(w.id)) continue;
      seen.add(w.id);
      out.push(w);
    }
    return out;
  };

  const getWarehousesByCompany = (companyId: string) =>
    warehouses.value.filter(w => w.companyId === companyId);

  /**
   * 按编码优先覆盖；无编码时按名称覆盖。
   * 可把 code 默认成 name，便于库存 Excel 只有仓库名时匹配。
   */
  const upsertWarehouse = (data: Omit<Warehouse, 'id'> & { code?: string }) => {
    const name = norm(data.name);
    const code = norm(data.code || '') || name;
    if (!name || !code) throw new Error('仓库名称不能为空');
    if (!data.companyId) throw new Error('所属主体不能为空');

    const existing =
      getWarehouseByCode(code) ||
      getWarehouseByName(name, data.companyId) ||
      getWarehouseByName(name);

    const payload = { code, name, companyId: data.companyId };
    if (existing) {
      updateWarehouse(existing.id, payload);
      return existing.id;
    }
    addWarehouse(payload);
    return warehouses.value[warehouses.value.length - 1]?.id;
  };

  /** @deprecated 使用 upsertWarehouse */
  const upsertByCode = (data: Omit<Warehouse, 'id'>) => upsertWarehouse(data);

  const batchUpdate = (ids: string[], patchFn: (w: Warehouse) => Partial<Warehouse>) => {
    let n = 0;
    const idSet = new Set(ids.map(String));
    warehouses.value = warehouses.value.map(w => {
      if (!idSet.has(String(w.id))) return w;
      n += 1;
      return { ...w, ...patchFn(w) };
    });
    return n;
  };

  /** 把编码改成与名称相同（方便库存导入用名称匹配） */
  const syncCodeToName = (ids?: string[]) => {
    const idSet = ids?.length ? new Set(ids) : null;
    let n = 0;
    warehouses.value.forEach((w, i) => {
      if (idSet && !idSet.has(w.id)) return;
      if (norm(w.code) === norm(w.name)) return;
      warehouses.value[i] = { ...w, code: w.name };
      n += 1;
    });
    return n;
  };

  /** 把仓库上的旧主体 id 映射到去重后的标准 id */
  const remapCompanyIds = (idMap: Record<string, string>) => {
    let n = 0;
    warehouses.value = warehouses.value.map(w => {
      const nextId = idMap[w.companyId];
      if (!nextId || nextId === w.companyId) return w;
      n += 1;
      return { ...w, companyId: nextId };
    });
    return n;
  };

  return {
    warehouses,
    initWarehouses,
    ensureUniqueIds,
    remapCompanyIds,
    addWarehouse,
    updateWarehouse,
    deleteWarehouse,
    getWarehouseById,
    getWarehouseByCode,
    getWarehouseByName,
    resolveWarehouse,
    getWarehousesByIds,
    getWarehousesByCompany,
    upsertWarehouse,
    upsertByCode,
    batchUpdate,
    syncCodeToName,
  };
}, { persist: true });
