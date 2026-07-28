import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Company } from '../types';

function newCompanyId() {
  return `C_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export const useCompanyStore = defineStore('company', () => {
  const companies = ref<Company[]>([]);

  const initCompanies = () => {
    if (companies.value.length > 0) return;
    companies.value = [
      { id: 'COMP001', name: '总公司', code: 'ZC' },
      { id: 'COMP002', name: '子公司A', code: 'ZA' },
      { id: 'COMP003', name: '子公司B', code: 'ZB' },
      { id: 'COMP004', name: '子公司C', code: 'ZC2' },
    ];
  };

  /** 修复历史导入撞车的重复 id，避免主体多选「点一个全选」 */
  const ensureUniqueIds = () => {
    const seen = new Set<string>();
    let fixed = 0;
    companies.value = companies.value.map(c => {
      const id = String(c.id || '').trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        return id === c.id ? c : { ...c, id };
      }
      const nextId = newCompanyId();
      seen.add(nextId);
      fixed += 1;
      return { ...c, id: nextId };
    });
    return fixed;
  };

  const addCompany = (company: Omit<Company, 'id'>) => {
    companies.value.push({
      ...company,
      id: newCompanyId(),
    });
  };

  const updateCompany = (id: string, company: Partial<Company>) => {
    const index = companies.value.findIndex(c => c.id === id);
    if (index !== -1) {
      companies.value[index] = { ...companies.value[index], ...company };
    }
  };

  const deleteCompany = (id: string) => {
    const index = companies.value.findIndex(c => c.id === id);
    if (index !== -1) {
      companies.value.splice(index, 1);
    }
  };

  const getCompanyById = (id: string) => companies.value.find(c => c.id === id);

  const getCompanyByCode = (code: string) => companies.value.find(c => c.code === code);

  const upsertByCode = (data: { code: string; name: string }) => {
    const existing = getCompanyByCode(data.code);
    if (existing) {
      updateCompany(existing.id, { name: data.name });
      return existing.id;
    }
    addCompany(data);
    return companies.value[companies.value.length - 1]?.id;
  };

  return {
    companies,
    initCompanies,
    ensureUniqueIds,
    addCompany,
    updateCompany,
    deleteCompany,
    getCompanyById,
    getCompanyByCode,
    upsertByCode,
  };
}, {
  persist: true,
});
