/**
 * 自研数据表格（P1：替换 AG Grid Community，体积 -1.2MB、渲染路径可控）
 * 功能对齐 AG Grid 用到的部分：
 * - 双击编辑（text/number=input、date=date input、checkbox=toggle、status/people/dropdown=select）
 * - 行选择（表头全选 + 行首复选框，批量删除用）
 * - 行拖拽排序（HTML5 DnD，拖拽手柄 ⠿，落库 items/reorder）
 * - 单击行打开详情面板；LWW 冲突处理在 BoardTable.saveCell
 * DOM 契约（e2e 依赖）：
 *   [data-grid-cell][data-col="name"]、[data-grid-check]、[data-grid-drag]、[data-grid-row]
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { UI, TAG, doneLabelsOf } from '../theme';

export type GridRow = { id: string; name: string; version: number; position: number; values: Record<string, unknown> };
export type GridColumn = { id: string; name: string; type: string; settings: any };

const LABEL_W = 260;

function scalar(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') { const o = v as any; return String(o.label ?? o.name ?? o.id ?? ''); }
  return String(v);
}

type Props = {
  rows: GridRow[];
  columns: GridColumn[];
  onOpenItem?: (id: string) => void;
  onEdit: (row: GridRow, field: string, value: unknown) => Promise<void>;
  onOrderChange: (orders: { id: string; position: number }[]) => Promise<void>;
  onSelectionChange?: (ids: Set<string>) => void;
  editable: boolean;
};

export function BoardGrid({ rows, columns, onOpenItem, onEdit, onOrderChange, onSelectionChange, editable }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ rowId: string; field: string } | null>(null);
  const [draft, setDraft] = useState('');
  const dragId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null); // 快捷键导航焦点行
  /** 拖拽后的本地顺序覆盖（items 变化时重置） */
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [itemsVersion, setItemsVersion] = useState(0);

  useEffect(() => { setLocalOrder(null); setItemsVersion((v) => v + 1); }, [rows]);
  useEffect(() => { onSelectionChange?.(selected); }, [selected]);

  const sortedRows = useMemo(() => {
    if (localOrder) {
      const idx = new Map(localOrder.map((id, i) => [id, i]));
      return [...rows].sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0));
    }
    return [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }, [rows, localOrder]);

  const allChecked = sortedRows.length > 0 && sortedRows.every((r) => selected.has(r.id));

  /** 表格快捷键（P0-7）：↑↓ 导航、Enter 开详情、Space 勾选、Esc 清除；输入态不接管 */
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
  const toggleRow = (id: string) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const startEdit = (rowId: string, field: string, current: string) => {
    if (!editable) return;
    setEditing({ rowId, field });
    setDraft(current);
  };

  const commit = async () => {
    const e = editing;
    setEditing(null);
    if (!e) return;
    const row = rows.find((r) => r.id === e.rowId);
    if (!row) return;
    const col = columns.find((c) => c.id === e.field);
    let value: unknown = draft;
    if (e.field === 'name') {
      if (draft !== row.name && draft.trim()) await onEdit(row, 'name', draft.trim());
      return;
    }
    if (col?.type === 'number') value = draft === '' ? null : Number(draft);
    if (col?.type === 'checkbox') value = draft === 'true';
    await onEdit(row, e.field, value);
  };

  /** 拖拽排序：拖到目标行上方 → 本地重排 + 落库 */
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
    const locked = editable && col.settings?.editable === 'owner' ? false : editable;

    if (isEditing) {
      if (col.type === 'date') {
        return <input data-grid-editor autoFocus type="date" value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }}
          style={editorStyle} />;
      }
      if (col.type === 'status' || col.type === 'people' || col.type === 'dropdown') {
        const opts: { value: string; label: string }[] = col.type === 'status'
          ? (col.settings?.labels ?? []).filter((l: any) => !(col.settings?.inactiveLabels ?? []).includes(l.label))
              .map((l: any) => ({ value: l.label, label: l.label }))
          : col.type === 'people'
            ? (col.settings?.members ?? []).map((m: any) => ({ value: m.id, label: m.name }))
            : (col.settings?.options ?? []).map((o: any) => ({ value: o.label, label: o.label }));
        return <select data-grid-editor autoFocus value={draft} onChange={(e) => { setDraft(e.target.value); setTimeout(commit, 0); }}
          onBlur={commit} style={editorStyle}>
          <option value="">—</option>
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>;
      }
      return <input data-grid-editor autoFocus type={col.type === 'number' ? 'number' : 'text'} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }}
        style={editorStyle} />;
    }

    if (col.type === 'checkbox') {
      return <input type="checkbox" checked={v === 'true'} disabled={!locked}
        onChange={(e) => onEdit(row, col.id, e.target.checked)} style={{ cursor: locked ? 'pointer' : 'not-allowed' }} />;
    }
    if (col.type === 'status') {
      const opt = (col.settings?.labels ?? []).find((l: any) => l.label === v);
      const doneSet = doneLabelsOf(col.settings);
      if (!v) return <span style={{ color: TAG.gray }}>—</span>;
      return <span data-status-chip={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
        background: `${opt?.color ?? '#d0d4e0'}22`,
        color: opt?.color ?? '#5a6072', padding: '2px 10px', borderRadius: 20, fontSize: 12 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: opt?.color ?? '#d0d4e0' }} />{v}</span>;
    }
    if (col.type === 'people') {
      const m = (col.settings?.members ?? []).find((u: any) => u.id === v || u.name === v);
      if (!v) return <span style={{ color: '#c3c8d4' }}>—</span>;
      return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 20, height: 20, borderRadius: '50%', background: m?.color ?? '#579bfc', color: '#fff',
          fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{(m?.name ?? v)[0]}</span>
        {m?.name ?? v}</span>;
    }
    if (col.type === 'dropdown' && Array.isArray(raw)) {
      if (!raw.length) return <span style={{ color: '#c3c8d4' }}>—</span>;
      return <span>{raw.map((r: any, i: number) => <span key={i} style={{ display: 'inline-block', background: '#d0d4e026',
        color: '#5a6072', padding: '2px 9px', borderRadius: 5, fontSize: 12, marginRight: 4 }}>{scalar(r)}</span>)}</span>;
    }
    if (!v) return <span style={{ color: '#c3c8d4' }}>—</span>;
    return <span style={{ fontSize: 13 }}>{v}</span>;
  };

  /** 行是否完成（第一个 status 列值为 done 标签）→ 条目名删除线 + 弱化 */
  const rowDone = (row: GridRow) => {
    const c = columns.find((x) => x.type === 'status');
    if (!c) return false;
    const v = row.values?.[c.id];
    return v != null && doneLabelsOf(c.settings).has(String(v));
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#fff' }} data-grid-root>
      {/* hover 行时显示 Open 按钮（P0-5）+ 焦点行高亮 */}
      <style>{`
        [data-grid-row] [data-grid-open]{opacity:0;transition:opacity .12s}
        [data-grid-row]:hover [data-grid-open]{opacity:1}
        tr[data-active="1"] td{background:${UI.primarySoft}}
      `}</style>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ position: 'sticky', top: 0, background: '#f6f7fb', zIndex: 2 }}>
            <th style={{ ...thStyle, width: 36 }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} data-grid-check-all />
            </th>
            <th style={{ ...thStyle, width: 28 }}></th>
            <th style={{ ...thStyle, textAlign: 'left', width: LABEL_W }}>条目</th>
            {columns.map((c) => (
              <th key={c.id} style={{ ...thStyle, textAlign: 'left' }}>
                {c.name}
                {c.settings?.editable === 'owner' && <span title="仅负责人可编辑" style={{ marginLeft: 4 }}>🔒</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.id + ':' + itemsVersion} data-grid-row={row.id} data-active={activeId === row.id ? '1' : '0'}
              draggable={false}
              style={{ borderBottom: '1px solid #eef0f5', background: overId === row.id ? '#eef1fe' : '#fff' }}
              onDragOver={(e) => { if (dragId.current) { e.preventDefault(); setOverId(row.id); } }}
              onDrop={(e) => { e.preventDefault(); drop(row.id); }}
              onClick={(e) => {
                const t = e.target as HTMLElement;
                if (t.closest('[data-grid-check],[data-grid-drag],[data-grid-editor],input,select')) return;
                if (editing) return;
                onOpenItem?.(row.id);
              }}
              onDoubleClick={(e) => {
                const t = e.target as HTMLElement;
                if (t.closest('[data-grid-check],[data-grid-drag],input,select')) return;
              }}
            >
              <td style={tdStyle}>
                <input type="checkbox" data-grid-check checked={selected.has(row.id)}
                  onChange={() => toggleRow(row.id)} onClick={(e) => e.stopPropagation()} />
              </td>
              <td style={tdStyle}>
                <span data-grid-drag draggable
                  onDragStart={() => { dragId.current = row.id; }}
                  onDragEnd={() => { dragId.current = null; setOverId(null); }}
                  title="拖拽排序"
                  style={{ cursor: 'grab', color: '#b5bac8', userSelect: 'none', fontSize: 14 }}>⠿</span>
              </td>
              <td style={{ ...tdStyle, fontWeight: 500 }} data-col="name" data-grid-cell={row.id}
                onDoubleClick={() => startEdit(row.id, 'name', row.name)}>
                {editing?.rowId === row.id && editing.field === 'name'
                  ? <input data-grid-editor autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                      onBlur={commit}
                      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }}
                      style={{ ...editorStyle, width: '95%' }} />
                  : <span style={rowDone(row) ? { textDecoration: 'line-through', color: UI.textFaint } : undefined}>{row.name}</span>}
              </td>
              {columns.map((c) => (
                <td key={c.id} data-col={c.id} data-grid-cell={row.id} style={tdStyle}
                  onDoubleClick={() => startEdit(row.id, c.id, c.type === 'checkbox' ? String(row.values[c.id] === true) : scalar(row.values[c.id]))}>
                  {renderCell(row, c)}
                </td>
              ))}
              <td style={{ ...tdStyle, width: 60, textAlign: 'right' }}>
                <button data-grid-open={row.id} onClick={(e) => { e.stopPropagation(); onOpenItem?.(row.id); }}
                  title="打开详情"
                  style={{ border: 'none', background: UI.primarySoft, color: UI.primary, fontSize: 12,
                    padding: '3px 10px', borderRadius: 7, cursor: 'pointer' }}>Open</button>
              </td>
            </tr>
          ))}
          {sortedRows.length === 0 && (
            <tr><td colSpan={columns.length + 4} style={{ padding: 40, color: '#7a7f8c', fontSize: 14, textAlign: 'center' }}>
              还没有条目——点「＋ 新建条目」开始（快捷键：↑↓ 导航 · Enter 打开 · Space 勾选 · Esc 清除）
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 12, color: '#7a7f8c', fontWeight: 600,
  borderBottom: '1px solid #e6e8ef', whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  padding: '6px 10px', borderBottom: '1px solid #eef0f5', whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
};
const editorStyle: React.CSSProperties = {
  width: '100%', padding: '3px 6px', borderRadius: 6, border: '2px solid #4f6ef7',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
