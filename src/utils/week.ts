/** 周起始统一为周六（与 ERP 渠道要货一致） */

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** JS: Sun=0 … Sat=6 → 回退到本周周六 */
export function weekStartSaturday(input: Date | string = new Date()): string {
  const d = typeof input === 'string' ? new Date(input + (input.length === 10 ? 'T00:00:00' : '')) : new Date(input);
  const wd = d.getDay();
  const daysBack = (wd + 1) % 7;
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - daysBack);
  return formatDate(result);
}

export function weekEndFriday(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return formatDate(d);
}

export function weekLabel(weekStart: string): string {
  return `${weekStart} ~ ${weekEndFriday(weekStart)}`;
}

export type PeriodGrain = 'week' | 'month' | 'quarter' | 'year';

/** 将周起始归到统计周期 key */
export function periodKey(weekStart: string, grain: PeriodGrain): string {
  const d = new Date(weekStart + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (grain === 'week') return weekStart;
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
