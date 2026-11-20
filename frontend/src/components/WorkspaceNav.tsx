/**
 * 工作区布局 — 左侧导航
 * 顶部「＋」按钮（Monday 式）：新建 Board / Dashboard / 分组
 * 分区：工作台 / 仪表盘（自定义 Dashboard）/ Board 分组 / 未分组
 * 菜单均用 fixed 定位（避免被行的 overflow:hidden 裁剪）
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

interface BoardItem { id: string; name: string; my_role: string; department_name?: string; visibility: string; }
interface Folder { id: string; name: string; position: number; boardIds: string[]; dashboardIds?: string[]; }
interface DashItem { id: string; name: string; is_team?: boolean; is_owner?: boolean; }

export function WorkspaceNav({ activeId, dashboardActive, activeDashboardId, onOpen, onNewBoard, onNewDashboard, onOpenDashboard, onOpenCustomDashboard }: {
  activeId?: string; dashboardActive?: boolean; activeDashboardId?: string | null;
  onOpen: (b: BoardItem) => void; onNewBoard?: () => void; onNewDashboard?: () => void;
  onOpenDashboard?: () => void; onOpenCustomDashboard?: (id: string) => void;
}) {
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [dashboards, setDashboards] = useState<DashItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [folderCollapsed, setFolderCollapsed] = useState<Record<string, boolean>>({});
  // 两个 fixed 菜单：加号菜单 / board 分组菜单
  const [plusMenu, setPlusMenu] = useState<{ x: number; y: number } | null>(null);
  const [boardMenu, setBoardMenu] = useState<{ boardId: string; x: number; y: number } | null>(null);
  const [dashMenu, setDashMenu] = useState<{ dashId: string; x: number; y: number } | null>(null);

  const reload = () => {
    api.getBoards().then((d) => setBoards(Array.isArray(d) ? d : [])).catch(() => {});
    api.listFolders().then((d) => setFolders(Array.isArray(d) ? d : [])).catch(() => {});
    api.listDashboards().then((d) => setDashboards(Array.isArray(d) ? d : [])).catch(() => {});
  };
  useEffect(reload, []);

  // 点击任意处关闭菜单
  useEffect(() => {
    const close = () => { setPlusMenu(null); setBoardMenu(null); setDashMenu(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const folderOf = (boardId: string): string | undefined => {
    for (const f of folders) if (f.boardIds.includes(boardId)) return f.id;
    return undefined;
  };

  const dashFolderOf = (dashboardId: string): string | undefined => {
    for (const f of folders) if ((f.dashboardIds ?? []).includes(dashboardId)) return f.id;
    return undefined;
  };

  /** 把 dashboard 移入/移出分组 */
  const moveDashToFolder = async (dashboardId: string, folderId: string | null) => {
    try {
      if (folderId) await api.addDashboardToFolder(folderId, dashboardId);
      else {
        const cur = dashFolderOf(dashboardId);
        if (cur) await api.removeDashboardFromFolder(cur, dashboardId);
      }
      reload();
    } catch (e) { alert(`操作失败：${(e as Error).message}`); }
  };

  const moveToFolder = async (boardId: string, folderId: string | null) => {
    try {
      if (folderId) await api.addBoardToFolder(folderId, boardId);
      else {
        const cur = folderOf(boardId);
        if (cur) await api.removeBoardFromFolder(cur, boardId);
      }
      setBoardMenu(null);
      reload();
    } catch (e) { alert(`操作失败：${(e as Error).message}`); }
  };

  /** 工作区 board 拖拽排序：把 from 移到 to 的位置（本地乐观 + 后端持久化） */
  const reorderBoard = (fromId: string, toId: string) => {
    const from = boards.findIndex((x) => x.id === fromId);
    const to = boards.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...boards];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setBoards(next);
    api.reorderBoards(next.map((x) => x.id)).catch(() => reload());
  };

  /** 分组拖拽排序 */
  const reorderFolder = (fromId: string, toId: string) => {
    const from = folders.findIndex((x) => x.id === fromId);
    const to = folders.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...folders];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setFolders(next);
    api.reorderFolders(next.map((x) => x.id)).catch(() => reload());
  };

  /** dashboard 拖拽排序 */
  const reorderDash = (fromId: string, toId: string) => {
    const from = dashboards.findIndex((x) => x.id === fromId);
    const to = dashboards.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...dashboards];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDashboards(next);
    api.reorderDashboards(next.map((x) => x.id)).catch(() => reload());
  };

  /** 统一拖拽数据格式：`type:id`，用于区分 board/folder/dash 三类拖拽 */
  const parseDrag = (data: string): { type: string; id: string } => {
    const i = data.indexOf(':');
    if (i < 0) return { type: 'board', id: data };
    return { type: data.slice(0, i), id: data.slice(i + 1) };
  };

  const newFolder = async (boardId?: string, dashboardId?: string) => {
    const name = prompt('新建分组名称');
    if (!name || !name.trim()) return;
    try {
      const f: any = await api.createFolder(name.trim());
      if (boardId && f?.id) await api.addBoardToFolder(f.id, boardId);
      if (dashboardId && f?.id) await api.addDashboardToFolder(f.id, dashboardId);
      reload();
      setPlusMenu(null); setBoardMenu(null); setDashMenu(null);
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

  // —— Board 级操作：复制 / 重命名 / 删除 ——
  const duplicateBoard = async (b: BoardItem) => {
    try { await api.duplicateBoard(b.id); setBoardMenu(null); reload(); }
    catch (e) { alert(`复制失败：${(e as Error).message}`); }
  };
  const renameBoard = async (b: BoardItem) => {
    const name = prompt('重命名 Board', b.name);
    if (!name || !name.trim() || name.trim() === b.name) return;
    try { await api.renameBoard(b.id, name.trim()); setBoardMenu(null); reload(); }
    catch (e) { alert(`重命名失败：${(e as Error).message}`); }
  };
  const deleteBoard = async (b: BoardItem) => {
    if (!confirm(`删除 Board「${b.name}」？\n\n该看板及其所有条目、列、分组将被永久删除，无法恢复。`)) return;
    try { await api.deleteBoard(b.id); setBoardMenu(null); reload(); }
    catch (e) { alert(`删除失败：${(e as Error).message}`); }
  };

  // —— Dashboard 级操作：复制 / 重命名 / 删除 ——
  const openDashMenu = (d: DashItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const r = (e.target as HTMLElement).getBoundingClientRect();
    setDashMenu({ dashId: d.id, x: Math.min(r.right - 170, window.innerWidth - 180), y: r.bottom + 2 });
  };
  const duplicateDash = async (d: DashItem) => {
    try { await api.duplicateDashboard(d.id); setDashMenu(null); reload(); }
    catch (e) { alert(`复制失败：${(e as Error).message}`); }
  };
  const renameDash = async (d: DashItem) => {
    const name = prompt('重命名 Dashboard', d.name);
    if (!name || !name.trim() || name.trim() === d.name) return;
    try { await api.renameDashboard(d.id, name.trim()); setDashMenu(null); reload(); }
    catch (e) { alert(`重命名失败：${(e as Error).message}`); }
  };
  const deleteDash = async (d: DashItem) => {
    if (!confirm(`删除 Dashboard「${d.name}」？该仪表盘及其图表将被永久删除。`)) return;
    try { await api.deleteDashboard(d.id); setDashMenu(null); reload(); }
    catch (e) { alert(`删除失败：${(e as Error).message}`); }
  };

  const openBoardMenu = (b: BoardItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const r = (e.target as HTMLElement).getBoundingClientRect();
    setBoardMenu({ boardId: b.id, x: Math.min(r.right - 170, window.innerWidth - 180), y: r.bottom + 2 });
  };

  const openPlusMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = (e.target as HTMLElement).getBoundingClientRect();
    setPlusMenu({ x: Math.min(r.left, window.innerWidth - 190), y: r.bottom + 4 });
  };

  const boardRow = (b: BoardItem, indent = false) => (
    <div key={b.id} onClick={() => onOpen(b)} title={b.name} data-board-item={b.name} draggable
      onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', 'board:' + b.id); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const t = parseDrag(e.dataTransfer.getData('text/plain')); if (t.type === 'board') reorderBoard(t.id, b.id); else if (t.type === 'dash') moveDashToFolder(t.id, folderOf(b.id) ?? null); }}
      style={{
        padding: '8px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
        background: activeId === b.id ? '#eef1fe' : 'transparent',
        color: activeId === b.id ? '#4f6ef7' : '#25272c', fontWeight: activeId === b.id ? 600 : 400,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        display: 'flex', alignItems: 'center', gap: 8, paddingLeft: indent ? 24 : 10,
      }}>
      <span style={{
        width: 8, height: 8, borderRadius: 3, flexShrink: 0,
        background: b.visibility === 'company' ? '#00c875' : b.visibility === 'department' ? '#579bfc' : '#9d3dd7',
      }} title={{ company: '全员可见', department: '部门内', shared: '指定共享', private: '私有' }[b.visibility]} />
      {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>}
      {!collapsed && (
        <span data-board-menu-trigger onClick={(e) => openBoardMenu(b, e)}
          title="更多操作"
          style={{ flexShrink: 0, color: '#a0a4b1', fontSize: 11, padding: '0 4px', borderRadius: 4, cursor: 'pointer' }}>⋯</span>
      )}
    </div>
  );

  const dashRow = (d: DashItem, indent = false) => (
    <div key={d.id} data-dashboard-item={d.name} onClick={() => onOpenCustomDashboard?.(d.id)} draggable
      onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', 'dash:' + d.id); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const t = parseDrag(e.dataTransfer.getData('text/plain')); if (t.type === 'dash') reorderDash(t.id, d.id); else if (t.type === 'board') moveToFolder(t.id, dashFolderOf(d.id) ?? null); }}
      style={{ padding: '8px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
        background: activeDashboardId === d.id ? '#eef1fe' : 'transparent',
        color: activeDashboardId === d.id ? '#4f6ef7' : '#25272c', fontWeight: activeDashboardId === d.id ? 600 : 400,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        display: 'flex', alignItems: 'center', gap: 8, paddingLeft: indent ? 24 : 10 }}>
      <span>{d.is_team ? '👥' : '📈'}</span>
      {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>}
      {!collapsed && d.is_team && <span style={{ fontSize: 10, color: '#a0a4b1' }}>团队</span>}
      {!collapsed && (
        <span data-dashboard-menu-trigger onClick={(e) => openDashMenu(d, e)} title="更多操作"
          style={{ flexShrink: 0, color: '#a0a4b1', fontSize: 11, padding: '0 4px', borderRadius: 4, cursor: 'pointer' }}>⋯</span>
      )}
    </div>
  );

  return (
    <nav style={{
      width: collapsed ? 52 : 232, height: '100%', minHeight: 0, background: '#fafbfd', borderRight: '1px solid #e6e8ef',
      padding: 10, flexShrink: 0, transition: 'width .2s', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      {/* 标题 + 加号 + 折叠 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px' }}>
        {!collapsed && <span style={{ fontSize: 11, fontWeight: 700, color: '#7a7f8c', letterSpacing: 1 }}>工作区</span>}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span data-workspace-plus onClick={openPlusMenu} title="新建 Board / Dashboard / 分组"
            style={{ cursor: 'pointer', color: '#7a7f8c', fontSize: 16, fontWeight: 700, lineHeight: 1, padding: '0 2px' }}>＋</span>
          <span style={{ cursor: 'pointer', color: '#7a7f8c', fontSize: 13 }} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? '»' : '«'}
          </span>
        </span>
      </div>

      {/* 工作台入口 */}
      <div data-workspace-dashboard onClick={() => onOpenDashboard?.()}
        style={{ padding: '8px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
          background: dashboardActive ? '#eef1fe' : 'transparent', color: dashboardActive ? '#4f6ef7' : '#25272c',
          fontWeight: dashboardActive ? 600 : 500, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
        <span>📊</span>{!collapsed && <span>工作台</span>}
      </div>

      <div data-board-list style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Board 分组（含 board + dashboard） */}
        {folders.map((f) => {
          const list = boards.filter((b) => f.boardIds.includes(b.id));
          const dashList = dashboards.filter((d) => (f.dashboardIds ?? []).includes(d.id));
          const isC = !!folderCollapsed[f.id];
          return (
            <div key={f.id}>
              <div onClick={() => setFolderCollapsed((c) => ({ ...c, [f.id]: !c[f.id] }))} draggable
                onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', 'folder:' + f.id); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const t = parseDrag(e.dataTransfer.getData('text/plain')); if (t.type === 'board') moveToFolder(t.id, f.id); else if (t.type === 'dash') moveDashToFolder(t.id, f.id); else if (t.type === 'folder') reorderFolder(t.id, f.id); }}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', cursor: 'pointer',
                  color: '#5a6072', fontSize: 12, fontWeight: 600, borderRadius: 6 }}>
                <span>{isC ? '▸' : '▾'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ color: '#a0a4b1', fontSize: 11 }}>{list.length + dashList.length}</span>
                {!collapsed && (
                  <>
                    <span onClick={(e) => { e.stopPropagation(); renameFolder(f); }} title="重命名"
                      style={{ color: '#a0a4b1', fontSize: 11, padding: '0 3px' }}>✎</span>
                    <span onClick={(e) => { e.stopPropagation(); deleteFolder(f); }} title="删除分组"
                      style={{ color: '#a0a4b1', fontSize: 11, padding: '0 3px' }}>✕</span>
                  </>
                )}
              </div>
              {!isC && (<>
                {list.map((b) => boardRow(b, true))}
                {dashList.map((d) => dashRow(d, true))}
              </>)}
            </div>
          );
        })}

        {/* 未分组 Board + Dashboard（拖到这里 = 移出分组） */}
        <div data-ungrouped-drop style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 44, borderTop: '1px dashed #e6e8ef', paddingTop: 6, marginTop: 4 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const t = parseDrag(e.dataTransfer.getData('text/plain')); if (t.type === 'board' && folderOf(t.id)) moveToFolder(t.id, null); else if (t.type === 'dash' && dashFolderOf(t.id)) moveDashToFolder(t.id, null); }}>
          {!collapsed && (
            <div style={{ fontSize: 11, color: '#b0b4c0', fontWeight: 600, padding: '0 8px', letterSpacing: .5 }}>未分组</div>
          )}
          {boards.filter((b) => !folderOf(b.id)).map((b) => boardRow(b))}
          {dashboards.filter((d) => !dashFolderOf(d.id)).map((d) => dashRow(d))}
        </div>
      </div>

      {/* 加号菜单（fixed，避免裁剪） */}
      {plusMenu && (
        <div data-workspace-plus-menu onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', left: plusMenu.x, top: plusMenu.y, zIndex: 200, background: '#fff',
            borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,.18)', padding: 6, minWidth: 180, fontSize: 13, border: '1px solid #eef0f5' }}>
          <div onClick={() => { setPlusMenu(null); onNewBoard?.(); }}
            style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}>▤ 新建 Board</div>
          <div data-plus-dashboard onClick={() => { setPlusMenu(null); onNewDashboard?.(); }}
            style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}>📊 新建 Dashboard</div>
          <div onClick={() => { setPlusMenu(null); newFolder(); }}
            style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}>🗂 新建分组</div>
        </div>
      )}

      {/* board 分组菜单（fixed） */}
      {boardMenu && (() => {
        const b = boards.find((x) => x.id === boardMenu.boardId);
        if (!b) return null;
        return (
          <div data-board-menu onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: boardMenu.x, top: boardMenu.y, zIndex: 200, background: '#fff',
              borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,.18)', padding: 6, minWidth: 170, fontSize: 12, border: '1px solid #eef0f5' }}>
            <div style={{ color: '#a0a4b1', fontSize: 11, padding: '2px 8px 6px' }}>移动到分组</div>
            {folders.map((f) => (
              <div key={f.id} data-board-menu-folder={f.name} onClick={() => moveToFolder(b.id, f.id)}
                style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#33333f' }}>
                {folderOf(b.id) === f.id ? '✓ ' : ''}{f.name}
              </div>
            ))}
            {folderOf(b.id) && (
              <div onClick={() => moveToFolder(b.id, null)}
                style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#7a7f8c' }}>从分组移除</div>
            )}
            <div style={{ borderTop: '1px solid #f0f1f5', margin: '4px 0' }} />
            <div onClick={() => newFolder(b.id)}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#4f6ef7' }}>＋ 新建分组…</div>
            <div style={{ borderTop: '1px solid #f0f1f5', margin: '4px 0' }} />
            <div data-board-dup onClick={() => duplicateBoard(b)}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#33333f' }}>⧉ 复制 Board</div>
            <div data-board-rename onClick={() => renameBoard(b)}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#33333f' }}>✎ 重命名 Board</div>
            <div data-board-delete onClick={() => deleteBoard(b)}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#e2445c' }}>🗑 删除 Board</div>
          </div>
        );
      })()}

      {/* dashboard 操作菜单（fixed） */}
      {dashMenu && (() => {
        const d = dashboards.find((x) => x.id === dashMenu.dashId);
        if (!d) return null;
        return (
          <div data-dash-menu onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: dashMenu.x, top: dashMenu.y, zIndex: 200, background: '#fff',
              borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,.18)', padding: 6, minWidth: 170, fontSize: 12, border: '1px solid #eef0f5' }}>
            <div style={{ color: '#a0a4b1', fontSize: 11, padding: '2px 8px 6px' }}>移动到分组</div>
            {folders.map((f) => (
              <div key={f.id} data-dash-menu-folder={f.name} onClick={() => { moveDashToFolder(d.id, f.id); setDashMenu(null); }}
                style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#33333f' }}>
                {dashFolderOf(d.id) === f.id ? '✓ ' : ''}{f.name}
              </div>
            ))}
            {dashFolderOf(d.id) && (
              <div onClick={() => { moveDashToFolder(d.id, null); setDashMenu(null); }}
                style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#7a7f8c' }}>从分组移除</div>
            )}
            <div style={{ borderTop: '1px solid #f0f1f5', margin: '4px 0' }} />
            <div onClick={() => { newFolder(undefined, d.id); setDashMenu(null); }}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#4f6ef7' }}>＋ 新建分组…</div>
            <div style={{ borderTop: '1px solid #f0f1f5', margin: '4px 0' }} />
            <div data-dash-dup onClick={() => duplicateDash(d)}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#33333f' }}>⧉ 复制 Dashboard</div>
            <div data-dash-rename onClick={() => renameDash(d)}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#33333f' }}>✎ 重命名 Dashboard</div>
            <div data-dash-delete onClick={() => deleteDash(d)}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: '#e2445c' }}>🗑 删除 Dashboard</div>
          </div>
        );
      })()}
    </nav>
  );
}
