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

/** 条目是否「完成」：第一个 status 列的值落在 done 标签集合内 */
export function isItemDone(columns: any[], values: Record<string, unknown> | undefined): boolean {
  const statusCol = (columns ?? []).find((c) => c.type === 'status');
  if (!statusCol) return false;
  const v = values?.[statusCol.id];
  return v != null && doneLabelsOf(statusCol.settings).has(String(v));
}
