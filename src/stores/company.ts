import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Company } from '../types';
import { canonicalCompanyName } from '../utils/companyDisplay';

function newCompanyId() {
  return `C_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normCode(code: string) {
  return String(code || '').trim();
}

export const useCompanyStore = defineStore('company', () => {
  const companies = ref<Company[]>([]);

  const initCompanies = () => {
    if (companies.value.length > 0) return;
    companies.value = [
      { id: 'COMP001', name: '总公司', code: 'ZC' },
      { id: 'COMP002', name: '下属A', code: 'ZA' },
      { id: 'COMP003', name: '下属B', code: 'ZB' },
      { id: 'COMP004', name: '下属C', code: 'ZC2' },
    ];
  };

  /** 修复历史导入撞车的重复 id，返回 旧id → 新id（供仓库/渠道同步） */
  const ensureUniqueIds = (): Record<string, string> => {
    const idMap: Record<string, string> = {};
    const seen = new Set<string>();
    companies.value = companies.value.map(c => {
      const id = String(c.id || '').trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        idMap[id] = id; // 正主：恒等映射
        return id === c.id ? c : { ...c, id };
      }
      // 空 id 或与正主撞车：换新 id。绝不能把正主 id 再映射走，否则渠道会丢挂
      const nextId = newCompanyId();
      seen.add(nextId);
      idMap[nextId] = nextId;
      return { ...c, id: nextId };
    });
    return idMap;
  };

  /**
   * 统一名称文案 + 按代码去重。
   * 返回旧 id → 保留 id 的映射，供仓库/渠道 remapping。
   */
  const normalizeCompanies = (): Record<string, string> => {
    const idMap: Record<string, string> = {};
    const byCode = new Map<string, Company>();

    for (const c of companies.value) {
      const code = normCode(c.code);
      const name = canonicalCompanyName(c.name, code);
      const normalized: Company = { ...c, code, name };
      if (!code) {
        byCode.set(`__id__:${c.id}`, normalized);
        continue;
      }
      const key = code.toUpperCase();
      const existing = byCode.get(key);
      if (!existing) {
        byCode.set(key, normalized);
        continue;
      }
      // 同代码保留先出现的 id，名称取规范名；把重复 id 映射过去
      idMap[normalized.id] = existing.id;
      byCode.set(key, {
        ...existing,
        name: canonicalCompanyName(existing.name || name, existing.code),
      });
    }

    companies.value = [...byCode.values()].map(c => ({
      ...c,
      name: canonicalCompanyName(c.name, c.code),
    }));

    // 自身 id 也写入恒等，方便调用方
    for (const c of companies.value) {
      if (!idMap[c.id]) idMap[c.id] = c.id;
    }
    return idMap;
  };

  const addCompany = (company: Omit<Company, 'id'>) => {
    companies.value.push({
      ...company,
      name: canonicalCompanyName(company.name, company.code),
      code: normCode(company.code),
      id: newCompanyId(),
    });
  };

  const updateCompany = (id: string, company: Partial<Company>) => {
    const index = companies.value.findIndex(c => c.id === id);
    if (index === -1) return;
    const cur = companies.value[index];
    const next = {
      ...cur,
      ...company,
      code: company.code !== undefined ? normCode(company.code) : cur.code,
      name: canonicalCompanyName(
        company.name !== undefined ? company.name : cur.name,
        company.code !== undefined ? company.code : cur.code,
      ),
    };
    companies.value = companies.value.map((c, i) => (i === index ? next : c));
  };

  const deleteCompany = (id: string) => {
    const index = companies.value.findIndex(c => c.id === id);
    if (index !== -1) {
      companies.value.splice(index, 1);
    }
  };

  const getCompanyById = (id: string) => companies.value.find(c => c.id === id);

  const getCompanyByCode = (code: string) => {
    const key = normCode(code).toUpperCase();
    if (!key) return undefined;
    return companies.value.find(c => normCode(c.code).toUpperCase() === key);
  };

  /** 按名称匹配（忽略空格大小写；编码/名称填一个即可时用） */
  const getCompanyByName = (name: string) => {
    const key = canonicalCompanyName(name, '').replace(/\s+/g, '').toLowerCase();
    if (!key) return undefined;
    return companies.value.find(c => {
      const n = canonicalCompanyName(c.name, c.code).replace(/\s+/g, '').toLowerCase();
      return n === key || normCode(c.code).toLowerCase() === key;
    });
  };

  /** 编码或名称任一命中即可 */
  const resolveCompany = (codeOrName?: string, fallbackName?: string) => {
    for (const raw of [codeOrName, fallbackName]) {
      const t = String(raw || '').trim();
      if (!t) continue;
      const byCode = getCompanyByCode(t);
      if (byCode) return byCode;
      const byName = getCompanyByName(t);
      if (byName) return byName;
    }
    return undefined;
  };

  const upsertByCode = (data: { code: string; name: string }) => {
    const code = normCode(data.code);
    const name = canonicalCompanyName(data.name, code);
    const existing = getCompanyByCode(code);
    if (existing) {
      updateCompany(existing.id, { name });
      return existing.id;
    }
    addCompany({ code, name });
    return companies.value[companies.value.length - 1]?.id;
  };

  return {
    companies,
    initCompanies,
    ensureUniqueIds,
    normalizeCompanies,
    addCompany,
    updateCompany,
    deleteCompany,
    getCompanyById,
    getCompanyByCode,
    getCompanyByName,
    resolveCompany,
    upsertByCode,
  };
}, {
  persist: true,
});
