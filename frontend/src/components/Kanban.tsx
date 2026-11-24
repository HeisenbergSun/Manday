/**
 * 看板视图 — dnd-kit + 乐观更新（拖拽先本地生效，失败回滚 toast）
 * 第二十三批全面升级：按任意列分桶 + WIP 限制 + 卡片多字段 + 列折叠 + 空列占位
 * DOM 契约（e2e 依赖）：
 *   [data-kanban-col] [data-kanban-mode] [data-kanban-groupby] [data-kanban-card]
 *   [data-kanban-collapse] [data-kanban-people]
 */
import { DndContext, DragEndEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { useEffect, useMemo, useState } from 'react';
import { useItems, useToast } from '../store';
import { api } from '../api';
import { soften } from '../theme';
import { useCompanyUsers, personNames, membersOf } from '../people';

const AVATAR_COLORS = ['#579bfc', '#e2445c', '#00a25b', '#fdab3d', '#a25ddc', '#00d6c5', '#ff8a65'];

/** 卡片：显示条目名 + 自动检测 people/date/rating/tags/number/status 字段 */
function Card({ itemId, onOpenItem }: { itemId: string; onOpenItem?: (id: string) => void }) {
  const item = useItems((s) => s.items[itemId]);
  const columns = useItems((s) => s.columns);
  const users = useCompanyUsers();
  if (!item) return null;

  const peopleCol = columns.find((c: any) => c.type === 'people');
  const dateCol = columns.find((c: any) => c.type === 'date');
  const statusCol = columns.find((c: any) => c.type === 'status');
  const ratingCol = columns.find((c: any) => c.type === 'rating');
  const tagsCol = columns.find((c: any) => c.type === 'tags');
  const numCol = columns.find((c: any) => c.type === 'number');

  const people = peopleCol ? (item as any).values?.[peopleCol.id] : null;
  const peopleNames: string[] = peopleCol ? personNames(people, users, membersOf(peopleCol)) : [];

  const dateVal = dateCol ? (item as any).values?.[dateCol.id] : null;
  const overdue = dateVal && new Date(String(dateVal)) < new Date(new Date().toDateString());

  const statusVal = statusCol ? (item as any).values?.[statusCol.id] : null;
  const statusLabel = ((statusCol?.settings?.labels as any[]) ?? []).find((l: any) => l.label === statusVal);

  const ratingVal = ratingCol ? Number((item as any).values?.[ratingCol.id] ?? 0) : 0;
  const ratingMax = Number(ratingCol?.settings?.max ?? 5);

  let tagsList: string[] = [];
  if (tagsCol) {
    const tv = (item as any).values?.[tagsCol.id];
    if (tv) {
      try { tagsList = Array.isArray(tv) ? tv : JSON.parse(String(tv)); } catch { /* ignore */ }
    }
  }

  const numVal = numCol ? (item as any).values?.[numCol.id] : null;
  const hasExtras = peopleNames.length > 0 || dateVal || ratingVal > 0 || tagsList.length > 0 || numVal != null;

  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: itemId });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      data-kanban-card={itemId}
      onClick={() => onOpenItem?.(itemId)}
      title="点击打开条目详情"
      style={{
        transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined,
        background: '#fff', borderRadius: 8, padding: '10px 12px', marginBottom: 8, cursor: 'grab',
        boxShadow: '0 1px 3px rgba(20,30,70,.06)', border: '1px solid #e6e8ef',
        position: 'relative', overflow: 'hidden',
      }}>
      {statusLabel && (
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: soften(statusLabel.color) ?? '#4f6ef7' }} />
      )}
      <b style={{ fontSize: 13, display: 'block', marginBottom: hasExtras ? 6 : 0, color: '#1f2330' }}>{item.name}</b>
      {hasExtras && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {peopleNames.length > 0 && (
            <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              {peopleNames.slice(0, 3).map((n, i) => (
                <span key={n} data-kanban-people={n}
                  style={{ width: 20, height: 20, borderRadius: '50%', background: AVATAR_COLORS[i % AVATAR_COLORS.length],
                    color: '#fff', fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
                  {n[0]?.toUpperCase()}
                </span>
              ))}
              {peopleNames.length > 3 && <span style={{ fontSize: 10, color: '#7a7f8c', marginLeft: 2 }}>+{peopleNames.length - 3}</span>}
            </span>
          )}
          {dateVal && (
            <span style={{ background: overdue ? '#fdeaea' : '#f0f1f5', color: overdue ? '#e2445c' : '#7a7f8c',
              borderRadius: 10, padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' }}>
              {String(dateVal).slice(5, 10)}{overdue ? ' \u26a0' : ''}
            </span>
          )}
          {ratingVal > 0 && ratingCol && (
            <span style={{ fontSize: 11, color: '#fdab3d', letterSpacing: 1 }}>
              {'\u2605'.repeat(ratingVal)}{'\u2606'.repeat(ratingMax - ratingVal)}
            </span>
          )}
          {tagsList.slice(0, 2).map((t) => (
            <span key={t} style={{ background: '#eef1fe', color: '#4f6ef7', borderRadius: 10, padding: '1px 7px', fontSize: 10 }}>{t}</span>
          ))}
          {tagsList.length > 2 && <span style={{ fontSize: 10, color: '#7a7f8c' }}>+{tagsList.length - 2}</span>}
          {numVal != null && numCol && (
            <span style={{ background: '#f0f1f5', color: '#33333f', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 500 }}>
              {String(numVal)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** 看板列：WIP 限制 + 折叠/展开 + 空列占位 */
function BucketColumn({ id, name, color, items, wipLimit, collapsed, onToggle, onOpenItem }: {
  id: string; name: string; color?: string; items: any[]; wipLimit?: number; collapsed: boolean; onToggle: () => void; onOpenItem?: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const count = items.length;
  const overWip = wipLimit != null && count > wipLimit;
  const atWip = wipLimit != null && count >= wipLimit;

  if (collapsed) {
    return (
      <div onClick={onToggle} data-kanban-col={id} style={{
        width: 44, background: '#eef0f5', borderRadius: 10, padding: '10px 6px',
        textAlign: 'center', cursor: 'pointer', writingMode: 'vertical-rl', fontSize: 12, fontWeight: 600, color: '#7a7f8c',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      }}>
        <span style={{ writingMode: 'vertical-rl' }}>{name} ({count})</span>
        <span style={{ fontSize: 14 }}>▶</span>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} data-kanban-col={id} style={{
      width: 280, background: '#eef0f5', borderRadius: 10, padding: 10, minHeight: 120,
      outline: isOver ? '2px dashed #4f6ef7' : 'none',
      opacity: atWip && isOver ? 0.5 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />}
        <b style={{ fontSize: 13, flex: 1, color: '#1f2330' }}>{name}</b>
        <span style={{ fontSize: 12, color: overWip ? '#e2445c' : '#7a7f8c', fontWeight: overWip ? 700 : 400 }}>
          {count}{wipLimit != null ? ` / ${wipLimit}` : ''}
        </span>
        <button onClick={onToggle} title="折叠列" data-kanban-collapse={id}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#7a7f8c', padding: 0, lineHeight: 1 }}>◀</button>
      </div>
      {overWip && (
        <div style={{ fontSize: 10, color: '#e2445c', marginBottom: 6, fontWeight: 600 }}>超出 WIP 限制</div>
      )}
      {items.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#a0a4b1', fontSize: 12, padding: '20px 0', border: '2px dashed #d5d9e3', borderRadius: 8 }}>
          拖拽条目到此处
        </div>
      ) : (
        items.map((i) => <Card key={i.id} itemId={i.id} onOpenItem={onOpenItem} />)
      )}
    </div>
  );
}

export function Kanban({ groups, boardId, onOpenItem }: { groups: { id: string; name: string }[]; boardId?: string; onOpenItem?: (id: string) => void }) {
  const columns = useItems((s) => s.columns);
  const allItems = useItems((s) => s.items);
  const users = useCompanyUsers();
  const statusCol = columns.find((c: any) => c.type === 'status');
  const [mode, setMode] = useState<'group' | 'status' | 'column'>('group');
  const [groupByColId, setGroupByColId] = useState<string>('');
  const [toast, setToast] = useState('');
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(new Set());
  const [wipLimits, setWipLimits] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!boardId) return;
    api.getPrefs(boardId).then((p: any) => {
      if (p?.prefs?.kanbanMode === 'status' && statusCol) setMode('status');
      if (p?.prefs?.kanbanGroupCol) { setMode('column'); setGroupByColId(p.prefs.kanbanGroupCol); }
      if (p?.prefs?.kanbanWip) setWipLimits(p.prefs.kanbanWip);
    }).catch(() => {});
  }, [boardId]);

  const switchMode = (m: 'group' | 'status' | 'column') => {
    setMode(m);
    if (boardId) api.putPrefs(boardId, { prefs: { kanbanMode: m } }).catch(() => {});
  };

  const switchGroupCol = (colId: string) => {
    if (!colId) return;
    setGroupByColId(colId);
    setMode('column');
    if (boardId) api.putPrefs(boardId, { prefs: { kanbanMode: 'column', kanbanGroupCol: colId } }).catch(() => {});
  };

  const toggleCollapse = (colId: string) => {
    setCollapsedCols((s) => {
      const n = new Set(s);
      if (n.has(colId)) n.delete(colId); else n.add(colId);
      return n;
    });
  };

  /** 状态列活动标签 → 看板列 */
  const statusLanes = useMemo(() => {
    if (!statusCol) return [];
    return ((statusCol.settings?.labels ?? []) as any[])
      .filter((l: any) => !((statusCol.settings?.inactiveLabels ?? []) as string[]).includes(l.label))
      .map((l: any) => ({ id: l.label, name: l.label, color: soften(l.color) ?? undefined }));
  }, [statusCol]);

  /** 按模式计算分桶 */
  const buckets = useMemo(() => {
    const items = Object.values(allItems) as any[];
    if (mode === 'group') {
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        color: undefined as string | undefined,
        items: items.filter((i) => (g.id === 'default' ? true : i.group_id === g.id)),
      }));
    }
    if (mode === 'status' && statusCol) {
      return statusLanes.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
        items: items.filter((i) => String(i.values?.[statusCol.id] ?? '') === l.id),
      }));
    }
    if (mode === 'column' && groupByColId) {
      const col = columns.find((c: any) => c.id === groupByColId);
      if (!col) return [];
      const map = new Map<string, { name: string; color?: string; items: any[] }>();
      if (col.type === 'status') {
        for (const l of (col.settings?.labels ?? []) as any[]) {
          if (((col.settings?.inactiveLabels as any[]) ?? []).includes(l.label)) continue;
          map.set(l.label, { name: l.label, color: soften(l.color) ?? undefined, items: [] });
        }
      }
      if (col.type === 'checkbox') {
        map.set('true', { name: '已勾选', color: '#00a25b', items: [] });
        map.set('false', { name: '未勾选', color: '#7a7f8c', items: [] });
      }
      for (const it of items) {
        const v = it.values?.[col.id];
        let key: string;
        if (v == null || v === '') key = '__empty__';
        else if (col.type === 'checkbox') key = v === true || v === 'true' ? 'true' : 'false';
        else if (col.type === 'people') {
          const names = personNames(v, users, membersOf(col));
          key = names[0] || '__empty__';
        } else key = String(v);
        if (!map.has(key)) map.set(key, { name: key === '__empty__' ? '无值' : key, items: [] });
        map.get(key)!.items.push(it);
      }
      return Array.from(map.entries()).map(([id, b]) => ({ id, ...b }));
    }
    return [];
  }, [mode, groupByColId, groups, allItems, columns, statusCol, statusLanes, users]);

  async function onDragEnd(e: DragEndEvent) {
    const itemId = String(e.active.id);
    const target = e.over?.id == null ? '' : String(e.over.id);
    if (!target || target === 'undefined' || target === 'default') return;
    const store = useItems.getState();
    const item = store.items[itemId];
    if (!item) return;

    // WIP 检查
    const targetBucket = buckets.find((b) => b.id === target);
    if (targetBucket && wipLimits[target]) {
      if (targetBucket.items.length >= wipLimits[target]) {
        setToast(`「${targetBucket.name}」已满（WIP ${wipLimits[target]}），无法拖入`);
        setTimeout(() => setToast(''), 2500);
        return;
      }
    }

    if (mode === 'group') {
      if (item.group_id === target) return;
      const prevGroupId = item.group_id;
      store.patchItem(itemId, { groupId: target });
      try {
        const r: any = await api.updateItem(itemId, { groupId: target });
        if (r?.version) store.patchItem(itemId, { version: r.version });
      } catch {
        store.patchItem(itemId, prevGroupId ? { groupId: prevGroupId } : {});
        useToast.getState().toast('移动失败，已回滚', 'error');
      }
      return;
    }

    // status / column 模式：更新单元格值
    const colId = mode === 'status' ? statusCol?.id : groupByColId;
    if (!colId) return;
    const targetVal = target === '__empty__' ? null : target;
    const prev = (item as any).values?.[colId] ?? null;
    if (prev === targetVal) return;
    store.patchItem(itemId, { values: { ...(item as any).values, [colId]: targetVal } } as any);
    try {
      const r: any = await api.updateCell(itemId, colId, targetVal, item.version);
      if (r?.version) store.patchItem(itemId, { version: r.version } as any);
      setToast(`已移动到「${target === '__empty__' ? '无值' : target}」`);
      setTimeout(() => setToast(''), 1800);
    } catch {
      store.patchItem(itemId, { values: { ...(item as any).values, [colId]: prev } } as any);
      setToast('移动失败，已回滚');
      setTimeout(() => setToast(''), 1800);
    }
  }

  /** 可分桶的列 */
  const groupableCols = columns.filter((c: any) =>
    ['status', 'people', 'checkbox', 'rating', 'tags', 'number', 'text', 'dropdown'].includes(c.type));

  /** 设置 WIP 限制 */
  const setWip = (bucketId: string, limit: number) => {
    setWipLimits((s) => {
      const n = { ...s };
      if (limit <= 0) delete n[bucketId]; else n[bucketId] = limit;
      if (boardId) api.putPrefs(boardId, { prefs: { kanbanWip: n } }).catch(() => {});
      return n;
    });
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px 0', alignItems: 'center', flexWrap: 'wrap' }}>
        <button data-kanban-mode="group" onClick={() => switchMode('group')}
          style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 12,
            background: mode === 'group' ? '#eef1fe' : '#fff', color: mode === 'group' ? '#4f6ef7' : '#7a7f8c', cursor: 'pointer' }}>
          按分组
        </button>
        {statusCol && (
          <button data-kanban-mode="status" onClick={() => switchMode('status')}
            style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 12,
              background: mode === 'status' ? '#eef1fe' : '#fff', color: mode === 'status' ? '#4f6ef7' : '#7a7f8c', cursor: 'pointer' }}>
            按状态（{statusCol.name}）
          </button>
        )}
        {groupableCols.length > 0 && (
          <select data-kanban-groupby value={mode === 'column' ? groupByColId : ''} onChange={(e) => switchGroupCol(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 12,
              background: mode === 'column' ? '#eef1fe' : '#fff', color: '#4f6ef7', cursor: 'pointer' }}>
            <option value="">按列分桶…</option>
            {groupableCols.map((c: any) => <option key={c.id} value={c.id}>{c.name}（{c.type}）</option>)}
          </select>
        )}
        {toast && <span style={{ fontSize: 12, color: '#4f6ef7' }}>{toast}</span>}
        <span style={{ fontSize: 11, color: '#7a7f8c', marginLeft: 'auto' }}>
          共 {buckets.reduce((s, b) => s + b.items.length, 0)} 条目 · 拖拽卡片切换列 · 点击 ◀ 折叠列
        </span>
      </div>
      <DndContext onDragEnd={onDragEnd}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: 14, overflowX: 'auto', flex: 1 }}>
          {buckets.map((b) => (
            <BucketColumn key={b.id} id={b.id} name={b.name} color={b.color} items={b.items}
              wipLimit={wipLimits[b.id]} collapsed={collapsedCols.has(b.id)}
              onToggle={() => toggleCollapse(b.id)} onOpenItem={onOpenItem} />
          ))}
          {buckets.length === 0 && (
            <div style={{ color: '#7a7f8c', fontSize: 13, padding: 40 }}>
              {mode === 'column' && !groupByColId ? '选择一个列来按其值分桶' : '没有可用数据'}
            </div>
          )}
        </div>
      </DndContext>
    </div>
  );
}
