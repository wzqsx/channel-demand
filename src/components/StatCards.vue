<script setup lang="ts">
export type StatTone = 'default' | 'primary' | 'success' | 'warning' | 'danger';

export interface StatItem {
  label: string;
  value: string | number;
  /** 可选副文案 */
  sub?: string;
  tone?: StatTone;
}

withDefaults(
  defineProps<{
    items: StatItem[];
  }>(),
  { items: () => [] },
);
</script>

<template>
  <div v-if="items.length" class="stat-cards">
    <div
      v-for="(item, idx) in items"
      :key="idx"
      class="stat-card"
      :class="`stat-card--${item.tone || 'default'}`"
    >
      <div class="stat-card__accent" />
      <div class="stat-card__body">
        <div class="stat-card__label">{{ item.label }}</div>
        <div class="stat-card__value">{{ item.value }}</div>
        <div v-if="item.sub" class="stat-card__sub" :title="item.sub">{{ item.sub }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 10px;
  width: 100%;
}

.stat-card {
  position: relative;
  display: flex;
  min-height: 78px;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fafbfc 100%);
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.stat-card:hover {
  border-color: rgba(22, 119, 255, 0.18);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}

.stat-card__accent {
  width: 3px;
  flex-shrink: 0;
  background: #c9cdd4;
}

.stat-card--primary .stat-card__accent {
  background: #1677ff;
}
.stat-card--success .stat-card__accent {
  background: #52c41a;
}
.stat-card--warning .stat-card__accent {
  background: #faad14;
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

.stat-card__label {
  font-size: 12px;
  color: #86909c;
  line-height: 1.3;
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
  color: #d48806;
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
</style>
