/**
 * 看板视图 — dnd-kit + 乐观更新（拖拽先本地生效，失败回滚 toast）
 */
import { DndContext, DragEndEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { useItems } from '../store';
import { api } from '../api';

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

function Column({ group, isDefault }: { group: { id: string; name: string }; isDefault?: boolean }) {
  // 条目分组字段是 item.group_id（不是 values.group）；无分组时兜底到"全部条目"列
  const items = useItems((s) => Object.values(s.items).filter(
    (i: any) => (isDefault ? true : i.group_id === group.id),
  ));
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  return (
    <div ref={setNodeRef} style={{
      width: 280, background: '#eef0f5', borderRadius: 10, padding: 10,
      outline: isOver ? '2px dashed #4f6ef7' : 'none',
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{group.name} ({items.length})</div>
      {items.map((i) => <Card key={i.id} itemId={i.id} />)}
    </div>
  );
}

export function Kanban({ groups }: { groups: { id: string; name: string }[] }) {
  const boardId = useItems((s) => s.columns[0] && location.pathname.split('/').pop());

  async function onDragEnd(e: DragEndEvent) {
    const itemId = String(e.active.id);
    const targetGroup = e.over?.id == null ? '' : String(e.over.id);
    if (!targetGroup || targetGroup === 'undefined' || targetGroup === 'default') return;
    const store = useItems.getState();
    const item = store.items[itemId];
    if (!item || item.group_id === targetGroup) return;
    // 乐观更新：先改本地（视觉即时反馈），失败回滚
    const prevGroupId = item.group_id;
    store.patchItem(itemId, { groupId: targetGroup });
    try {
      const r: any = await api.updateItem(itemId, { groupId: targetGroup });
      if (r?.version) store.patchItem(itemId, { version: r.version });
    } catch {
      store.patchItem(itemId, prevGroupId ? { groupId: prevGroupId } : {});
      alert('移动失败，已回滚');
    }
  }

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: 14, overflowX: 'auto' }}>
        {groups.map((g) => <Column key={g.id} group={g} isDefault={g.id === 'default'} />)}
      </div>
    </DndContext>
  );
}
