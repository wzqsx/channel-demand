<script setup lang="ts">
import { ElPopover, ElButton, ElCheckboxGroup, ElCheckbox } from 'element-plus';

/**
 * 多选筛选：勾选列表，避免 ElSelect multiple 一点就像全选的体验问题
 */
const props = withDefaults(
  defineProps<{
    options: { value: string; label: string }[];
    placeholder?: string;
    width?: string;
  }>(),
  {
    placeholder: '请选择',
    width: '200px',
  },
);

const model = defineModel<string[]>({ default: () => [] });

const selectAll = () => {
  model.value = props.options.map(o => o.value);
};

const clearAll = () => {
  model.value = [];
};
</script>

<template>
  <ElPopover placement="bottom-start" :width="280" trigger="click">
    <template #reference>
      <ElButton size="small" class="mcf-btn" :style="{ width }">
        <span class="mcf-btn__text">
          <template v-if="!model.length">{{ placeholder }}</template>
          <template v-else-if="model.length === 1">
            {{ options.find(o => o.value === model[0])?.label || model[0] }}
          </template>
          <template v-else>已选 {{ model.length }} 项</template>
        </span>
        <span class="mcf-btn__caret">▾</span>
      </ElButton>
    </template>

    <div class="mcf">
      <div class="mcf__bar">
        <ElButton link type="primary" size="small" @click="selectAll">全选</ElButton>
        <ElButton link size="small" @click="clearAll">清空</ElButton>
        <span class="mcf__count">已选 {{ model.length }}/{{ options.length }}</span>
      </div>
      <ElCheckboxGroup v-model="model" class="mcf__list">
        <ElCheckbox
          v-for="o in options"
          :key="o.value"
          :value="o.value"
          class="mcf__item"
        >
          {{ o.label }}
        </ElCheckbox>
      </ElCheckboxGroup>
      <div v-if="!options.length" class="mcf__empty">暂无可选项</div>
    </div>
  </ElPopover>
</template>

<style scoped>
.mcf-btn {
  justify-content: space-between;
  font-weight: 400;
}
.mcf-btn__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  flex: 1;
  color: var(--erp-text);
}
.mcf-btn__caret {
  color: var(--erp-text-muted);
  margin-left: 6px;
}
.mcf__bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--erp-border);
}
.mcf__count {
  margin-left: auto;
  font-size: 12px;
  color: var(--erp-text-muted);
}
.mcf__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
}
.mcf__item {
  margin-right: 0;
  height: 28px;
}
.mcf__empty {
  padding: 12px 0;
  text-align: center;
  color: var(--erp-text-muted);
  font-size: 12px;
}
</style>
