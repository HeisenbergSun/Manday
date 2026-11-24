/**
 * 本地时区日期工具 —— 统一日期字符串（YYYY-MM-DD）与本地午夜时间戳的换算。
 * 避免直接 `toISOString().slice(0,10)`：GMT+8 下会把本地日期偏移一天。
 */

/** Date → 本地时区 YYYY-MM-DD */
export function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 'YYYY-MM-DD'（或带时间的前 10 位）→ 本地午夜 Date */
export function parseLocal(s: string | null | undefined): Date {
  const t = String(s ?? '').slice(0, 10);
  const [y, m, d] = t.split('-').map((x) => Number(x));
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

/** 今天（本地时区）YYYY-MM-DD */
export function todayStr(): string { return fmtLocal(new Date()); }

/** 本地午夜时间戳（毫秒） */
export function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

/** 以 base 为基准加 n 天，返回 YYYY-MM-DD（本地时区） */
export function addDaysStr(base: Date, n: number): string {
  const d = new Date(base); d.setDate(d.getDate() + n);
  return fmtLocal(d);
}
