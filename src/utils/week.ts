/**
 * 要货周期：自选起始日，结束日 = 起始日 + 6 天（共 7 天）
 * 例：选 7月30日 → 7月30日 — 8月5日
 */

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalDate(input: Date | string = new Date()): Date {
  if (typeof input === 'string') {
    const s = String(input).trim();
    return new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
  }
  return new Date(input);
}

/** 规范为 YYYY-MM-DD（不强制对齐到周几） */
export function toDateKey(input: Date | string = new Date()): string {
  const d = toLocalDate(input);
  d.setHours(0, 0, 0, 0);
  return formatDate(d);
}

/**
 * 周期起始日 = 用户所选日期（原 weekStart / weekStartSaturday 兼容入口，已不再对齐周五）
 */
export function weekStart(input: Date | string = new Date()): string {
  return toDateKey(input);
}

/** @deprecated 历史命名，等同 weekStart / toDateKey */
export const weekStartSaturday = weekStart;

/** 周期结束日 = 起始日 + 6 天 */
export function weekEnd(weekStartStr: string): string {
  const d = toLocalDate(weekStartStr || new Date());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 6);
  return formatDate(d);
}

/** @deprecated 历史命名，等同 weekEnd */
export const weekEndFriday = weekEnd;

function mdLabel(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 展示：7月30日 — 8月5日；跨年带年份 */
export function weekLabel(weekStartStr: string): string {
  if (!weekStartStr) return '';
  const s = toLocalDate(weekStartStr);
  const e = toLocalDate(weekEnd(weekStartStr));
  if (s.getFullYear() !== e.getFullYear()) {
    return `${s.getFullYear()}年${mdLabel(s)} — ${e.getFullYear()}年${mdLabel(e)}`;
  }
  return `${mdLabel(s)} — ${mdLabel(e)}`;
}

/** 默认周期起始：今天 */
export function currentWeekStart(now: Date | string = new Date()): string {
  return toDateKey(now);
}

/** 起始日晚于今天 → 提前提报未来周期 */
export function isFutureWeek(weekStartStr: string, now: Date | string = new Date()): boolean {
  const w = String(weekStartStr || '').trim();
  if (!w) return false;
  return toDateKey(w) > toDateKey(now);
}

/** 起止对象，提交/展示用 */
export function periodRange(weekStartStr: string): { weekStart: string; weekEnd: string; label: string } {
  const start = toDateKey(weekStartStr || new Date());
  const end = weekEnd(start);
  return { weekStart: start, weekEnd: end, label: weekLabel(start) };
}

/**
 * @deprecated 未来周期可选（提交时确认）；不再禁用日期
 */
export function disabledFutureWeekDate(_date: Date): boolean {
  return false;
}

export type PeriodGrain = 'week' | 'month' | 'quarter' | 'year';

/** 将周起始归到统计周期 key */
export function periodKey(weekStartStr: string, grain: PeriodGrain): string {
  const d = toLocalDate(weekStartStr);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (grain === 'week') return toDateKey(weekStartStr);
  if (grain === 'month') return `${y}-${pad(m)}`;
  if (grain === 'quarter') return `${y}-Q${Math.ceil(m / 3)}`;
  return String(y);
}

export function periodLabel(key: string, grain: PeriodGrain): string {
  if (grain === 'week') return weekLabel(key);
  if (grain === 'month') return `${key}月`;
  if (grain === 'quarter') return key.replace('-', ' ');
  return `${key}年`;
}

/** 完成率展示：销货/要货，保留1位小数 */
export function completionRate(sales: number, demand: number): number {
  if (demand <= 0) return sales > 0 ? 100 : 0;
  return Math.round((sales / demand) * 1000) / 10;
}
