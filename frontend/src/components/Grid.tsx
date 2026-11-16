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
import { UI, TAG, doneLabelsOf, soften, GROUP_PALETTE } from '../theme';
import { api } from '../api';

export type GridRow = { id: string; name: string; version: number; position: number; values: Record<string, unknown>; group_id?: string };
export type GridColumn = { id: string; name: string; type: string; settings: any; restricted?: boolean };

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
  /** 当前用户是否 owner（P1-1/P1-2：结构操作与 owner-only 列编辑的 UI 依据） */
  isOwner?: boolean;
  /** 视图排序（P1-3）：字段为 'name' 或列 id；点击表头触发 onSortChange */
  sortBy?: string | null;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (field: string) => void;
  /** P2-5 分组色带：传入 groups 时表格按分组渲染极浅色带（默认排序时） */
  groups?: { id: string; name: string; color?: string | null }[];
};

export function BoardGrid({ rows, columns, onOpenItem, onEdit, onOrderChange, onSelectionChange, editable, isOwner, sortBy, sortDir, onSortChange, groups }: Props) {
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
    if (sortBy) {
      const dir = sortDir === 'desc' ? -1 : 1;
      return [...rows].sort((a, b) => {
        if (sortBy === 'name') return dir * a.name.localeCompare(b.name, 'zh-Hans-CN');
        const col = columns.find((c) => c.id === sortBy);
        const av = col?.type === 'checkbox' ? String(a.values[sortBy] === true) : scalar(a.values[sortBy]);
        const bv = col?.type === 'checkbox' ? String(b.values[sortBy] === true) : scalar(b.values[sortBy]);
        const an = Number(av), bn = Number(bv);
        if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) return dir * (an - bn);
        if (av === '' && bv === '') return 0;
        if (av === '') return 1; // 空值恒排后
        if (bv === '') return -1;
        return dir * av.localeCompare(bv, 'zh-Hans-CN');
      });
    }
    return [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }, [rows, localOrder, sortBy, sortDir, columns]);

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
    const col = columns.find((c) => c.id === field);
    if (col?.restricted) return; // P1-2 受限查看列不可编辑
    if (col?.type === 'formula') return; // P2-3 公式列只读
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
    // P1-2：editPermission='owner'（兼容旧 editable）非 owner 不可编辑；restricted 列整体锁定
    const ep = col.settings?.editPermission ?? col.settings?.editable;
    const locked = editable && !col.restricted && (isOwner || ep !== 'owner');

    if (col.restricted) {
      // 无权查看：模糊占位（保留列宽，不泄漏内容）
      return <span data-grid-restricted={col.id} title="该列仅负责人可见"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#a0a4b1', fontSize: 12 }}>
        <span style={{ display: 'inline-block', width: 52, height: 13, borderRadius: 7,
          background: '#e3e6ee', filter: 'blur(1px)' }} />🔒</span>;
    }

    if (isEditing) {
      if (col.type === 'dependency') {
        return <DependencyEditor rows={rows.filter((r) => r.id !== row.id)}
          onCommit={(itemId) => { setEditing(null); onEdit(row, col.id, itemId); }} />;
      }
      if (col.type === 'mirror') {
        return <MirrorEditor col={col} onCommit={(itemId) => { setEditing(null); if (itemId) onEdit(row, col.id, itemId); }} />;
      }
      if (col.type === 'attachment') {
        // P3-2：选文件即上传，成功后触发刷新（不走 updateCell，cell 由附件端点维护）
        return <AttachmentEditor rowId={row.id} colId={col.id} onDone={() => { setEditing(null); onEdit(row, '__attachments__', null); }} />;
      }
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

    if (col.type === 'formula') {
      if (v === undefined || v === null || v === '') return <span data-formula-cell={col.id} style={{ color: '#c3c8d4' }}>—</span>;
      return <span data-formula-cell={col.id} title={`ƒx ${col.settings?.formula ?? ''}`} style={{ color: '#5b6c8f', fontSize: 13 }}>{v}</span>;
    }
    if (col.type === 'dependency') {
      // P3-1：cell 存前置条目 id（JSON 数组或裸 id），渲染为 ⤴ 前置条目名
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
      // P2-4：后端注入 JSON 文本 { itemId, name, label, color }
      let m: any = null;
      try { m = JSON.parse(String(v)); } catch { /* 非法值当空 */ }
      if (!m || (!m.name && !m.label)) return <span data-mirror-cell={col.id} style={{ color: '#c3c8d4' }}>—</span>;
      return <span data-mirror-cell={col.id} title={`镜像自：${m.name ?? ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13 }}>{m.name}</span>
        {m.label && <span style={{ background: `${soften(m.color) ?? '#d0d4e0'}22`, color: soften(m.color) ?? '#5a6072',
          padding: '1px 9px', borderRadius: 20, fontSize: 12 }}>{m.label}</span>}
      </span>;
    }
    if (col.type === 'attachment') {
      // P3-2：cell 存附件元数据 JSON 数组 [{id,name,size,mime}]，chip 点击下载
      let list: any[] = [];
      try { const p = JSON.parse(String(v)); if (Array.isArray(p)) list = p; } catch { /* 非法值当空 */ }
      if (!list.length) return <span data-attach-cell={col.id} style={{ color: '#c3c8d4' }}>—</span>;
      return <span data-attach-cell={col.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {list.map((a) => (
          <span key={a.id} data-attach-chip={a.id} title={`${a.name} · 点击下载`}
            onClick={() => api.downloadAttachment(a.id, a.name).catch(() => {})}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eef1fe', color: '#5b6c8f',
              padding: '2px 9px', borderRadius: 14, fontSize: 12, cursor: 'pointer', maxWidth: 180,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            📎 {a.name}
          </span>
        ))}
      </span>;
    }
    if (col.type === 'checkbox') {
      return <input type="checkbox" checked={v === 'true'} disabled={!locked}
        onChange={(e) => locked && onEdit(row, col.id, e.target.checked)} style={{ cursor: locked ? 'pointer' : 'not-allowed' }} />;
    }
    if (col.type === 'status') {
      const opt = (col.settings?.labels ?? []).find((l: any) => l.label === v);
      const doneSet = doneLabelsOf(col.settings);
      const chipColor = soften(opt?.color) ?? '#d0d4e0';
      if (!v) return <span style={{ color: TAG.gray }}>—</span>;
      return <span data-status-chip={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
        background: `${chipColor}22`,
        color: chipColor, padding: '2px 10px', borderRadius: 20, fontSize: 12 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: chipColor }} />{v}</span>;
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
            <th style={{ ...thStyle, textAlign: 'left', width: LABEL_W, cursor: onSortChange ? 'pointer' : undefined }}
              onClick={() => onSortChange?.('name')}
              title="点击排序">
              条目{sortBy === 'name' ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
            </th>
            {columns.map((c) => (
              <th key={c.id} style={{ ...thStyle, textAlign: 'left', cursor: onSortChange && !c.restricted ? 'pointer' : undefined }}
                onClick={() => !c.restricted && onSortChange?.(c.id)} title={c.restricted ? undefined : '点击排序'}>
                {c.name}
                {sortBy === c.id ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                {c.restricted
                  ? <span title="仅负责人可见" style={{ marginLeft: 4 }}>👁🔒</span>
                  : (c.settings?.editPermission ?? c.settings?.editable) === 'owner'
                    ? <span title="仅负责人可编辑" style={{ marginLeft: 4 }}>✏️🔒</span>
                    : null}
              {c.type === 'formula' && <span title={c.settings?.formula} style={{ marginLeft: 4, fontSize: 10,
                background: '#eef1fe', color: '#5b6c8f', borderRadius: 4, padding: '1px 5px' }}>ƒx</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(() => {
            // P2-5 分组色带：默认顺序（无列排序、无拖拽重排）时按分组插入极浅色带行
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
            for (const row of sortedRows) {
              const gid = showBands ? row.group_id ?? null : null;
              if (showBands && gid !== lastGid) {
                lastGid = gid;
                const g = groups!.find((x) => x.id === gid);
                const bandColor = (colorOf(gid ?? undefined) ?? '#b5bac8') as string;
                out.push(<tr key={'band:' + (gid ?? 'none')} data-group-band={gid ?? ''} style={{ background: `${bandColor}14` }}>
                  <td colSpan={columns.length + 3} style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, color: '#5a6072' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: bandColor, marginRight: 7 }} />
                    {g?.name ?? '未分组'}
                  </td>
                </tr>);
              }
              const rowTint = colorOf(showBands ? row.group_id : undefined);
              out.push(<tr key={row.id + ':' + itemsVersion} data-grid-row={row.id} data-active={activeId === row.id ? '1' : '0'}
                draggable={false}
                style={{ borderBottom: '1px solid #eef0f5', background: overId === row.id ? '#eef1fe' : (rowTint ? `${rowTint}0D` : '#fff') }}
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
                  onDoubleClick={() => !c.restricted && startEdit(row.id, c.id, c.type === 'checkbox' ? String(row.values[c.id] === true) : scalar(row.values[c.id]))}>
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
            );
            }
            return out;
          })()}
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

/** P3-1 依赖编辑器：从本看板其他条目中选前置任务，提交条目 id */
function AttachmentEditor({ rowId, colId, onDone }: { rowId: string; colId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return <input data-attach-input type="file" disabled={busy} autoFocus
    onChange={async (e) => {
      const f = e.target.files?.[0];
      if (!f) { onDone(); return; }
      setBusy(true);
      try { await api.uploadAttachment(rowId, colId, f); } catch { /* 提示由上层 reload 呈现 */ }
      onDone();
    }}
    style={{ fontSize: 13, padding: '4px 8px', borderRadius: 8, border: '1px solid #e6e8ef' }} />;
}

function DependencyEditor({ rows, onCommit }: { rows: GridRow[]; onCommit: (itemId: string) => void }) {
  return <select data-grid-editor autoFocus value="" onChange={(e) => { if (e.target.value) onCommit(e.target.value); }}
    onBlur={() => onCommit('')} style={editorStyle}>
    <option value="">— 清除前置 —</option>
    {rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
  </select>;
}

/** P2-4 Mirror 编辑器：从连接的看板选条目，提交源条目 id（状态由后端读取时镜像注入） */
function MirrorEditor({ col, onCommit }: { col: GridColumn; onCommit: (itemId: string) => void }) {
  const [opts, setOpts] = useState<{ id: string; name: string; label: string | null }[] | null>(null);
  useEffect(() => {
    api.getBoard(String(col.settings?.connectBoardId ?? '')).then((d: any) => {
      const sc = (d.columns ?? []).find((c: any) => c.type === 'status');
      setOpts((d.items ?? []).map((i: any) => ({
        id: i.id, name: i.name, label: sc ? String(i.values?.[sc.id] ?? '') : null,
      })));
    }).catch(() => setOpts([]));
  }, [col.id]);
  if (opts === null) return <span style={{ fontSize: 12, color: '#a0a4b1' }}>加载中…</span>;
  return <select data-grid-editor autoFocus value="" onChange={(e) => { if (e.target.value) onCommit(e.target.value); }}
    onBlur={() => onCommit('')} style={editorStyle}>
    <option value="">— 清除镜像 —</option>
    {opts.map((o) => <option key={o.id} value={o.id}>{o.name}{o.label ? ` · ${o.label}` : ''}</option>)}
  </select>;
}
