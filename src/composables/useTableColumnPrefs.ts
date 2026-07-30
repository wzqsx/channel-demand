import { computed, ref, watch, type Ref } from 'vue';

export type ColumnMeta = {
  key: string;
  label: string;
  width?: number | string;
  minWidth?: number | string;
  align?: 'left' | 'center' | 'right';
  fixed?: 'left' | 'right' | boolean;
  tooltip?: boolean;
  /** 不可隐藏（如操作列） */
  required?: boolean;
  /** Element Plus 排序：绑定行字段或自定义比较 */
  sortable?: boolean | 'custom';
  prop?: string;
  sortMethod?: (a: any, b: any) => number;
};

type StoredPrefs = {
  order: string[];
  hidden: string[];
};

function loadPrefs(storageKey: string): StoredPrefs | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPrefs;
    if (!Array.isArray(parsed?.order) || !Array.isArray(parsed?.hidden)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePrefs(storageKey: string, prefs: StoredPrefs) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

/** 列顺序 + 显隐，localStorage 持久化；catalog 变化时自动并入新列、剔除失效列 */
export function useTableColumnPrefs(storageKey: string, catalog: Ref<ColumnMeta[]>) {
  const order = ref<string[]>([]);
  const hidden = ref<string[]>([]);

  const syncFromCatalog = () => {
    const keys = catalog.value.map(c => c.key);
    const keySet = new Set(keys);
    if (!order.value.length) {
      const stored = loadPrefs(storageKey);
      if (stored) {
        order.value = stored.order.filter(k => keySet.has(k));
        hidden.value = stored.hidden.filter(k => keySet.has(k));
      }
    }
    // 去掉已不存在的列
    order.value = order.value.filter(k => keySet.has(k));
    hidden.value = hidden.value.filter(k => keySet.has(k));
    // 追加新列（插在操作列前；否则末尾）
    const existing = new Set(order.value);
    const actionsIdx = order.value.indexOf('actions');
    for (const k of keys) {
      if (existing.has(k)) continue;
      if (actionsIdx >= 0) {
        order.value.splice(actionsIdx, 0, k);
      } else {
        order.value.push(k);
      }
      existing.add(k);
    }
    // catalog 里 required 列强制可见
    const required = new Set(catalog.value.filter(c => c.required).map(c => c.key));
    hidden.value = hidden.value.filter(k => !required.has(k));
  };

  watch(catalog, syncFromCatalog, { immediate: true, deep: true });

  watch(
    [order, hidden],
    () => {
      savePrefs(storageKey, { order: [...order.value], hidden: [...hidden.value] });
    },
    { deep: true },
  );

  const metaByKey = computed(() => {
    const map = new Map<string, ColumnMeta>();
    catalog.value.forEach(c => map.set(c.key, c));
    return map;
  });

  const settingsList = computed(() =>
    order.value
      .map(key => metaByKey.value.get(key))
      .filter((c): c is ColumnMeta => !!c),
  );

  const visibleColumns = computed(() => {
    const hide = new Set(hidden.value);
    return settingsList.value.filter(c => c.required || !hide.has(c.key));
  });

  const isVisible = (key: string) => {
    const meta = metaByKey.value.get(key);
    if (meta?.required) return true;
    return !hidden.value.includes(key);
  };

  const setVisible = (key: string, visible: boolean) => {
    const meta = metaByKey.value.get(key);
    if (meta?.required) return;
    if (visible) {
      hidden.value = hidden.value.filter(k => k !== key);
    } else if (!hidden.value.includes(key)) {
      // 至少保留一列可见（不含仅操作）
      const wouldHide = new Set([...hidden.value, key]);
      const remain = settingsList.value.filter(c => c.required || !wouldHide.has(c.key));
      if (remain.length <= 1 && remain.every(c => c.key === 'actions')) return;
      if (!remain.length) return;
      hidden.value = [...hidden.value, key];
    }
  };

  const moveColumn = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= order.value.length || toIndex >= order.value.length) return;
    const next = [...order.value];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    order.value = next;
  };

  const resetColumns = () => {
    order.value = catalog.value.map(c => c.key);
    hidden.value = [];
  };

  const showAll = () => {
    hidden.value = [];
  };

  return {
    settingsList,
    visibleColumns,
    isVisible,
    setVisible,
    moveColumn,
    resetColumns,
    showAll,
  };
}
