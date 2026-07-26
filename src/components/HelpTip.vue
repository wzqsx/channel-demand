<template>
  <el-tooltip
    :visible="visible"
    :effect="effect"
    :placement="placement"
    :show-after="80"
    :hide-after="100"
    popper-class="app-help-tip-popper"
    @update:visible="onVisible"
  >
    <template #content>
      <div class="app-help-tip__content">
        <div v-if="title" class="app-help-tip__title">{{ title }}</div>
        <slot>
          <div class="app-help-tip__body" v-html="safeHtml" />
        </slot>
      </div>
    </template>
    <span
      class="app-help-tip"
      :class="{ 'is-inline': inline, 'is-open': pinned || open }"
      tabindex="0"
      role="button"
      :aria-label="ariaLabel"
      @click.stop.prevent="togglePin"
      @keydown.enter.prevent="togglePin"
      @keydown.space.prevent="togglePin"
    >
      <el-icon :size="size"><QuestionFilled /></el-icon>
    </span>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { QuestionFilled } from '@element-plus/icons-vue';

const props = withDefaults(
  defineProps<{
    /** 纯文本说明；可用 \n 换行 */
    content?: string;
    title?: string;
    inline?: boolean;
    size?: number;
    placement?: string;
    effect?: 'dark' | 'light';
    ariaLabel?: string;
  }>(),
  {
    content: '',
    title: '',
    inline: false,
    size: 16,
    placement: 'top',
    effect: 'light',
    ariaLabel: '说明',
  },
);

const pinned = ref(false);
const open = ref(false);
const visible = computed(() => pinned.value || open.value);

const safeHtml = computed(() => {
  const raw = String(props.content || '').replace(/\\n/g, '\n');
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');
});

function onVisible(v: boolean) {
  if (pinned.value && !v) return;
  open.value = v;
}

function togglePin() {
  pinned.value = !pinned.value;
  open.value = pinned.value;
}
</script>

<style scoped>
.app-help-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  cursor: help;
  outline: none;
  border-radius: 50%;
  flex-shrink: 0;
  vertical-align: middle;
  line-height: 1;
}
.app-help-tip.is-inline {
  margin-left: 4px;
}
.app-help-tip:hover,
.app-help-tip:focus,
.app-help-tip.is-open {
  color: #1677ff;
}
</style>

<style>
.app-help-tip-popper {
  max-width: 380px !important;
}
.app-help-tip__content {
  font-size: 12.5px;
  line-height: 1.6;
  color: #475569;
}
.app-help-tip__title {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 6px;
}
.app-help-tip__body {
  white-space: normal;
}
</style>
