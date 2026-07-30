<script setup lang="ts">
export type StatTone = 'default' | 'primary' | 'success' | 'warning' | 'danger';

export interface StatItem {
  /** 用于选中态联动，如 shortage / warning */
  key?: string;
  label: string;
  value: string | number;
  /** 可选副文案 */
  sub?: string;
  tone?: StatTone;
  /** 左上角状态角标文案，如「缺货」「预警」 */
  badge?: string;
  /** 是否可点击筛选；默认 false */
  clickable?: boolean;
}

const props = withDefaults(
  defineProps<{
    items: StatItem[];
    /** 当前激活的卡片 key；与 clickable 项联动 */
    activeKey?: string | null;
  }>(),
  { items: () => [], activeKey: null },
);

const emit = defineEmits<{
  select: [key: string];
}>();

const isActive = (item: StatItem) =>
  !!(item.clickable && item.key && props.activeKey === item.key);

const onCardClick = (item: StatItem) => {
  if (!item.clickable || !item.key) return;
  emit('select', item.key);
};
</script>

<template>
  <div
    v-if="items.length"
    class="stat-cards"
    :style="{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }"
  >
    <div
      v-for="(item, idx) in items"
      :key="item.key || idx"
      class="stat-card"
      :class="[
        `stat-card--${item.tone || 'default'}`,
        {
          'stat-card--clickable': item.clickable && item.key,
          'stat-card--active': isActive(item),
        },
      ]"
      :role="item.clickable && item.key ? 'button' : undefined"
      :tabindex="item.clickable && item.key ? 0 : undefined"
      :aria-pressed="item.clickable && item.key ? isActive(item) : undefined"
      :title="item.clickable ? (isActive(item) ? '再次点击取消筛选' : '点击按此条件筛选') : undefined"
      @click="onCardClick(item)"
      @keydown.enter.prevent="onCardClick(item)"
      @keydown.space.prevent="onCardClick(item)"
    >
      <div class="stat-card__accent" />
      <div class="stat-card__body">
        <div class="stat-card__top">
          <div class="stat-card__label">{{ item.label }}</div>
          <span v-if="isActive(item)" class="stat-card__filtering">筛选中</span>
          <span v-else-if="item.badge" class="stat-card__badge">{{ item.badge }}</span>
        </div>
        <div class="stat-card__value">{{ item.value }}</div>
        <div v-if="item.sub" class="stat-card__sub" :title="item.sub">{{ item.sub }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-cards {
  display: grid;
  gap: 10px;
  width: 100%;
}

@media (max-width: 720px) {
  .stat-cards {
    grid-template-columns: 1fr !important;
  }
}

.stat-card {
  position: relative;
  display: flex;
  min-height: 84px;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fafbfc 100%);
  border: 2px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease,
    background 0.15s ease;
}

.stat-card--clickable {
  cursor: pointer;
  user-select: none;
}

.stat-card--clickable:hover:not(.stat-card--active) {
  transform: translateY(-1px);
  border-color: rgba(22, 119, 255, 0.28);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
}

.stat-card--clickable:focus-visible {
  outline: 2px solid #1677ff;
  outline-offset: 2px;
}

.stat-card--active {
  transform: translateY(-1px);
  z-index: 1;
}

.stat-card--active.stat-card--danger {
  border-color: #ff4d4f;
  background: linear-gradient(180deg, #fff1f0 0%, #ffe4e2 100%);
  box-shadow: 0 0 0 3px rgba(255, 77, 79, 0.18), 0 6px 16px rgba(255, 77, 79, 0.2);
}

.stat-card--active.stat-card--warning {
  border-color: #fa8c16;
  background: linear-gradient(180deg, #fff7e6 0%, #ffecc7 100%);
  box-shadow: 0 0 0 3px rgba(250, 140, 22, 0.18), 0 6px 16px rgba(250, 140, 22, 0.2);
}

.stat-card--active.stat-card--primary {
  border-color: #1677ff;
  background: linear-gradient(180deg, #e6f4ff 0%, #d6ebff 100%);
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.16), 0 6px 16px rgba(22, 119, 255, 0.18);
}

.stat-card--active:hover {
  transform: translateY(-1px);
}

.stat-card__accent {
  width: 4px;
  flex-shrink: 0;
  background: #c9cdd4;
}

.stat-card--active .stat-card__accent {
  width: 6px;
}

.stat-card--primary .stat-card__accent {
  background: #1677ff;
}
.stat-card--success .stat-card__accent {
  background: #52c41a;
}
.stat-card--warning {
  background: linear-gradient(180deg, #fffbe6 0%, #fff7e6 100%);
  border-color: rgba(250, 173, 20, 0.35);
}
.stat-card--warning .stat-card__accent {
  background: #fa8c16;
}
.stat-card--danger {
  background: linear-gradient(180deg, #fff2f0 0%, #fff1f0 100%);
  border-color: rgba(255, 77, 79, 0.35);
}
.stat-card--danger .stat-card__accent {
  background: #ff4d4f;
}

.stat-card__body {
  flex: 1;
  min-width: 0;
  padding: 12px 14px 12px 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.stat-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stat-card__label {
  font-size: 12px;
  color: #86909c;
  line-height: 1.3;
}

.stat-card__badge,
.stat-card__filtering {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
}

.stat-card__badge {
  background: #f2f3f5;
  color: #4e5969;
}

.stat-card__filtering {
  background: #1d2129;
  color: #fff;
}

.stat-card--danger .stat-card__badge {
  background: #ffccc7;
  color: #a8071a;
}
.stat-card--danger.stat-card--active .stat-card__filtering {
  background: #cf1322;
}
.stat-card--warning .stat-card__badge {
  background: #ffe7ba;
  color: #ad4e00;
}
.stat-card--warning.stat-card--active .stat-card__filtering {
  background: #d46b08;
}
.stat-card--primary .stat-card__badge {
  background: #bae0ff;
  color: #003eb3;
}

.stat-card__value {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: #1d2129;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}

.stat-card--primary .stat-card__value {
  color: #1677ff;
}
.stat-card--success .stat-card__value {
  color: #389e0d;
}
.stat-card--warning .stat-card__value {
  color: #d46b08;
}
.stat-card--danger .stat-card__value {
  color: #cf1322;
}

.stat-card__sub {
  margin-top: 2px;
  font-size: 12px;
  color: #4e5969;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-card--active .stat-card__sub {
  color: #1d2129;
  font-weight: 500;
}
</style>
