/**
 * 自研数据表格（P1：替换 AG Grid Community，体积 -1.2MB、渲染路径可控）
 * 第二十三批全面升级：多条件筛选栏 + 列汇总页脚 + 条件格式(数值热力图) +
 *   列隐藏/冻结/拖拽换序/宽度调整 + Group 折叠展开
 * 功能对齐 AG Grid 用到的部分 + Monday.com 表格视图核心能力
 * DOM 契约（e2e 依赖）：
 *   [data-grid-cell][data-col="name"]、[data-grid-check]、[data-grid-drag]、[data-grid-row]
 *   [data-filter-bar] [data-filter-row] [data-filter-add] [data-filter-clear]
 *   [data-col-summary] [data-col-menu] [data-group-band] [data-col-hide] [data-col-freeze]
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { UI, TAG, doneLabelsOf, soften, GROUP_PALETTE } from '../theme';
import { api } from '../api';
import { Icon } from './Icons';

export type GridRow = { id: string; name: string; version: number; position: number; values: Record<string, unknown>; group_id?: string; subtasks?: { total: number; done: number } };
export type GridColumn = { id: string; name: string; type: string; settings: any; restricted?: boolean };

const LABEL_W = 260;

// ── 列类型定义（菜单/内联建列共用） ──
const COL_TYPES = [
  { value: 'text', label: '文本' },
  { value: 'status', label: '状态' },
  { value: 'people', label: '人员' },
  { value: 'date', label: '日期' },
  { value: 'number', label: '数字' },
  { value: 'checkbox', label: '勾选' },
  { value: 'formula', label: '公式' },
  { value: 'mirror', label: '镜像' },
  { value: 'dependency', label: '前置任务' },
  { value: 'attachment', label: '附件' },
  { value: 'rating', label: '星级' },
  { value: 'tags', label: '标签' },
  { value: 'longtext', label: '长文本' },
];
const COL_TYPE_LABELS: Record<string, string> = Object.fromEntries(COL_TYPES.map((t) => [t.value, t.label]));
const menuBtnStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
  border: 'none', background: 'none', cursor: 'pointer', borderRadius: 6, fontSize: 12,
};

// ── 第二十三批：筛选 / 列状态 / 汇总 类型 ──
export type FilterOperator = 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'gt' | 'lt' | 'gte' | 'lte' | 'empty' | 'not_empty';
export type FilterCondition = { id: string; columnId: string; operator: FilterOperator; value: string };
export type ColumnState = { hidden?: boolean; frozen?: boolean; width?: number };
export type SummaryType = 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max';

const SUMMARY_CYCLE: SummaryType[] = ['none', 'sum', 'avg', 'count', 'min', 'max'];
const SUMMARY_LABEL: Record<SummaryType, string> = { none: '∅', sum: 'Σ', avg: 'x̄', count: '#', min: 'min', max: 'max' };

function scalar(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') { const o = v as any; return String(o.label ?? o.name ?? o.id ?? ''); }
  return String(v);
}

/** 通用下拉选择器（单击编辑用）：绝对定位面板，点选项即提交，点外部关闭。
 *  原生 <select> 在单击编辑模式下会因 autoFocus+onBlur+onChange 竞争而错乱，且无法回显不在选项中的值。 */
function ChipDropdown({ value, options, onPick, onClose, colorOf, placeholder, onAddOption }: {
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onPick: (v: string) => void;
  onClose: () => void;
  colorOf?: (o: { value: string; label: string; hint?: string }) => string | null;
  placeholder?: string;
  onAddOption?: (label: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const id = setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  // 若当前值不在选项里，补一个「当前值」项保证回显
  const extra = value && !options.some((o) => o.value === value);
  return (
    <div ref={ref} data-grid-editor data-chip-dropdown style={{
      position: 'absolute', zIndex: 45, top: '100%', left: 0, minWidth: 160, maxWidth: 260,
      maxHeight: 280, overflowY: 'auto', background: '#fff', borderRadius: 10,
      boxShadow: '0 8px 28px rgba(20,30,70,.2)', padding: 6, border: '1px solid #e6e8ef',
    }}>
      <div data-chip-opt="" onClick={() => onPick('')}
        style={{ padding: '6px 10px', borderRadius: 7, fontSize: 12, cursor: 'pointer', color: '#a0a4b1' }}>
        {placeholder ?? '— 清空 —'}
      </div>
      {extra && (
        <div data-chip-opt={value} onClick={() => onPick(value)}
          style={{ padding: '6px 10px', borderRadius: 7, fontSize: 12, cursor: 'pointer', background: '#eef1fe', color: '#4f6ef7' }}>
          {value} <span style={{ fontSize: 10, color: '#a0a4b1' }}>（当前值）</span>
        </div>
      )}
      {options.map((o) => {
        const c = colorOf?.(o) ?? null;
        return (
          <div key={o.value} data-chip-opt={o.value} onClick={() => onPick(o.value)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 7,
              fontSize: 12, cursor: 'pointer', background: o.value === value ? '#eef1fe' : 'transparent' }}>
            {c && <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
            {o.hint && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#a0a4b1' }}>{o.hint}</span>}
          </div>
        );
      })}
      {onAddOption && (
        <div style={{ borderTop: '1px solid #f0f1f5', marginTop: 4, paddingTop: 4 }}>
          <input data-option-add-inline placeholder="＋ 新建选项（回车添加）"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) onAddOption(v); (e.target as HTMLInputElement).value = ''; }
            }}
            style={{ width: '100%', padding: '6px 10px', border: 'none', borderBottom: '1px dashed #c3c8d4', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
        </div>
      )}
    </div>
  );
}

/** 稳定字符串哈希（给人名分配固定颜色） */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** 全公司用户列表（懒加载一次），用于 people 列选项与显示 */
function useCompanyUsers() {
  const [users, setUsers] = useState<{ id: string; name: string; email?: string }[]>([]);
  useEffect(() => {
    let alive = true;
    api.listUsers().then((u: any) => { if (alive) setUsers(Array.isArray(u) ? u : []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return users;
}

let filterIdCounter = 0;
function newFilterId() { return `f${++filterIdCounter}`; }

type Props = {
  rows: GridRow[];
  columns: GridColumn[];
  onOpenItem?: (id: string) => void;
  onEdit: (row: GridRow, field: string, value: unknown) => Promise<void>;
  onOrderChange: (orders: { id: string; position: number }[]) => Promise<void>;
  onSelectionChange?: (ids: Set<string>) => void;
  editable: boolean;
  isOwner?: boolean;
  sortBy?: string | null;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (field: string) => void;
  groups?: { id: string; name: string; color?: string | null }[];
  boardId?: string;
  onAddColumn?: (name: string, type: string, settings?: any) => Promise<void>;
  onRenameColumn?: (colId: string, name: string) => Promise<void>;
  onChangeColumnType?: (colId: string, type: string, settings?: any) => Promise<void>;
  onDeleteColumn?: (colId: string) => Promise<void>;
  onDuplicateColumn?: (colId: string) => Promise<void>;
  /** 列拖拽换序持久化 */
  onReorderColumn?: (order: string[]) => Promise<void>;
  /** 单元格内联新建选项（status/dropdown/tags）：调父组件写 settings */
  onAddColumnOption?: (colId: string, colType: string, label: string) => Promise<void>;
  onRenameGroup?: (gid: string, name: string) => Promise<void>;
  onAddGroup?: (name: string) => Promise<void>;
  onDeleteGroup?: (gid: string) => Promise<void>;
  onDuplicateGroup?: (gid: string) => Promise<void>;
  onDuplicateItem?: (itemId: string) => Promise<void>;
  onDeleteItem?: (itemId: string) => Promise<void>;
  onMoveItem?: (itemId: string, groupId: string | null) => Promise<void>;
  /** #61 筛选状态受控提升（视图持久化用）：传入则由父组件持有 */
  filters?: FilterCondition[];
  onFiltersChange?: (f: FilterCondition[]) => void;
  /** #58 导出接筛选：当前筛选后的行集回调 */
  onFilteredRowsChange?: (rows: GridRow[]) => void;
  /** 外部清除选择信号（父组件点击「清除选择」时递增，触发清空内部勾选） */
  clearSignal?: number;
};

export function BoardGrid({ rows, columns, onOpenItem, onEdit, onOrderChange, onSelectionChange, editable, isOwner, sortBy, sortDir, onSortChange, groups, boardId, onAddColumn, onRenameColumn, onChangeColumnType, onDeleteColumn, onDuplicateColumn, onReorderColumn, onAddColumnOption, onRenameGroup, onAddGroup, onDeleteGroup, onDuplicateGroup, onDuplicateItem, onDeleteItem, onMoveItem, filters: filtersProp, onFiltersChange, onFilteredRowsChange, clearSignal }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ rowId: string; field: string } | null>(null);
  const [draft, setDraft] = useState('');
  const lastSelectedRef = useRef<string | null>(null); // shift 连续选择的锚点行
  const shiftKeyRef = useRef(false); // checkbox 点击时是否按住 shift（change 事件拿不到 shiftKey）
  const dragId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [itemsVersion, setItemsVersion] = useState(0);

  // ── 筛选栏（#61：可选受控提升到父组件，便于视图持久化）──
  const [filterBarOpen, setFilterBarOpen] = useState(false);
  const [internalFilters, setInternalFilters] = useState<FilterCondition[]>([]);
  const filters = filtersProp ?? internalFilters;
  const setFilters = (f: FilterCondition[] | ((cur: FilterCondition[]) => FilterCondition[])) => {
    const next = typeof f === 'function' ? (f as (cur: FilterCondition[]) => FilterCondition[])(filters) : f;
    if (onFiltersChange) onFiltersChange(next);
    else setInternalFilters(next);
  };

  // 工具条「筛选」按钮 → 展开/收起筛选栏（事件通信，避免提升状态）
  useEffect(() => {
    const onToggle = () => setFilterBarOpen((v) => !v);
    window.addEventListener('manday:toggle-filter', onToggle);
    return () => window.removeEventListener('manday:toggle-filter', onToggle);
  }, []);

  // ── 列状态（隐藏/冻结/宽度/顺序） ──
  const [columnStates, setColumnStates] = useState<Record<string, ColumnState>>({});
  const [columnOrder, setColumnOrder] = useState<string[] | null>(null);
  const [colMenuFor, setColMenuFor] = useState<string | null>(null);
  const resizeColRef = useRef<{ id: string; startX: number; startW: number } | null>(null);
  const colDragId = useRef<string | null>(null);
  const [colDragOver, setColDragOver] = useState<string | null>(null);

  // ── 列汇总 ──
  const [summaries, setSummaries] = useState<Record<string, SummaryType>>({});

  // ── 分组折叠 ──
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── 列头菜单增强（改名/改类型/删除/复制） ──
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [changingTypeCol, setChangingTypeCol] = useState<string | null>(null);

  // ── 内联建列 ──
  const [addingCol, setAddingCol] = useState(false);
  const [newColNameDraft, setNewColNameDraft] = useState('');
  const [newColTypeDraft, setNewColTypeDraft] = useState('text');

  // ── 分组头增强 ──
  const [groupMenuFor, setGroupMenuFor] = useState<string | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [groupRenameDraft, setGroupRenameDraft] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupNameDraft, setNewGroupNameDraft] = useState('');

  // ── 行菜单 ──
  const [rowMenuFor, setRowMenuFor] = useState<string | null>(null);

  // ── #66 附件图片 lightbox 预览 ──
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const openImage = async (a: { id: string; name: string }) => {
    try {
      const blob = await api.attachmentBlob(a.id);
      setLightbox({ url: URL.createObjectURL(blob), name: a.name });
    } catch { api.downloadAttachment(a.id, a.name).catch(() => {}); }
  };
  const isImageFile = (n: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n);

  // ── people 列真实用户列表（选项/显示用）──
  const companyUsers = useCompanyUsers();

  useEffect(() => { setLocalOrder(null); setItemsVersion((v) => v + 1); }, [rows]);
  useEffect(() => { onSelectionChange?.(selected); }, [selected]);
  // 外部清除选择信号 → 清空内部勾选（父组件「清除选择」按钮）
  useEffect(() => { if (clearSignal) setSelected(new Set()); }, [clearSignal]);
  // #58：筛选后的行集回传父组件（导出用）
  const filteredRowsCb = useRef(onFilteredRowsChange);
  filteredRowsCb.current = onFilteredRowsChange;

  // 列菜单外部点击关闭
  useEffect(() => {
    if (!colMenuFor) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-col-menu]') && !t.closest('[data-col-menu-trigger]')) setColMenuFor(null);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
    return () => window.removeEventListener('click', close);
  }, [colMenuFor]);

  // 分组菜单外部点击关闭
  useEffect(() => {
    if (!groupMenuFor) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-group-menu]') && !t.closest('[data-group-menu-trigger]')) setGroupMenuFor(null);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
    return () => window.removeEventListener('click', close);
  }, [groupMenuFor]);

  // 行菜单外部点击关闭
  useEffect(() => {
    if (!rowMenuFor) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-row-menu]') && !t.closest('[data-row-menu-trigger]')) setRowMenuFor(null);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
    return () => window.removeEventListener('click', close);
  }, [rowMenuFor]);

  // 列宽拖拽（始终挂载，内部检查 ref）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeColRef.current; if (!r) return;
      const newW = Math.max(80, Math.min(500, r.startW + (e.clientX - r.startX)));
      setColumnStates((s) => ({ ...s, [r.id]: { ...s[r.id], width: newW } }));
    };
    const onUp = () => { resizeColRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── 可见列（隐藏过滤 + 自定义顺序 + 冻结优先） ──
  const visibleColumns = useMemo(() => {
    let cols = columns.filter((c) => !columnStates[c.id]?.hidden);
    if (columnOrder) {
      const idx = new Map(columnOrder.map((id, i) => [id, i]));
      cols = [...cols].sort((a, b) => (idx.get(a.id) ?? 999) - (idx.get(b.id) ?? 999));
    }
    return [...cols].sort((a, b) => {
      const af = columnStates[a.id]?.frozen ? 0 : 1;
      const bf = columnStates[b.id]?.frozen ? 0 : 1;
      return af - bf;
    });
  }, [columns, columnStates, columnOrder]);

  // ── 筛选行 ──
  const filteredRows = useMemo(() => {
    if (filters.length === 0) return rows;
    return rows.filter((r) => filters.every((f) => {
      const val = f.columnId === 'name' ? r.name : scalar(r.values[f.columnId]);
      const num = Number(val);
      switch (f.operator) {
        case 'contains': return val.toLowerCase().includes(f.value.toLowerCase());
        case 'not_contains': return !val.toLowerCase().includes(f.value.toLowerCase());
        case 'equals': return val === f.value;
        case 'not_equals': return val !== f.value;
        case 'gt': return val !== '' && !isNaN(num) && num > Number(f.value);
        case 'lt': return val !== '' && !isNaN(num) && num < Number(f.value);
        case 'gte': return val !== '' && !isNaN(num) && num >= Number(f.value);
        case 'lte': return val !== '' && !isNaN(num) && num <= Number(f.value);
        case 'empty': return val === '';
        case 'not_empty': return val !== '';
        default: return true;
      }
    }));
  }, [rows, filters]);
  useEffect(() => { filteredRowsCb.current?.(filteredRows); }, [filteredRows]);

  // 大板性能：分块渲染（初始 150 行，滚近底部增量 +200，IntersectionObserver 触发）
  const gridRootRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(150);
  useEffect(() => { setVisibleCount(150); }, [filteredRows.length]);
  useEffect(() => {
    const root = gridRootRef.current;
    const sentinel = root?.querySelector('[data-grid-sentinel]');
    if (!root || !sentinel) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setVisibleCount((c) => c + 200); },
      { root, rootMargin: '600px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });
  // #61：恢复带筛选的视图时自动展开筛选栏
  const prevFilterCount = useRef(0);
  useEffect(() => {
    if (filters.length > 0 && prevFilterCount.current === 0) setFilterBarOpen(true);
    prevFilterCount.current = filters.length;
  }, [filters.length]);

  const sortedRows = useMemo(() => {
    let arr = [...filteredRows];
    if (localOrder) {
      const idx = new Map(localOrder.map((id, i) => [id, i]));
      arr.sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0));
    } else if (sortBy) {
      const dir = sortDir === 'desc' ? -1 : 1;
      arr.sort((a, b) => {
        if (sortBy === 'name') return dir * a.name.localeCompare(b.name, 'zh-Hans-CN');
        const col = columns.find((c) => c.id === sortBy);
        const av = col?.type === 'checkbox' ? String(a.values[sortBy] === true) : scalar(a.values[sortBy]);
        const bv = col?.type === 'checkbox' ? String(b.values[sortBy] === true) : scalar(b.values[sortBy]);
        const an = Number(av), bn = Number(bv);
        if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) return dir * (an - bn);
        if (av === '' && bv === '') return 0;
        if (av === '') return 1;
        if (bv === '') return -1;
        return dir * av.localeCompare(bv, 'zh-Hans-CN');
      });
    } else {
      // 有分组时先按 groups 数组顺序排分组，再按 position 排组内条目；
      // 无分组或 group_id 不在 groups 中的条目放最后（未分组）
      if (groups?.length) {
        const groupIdx = new Map(groups.map((g, i) => [g.id, i]));
        arr.sort((a, b) => {
          const ga = a.group_id ? (groupIdx.get(a.group_id) ?? 99999) : 99999;
          const gb = b.group_id ? (groupIdx.get(b.group_id) ?? 99999) : 99999;
          if (ga !== gb) return ga - gb;
          return (a.position ?? 0) - (b.position ?? 0);
        });
      } else {
        arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      }
    }
    return arr;
  }, [filteredRows, localOrder, sortBy, sortDir, columns, groups]);

  const allChecked = sortedRows.length > 0 && sortedRows.every((r) => selected.has(r.id));

  // ── 数值热力图范围 ──
  const numericRange = useMemo(() => {
    const ranges: Record<string, { min: number; max: number }> = {};
    for (const col of visibleColumns) {
      if (col.type !== 'number' && col.type !== 'formula') continue;
      const vals = sortedRows.map((r) => scalar(r.values[col.id]))
        .filter((v) => v !== '' && !isNaN(Number(v))).map(Number);
      if (vals.length > 0) ranges[col.id] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
    return ranges;
  }, [visibleColumns, sortedRows]);

  const heatColor = (colId: string, val: string): string | null => {
    const range = numericRange[colId];
    if (!range || range.max === range.min) return null;
    const n = Number(val);
    if (isNaN(n)) return null;
    const ratio = (n - range.min) / (range.max - range.min);
    return `rgba(79, 110, 247, ${(0.06 + ratio * 0.16).toFixed(3)})`;
  };

  // ── 列汇总计算 ──
  const computeSummary = (col: GridColumn): string => {
    const type = summaries[col.id] ?? 'none';
    if (type === 'none') return '';
    const vals = sortedRows.map((r) => scalar(r.values[col.id])).filter((v) => v !== '');
    if (type === 'count') return String(vals.length);
    const nums = vals.map(Number).filter((n) => !isNaN(n));
    if (nums.length === 0) return '—';
    const sum = nums.reduce((a, b) => a + b, 0);
    switch (type) {
      case 'sum': return String(Math.round(sum * 100) / 100);
      case 'avg': return String(Math.round((sum / nums.length) * 100) / 100);
      case 'min': return String(Math.min(...nums));
      case 'max': return String(Math.max(...nums));
      default: return '';
    }
  };

  const cycleSummary = (colId: string) => {
    const cur = summaries[colId] ?? 'none';
    const next = SUMMARY_CYCLE[(SUMMARY_CYCLE.indexOf(cur) + 1) % SUMMARY_CYCLE.length];
    setSummaries((s) => ({ ...s, [colId]: next }));
  };

  // ── 快捷键导航 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (editing || (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))) return;
      if (!sortedRows.length) return;
      const idx = activeId ? sortedRows.findIndex((r) => r.id === activeId) : -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(Math.max(idx + (e.key === 'ArrowDown' ? 1 : -1), 0), sortedRows.length - 1);
        setActiveId(sortedRows[next].id);
      } else if (e.key === 'Enter' && activeId) {
        e.preventDefault(); onOpenItem?.(activeId);
      } else if (e.key === ' ' && activeId) {
        e.preventDefault(); toggleRow(activeId);
      } else if (e.key === 'Escape') {
        setSelected(new Set()); setActiveId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, sortedRows, activeId, onOpenItem]);

  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(sortedRows.map((r) => r.id)));
  };
  const toggleRow = (id: string, shiftKey = false) => {
    setSelected((s) => {
      const n = new Set(s);
      if (shiftKey && lastSelectedRef.current) {
        // shift 连续选择：选中上次点击行 → 当前行之间的所有行
        const ids = sortedRows.map((r) => r.id);
        const a = ids.indexOf(lastSelectedRef.current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          for (let i = lo; i <= hi; i++) n.add(ids[i]);
        } else {
          n.has(id) ? n.delete(id) : n.add(id);
        }
      } else {
        n.has(id) ? n.delete(id) : n.add(id);
      }
      return n;
    });
    lastSelectedRef.current = id;
  };

  // ── 筛选操作 ──
  const addFilter = () => {
    const firstCol = columns[0]?.id ?? 'name';
    setFilters((f) => [...f, { id: newFilterId(), columnId: firstCol, operator: 'contains', value: '' }]);
  };
  const updateFilter = (id: string, patch: Partial<FilterCondition>) => {
    setFilters((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const removeFilter = (id: string) => {
    setFilters((f) => f.filter((x) => x.id !== id));
  };
  const clearFilters = () => { setFilters([]); setFilterBarOpen(false); };

  // ── 列状态操作 ──
  const toggleColumnHidden = (colId: string) => {
    setColumnStates((s) => ({ ...s, [colId]: { ...s[colId], hidden: !s[colId]?.hidden } }));
    setColMenuFor(null);
  };
  const toggleColumnFrozen = (colId: string) => {
    setColumnStates((s) => ({ ...s, [colId]: { ...s[colId], frozen: !s[colId]?.frozen } }));
    setColMenuFor(null);
  };
  const resetColumnWidth = (colId: string) => {
    setColumnStates((s) => { const n = { ...s }; if (n[colId]) delete n[colId].width; return n; });
    setColMenuFor(null);
  };
  const showAllColumns = () => {
    setColumnStates((s) => {
      const n: Record<string, ColumnState> = {};
      for (const [k, v] of Object.entries(s)) n[k] = { ...v, hidden: false };
      return n;
    });
  };

  // ── 列拖拽换序 ──
  const onColDragStart = (e: React.DragEvent, colId: string) => {
    colDragId.current = colId;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onColDragOver = (e: React.DragEvent, colId: string) => {
    if (colDragId.current && colDragId.current !== colId) { e.preventDefault(); setColDragOver(colId); }
  };
  const onColDrop = (colId: string) => {
    const src = colDragId.current; colDragId.current = null; setColDragOver(null);
    if (!src || src === colId) return;
    const ids = visibleColumns.map((c) => c.id);
    const from = ids.indexOf(src); const to = ids.indexOf(colId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setColumnOrder(ids);
    onReorderColumn?.(ids).catch(() => {});
  };

  // ── 分组折叠 ──
  const toggleGroupCollapse = (gid: string | null) => {
    const key = gid ?? '__none__';
    setCollapsedGroups((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const isGroupCollapsed = (gid: string | null) => collapsedGroups.has(gid ?? '__none__');

  // ── 列操作 ──
  const startRenameCol = (colId: string, curName: string) => {
    setRenamingCol(colId); setRenameDraft(curName);
  };
  const commitRenameCol = async () => {
    const id = renamingCol; const name = renameDraft.trim();
    setRenamingCol(null);
    if (id && name && onRenameColumn) await onRenameColumn(id, name);
  };
  const startChangeType = (colId: string) => {
    setChangingTypeCol(colId);
  };
  const commitChangeType = async (colId: string, newType: string) => {
    setChangingTypeCol(null);
    if (onChangeColumnType) {
      const settings = newType === 'formula' ? { formula: prompt('输入公式（如 {数字} * 2）') ?? '' } : undefined;
      await onChangeColumnType(colId, newType, settings);
    }
  };
  const handleAddColumn = async () => {
    const name = newColNameDraft.trim();
    if (!name || !onAddColumn) { setAddingCol(false); return; }
    await onAddColumn(name, newColTypeDraft);
    setNewColNameDraft(''); setNewColTypeDraft('text'); setAddingCol(false);
  };
  const handleDeleteCol = async (colId: string, colName: string) => {
    setColMenuFor(null);
    if (!confirm(`删除列「${colName}」？该列所有数据会一并删除，不可恢复。`)) return;
    if (onDeleteColumn) await onDeleteColumn(colId);
  };
  const handleDuplicateCol = async (colId: string) => {
    setColMenuFor(null);
    if (onDuplicateColumn) await onDuplicateColumn(colId);
  };

  const startEdit = (rowId: string, field: string, current: string) => {
    if (!editable) return;
    const col = columns.find((c) => c.id === field);
    if (col?.restricted) return;
    if (col?.type === 'formula') return;
    if (col?.type === 'rating') return; // 星级直接点击编辑，不走双击流程
    setEditing({ rowId, field });
    setDraft(current);
  };

  /** 取单元格当前显示值（#59 键盘跳转后重新开编辑器用，与 td onClick 的 draft 来源一致） */
  const startEditValue = (row: GridRow, field: string): string => {
    if (field === 'name') return row.name;
    const col = columns.find((c) => c.id === field);
    return col?.type === 'checkbox' ? String(row.values[field] === true)
      : col?.type === 'tags' ? JSON.stringify(row.values[field] ?? [])
      : col?.type === 'people' || col?.type === 'dependency' ? String(row.values[field] ?? '')
      : col?.type === 'mirror' ? (() => { try { return String(JSON.parse(String(row.values[field] ?? '{}')).itemId ?? ''); } catch { return ''; } })()
      : scalar(row.values[field]);
  };

  /** #59 键盘流：Enter → 下行同列继续编辑；Tab → 右跳下一个可编辑列 */
  const moveEditing = (rowId: string, field: string, dir: 'down' | 'right') => {
    if (dir === 'down') {
      const idx = sortedRows.findIndex((r) => r.id === rowId);
      const next = sortedRows[idx + 1];
      if (next) startEdit(next.id, field, startEditValue(next, field));
      return;
    }
    const editableType = (t?: string) => !!t && ['text', 'number', 'date', 'longtext', 'status', 'people', 'dropdown', 'checkbox', 'tags'].includes(t);
    const cols = visibleColumns;
    const from = field === 'name' ? -1 : cols.findIndex((c) => c.id === field);
    const row = rows.find((r) => r.id === rowId);
    for (let i = from + 1; i < cols.length; i++) {
      const c = cols[i];
      if (c.restricted || !editableType(c.type) || !row) continue;
      startEdit(rowId, c.id, startEditValue(row, c.id));
      return;
    }
  };

  const commit = async (move?: 'down' | 'right') => {
    const e = editing;
    setEditing(null);
    if (!e) return;
    const row = rows.find((r) => r.id === e.rowId);
    if (!row) return;
    const col = columns.find((c) => c.id === e.field);
    let value: unknown = draft;
    if (e.field === 'name') {
      if (draft !== row.name && draft.trim()) await onEdit(row, 'name', draft.trim());
      if (move) moveEditing(e.rowId, 'name', move);
      return;
    }
    if (col?.type === 'number') value = draft === '' ? null : Number(draft);
    if (col?.type === 'checkbox') value = draft === 'true';
    if (col?.type === 'tags') { try { value = JSON.parse(draft); } catch { value = []; } }
    const p = onEdit(row, e.field, value);
    if (move) moveEditing(e.rowId, e.field, move);
    await p;
  };

  const drop = async (targetId: string) => {
    const src = dragId.current;
    dragId.current = null;
    setOverId(null);
    if (!src || src === targetId) return;
    const ids = sortedRows.map((r) => r.id);
    const from = ids.indexOf(src);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setLocalOrder(ids);
    await onOrderChange(ids.map((id, i) => ({ id, position: (i + 1) * 1000 })));
  };

  const renderCell = (row: GridRow, col: GridColumn) => {
    const raw = row.values[col.id];
    const v = scalar(raw);
    const isEditing = editing?.rowId === row.id && editing.field === col.id;
    const ep = col.settings?.editPermission ?? col.settings?.editable;
    const locked = editable && !col.restricted && (isOwner || ep !== 'owner');
    const heat = heatColor(col.id, v);
    const cellBg = heat ? { background: heat } : undefined;

    if (col.restricted) {
      return <span data-grid-restricted={col.id} title="该列仅负责人可见"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#a0a4b1', fontSize: 12 }}>
        <span style={{ display: 'inline-block', width: 52, height: 13, borderRadius: 7,
          background: '#e3e6ee', filter: 'blur(1px)' }} />🔒</span>;
    }

    if (isEditing) {
      if (col.type === 'dependency') {
        return <DependencyEditor rows={rows.filter((r) => r.id !== row.id)} value={draft}
          onCommit={(itemId) => { setEditing(null); onEdit(row, col.id, itemId); }} onClose={() => setEditing(null)} />;
      }
      if (col.type === 'mirror') {
        return <MirrorEditor col={col} value={draft}
          onCommit={(itemId) => { setEditing(null); if (itemId) onEdit(row, col.id, itemId); }} onClose={() => setEditing(null)} />;
      }
      if (col.type === 'attachment') {
        return <AttachmentEditor rowId={row.id} colId={col.id} onDone={() => { setEditing(null); onEdit(row, '__attachments__', null); }} />;
      }
      if (col.type === 'date') {
        return <input data-grid-editor autoFocus type="date" value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit('down'); } if (e.key === 'Tab') { e.preventDefault(); commit('right'); } if (e.key === 'Escape') setEditing(null); }}
          style={editorStyle} />;
      }
      if (col.type === 'status' || col.type === 'people' || col.type === 'dropdown') {
        // 选项来源：status=标签 / people=全公司真实用户 / dropdown=自定义选项
        const opts: { value: string; label: string; hint?: string }[] = col.type === 'status'
          ? (col.settings?.labels ?? []).filter((l: any) => !(col.settings?.inactiveLabels ?? []).includes(l.label))
              .map((l: any) => ({ value: l.label, label: l.label }))
          : col.type === 'people'
            ? companyUsers.map((u) => ({ value: u.id, label: u.name, hint: u.email }))
            : (col.settings?.options ?? []).map((o: any) => ({ value: o.label, label: o.label }));
        const colorOf = col.type === 'status'
          ? (o: { value: string }) => soften((col.settings?.labels ?? []).find((l: any) => l.label === o.value)?.color) ?? '#8a90a3'
          : col.type === 'people'
            ? (o: { value: string }) => {
                const u = companyUsers.find((x) => x.id === o.value);
                return u ? GROUP_PALETTE[Math.abs(hashStr(u.id)) % GROUP_PALETTE.length] : '#579bfc';
              }
            : undefined;
        const pick = (val: string) => { setDraft(val); setEditing(null); onEdit(row, col.id, val); };
        return <ChipDropdown value={draft} options={opts} colorOf={colorOf} onPick={pick}
          onClose={() => setEditing(null)}
          onAddOption={col.type === 'people' ? undefined : (label) => onAddColumnOption?.(col.id, col.type, label)}
          placeholder={col.type === 'status' ? '— 清除状态 —' : col.type === 'people' ? '— 清除负责人 —' : '— 清空 —'} />;
      }
      if (col.type === 'tags') {
        const opts = col.settings?.options ?? [];
        let current: string[] = [];
        try { const p = JSON.parse(draft); if (Array.isArray(p)) current = p; } catch { if (draft) current = [draft]; }
        return <div data-grid-editor data-tags-editor style={{ ...editorStyle, padding: 4, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {opts.map((o: any) => {
            const sel = current.includes(o.label);
            return <span key={o.label} data-tag-toggle={o.label}
              onClick={() => {
                const next = sel ? current.filter((t) => t !== o.label) : [...current, o.label];
                setDraft(JSON.stringify(next));
              }}
              style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, cursor: 'pointer',
                background: sel ? `${soften(o.color) ?? '#4f6ef7'}22` : '#f0f1f5',
                color: sel ? soften(o.color) ?? '#4f6ef7' : '#7a7f8c' }}>
              {o.label}
            </span>;
          })}
          <input data-option-add-inline placeholder="＋ 新标签" onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) { onAddColumnOption?.(col.id, col.type, v); setDraft(JSON.stringify([...current, v])); } (e.target as HTMLInputElement).value = ''; } }}
            style={{ width: 64, padding: '2px 6px', borderRadius: 10, border: '1px dashed #c3c8d4', fontSize: 11, outline: 'none' }} />
          <button onClick={() => commit()} style={{ marginLeft: 4, padding: '2px 8px', borderRadius: 6, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 11 }}>✓</button>
        </div>;
      }
      if (col.type === 'longtext') {
        return <textarea data-grid-editor autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit(); if (e.key === 'Escape') setEditing(null); }}
          style={{ ...editorStyle, minHeight: 60, resize: 'vertical' }} />;
      }
      return <input data-grid-editor autoFocus type={col.type === 'number' ? 'number' : 'text'} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit('down'); } if (e.key === 'Tab') { e.preventDefault(); commit('right'); } if (e.key === 'Escape') setEditing(null); }}
        style={editorStyle} />;
    }

    if (col.type === 'formula') {
      if (v === undefined || v === null || v === '') return <span data-formula-cell={col.id} style={{ color: '#c3c8d4' }}>—</span>;
      return <span data-formula-cell={col.id} title={`ƒx ${col.settings?.formula ?? ''}`} style={{ ...cellBg, color: '#5b6c8f', fontSize: 13, padding: '2px 6px', borderRadius: 4, display: 'inline-block' }}>{v}</span>;
    }
    if (col.type === 'dependency') {
      let depIds: string[] = [];
      try {
        const p = JSON.parse(String(v));
        depIds = Array.isArray(p) ? p.map(String) : p ? [String(p)] : [];
      } catch { depIds = v ? [String(v)] : []; }
      depIds = depIds.filter(Boolean);
      if (!depIds.length) return <span data-dep-cell={col.id} style={{ color: '#c3c8d4' }}>—</span>;
      const names = depIds.map((id) => rows.find((r) => r.id === id)?.name ?? '?');
      return <span data-dep-cell={col.id} title={`前置：${names.join('、')}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#7a7f8c' }}>
        <span style={{ color: '#b5bac8' }}>⤴</span>{names.join('、')}</span>;
    }
    if (col.type === 'mirror') {
      let m: any = null;
      try { m = JSON.parse(String(v)); } catch { }
      if (!m || (!m.name && !m.label)) return <span data-mirror-cell={col.id} style={{ color: '#c3c8d4' }}>—</span>;
      return <span data-mirror-cell={col.id} title={`镜像自：${m.name ?? ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13 }}>{m.name}</span>
        {m.label && <span style={{ background: `${soften(m.color) ?? '#d0d4e0'}22`, color: soften(m.color) ?? '#5a6072',
          padding: '1px 9px', borderRadius: 20, fontSize: 12 }}>{m.label}</span>}
      </span>;
    }
    if (col.type === 'attachment') {
      let list: any[] = [];
      try { const p = JSON.parse(String(v)); if (Array.isArray(p)) list = p; } catch { }
      if (!list.length) return <span data-attach-cell={col.id} style={{ color: '#c3c8d4' }}>—</span>;
      return <span data-attach-cell={col.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {list.map((a) => {
          const img = isImageFile(a.name);
          return <span key={a.id} data-attach-chip={a.id} data-attach-img={img ? '1' : undefined}
            title={`${a.name} · ${img ? '点击预览' : '点击下载'}`}
            onClick={() => (img ? openImage(a) : api.downloadAttachment(a.id, a.name).catch(() => {}))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eef1fe', color: '#5b6c8f',
              padding: '2px 9px', borderRadius: 14, fontSize: 12, cursor: 'pointer', maxWidth: 180,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {img ? '🖼' : '📎'} {a.name}
          </span>;
        })}
      </span>;
    }
    if (col.type === 'checkbox') {
      return <input type="checkbox" checked={v === 'true'} disabled={!locked}
        onChange={(e) => locked && onEdit(row, col.id, e.target.checked)} style={{ cursor: locked ? 'pointer' : 'not-allowed' }} />;
    }
    if (col.type === 'status') {
      const opt = (col.settings?.labels ?? []).find((l: any) => l.label === v);
      const chipColor = soften(opt?.color) ?? '#d0d4e0';
      if (!v) return <span style={{ color: TAG.gray }}>—</span>;
      return <span data-status-chip={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
        background: `${chipColor}22`,
        color: chipColor, padding: '2px 10px', borderRadius: 20, fontSize: 12 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: chipColor }} />{v}</span>;
    }
    if (col.type === 'people') {
      if (!v) return <span style={{ color: '#c3c8d4' }}>—</span>;
      // v 可能是用户 ID；优先从真实用户列表解析，兼容旧数据里直接存名字的情况
      const u = companyUsers.find((x) => x.id === v) ?? companyUsers.find((x) => x.name === v);
      // 兼容旧 settings.members 假数据（name 匹配）
      const legacy = (col.settings?.members ?? []).find((m: any) => m.id === v || m.name === v);
      const name = u?.name ?? legacy?.name ?? v;
      const color = u ? GROUP_PALETTE[Math.abs(hashStr(u.id)) % GROUP_PALETTE.length]
        : (legacy?.color ?? '#579bfc');
      return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 20, height: 20, borderRadius: '50%', background: color, color: '#fff',
          fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{name[0]}</span>
        {name}</span>;
    }
    if (col.type === 'dropdown') {
      // 兼容数组（多选）和单值字符串
      const list = Array.isArray(raw) ? raw : (v ? [v] : []);
      if (!list.length) return <span style={{ color: '#c3c8d4' }}>—</span>;
      return <span>{list.map((r: any, i: number) => <span key={i} style={{ display: 'inline-block', background: '#d0d4e026',
        color: '#5a6072', padding: '2px 9px', borderRadius: 5, fontSize: 12, marginRight: 4 }}>{scalar(r)}</span>)}</span>;
    }
    if (col.type === 'rating') {
      const max = col.settings?.max ?? 5;
      const n = Number(v) || 0;
      return <span data-rating-cell={col.id} style={{ display: 'inline-flex', gap: 1 }}>
        {Array.from({ length: max }, (_, i) => (
          <span key={i} data-rating-star={i + 1}
            onClick={(e) => { e.stopPropagation(); if (locked) onEdit(row, col.id, i + 1 === n ? 0 : i + 1); }}
            style={{ fontSize: 14, cursor: locked ? 'pointer' : 'default', color: i < n ? '#f5a623' : '#d5d9e3', userSelect: 'none' }}>★</span>
        ))}
      </span>;
    }
    if (col.type === 'tags') {
      let selected: string[] = [];
      try { const p = JSON.parse(String(v)); if (Array.isArray(p)) selected = p; } catch { if (v) selected = [v]; }
      if (!selected.length) return <span style={{ color: '#c3c8d4' }}>—</span>;
      const opts = col.settings?.options ?? [];
      return <span data-tags-cell={col.id} style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap' }}>
        {selected.map((tag, i) => {
          const opt = opts.find((o: any) => o.label === tag);
          const color = soften(opt?.color) ?? '#7a7f8c';
          return <span key={i} style={{ background: `${color}22`, color, padding: '1px 8px', borderRadius: 10, fontSize: 11 }}>{tag}</span>;
        })}
      </span>;
    }
    if (col.type === 'longtext') {
      if (!v) return <span style={{ color: '#c3c8d4' }}>—</span>;
      const truncated = v.length > 50 ? v.slice(0, 50) + '…' : v;
      return <span data-longtext-cell={col.id} title={v} style={{ fontSize: 13, color: '#5a6072' }}>{truncated}</span>;
    }
    if (!v) return <span style={{ color: '#c3c8d4' }}>—</span>;
    if (cellBg && (col.type === 'number' || col.type === 'formula')) {
      return <span style={{ ...cellBg, fontSize: 13, padding: '2px 6px', borderRadius: 4, display: 'inline-block' }}>{v}</span>;
    }
    return <span style={{ fontSize: 13 }}>{v}</span>;
  };

  const rowDone = (row: GridRow) => {
    const c = columns.find((x) => x.type === 'status');
    if (!c) return false;
    const v = row.values?.[c.id];
    return v != null && doneLabelsOf(c.settings).has(String(v));
  };

  const colWidth = (colId: string): number | undefined => columnStates[colId]?.width;
  const hiddenCount = columns.filter((c) => columnStates[c.id]?.hidden).length;

  return (
    <div ref={gridRootRef} style={{ flex: 1, overflow: 'auto', background: '#fff' }} data-grid-root>
      <style>{`
        [data-grid-row] [data-grid-open]{opacity:0;transition:opacity .12s}
        [data-grid-row]:hover [data-grid-open]{opacity:1}
        tr[data-active="1"] td{background:${UI.primarySoft}}
        [data-col-resize]{cursor:col-resize;user-select:none}
        [data-col-drag-over]{background:#eef1fe!important}
      `}</style>

      {/* ── 筛选栏 ── */}
      <div data-filter-bar style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderBottom: '1px solid #eef0f5', flexWrap: 'wrap', background: '#fafbfe' }}>
        <button data-filter-toggle onClick={() => setFilterBarOpen((v) => !v)}
          style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #e6e8ef', background: filterBarOpen ? '#eef1fe' : '#fff', cursor: 'pointer', fontSize: 12, color: '#4f6ef7', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon name="filter" size={13} />
          筛选{filters.length ? ` (${filters.length})` : ''}
        </button>
        {filterBarOpen && (
          <>
            {filters.map((f) => (
              <div key={f.id} data-filter-row style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <select data-filter-col value={f.columnId} onChange={(e) => updateFilter(f.id, { columnId: e.target.value })} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #e6e8ef' }}>
                  <option value="name">条目</option>
                  {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select data-filter-op value={f.operator} onChange={(e) => updateFilter(f.id, { operator: e.target.value as FilterOperator })} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #e6e8ef' }}>
                  <option value="contains">包含</option>
                  <option value="not_contains">不包含</option>
                  <option value="equals">等于</option>
                  <option value="not_equals">不等于</option>
                  <option value="gt">大于</option>
                  <option value="lt">小于</option>
                  <option value="gte">≥</option>
                  <option value="lte">≤</option>
                  <option value="empty">为空</option>
                  <option value="not_empty">非空</option>
                </select>
                {f.operator !== 'empty' && f.operator !== 'not_empty' && (
                  <input data-filter-val value={f.value} onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                    placeholder="值" style={{ width: 100, fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #e6e8ef' }} />
                )}
                <button data-filter-remove onClick={() => removeFilter(f.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#e2445c', fontSize: 14 }}>✕</button>
              </div>
            ))}
            <button data-filter-add onClick={addFilter} style={{ padding: '3px 10px', borderRadius: 6, border: '1px dashed #4f6ef7', background: '#f5f7ff', color: '#4f6ef7', cursor: 'pointer', fontSize: 12 }}>＋ 条件</button>
            {filters.length > 0 && <button data-filter-clear onClick={clearFilters} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: 'none', color: '#7a7f8c', cursor: 'pointer', fontSize: 12 }}>清除全部</button>}
            <span style={{ fontSize: 11, color: '#a0a4b1' }}>匹配 {filteredRows.length}/{rows.length} 行</span>
          </>
        )}
        {hiddenCount > 0 && (
          <button data-col-show-all onClick={showAllColumns} title={`${hiddenCount} 列已隐藏`}
            style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 6, border: '1px solid #e6e8ef', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#b8860b' }}>
            {'\u{1F441}'} 显示隐藏列 ({hiddenCount})
          </button>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ position: 'sticky', top: 0, background: '#eef1f6', zIndex: 2, boxShadow: '0 1px 0 #e6e8ef' }}>
            <th style={{ ...thStyle, width: 36 }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} data-grid-check-all />
            </th>
            <th style={{ ...thStyle, width: 28 }}></th>
            <th style={{ ...thStyle, textAlign: 'left', width: LABEL_W, cursor: onSortChange ? 'pointer' : undefined }}
              onClick={() => onSortChange?.('name')}
              title="点击排序">
              条目{sortBy === 'name' ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
            </th>
            {visibleColumns.map((c) => (
              <th key={c.id}
                draggable
                onDragStart={(e) => onColDragStart(e, c.id)}
                onDragOver={(e) => onColDragOver(e, c.id)}
                onDrop={() => onColDrop(c.id)}
                onDragEnd={() => { colDragId.current = null; setColDragOver(null); }}
                style={{ ...thStyle, textAlign: 'left', cursor: 'pointer', width: colWidth(c.id),
                  background: colDragOver === c.id ? '#eef1fe' : undefined,
                  borderLeft: columnStates[c.id]?.frozen ? '2px solid #4f6ef7' : undefined }}
                onClick={() => !c.restricted && onSortChange?.(c.id)}
                onContextMenu={(e) => { e.preventDefault(); setColMenuFor(c.id); }}
                title="点击排序 · 右键列菜单 · 拖拽换序 · 右边缘拖拽调宽">
                <span data-col-menu-trigger onClick={(e) => { e.stopPropagation(); setColMenuFor(c.id === colMenuFor ? null : c.id); }}
                  style={{ cursor: 'pointer', marginRight: 4, fontSize: 10, color: '#a0a4b1' }}>▾</span>
                {c.name}
                {sortBy === c.id ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                {columnStates[c.id]?.frozen && <span title="已冻结" style={{ marginLeft: 3 }}>{'\u{1F4CC}'}</span>}
                {c.restricted
                  ? <span title="仅负责人可见" style={{ marginLeft: 4 }}>{'\u{1F441}'}🔒</span>
                  : (c.settings?.editPermission ?? c.settings?.editable) === 'owner'
                    ? <span title="仅负责人可编辑" style={{ marginLeft: 4 }}>✏️🔒</span>
                    : null}
                {c.type === 'formula' && <span title={c.settings?.formula} style={{ marginLeft: 4, fontSize: 10,
                  background: '#eef1fe', color: '#5b6c8f', borderRadius: 4, padding: '1px 5px' }}>ƒx</span>}
                {/* 列宽拖拽手柄 */}
                <span data-col-resize
                  onMouseDown={(e) => {
                    e.stopPropagation(); e.preventDefault();
                    const th = (e.currentTarget.parentElement as HTMLElement);
                    resizeColRef.current = { id: c.id, startX: e.clientX, startW: th.offsetWidth || 220 };
                  }}
                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize' }} />
                {/* 列右键菜单 — Monday.com 风格完整菜单 */}
                {colMenuFor === c.id && (
                  <div data-col-menu style={{ position: 'absolute', top: '100%', right: 0, background: '#fff', borderRadius: 8,
                    boxShadow: '0 6px 20px rgba(0,0,0,.12)', padding: 6, zIndex: 10, minWidth: 200, fontSize: 12 }}
                    onClick={(e) => e.stopPropagation()}>
                    {/* 排序 */}
                    <button data-col-sort onClick={() => { onSortChange?.(c.id); setColMenuFor(null); }}
                      style={menuBtnStyle}>
                      ↕ 按此列排序{sortBy === c.id ? (sortDir === 'desc' ? '（降序）' : '（升序）') : ''}
                    </button>
                    {/* 按此列筛选 */}
                    <button data-col-filter onClick={() => {
                      setFilterBarOpen(true);
                      if (!filters.some((f) => f.columnId === c.id)) {
                        setFilters((f) => [...f, { id: newFilterId(), columnId: c.id, operator: 'contains', value: '' }]);
                      }
                      setColMenuFor(null);
                    }} style={menuBtnStyle}>
                      🔍 按此列筛选
                    </button>
                    <div style={{ borderTop: '1px solid #eef0f5', margin: '4px 0' }} />
                    {/* 改名 */}
                    {renamingCol === c.id ? (
                      <div style={{ padding: '4px 10px' }}>
                        <input autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRenameCol(); if (e.key === 'Escape') setRenamingCol(null); }}
                          onBlur={commitRenameCol}
                          style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: '2px solid #4f6ef7', fontSize: 12, boxSizing: 'border-box' }} />
                      </div>
                    ) : (
                      <button data-col-rename onClick={() => startRenameCol(c.id, c.name)} style={menuBtnStyle}>
                        ✏️ 重命名列
                      </button>
                    )}
                    {/* 改类型 */}
                    {changingTypeCol === c.id ? (
                      <div style={{ padding: '4px 10px' }}>
                        <select autoFocus value="" onChange={(e) => { if (e.target.value) commitChangeType(c.id, e.target.value); }}
                          onBlur={() => setChangingTypeCol(null)}
                          style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: '1px solid #e6e8ef', fontSize: 12, boxSizing: 'border-box' }}>
                          <option value="">选择新类型…</option>
                          {COL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                    ) : (
                      <button data-col-changetype onClick={() => startChangeType(c.id)} style={menuBtnStyle}>
                        🔄 更改列类型（当前：{COL_TYPE_LABELS[c.type] ?? c.type}）
                      </button>
                    )}
                    {/* 复制列 */}
                    <button data-col-duplicate onClick={() => handleDuplicateCol(c.id)} style={menuBtnStyle}>
                      📋 复制列
                    </button>
                    <div style={{ borderTop: '1px solid #eef0f5', margin: '4px 0' }} />
                    {/* 冻结/隐藏 */}
                    <button data-col-freeze onClick={() => toggleColumnFrozen(c.id)} style={menuBtnStyle}>
                      {columnStates[c.id]?.frozen ? '📌 取消冻结' : '📌 冻结列'}
                    </button>
                    <button data-col-hide onClick={() => toggleColumnHidden(c.id)}
                      style={{ ...menuBtnStyle, color: '#e2445c' }}>
                      隐藏列
                    </button>
                    {columnStates[c.id]?.width && (
                      <button onClick={() => resetColumnWidth(c.id)} style={menuBtnStyle}>
                        重置列宽
                      </button>
                    )}
                    {/* 删除列 */}
                    {isOwner && (
                      <>
                        <div style={{ borderTop: '1px solid #eef0f5', margin: '4px 0' }} />
                        <button data-col-delete onClick={() => handleDeleteCol(c.id, c.name)}
                          style={{ ...menuBtnStyle, color: '#e2445c' }}>
                          🗑 删除列
                        </button>
                      </>
                    )}
                  </div>
                )}
              </th>
            ))}
            {/* 内联新建列按钮（对所有人开放显示，非 owner 点击由后端权限拦截） */}
            <th style={{ ...thStyle, width: 100, textAlign: 'center' }}>
              {onAddColumn && (
                addingCol ? (
                  <div data-addcol-inline style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'center' }}>
                    <input autoFocus value={newColNameDraft} onChange={(e) => setNewColNameDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddColumn(); if (e.key === 'Escape') setAddingCol(false); }}
                      onBlur={() => { if (!newColNameDraft.trim()) setAddingCol(false); }}
                      placeholder="列名" style={{ width: 60, padding: '3px 4px', borderRadius: 4, border: '1px solid #4f6ef7', fontSize: 11 }} />
                    <select value={newColTypeDraft} onChange={(e) => setNewColTypeDraft(e.target.value)}
                      style={{ padding: '3px 2px', borderRadius: 4, border: '1px solid #e6e8ef', fontSize: 11 }}>
                      {COL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <button data-addcol-confirm onClick={handleAddColumn} disabled={!newColNameDraft.trim()}
                      style={{ padding: '2px 6px', borderRadius: 4, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 11 }}>✓</button>
                  </div>
                ) : (
                  <button data-addcol-trigger onClick={() => setAddingCol(true)}
                    title="添加新列"
                    style={{ border: '1px dashed #b5bac8', background: '#f6f7fb', color: '#7a7f8c',
                      cursor: 'pointer', fontSize: 16, borderRadius: 6, padding: '2px 12px', lineHeight: 1 }}>＋</button>
                )
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            const showBands = !!groups?.length && !sortBy && !localOrder;
            const colorOf = (gid?: string) => {
              if (!gid || !groups?.length) return null;
              const gi = groups.findIndex((g) => g.id === gid);
              if (gi < 0) return null;
              const c = groups[gi].color;
              return (c && /^#[0-9a-fA-F]{6}$/.test(c) ? soften(c) : GROUP_PALETTE[gi % GROUP_PALETTE.length]) as string;
            };
            let lastGid: string | undefined | null = '__none__';
            const out: any[] = [];
            for (const row of sortedRows.slice(0, visibleCount)) {
              const gid = showBands ? row.group_id ?? null : null;
              if (showBands && gid !== lastGid) {
                lastGid = gid;
                const g = groups!.find((x) => x.id === gid);
                const bandColor = (colorOf(gid ?? undefined) ?? '#b5bac8') as string;
                const collapsed = isGroupCollapsed(gid);
                out.push(<tr key={'band:' + (gid ?? 'none')} data-group-band={gid ?? ''}
                  style={{ background: `${bandColor}14`, cursor: 'pointer' }}
                  onClick={() => toggleGroupCollapse(gid)}>
                  <td colSpan={visibleColumns.length + 5} style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, color: '#5a6072', position: 'relative' }}>
                    <span style={{ display: 'inline-block', marginRight: 5, fontSize: 10 }}>{collapsed ? '▶' : '▼'}</span>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: bandColor, marginRight: 7 }} />
                    {renamingGroup === gid ? (
                      <input autoFocus value={groupRenameDraft}
                        onChange={(e) => setGroupRenameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { if (gid && onRenameGroup && groupRenameDraft.trim()) { onRenameGroup(gid, groupRenameDraft.trim()); } setRenamingGroup(null); } if (e.key === 'Escape') setRenamingGroup(null); }}
                        onBlur={() => { if (gid && onRenameGroup && groupRenameDraft.trim()) onRenameGroup(gid, groupRenameDraft.trim()); setRenamingGroup(null); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 12, fontWeight: 600, padding: '2px 6px', borderRadius: 4, border: '2px solid #4f6ef7', color: '#333' }} />
                    ) : (
                      <span data-group-name={gid ?? ''} onDoubleClick={(e) => { e.stopPropagation(); if (gid && isOwner && onRenameGroup) { setRenamingGroup(gid); setGroupRenameDraft(g?.name ?? ''); } }}>{g?.name ?? '未分组'}</span>
                    )}
                    {!collapsed && <span style={{ marginLeft: 8, fontSize: 11, color: '#a0a4b1', fontWeight: 400 }}>
                      ({sortedRows.filter((r) => (r.group_id ?? null) === gid).length})
                    </span>}
                    {isOwner && gid && (
                      <span data-group-menu-trigger onClick={(e) => { e.stopPropagation(); setGroupMenuFor(groupMenuFor === gid ? null : gid); }}
                        style={{ cursor: 'pointer', marginLeft: 8, fontSize: 10, color: '#a0a4b1', padding: '1px 4px', borderRadius: 3 }}>▾</span>
                    )}
                    {groupMenuFor === gid && (
                      <div data-group-menu style={{ position: 'absolute', top: '100%', left: 14, background: '#fff', borderRadius: 8,
                        boxShadow: '0 6px 20px rgba(0,0,0,.12)', padding: 6, zIndex: 20, minWidth: 180, fontSize: 12 }}
                        onClick={(e) => e.stopPropagation()}>
                        <button data-group-rename onClick={() => { setRenamingGroup(gid); setGroupRenameDraft(g?.name ?? ''); setGroupMenuFor(null); }} style={menuBtnStyle}>✏️ 重命名分组</button>
                        <button data-group-duplicate onClick={() => { if (gid && onDuplicateGroup) onDuplicateGroup(gid); setGroupMenuFor(null); }} style={menuBtnStyle}>📋 复制分组</button>
                        <div style={{ borderTop: '1px solid #eef0f5', margin: '4px 0' }} />
                        <button data-group-delete onClick={() => { if (gid && confirm(`删除分组「${g?.name}」？分组内条目将移至未分组。`)) { if (onDeleteGroup) onDeleteGroup(gid); } setGroupMenuFor(null); }}
                          style={{ ...menuBtnStyle, color: '#e2445c' }}>🗑 删除分组</button>
                      </div>
                    )}
                  </td>
                </tr>);
              }
              if (showBands && isGroupCollapsed(row.group_id ?? null)) continue;
              const rowTint = colorOf(showBands ? row.group_id : undefined);
              out.push(<tr key={row.id + ':' + itemsVersion} data-grid-row={row.id} data-active={activeId === row.id ? '1' : '0'}
                draggable={false}
                style={{ borderBottom: '1px solid #eef0f5', background: overId === row.id ? '#eef1fe' : (rowTint ? `${rowTint}0D` : '#fff') }}
                onDragOver={(e) => { if (dragId.current) { e.preventDefault(); setOverId(row.id); } }}
                onDrop={(e) => { e.preventDefault(); drop(row.id); }}
                onClick={(e) => {
                  const t = e.target as HTMLElement;
                  if (t.closest('[data-grid-check],[data-grid-drag],[data-grid-editor],input,select,[data-row-menu-trigger],[data-row-menu]')) return;
                  if (editing) return;
                  // 不自动打开详情，只有点击 Open 按钮才打开
                }}
              >
              <td style={tdStyle}>
                <input type="checkbox" data-grid-check checked={selected.has(row.id)}
                  onChange={() => toggleRow(row.id, shiftKeyRef.current)}
                  onClick={(e) => { shiftKeyRef.current = e.shiftKey; e.stopPropagation(); }} />
              </td>
              <td style={tdStyle}>
                <span data-grid-drag draggable
                  onDragStart={() => { dragId.current = row.id; }}
                  onDragEnd={() => { dragId.current = null; setOverId(null); }}
                  title="拖拽排序"
                  style={{ cursor: 'grab', color: '#b5bac8', userSelect: 'none', fontSize: 14 }}>⠿</span>
                {editable && (
                  <span data-row-menu-trigger onClick={(e) => { e.stopPropagation(); setRowMenuFor(rowMenuFor === row.id ? null : row.id); }}
                    style={{ cursor: 'pointer', marginLeft: 2, fontSize: 10, color: '#b5bac8' }}>▾</span>
                )}
                {rowMenuFor === row.id && (
                  <div data-row-menu style={{ position: 'absolute', zIndex: 30, background: '#fff', borderRadius: 8,
                    boxShadow: '0 6px 20px rgba(0,0,0,.12)', padding: 6, minWidth: 170, fontSize: 12 }}
                    onClick={(e) => e.stopPropagation()}>
                    {onDuplicateItem && <button data-row-duplicate onClick={() => { onDuplicateItem(row.id); setRowMenuFor(null); }} style={menuBtnStyle}>📋 复制行</button>}
                    {onMoveItem && groups?.length ? (
                      <>
                        <div style={{ padding: '3px 10px', color: '#a0a4b1', fontSize: 11 }}>移动到分组：</div>
                        {groups.map((g) => (
                          <button key={g.id} data-row-move={g.id} onClick={() => { onMoveItem(row.id, g.id); setRowMenuFor(null); }} style={menuBtnStyle}>{g.name}</button>
                        ))}
                        <button data-row-move="" onClick={() => { onMoveItem(row.id, null); setRowMenuFor(null); }} style={menuBtnStyle}>未分组</button>
                      </>
                    ) : null}
                    {onDeleteItem && <><div style={{ borderTop: '1px solid #eef0f5', margin: '4px 0' }} /><button data-row-delete onClick={() => { if (confirm(`删除「${row.name}」？可从回收站恢复。`)) onDeleteItem(row.id); setRowMenuFor(null); }} style={{ ...menuBtnStyle, color: '#e2445c' }}>🗑 删除行</button></>}
                  </div>
                )}
              </td>
              <td style={{ ...tdStyle, fontWeight: 500 }} data-col="name" data-grid-cell={row.id}
                onClick={() => !editing && startEdit(row.id, 'name', row.name)}>
                {editing?.rowId === row.id && editing.field === 'name'
                  ? <input data-grid-editor autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit()}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit('down'); } if (e.key === 'Escape') setEditing(null); }}
                      style={{ ...editorStyle, width: '95%' }} />
                  : <span style={rowDone(row) ? { textDecoration: 'line-through', color: UI.textFaint } : undefined}>{row.name}
                    {/* #62 子任务进度徽章 */}
                    {row.subtasks && (
                      <span data-subtask-badge={row.id} style={{ marginLeft: 6, fontSize: 10, padding: '1px 7px', borderRadius: 9,
                        background: row.subtasks.total > 0 && row.subtasks.done >= row.subtasks.total ? '#00a25b22' : '#eef1fe',
                        color: row.subtasks.total > 0 && row.subtasks.done >= row.subtasks.total ? '#00a25b' : '#5b6c8f' }}>
                        ☑ {row.subtasks.done}/{row.subtasks.total}
                      </span>
                    )}
                  </span>}
              </td>
              {visibleColumns.map((c) => {
                const isDropdownEdit = editing?.rowId === row.id && editing.field === c.id
                  && (c.type === 'status' || c.type === 'people' || c.type === 'dropdown'
                      || c.type === 'dependency' || c.type === 'mirror');
                return (
                <td key={c.id} data-col={c.id} data-grid-cell={row.id}
                  style={isDropdownEdit
                    ? { ...tdStyle, width: colWidth(c.id), position: 'relative', overflow: 'visible', textAlign: (c.type === 'number' || c.type === 'formula') ? 'right' : undefined }
                    : { ...tdStyle, width: colWidth(c.id), textAlign: (c.type === 'number' || c.type === 'formula') ? 'right' : undefined }}
                  onClick={() => !c.restricted && !editing && startEdit(row.id, c.id,
                    c.type === 'checkbox' ? String(row.values[c.id] === true)
                    : c.type === 'tags' ? JSON.stringify(row.values[c.id] ?? [])
                    : c.type === 'people' || c.type === 'dependency' ? String(row.values[c.id] ?? '')
                    : c.type === 'mirror' ? (() => { try { return String(JSON.parse(String(row.values[c.id] ?? '{}')).itemId ?? ''); } catch { return ''; } })()
                    : scalar(row.values[c.id]))}>
                  {renderCell(row, c)}
                </td>
                );
              })}
              <td style={{ ...tdStyle, width: 60, textAlign: 'right' }}>
                <button data-grid-open={row.id} onClick={(e) => { e.stopPropagation(); onOpenItem?.(row.id); }}
                  title="打开详情"
                  style={{ border: 'none', background: UI.primarySoft, color: UI.primary, fontSize: 12,
                    padding: '3px 10px', borderRadius: 7, cursor: 'pointer' }}>Open</button>
              </td>
            </tr>
            );
            }
            if (visibleCount < sortedRows.length) out.push(
              <tr key="__sentinel" data-grid-sentinel="1"><td colSpan={visibleColumns.length + 5}
                style={{ padding: 10, textAlign: 'center', color: '#a0a4b1', fontSize: 12 }}>
                已显示 {visibleCount} / {sortedRows.length} 行，滚动加载更多…
              </td></tr>);
            return out;
          })()}
          {sortedRows.length === 0 && (
            <tr><td colSpan={visibleColumns.length + 5} style={{ padding: 40, color: '#7a7f8c', fontSize: 14, textAlign: 'center' }}>
              {filters.length > 0 ? '没有匹配筛选条件的行——调整筛选或清除条件' : '还没有条目——点「＋ 新建条目」开始（快捷键：↑↓ 导航 · Enter 打开 · Space 勾选 · Esc 清除）'}
            </td></tr>
          )}
        </tbody>
        {/* ── 列汇总页脚 ── */}
        {sortedRows.length > 0 && (
          <tfoot>
            <tr style={{ background: '#f6f7fb', borderTop: '2px solid #e6e8ef' }}>
              <td style={tdStyle} colSpan={3}>
                <span style={{ fontSize: 11, color: '#a0a4b1' }}>汇总 · 点击列底部切换</span>
              </td>
              {visibleColumns.map((c) => {
                const type = summaries[c.id] ?? 'none';
                const val = computeSummary(c);
                return (
                  <td key={c.id} data-col-summary={c.id} data-summary-type={type}
                    onClick={() => cycleSummary(c.id)}
                    title="点击切换：无 → 求和 → 均值 → 计数 → 最小 → 最大"
                    style={{ ...tdStyle, cursor: 'pointer', fontWeight: type !== 'none' ? 600 : 400, color: type !== 'none' ? '#4f6ef7' : '#c3c8d4' }}>
                    {type !== 'none' ? `${SUMMARY_LABEL[type]} ${val}` : '∅'}
                  </td>
                );
              })}
              <td style={tdStyle}></td>
              <td style={{ ...tdStyle, width: 100 }}></td>
            </tr>
          </tfoot>
        )}
      </table>
      {/* ── 新建分组 ── */}
      {isOwner && onAddGroup && !!groups?.length && (
        <div style={{ marginTop: 8, padding: '0 14px' }}>
          {addingGroup ? (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input autoFocus value={newGroupNameDraft} onChange={(e) => setNewGroupNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newGroupNameDraft.trim()) { onAddGroup(newGroupNameDraft.trim()); setNewGroupNameDraft(''); setAddingGroup(false); } if (e.key === 'Escape') setAddingGroup(false); }}
                onBlur={() => { if (!newGroupNameDraft.trim()) setAddingGroup(false); }}
                placeholder="新分组名称" style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #4f6ef7', fontSize: 12 }} />
              <button data-addgroup-confirm onClick={() => { if (newGroupNameDraft.trim()) { onAddGroup(newGroupNameDraft.trim()); setNewGroupNameDraft(''); setAddingGroup(false); } }}
                style={{ padding: '3px 10px', borderRadius: 4, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 12 }}>✓ 添加</button>
            </span>
          ) : (
            <button data-addgroup-trigger onClick={() => setAddingGroup(true)}
              style={{ border: '1px dashed #b5bac8', background: '#f6f7fb', color: '#7a7f8c', borderRadius: 6, padding: '4px 14px', cursor: 'pointer', fontSize: 12 }}>
              + 新建分组
            </button>
          )}
        </div>
      )}
      {/* ── #66 图片 lightbox ── */}
      {lightbox && (
        <div data-lightbox="1" onClick={() => { URL.revokeObjectURL(lightbox.url); setLightbox(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,30,.72)', zIndex: 9998,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={lightbox.url} alt={lightbox.name}
            style={{ maxWidth: '88vw', maxHeight: '86vh', borderRadius: 8, boxShadow: '0 12px 48px rgba(0,0,0,.5)' }} />
          <div style={{ position: 'absolute', bottom: 20, color: '#fff', fontSize: 12 }}>{lightbox.name}（点击任意处关闭）</div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '9px 10px', fontSize: 12, color: '#5a6072', fontWeight: 600,
  borderBottom: '1px solid #e6e8ef', whiteSpace: 'nowrap', position: 'relative',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid #eef0f5', whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
};
const editorStyle: React.CSSProperties = {
  width: '100%', padding: '3px 6px', borderRadius: 6, border: '2px solid #4f6ef7',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
};

/** P3-2 附件编辑器 */
function AttachmentEditor({ rowId, colId, onDone }: { rowId: string; colId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return <input data-attach-input type="file" disabled={busy} autoFocus
    onChange={async (e) => {
      const f = e.target.files?.[0];
      if (!f) { onDone(); return; }
      setBusy(true);
      try { await api.uploadAttachment(rowId, colId, f); } catch { }
      onDone();
    }}
    style={{ fontSize: 13, padding: '4px 8px', borderRadius: 8, border: '1px solid #e6e8ef' }} />;
}

/** P3-1 依赖编辑器 */
function DependencyEditor({ rows, value, onCommit, onClose }: { rows: GridRow[]; value: string; onCommit: (itemId: string) => void; onClose: () => void }) {
  return <ChipDropdown value={value} options={rows.map((r) => ({ value: r.id, label: r.name }))}
    placeholder="— 清除前置 —" onPick={onCommit} onClose={onClose} />;
}

/** P2-4 Mirror 编辑器 */
function MirrorEditor({ col, value, onCommit, onClose }: { col: GridColumn; value: string; onCommit: (itemId: string) => void; onClose: () => void }) {
  const [opts, setOpts] = useState<{ id: string; name: string; label: string | null }[] | null>(null);
  useEffect(() => {
    api.getBoard(String(col.settings?.connectBoardId ?? '')).then((d: any) => {
      const sc = (d.columns ?? []).find((c: any) => c.type === 'status');
      setOpts((d.items ?? []).map((i: any) => ({
        id: i.id, name: i.name, label: sc ? String(i.values?.[sc.id] ?? '') : null,
      })));
    }).catch(() => setOpts([]));
  }, [col.id]);
  if (opts === null) return <span data-grid-editor style={{ fontSize: 12, color: '#a0a4b1' }}>加载中…</span>;
  return <ChipDropdown value={value}
    options={opts.map((o) => ({ value: o.id, label: o.name, hint: o.label ?? undefined }))}
    placeholder="— 清除镜像 —" onPick={onCommit} onClose={onClose} />;
}
