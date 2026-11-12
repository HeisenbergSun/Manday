/**
 * 工作区布局 — 左侧导航（Board 列表 / Dashboard / 回收站入口）+ 顶栏路由
 */
import { useEffect, useState } from 'react';

interface BoardItem { id: string; name: string; my_role: string; department_name?: string; visibility: string; }

export function WorkspaceNav({ activeId, onOpen, onNewBoard }: {
  activeId?: string; onOpen: (b: BoardItem) => void; onNewBoard?: () => void;
}) {
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch('/api/boards').then((r) => r.json()).then(setBoards);
  }, []);

  return (
    <nav style={{
      width: collapsed ? 52 : 232, background: '#fafbfd', borderRight: '1px solid #e6e8ef',
      padding: 10, flexShrink: 0, transition: 'width .2s', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px' }}>
        {!collapsed && <span style={{ fontSize: 11, fontWeight: 700, color: '#7a7f8c', letterSpacing: 1 }}>工作区</span>}
        <span style={{ cursor: 'pointer', color: '#7a7f8c', fontSize: 13 }} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '»' : '«'}
        </span>
      </div>

      {boards.map((b) => (
        <div key={b.id} onClick={() => onOpen(b)} style={{
          padding: '8px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
          background: activeId === b.id ? '#eef1fe' : 'transparent',
          color: activeId === b.id ? '#4f6ef7' : '#25272c', fontWeight: activeId === b.id ? 600 : 400,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: 3, flexShrink: 0,
            background: b.visibility === 'company' ? '#00c875' : b.visibility === 'department' ? '#579bfc' : '#9d3dd7',
          }} title={{ company: '全员可见', department: '部门内', shared: '指定共享', private: '私有' }[b.visibility]} />
          {!collapsed && <span>{b.name}</span>}
        </div>
      ))}

      <div style={{ marginTop: 'auto', borderTop: '1px solid #e6e8ef', paddingTop: 8 }}>
        <div style={{ padding: '8px 10px', borderRadius: 8, fontSize: 13, color: '#7a7f8c', cursor: 'pointer' }}
          onClick={onNewBoard}>
          {collapsed ? '⊕' : '＋ 新建 Board'}
        </div>
        <div style={{ padding: '8px 10px', borderRadius: 8, fontSize: 13, color: '#7a7f8c', cursor: 'pointer' }}>
          {collapsed ? '🗑' : '回收站'}
        </div>
      </div>
    </nav>
  );
}
