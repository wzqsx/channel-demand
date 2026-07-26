import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Company } from '../types';

export const useCompanyStore = defineStore('company', () => {
  const companies = ref<Company[]>([]);

  // 模拟初始数据
  const initCompanies = () => {
    // 如果已有数据，不再初始化
    if (companies.value.length > 0) return;
    companies.value = [
      { id: 'COMP001', name: '总公司', code: 'ZC' },
      { id: 'COMP002', name: '子公司A', code: 'ZA' },
      { id: 'COMP003', name: '子公司B', code: 'ZB' },
      { id: 'COMP004', name: '子公司C', code: 'ZC2' },
    ];
  };

  const addCompany = (company: Omit<Company, 'id'>) => {
    const newCompany: Company = {
      ...company,
      id: Date.now().toString(),
    };
    companies.value.push(newCompany);
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

  const getCompanyById = (id: string) => {
    return companies.value.find(c => c.id === id);
  };

  const getCompanyByCode = (code: string) => companies.value.find(c => c.code === code);

  /** 按编码新增或更新 */
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