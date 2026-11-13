/**
 * 看板视图 — dnd-kit + 乐观更新（拖拽先本地生效，失败回滚 toast）
 * P1-7：可切换「按分组 / 按状态」两种看板；按状态时拖拽 = 改状态列单元格（LWW）
 */
import { DndContext, DragEndEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { useEffect, useState } from 'react';
import { useItems } from '../store';
import { api } from '../api';
import { doneLabelsOf } from '../theme';

function Card({ itemId }: { itemId: string }) {
  const item = useItems((s) => s.items[itemId]);
  const columns = useItems((s) => s.columns);
  const peopleCol = columns.find((c: any) => c.type === 'people');
  const dateCol = columns.find((c: any) => c.type === 'date');
  const people = peopleCol ? (item as any).values?.[peopleCol.id] : null;
  const peopleNames = Array.isArray(people) ? people.map((p: any) => p?.name ?? String(p)).filter(Boolean)
    : people ? [typeof people === 'string' ? people : people?.name ?? ''].filter(Boolean) : [];
  const dateVal = dateCol ? (item as any).values?.[dateCol.id] : null;
  const overdue = dateVal && new Date(String(dateVal)) < new Date(new Date().toDateString());
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: itemId });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      style={{ transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined,
        background: '#fff', borderRadius: 8, padding: '10px 12px', marginBottom: 8, cursor: 'grab' }}>
      <b style={{ fontSize: 13, display: 'block', marginBottom: peopleNames.length || dateVal ? 6 : 0 }}>{item.name}</b>
      {(peopleNames.length > 0 || dateVal) && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {peopleNames.slice(0, 3).map((n) => (
            <span key={n} style={{ background: '#eef1fe', color: '#4f6ef7', borderRadius: 10, padding: '2px 8px', fontSize: 11 }}>{n}</span>
          ))}
          {dateVal && (
            <span style={{ background: overdue ? '#fdeaea' : '#f0f1f5', color: overdue ? '#e2445c' : '#7a7f8c',
              borderRadius: 10, padding: '2px 8px', fontSize: 11 }}>
              📅 {String(dateVal).slice(0, 10)}{overdue ? ' 已逾期' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Column({ group, isDefault, countLabel }: { group: { id: string; name: string }; isDefault?: boolean; countLabel?: string }) {
  // 条目分组字段是 item.group_id（不是 values.group）；无分组时兜底到“全部条目”列
  const items = useItems((s) => Object.values(s.items).filter(
    (i: any) => (isDefault ? true : i.group_id === group.id),
  ));
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  return (
    <div ref={setNodeRef} data-kanban-col={group.id} style={{
      width: 280, background: '#eef0f5', borderRadius: 10, padding: 10,
      outline: isOver ? '2px dashed #4f6ef7' : 'none',
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{group.name} ({countLabel ?? items.length})</div>
      {items.map((i) => <Card key={i.id} itemId={i.id} />)}
    </div>
  );
}

export function Kanban({ groups, boardId }: { groups: { id: string; name: string }[]; boardId?: string }) {
  const columns = useItems((s) => s.columns);
  const statusCol = columns.find((c: any) => c.type === 'status');
  const [mode, setMode] = useState<'group' | 'status'>('group');
  const [toast, setToast] = useState('');
  // P1-4：模式记住在个人偏好里（有 boardId 时）
  useEffect(() => {
    if (!boardId) return;
    api.getPrefs(boardId).then((p: any) => {
      if (p?.prefs?.kanbanMode === 'status' && statusCol) setMode('status');
    }).catch(() => {});
  }, [boardId]);
  const switchMode = (m: 'group' | 'status') => {
    setMode(m);
    if (boardId) api.putPrefs(boardId, { prefs: { kanbanMode: m } }).catch(() => {});
  };

  /** 状态列的活动标签（排除停用）→ 看板列 */
  const statusLanes = statusCol
    ? ((statusCol.settings?.labels ?? []) as any[])
        .filter((l: any) => !((statusCol.settings?.inactiveLabels ?? []) as string[]).includes(l.label))
        .map((l: any) => ({ id: l.label, name: l.label, color: l.color }))
    : [];

  async function onDragEnd(e: DragEndEvent) {
    const itemId = String(e.active.id);
    const target = e.over?.id == null ? '' : String(e.over.id);
    if (!target || target === 'undefined' || target === 'default') return;
    const store = useItems.getState();
    const item = store.items[itemId];
    if (!item) return;
    if (mode === 'status') {
      // P1-7：拖到状态列 = 改状态单元格（LWW）
      if (!statusCol) return;
      const prev = (item as any).values?.[statusCol.id] ?? null;
      if (prev === target) return;
      store.patchItem(itemId, { values: { ...(item as any).values, [statusCol.id]: target } } as any);
      try {
        const r: any = await api.updateCell(itemId, statusCol.id, target, item.version);
        if (r?.version) store.patchItem(itemId, { version: r.version } as any);
        setToast(`已改为「${target}」`);
        setTimeout(() => setToast(''), 1800);
      } catch {
        store.patchItem(itemId, { values: { ...(item as any).values, [statusCol.id]: prev } } as any);
        setToast('移动失败，已回滚');
        setTimeout(() => setToast(''), 1800);
      }
      return;
    }
    if (item.group_id === target) return;
    // 乐观更新：先改本地（视觉即时反馈），失败回滚
    const prevGroupId = item.group_id;
    store.patchItem(itemId, { groupId: target });
    try {
      const r: any = await api.updateItem(itemId, { groupId: target });
      if (r?.version) store.patchItem(itemId, { version: r.version } as any);
    } catch {
      store.patchItem(itemId, prevGroupId ? { groupId: prevGroupId } : {});
      alert('移动失败，已回滚');
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px 0', alignItems: 'center' }}>
        {statusCol && (
          <>
            <button data-kanban-mode="group" onClick={() => switchMode('group')}
              style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 12,
                background: mode === 'group' ? '#eef1fe' : '#fff', color: mode === 'group' ? '#4f6ef7' : '#7a7f8c', cursor: 'pointer' }}>
              按分组
            </button>
            <button data-kanban-mode="status" onClick={() => switchMode('status')}
              style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 12,
                background: mode === 'status' ? '#eef1fe' : '#fff', color: mode === 'status' ? '#4f6ef7' : '#7a7f8c', cursor: 'pointer' }}>
              按状态（绑定「{statusCol.name}」列）
            </button>
          </>
        )}
        {toast && <span style={{ fontSize: 12, color: '#4f6ef7' }}>{toast}</span>}
      </div>
    <DndContext onDragEnd={onDragEnd}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: 14, overflowX: 'auto' }}>
        {mode === 'status'
          ? statusLanes.map((g) => <StatusLane key={g.id} label={g.id} name={g.name} color={g.color} />)
          : groups.map((g) => <Column key={g.id} group={g} isDefault={g.id === 'default'} />)}
      </div>
    </DndContext>
    </div>
  );
}

/** 状态泳道：按 status 列值过滤（P1-7） */
function StatusLane({ label, name, color }: { label: string; name: string; color?: string }) {
  const columns = useItems((s) => s.columns);
  const items = useItems((s) => Object.values(s.items).filter(
    (i: any) => String(i.values?.[columns.find((c: any) => c.type === 'status')?.id ?? ''] ?? '') === label,
  ));
  const { setNodeRef, isOver } = useDroppable({ id: label });
  return (
    <div ref={setNodeRef} data-kanban-col={label} style={{
      width: 280, background: '#eef0f5', borderRadius: 10, padding: 10,
      outline: isOver ? '2px dashed #4f6ef7' : 'none',
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        {color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />}
        {name} ({items.length})
      </div>
      {items.map((i) => <Card key={i.id} itemId={i.id} />)}
    </div>
  );
}
