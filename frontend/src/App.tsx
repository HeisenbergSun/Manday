import { useEffect, useState } from 'react';
import { BoardTable } from './components/BoardTable';
import { Kanban } from './components/Kanban';
import { AiSidebar } from './components/AiSidebar';
import { ItemDetail } from './components/ItemDetail';
import { NotificationBell, CommandPalette } from './components/TopWidgets';
import { WorkspaceNav } from './components/WorkspaceNav';
import { DashboardPage } from './components/DashboardPage';
import { NewBoardModal } from './components/NewBoardModal';
import { useItems, useUi } from './store';
import { api } from './api';
import { joinBoard, leaveBoard } from './socket';

export function App() {
  const [view, setView] = useState<'table' | 'kanban' | 'dashboard'>('table');
  const { aiOpen, toggleAI } = useUi();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activeBoard, setActiveBoard] = useState<{ id: string; name: string } | null>({ id: 'demo-board', name: 'Demo' });
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const setBoard = useItems((s) => s.setBoard);

  useEffect(() => {
    const boardId = activeBoard?.id ?? 'demo-board';
    api.getBoard(boardId).then((d) => setBoard(d.items, d.columns));
    joinBoard(boardId);
    return () => leaveBoard(boardId);
  }, [activeBoard?.id]);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f6f7fb' }}>
      <header style={{ height: 52, background: '#fff', borderBottom: '1px solid #e6e8ef', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: '#4f6ef7' }}>Manday</div>
        <nav style={{ display: 'flex', gap: 4 }}>
          {(['table', 'kanban', 'dashboard'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
                background: view === v ? '#eef1fe' : 'transparent', color: view === v ? '#4f6ef7' : '#7a7f8c',
                fontWeight: view === v ? 600 : 400 }}>
              {v === 'table' ? '▤ 表格' : v === 'kanban' ? '▦ 看板' : '📊 Dashboard'}
            </button>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#7a7f8c', fontSize: 12 }}>⌘K 搜索</span>
          <NotificationBell />
          <button onClick={toggleAI} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>✦ AI 助手</button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <WorkspaceNav activeId={activeBoard?.id} onOpen={(b) => { setActiveBoard(b); setView('table'); }}
          onNewBoard={() => setNewBoardOpen(true)} />
        <main style={{ flex: 1, overflow: 'auto' }}>
          {view === 'table' ? <BoardTable boardId={activeBoard?.id ?? 'demo-board'} onOpenItem={setDetailId} />
            : view === 'kanban' ? <Kanban groups={[{ id: 'g1', name: '待办' }, { id: 'g2', name: '进行中' }, { id: 'g3', name: '已完成' }]} />
            : <DashboardPage boardIds={activeBoard ? [activeBoard.id] : []} />}
        </main>
        {detailId && <ItemDetail itemId={detailId} onClose={() => setDetailId(null)} />}
        {aiOpen && <AiSidebar boardId={activeBoard?.id} />}
      </div>
      <CommandPalette />
      {newBoardOpen && (
        <NewBoardModal onClose={() => setNewBoardOpen(false)}
          onCreated={async (boardId) => {
            // 实例化后刷新导航并打开新 Board（简化：直接加载）
            const d = await api.getBoard(boardId).catch(() => null);
            if (d) { setBoard(d.items, d.columns); setActiveBoard({ id: boardId, name: '新 Board' }); }
          }} />
      )}
    </div>
  );
}
