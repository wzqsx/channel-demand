<template>
  <div class="page-shell" :class="{ 'page-shell--scroll': pageScroll }">
    <!-- 第一行：统计卡片 -->
    <div v-if="$slots.metrics" class="page-shell__metrics-row">
      <slot name="metrics" />
    </div>

    <div v-if="$slots.toolbar || $slots.filters || help" class="page-shell__card page-shell__toolbar-card">
      <div v-if="$slots.toolbar || help" class="page-shell__toolbar">
        <HelpTip
          v-if="help"
          :content="help"
          :title="helpTitle || '说明'"
          inline
          :size="16"
        />
        <slot name="toolbar" />
      </div>
      <div v-if="$slots.filters" class="page-shell__filters">
        <slot name="filters" />
      </div>
    </div>

    <div class="page-shell__card page-shell__body-card">
      <div class="page-shell__body">
        <slot />
      </div>
      <div v-if="$slots.footer" class="page-shell__footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import HelpTip from './HelpTip.vue';

withDefaults(
  defineProps<{
    /** @deprecated 标题已由顶栏展示，此处不再渲染，仅兼容旧调用 */
    title?: string;
    /** 工具栏左侧帮助问号（悬停/点击查看） */
    help?: string;
    helpTitle?: string;
    pageScroll?: boolean;
  }>(),
  { title: '', help: '', helpTitle: '', pageScroll: false },
);
</script>

<style scoped>
.page-shell {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  padding: 16px;
  background: var(--erp-page-bg);
}

.page-shell--scroll .page-shell__body {
  overflow-y: auto;
}

.page-shell__metrics-row {
  flex-shrink: 0;
}

.page-shell__card {
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.page-shell__toolbar-card {
  flex-shrink: 0;
  padding: 10px 16px;
}

.page-shell__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.page-shell__filters {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.page-shell__body-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-shell__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.page-shell__body :deep(.erp-data-table) {
  flex: 1;
  height: 100% !important;
}

.page-shell__footer {
  padding: 8px 16px;
  border-top: 1px solid var(--erp-border);
  background: #fafbfc;
  flex-shrink: 0;
}
</style>
