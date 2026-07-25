import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Company } from '../types';

export const useCompanyStore = defineStore('company', () => {
  const companies = ref<Company[]>([]);

  // 模拟初始数据
  const initCompanies = () => {
    companies.value = [
      { id: 'COMP001', name: '总公司', code: 'ZC' },
      { id: 'COMP002', name: '子公司A', code: 'ZA' },
      { id: 'COMP003', name: '子公司B', code: 'ZB' },
      { id: 'COMP004', name: '子公司C', code: 'ZC' },
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

  return {
    companies,
    initCompanies,
    addCompany,
    updateCompany,
    deleteCompany,
    getCompanyById,
  };
});