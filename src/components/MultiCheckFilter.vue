<script setup lang="ts">
import { ElPopover, ElButton } from 'element-plus';

/**
 * 多选筛选：自定义勾选行，避免重复 id / Element Plus Checkbox 导致点一个像全选
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

const isChecked = (value: string) => model.value.includes(value);

const toggleOne = (value: string) => {
  if (!value) return;
  const cur = model.value;
  model.value = cur.includes(value) ? cur.filter(x => x !== value) : [...cur, value];
};
</script>

<template>
  <ElPopover placement="bottom-start" :width="280" trigger="click" :hide-after="0">
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

    <div class="mcf" @click.stop>
      <div class="mcf__bar">
        <ElButton link type="primary" size="small" @click="selectAll">全选</ElButton>
        <ElButton link size="small" @click="clearAll">清空</ElButton>
        <span class="mcf__count">已选 {{ model.length }}/{{ options.length }}</span>
      </div>
      <div class="mcf__list">
        <div
          v-for="(o, idx) in options"
          :key="`${o.value}__${idx}`"
          class="mcf__item"
          role="checkbox"
          :aria-checked="isChecked(o.value)"
          tabindex="0"
          @click="toggleOne(o.value)"
          @keydown.enter.prevent="toggleOne(o.value)"
          @keydown.space.prevent="toggleOne(o.value)"
        >
          <span class="mcf__check" :class="{ on: isChecked(o.value) }" />
          <span class="mcf__text">{{ o.label }}</span>
        </div>
      </div>
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
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  margin: 0;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--erp-text);
  user-select: none;
}
.mcf__item:hover {
  background: #eef3f9;
}
.mcf__check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 1px solid #c0c6cc;
  border-radius: 3px;
  background: #fff;
  box-sizing: border-box;
  position: relative;
}
.mcf__check.on {
  border-color: var(--erp-primary);
  background: var(--erp-primary);
}
.mcf__check.on::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.mcf__text {
  line-height: 1.3;
}
.mcf__empty {
  padding: 12px 0;
  text-align: center;
  color: var(--erp-text-muted);
  font-size: 12px;
}
</style>
