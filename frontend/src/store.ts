/**
 * 状态分层（专家定稿）：按 slice 切分，避免整表订阅导致重渲染
 */
import { create } from 'zustand';

export interface Item { id: string; group_id?: string; name: string; version: number; values: Record<string, unknown>; }
export interface ColumnDef { id: string; type: string; name: string; settings: Record<string, unknown>; }
export interface GroupDef { id: string; name: string; position?: number; color?: string; }

interface ItemsState {
  items: Record<string, Item>;
  columns: ColumnDef[];
  groups: GroupDef[];
  /** 当前用户在该 Board 的角色（P1-1 权限拆分 UI 依据；null = 未加载，保守按 owner 展示） */
  myRole: string | null;
  setBoard: (items: Item[], columns: ColumnDef[], groups?: GroupDef[], myRole?: string | null) => void;
  /** 实时 item 级 diff 更新：只动一个条目 */
  applyPatch: (itemId: string, field: string, value: unknown, version: number) => void;
  bumpVersion: (itemId: string, version: number) => void;
  addItem: (item: Item) => void;
  patchItem: (itemId: string, patch: { name?: string; groupId?: string; version?: number }) => void;
}

export const useItems = create<ItemsState>((set) => ({
  items: {},
  columns: [],
  groups: [],
  myRole: null,
  setBoard: (items, columns, groups, myRole) => set(() => ({
    items: Object.fromEntries((items ?? []).map((i) => [i.id, i])),
    columns: columns ?? [],
    groups: groups ?? [],
    myRole: myRole ?? null,
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
  addItem: (item) => set((s) => ({ items: { ...s.items, [item.id]: item } })),
  patchItem: (itemId, patch) => set((s) => {
    const it = s.items[itemId];
    if (!it) return s;
    return { items: { ...s.items, [itemId]: { ...it, ...patch } } };
  }),
}));

// 调试通道：e2e / 控制台可从 window 读 store 状态
if (typeof window !== 'undefined') (window as any).__useItems = useItems;

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
