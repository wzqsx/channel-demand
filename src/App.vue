<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElButton, ElMessage, ElMessageBox, ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus';
import { downloadAppDataBackup, importAppDataBackup } from './utils/dataBackup';

const router = useRouter();
const route = useRoute();
const importInputRef = ref<HTMLInputElement | null>(null);

const menuGroups = [
  {
    label: '业务',
    items: [
      { path: '/requisitions', label: '渠道要货' },
      { path: '/shortage-alert', label: '缺货与预警' },
      { path: '/sales-compare', label: '销货核对' },
      { path: '/channel-overview', label: '渠道要货总览' },
      { path: '/warehouse-stocks', label: '库存导入' },
    ],
  },
  {
    label: '主数据',
    items: [
      { path: '/companies', label: '公司主体' },
      { path: '/channels', label: '渠道管理' },
      { path: '/warehouses', label: '仓库管理' },
      { path: '/products', label: '商品管理' },
    ],
  },
  {
    label: '分析',
    items: [
      { path: '/stock-history', label: '库存快照' },
      { path: '/report-accuracy', label: '提报统计' },
    ],
  },
];

const isActive = (path: string) => route.path === path;

const currentTitle = computed(() => {
  for (const g of menuGroups) {
    const hit = g.items.find(i => i.path === route.path);
    if (hit) return hit.label;
  }
  return '渠道要货';
});

const handleExportData = () => {
  const n = downloadAppDataBackup();
  ElMessage.success(n ? `已导出 ${n} 类业务数据` : '当前没有可导出的本地数据');
};

const handleImportClick = () => importInputRef.value?.click();

const handleBackupCommand = (cmd: string | number) => {
  if (cmd === 'export') handleExportData();
  if (cmd === 'import') handleImportClick();
};

const handleImportFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    await ElMessageBox.confirm(
      '导入会清空并整体替换本浏览器地址下的业务数据（与备份文件不一致的旧数据也会被清掉）。建议先通过「数据备份 → 导出整站备份」留底。是否继续？',
      '恢复整站数据',
      { type: 'warning', confirmButtonText: '确认导入', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const result = importAppDataBackup(json);
    if (!result.ok) {
      ElMessage.error(result.message);
      return;
    }
    ElMessage.success(`已恢复 ${result.keys.length} 类数据，正在刷新…`);
    setTimeout(() => location.reload(), 500);
  } catch {
    ElMessage.error('备份文件无法解析，请确认是本系统导出的 JSON');
  }
};
</script>

<template>
  <div class="layout">
    <aside class="aside">
      <div class="brand">
        <div class="brand-mark">K</div>
        <div class="brand-text">
          <div class="brand-name">渠道要货</div>
        </div>
      </div>

      <nav class="nav">
        <div v-for="group in menuGroups" :key="group.label" class="nav-group">
          <div class="nav-group-label">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.path"
            type="button"
            class="nav-item"
            :class="{ active: isActive(item.path) }"
            @click="router.push(item.path)"
          >
            {{ item.label }}
          </button>
        </div>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="topbar-title">{{ currentTitle }}</div>
        <div class="topbar-actions">
          <input
            ref="importInputRef"
            type="file"
            accept="application/json,.json"
            class="hidden-file"
            @change="handleImportFile"
          />
          <ElDropdown trigger="click" @command="handleBackupCommand">
            <ElButton size="small">
              数据备份
              <span class="dropdown-caret">▾</span>
            </ElButton>
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem command="export">导出整站备份</ElDropdownItem>
                <ElDropdownItem command="import">导入整站备份</ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </div>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--erp-page-bg);
}

.aside {
  width: 200px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
  display: flex;
  flex-direction: column;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 14px 12px;
  border-bottom: 1px solid var(--sidebar-border);
}

.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--erp-primary);
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--erp-text);
}

.nav {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0 16px;
}

.nav-group {
  margin-bottom: 8px;
}

.nav-group-label {
  padding: 8px 20px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--sidebar-text-secondary);
}

.nav-item {
  display: block;
  width: calc(100% - 16px);
  margin: 1px 8px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--sidebar-text);
  text-align: left;
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-item:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--sidebar-text-active);
}

.nav-item.active {
  background: var(--sidebar-item-active-bg);
  color: var(--sidebar-text-active);
  font-weight: 600;
}

.main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid var(--erp-border);
}

.topbar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--erp-text);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dropdown-caret {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.7;
}

.hidden-file {
  display: none;
}

.content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
