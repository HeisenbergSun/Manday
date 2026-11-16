/**
 * 双色 token 分离（P0-8）：UI 品牌色与数据标签色严格两套，改主题不污染数据颜色
 * - UI_*：界面骨架（按钮/边框/背景），改品牌主题只动这一组
 * - TAG_*：数据语义色（状态标签/优先级），与业务含义绑定，不随主题变化
 * 同时把变量注入 :root，供 CSS 与 e2e 读取。
 */
export const UI = {
  primary: '#4f6ef7',
  primarySoft: '#eef1fe',
  border: '#e6e8ef',
  borderSoft: '#eef0f5',
  text: '#25272c',
  textSub: '#7a7f8c',
  textFaint: '#a0a4b1',
  danger: '#e2445c',
  bg: '#fff',
} as const;

export const TAG = {
  done: '#00c875',
  working: '#579bfc',
  stuck: '#e5484d',
  todo: '#8a90a3',
  warn: '#ffb224',
  gray: '#c3c8d4',
} as const;

/** 注入 CSS 变量（模块加载时执行一次） */
if (typeof document !== 'undefined' && !document.documentElement.dataset.tokens) {
  const s = document.createElement('style');
  s.textContent = `:root{
    --ui-primary:${UI.primary};--ui-primary-soft:${UI.primarySoft};
    --ui-border:${UI.border};--ui-text:${UI.text};--ui-text-sub:${UI.textSub};
    --ui-danger:${UI.danger};
    --tag-done:${TAG.done};--tag-working:${TAG.working};--tag-stuck:${TAG.stuck};
    --tag-todo:${TAG.todo};--tag-warn:${TAG.warn};
  }`;
  document.head.appendChild(s);
  document.documentElement.dataset.tokens = '1';
}

/** status 列的 done 标签集合：settings.doneLabels 优先，否则回退「已完成/Done」 */
export function doneLabelsOf(settings: any): Set<string> {
  const dl = settings?.doneLabels;
  if (Array.isArray(dl) && dl.length) return new Set(dl.map(String));
  return new Set(['已完成', 'Done']);
}

/**
 * P2-5 视觉低饱和收敛：把高饱和标签色压到柔和区间（S≤45%、L≥58%）
 * 非法输入原样返回，保证旧数据不受影响
 */
export function soften(hex?: string | null): string | null {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex ?? null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const s2 = Math.min(s, 0.45), l2 = Math.max(l, 0.58);
  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l2 - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const map: [number, number, number][] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [0, 0, c], [c, 0, x]];
  const [rr, gg, bb] = map[seg];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(rr)}${to(gg)}${to(bb)}`;
}

/** P2-5 分组色带调色板（柔和区间，配合 alpha 极浅色带使用） */
export const GROUP_PALETTE = ['#7b96e3', '#6fbf9a', '#e0a96d', '#c488b8', '#6fb3c4', '#a9a1e0'] as const;


/** 条目是否「完成」：第一个 status 列的值落在 done 标签集合内 */
export function isItemDone(columns: any[], values: Record<string, unknown> | undefined): boolean {
  const statusCol = (columns ?? []).find((c) => c.type === 'status');
  if (!statusCol) return false;
  const v = values?.[statusCol.id];
  return v != null && doneLabelsOf(statusCol.settings).has(String(v));
}
