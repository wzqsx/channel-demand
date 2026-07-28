import { ref, watch, onMounted, type Ref } from 'vue';

const PREFIX = 'k_filter_';

/** 记住页面主体多选筛选（sessionStorage，关标签页后清空） */
export function useRememberedCompanyFilter(pageKey: string): Ref<string[]> {
  const storageKey = `${PREFIX}${pageKey}_companyIds`;
  const companyIds = ref<string[]>([]);

  onMounted(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        companyIds.value = parsed.filter(x => typeof x === 'string');
      }
    } catch {
      /* ignore */
    }
  });

  watch(
    companyIds,
    val => {
      try {
        if (!val.length) sessionStorage.removeItem(storageKey);
        else sessionStorage.setItem(storageKey, JSON.stringify(val));
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  );

  return companyIds;
}
