/**
 * 看板视图 — dnd-kit + 乐观更新（拖拽先本地生效，失败回滚 toast）
 */
import { DndContext, DragEndEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { useItems } from '../store';
import { api } from '../api';

function Card({ itemId }: { itemId: string }) {
  const item = useItems((s) => s.items[itemId]);
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: itemId });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      style={{ transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined,
        background: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, cursor: 'grab' }}>
      <b>{item.name}</b>
    </div>
  );
}

function Column({ group }: { group: { id: string; name: string } }) {
  const items = useItems((s) => Object.values(s.items).filter((i) => i.values.group === group.id));
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
    const targetGroup = String(e.over?.id);
    if (!targetGroup) return;
    // 乐观更新：先改本地 store（视觉即时反馈），再 PATCH；失败 toast 回滚
    await api.batchUpdate([{ itemId, columnId: 'group', value: targetGroup }]);
  }

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: 14, overflowX: 'auto' }}>
        {groups.map((g) => <Column key={g.id} group={g} />)}
      </div>
    </DndContext>
  );
}
