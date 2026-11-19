/**
 * 工作区布局 — 左侧导航（工作台 / Board 自定义分组 / 回收站入口）
 * 需求：① 工作台入口 ② Board 自定义分组（文件夹）③ 溢出滚动 ④ 折叠
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

interface BoardItem { id: string; name: string; my_role: string; department_name?: string; visibility: string; }
interface Folder { id: string; name: string; position: number; boardIds: string[]; }

export function WorkspaceNav({ activeId, dashboardActive, onOpen, onNewBoard, onOpenDashboard }: {
  activeId?: string; dashboardActive?: boolean; onOpen: (b: BoardItem) => void;
  onNewBoard?: () => void; onOpenDashboard?: () => void;
}) {
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [folderCollapsed, setFolderCollapsed] = useState<Record<string, boolean>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null); // 正在展开「移动到分组」菜单的 board id

  const reload = () => {
    api.getBoards().then((d) => setBoards(Array.isArray(d) ? d : [])).catch(() => {});
    api.listFolders().then((d) => setFolders(Array.isArray(d) ? d : [])).catch(() => {});
  };
  useEffect(reload, []);

  // boardId → folderId 反查（未分组 = undefined）
  const folderOf = (boardId: string): string | undefined => {
    for (const f of folders) if (f.boardIds.includes(boardId)) return f.id;
    return undefined;
  };

  const moveToFolder = async (boardId: string, folderId: string | null) => {
    try {
      if (folderId) await api.addBoardToFolder(folderId, boardId);
      else {
        const cur = folderOf(boardId);
        if (cur) await api.removeBoardFromFolder(cur, boardId);
      }
      setMenuFor(null);
      reload();
    } catch (e) { alert(`操作失败：${(e as Error).message}`); }
  };

  const newFolder = async (boardId?: string) => {
    const name = prompt('新建分组名称');
    if (!name || !name.trim()) return;
    try {
      const f: any = await api.createFolder(name.trim());
      if (boardId && f?.id) await api.addBoardToFolder(f.id, boardId);
      reload();
      if (boardId) setMenuFor(null);
    } catch (e) { alert(`新建分组失败：${(e as Error).message}`); }
  };

  const renameFolder = async (f: Folder) => {
    const name = prompt('重命名分组', f.name);
    if (!name || !name.trim() || name.trim() === f.name) return;
    try { await api.renameFolder(f.id, name.trim()); reload(); }
    catch (e) { alert(`重命名失败：${(e as Error).message}`); }
  };

  const deleteFolder = async (f: Folder) => {
    if (!confirm(`删除分组「${f.name}」？分组内的 Board 会回到「未分组」，不会被删除。`)) return;
    try { await api.deleteFolder(f.id); reload(); }
    catch (e) { alert(`删除失败：${(e as Error).message}`); }
  };

  const boardRow = (b: BoardItem, indent = false) => (
    <div key={b.id} onClick={() => onOpen(b)} title={b.name} data-board-item={b.name} style={{
      padding: '8px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
      background: activeId === b.id ? '#eef1fe' : 'transparent',
      color: activeId === b.id ? '#4f6ef7' : '#25272c', fontWeight: activeId === b.id ? 600 : 400,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      display: 'flex', alignItems: 'center', gap: 8, paddingLeft: indent ? 24 : 10, position: 'relative',
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 3, flexShrink: 0,
        background: b.visibility === 'company' ? '#00c875' : b.visibility === 'department' ? '#579bfc' : '#9d3dd7',
      }} title={{ company: '全员可见', department: '部门内', shared: '指定共享', private: '私有' }[b.visibility]} />
      {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>}
      {!collapsed && (
        <span data-board-menu-trigger onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === b.id ? null : b.id); }}
          title="移动到分组"
          style={{ flexShrink: 0, color: '#a0a4b1', fontSize: 11, padding: '0 4px', borderRadius: 4, cursor: 'pointer' }}>⋯</span>
      )}
      {menuFor === b.id && (
        <div data-board-menu onClick={(e) => e.stopPropagation()} style={{
          position: 'absolute', right: 6, top: '100%', zIndex: 60, background: '#fff', borderRadius: 8,
          boxShadow: '0 6px 20px rgba(0,0,0,.15)', padding: 6, minWidth: 160, fontSize: 12, border: '1px solid #eef0f5',
        }}>
          <div style={{ color: '#a0a4b1', fontSize: 11, padding: '2px 8px 6px' }}>移动到分组</div>
          {folders.map((f) => (
            <div key={f.id} onClick={() => moveToFolder(b.id, f.id)}
              style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer', color: '#33333f' }}>
              {folderOf(b.id) === f.id ? '✓ ' : ''}{f.name}
            </div>
          ))}
          {folderOf(b.id) && (
            <div onClick={() => moveToFolder(b.id, null)}
              style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer', color: '#7a7f8c' }}>从分组移除</div>
          )}
          <div style={{ borderTop: '1px solid #f0f1f5', margin: '4px 0' }} />
          <div onClick={() => newFolder(b.id)}
            style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer', color: '#4f6ef7' }}>＋ 新建分组…</div>
        </div>
      )}
    </div>
  );

  return (
    <nav style={{
      width: collapsed ? 52 : 232, background: '#fafbfd', borderRight: '1px solid #e6e8ef',
      padding: 10, flexShrink: 0, transition: 'width .2s', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px' }}>
        {!collapsed && <span style={{ fontSize: 11, fontWeight: 700, color: '#7a7f8c', letterSpacing: 1 }}>工作区</span>}
        <span style={{ cursor: 'pointer', color: '#7a7f8c', fontSize: 13 }} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '»' : '«'}
        </span>
      </div>

      {/* 工作台入口（workspace 级 Dashboard） */}
      <div data-workspace-dashboard onClick={() => onOpenDashboard?.()}
        style={{ padding: '8px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
          background: dashboardActive ? '#eef1fe' : 'transparent', color: dashboardActive ? '#4f6ef7' : '#25272c',
          fontWeight: dashboardActive ? 600 : 500, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
        <span>📊</span>{!collapsed && <span>工作台</span>}
      </div>

      <div data-board-list style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* 分组 */}
        {folders.map((f) => {
          const list = boards.filter((b) => f.boardIds.includes(b.id));
          const isC = !!folderCollapsed[f.id];
          return (
            <div key={f.id}>
              <div onClick={() => setFolderCollapsed((c) => ({ ...c, [f.id]: !c[f.id] }))}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', cursor: 'pointer',
                  color: '#5a6072', fontSize: 12, fontWeight: 600, borderRadius: 6 }}>
                <span>{isC ? '▸' : '▾'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ color: '#a0a4b1', fontSize: 11 }}>{list.length}</span>
                {!collapsed && (
                  <>
                    <span onClick={(e) => { e.stopPropagation(); renameFolder(f); }} title="重命名"
                      style={{ color: '#a0a4b1', fontSize: 11, padding: '0 3px' }}>✎</span>
                    <span onClick={(e) => { e.stopPropagation(); deleteFolder(f); }} title="删除分组"
                      style={{ color: '#a0a4b1', fontSize: 11, padding: '0 3px' }}>✕</span>
                  </>
                )}
              </div>
              {!isC && list.map((b) => boardRow(b, true))}
            </div>
          );
        })}

        {/* 未分组 Board */}
        {boards.filter((b) => !folderOf(b.id)).map((b) => boardRow(b))}
      </div>

      <div style={{ borderTop: '1px solid #e6e8ef', paddingTop: 6, flexShrink: 0 }}>
        <div style={{ padding: '7px 10px', borderRadius: 8, fontSize: 13, color: '#7a7f8c', cursor: 'pointer' }}
          onClick={() => newFolder()}>
          {collapsed ? '🗂' : '＋ 新建分组'}
        </div>
        <div style={{ padding: '7px 10px', borderRadius: 8, fontSize: 13, color: '#7a7f8c', cursor: 'pointer' }}
          onClick={onNewBoard}>
          {collapsed ? '⊕' : '＋ 新建 Board'}
        </div>
        <div style={{ padding: '7px 10px', borderRadius: 8, fontSize: 13, color: '#7a7f8c', cursor: 'pointer' }}>
          {collapsed ? '🗑' : '回收站'}
        </div>
      </div>
    </nav>
  );
}
