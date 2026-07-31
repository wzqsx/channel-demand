/** 提报周：周五起 ～ 下周四止（例：7月31日—8月6日；下周 8月7日—8月13日） */

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalDate(input: Date | string = new Date()): Date {
  if (typeof input === 'string') {
    return new Date(input + (input.length === 10 ? 'T00:00:00' : ''));
  }
  return new Date(input);
}

/**
 * 回退到本周周五（JS: Sun=0 … Fri=5 … Sat=6）
 * 保留旧名 weekStartSaturday 以免全仓改引用；语义已改为周五起。
 */
export function weekStart(input: Date | string = new Date()): string {
  const d = toLocalDate(input);
  const wd = d.getDay();
  const daysBack = (wd - 5 + 7) % 7;
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - daysBack);
  return formatDate(result);
}

/** @deprecated 历史命名，等同 weekStart（周五） */
export const weekStartSaturday = weekStart;

/** 周结束日（下周四） */
export function weekEnd(weekStartStr: string): string {
  const d = new Date(weekStartStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return formatDate(d);
}

/** @deprecated 历史命名，等同 weekEnd（周四） */
export const weekEndFriday = weekEnd;

function mdLabel(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 展示：7月31日—8月6日；跨年带年份 */
export function weekLabel(weekStartStr: string): string {
  if (!weekStartStr) return '';
  const s = new Date(weekStartStr + 'T00:00:00');
  const e = new Date(weekStartStr + 'T00:00:00');
  e.setDate(e.getDate() + 6);
  if (s.getFullYear() !== e.getFullYear()) {
    return `${s.getFullYear()}年${mdLabel(s)}—${e.getFullYear()}年${mdLabel(e)}`;
  }
  return `${mdLabel(s)}—${mdLabel(e)}`;
}

/** 今天所在提报周起始 */
export function currentWeekStart(now: Date | string = new Date()): string {
  return weekStart(now);
}

/** 是否比「本周」更晚（提前提报下周/后周计划） */
export function isFutureWeek(weekStartStr: string, now: Date | string = new Date()): boolean {
  const w = String(weekStartStr || '').trim();
  if (!w) return false;
  return weekStart(w) > currentWeekStart(now);
}

/**
 * @deprecated 已允许选未来周（提交时二次确认）；保留空实现以免旧引用报错
 */
export function disabledFutureWeekDate(_date: Date): boolean {
  return false;
}

export type PeriodGrain = 'week' | 'month' | 'quarter' | 'year';

/** 将周起始归到统计周期 key */
export function periodKey(weekStartStr: string, grain: PeriodGrain): string {
  const d = new Date(weekStartStr + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (grain === 'week') return weekStartStr;
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
