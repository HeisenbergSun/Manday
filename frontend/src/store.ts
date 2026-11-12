/**
 * 状态分层（专家定稿）：按 slice 切分，避免整表订阅导致重渲染
 */
import { create } from 'zustand';

export interface Item { id: string; name: string; version: number; values: Record<string, unknown>; }
export interface ColumnDef { id: string; type: string; name: string; settings: Record<string, unknown>; }

interface ItemsState {
  items: Record<string, Item>;
  columns: ColumnDef[];
  setBoard: (items: Item[], columns: ColumnDef[]) => void;
  /** 实时 item 级 diff 更新：只动一个条目 */
  applyPatch: (itemId: string, field: string, value: unknown, version: number) => void;
  bumpVersion: (itemId: string, version: number) => void;
}

export const useItems = create<ItemsState>((set) => ({
  items: {},
  columns: [],
  setBoard: (items, columns) => set((s) => ({
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    columns,
  })),
  applyPatch: (itemId, field, value, version) => set((s) => {
    const it = s.items[itemId];
    if (!it || version <= it.version) return s;   // 收到旧版本事件 → 丢弃（LWW）
    return { items: { ...s.items, [itemId]: { ...it, version, values: { ...it.values, [field]: value } } } };
  }),
  bumpVersion: (itemId, version) => set((s) => {
    const it = s.items[itemId];
    return it ? { items: { ...s.items, [itemId]: { ...it, version } } } : s;
  }),
}));

interface UiState {
  aiOpen: boolean;
  toggleAI: () => void;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  clearSelect: () => void;
}

export const useUi = create<UiState>((set) => ({
  aiOpen: false,
  toggleAI: () => set((s) => ({ aiOpen: !s.aiOpen })),
  selectedIds: new Set(),
  toggleSelect: (id) => set((s) => {
    const next = new Set(s.selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { selectedIds: next };
  }),
  clearSelect: () => set({ selectedIds: new Set() }),
}));
