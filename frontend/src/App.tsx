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
import { api, getToken, clearToken } from './api';
import { joinBoard, leaveBoard } from './socket';

/** 登录页 — 开发一键登录 + 手动 token 备用通道（SSO 未配置时） */
function Login({ onLogin }: { onLogin: (u: { id: string; name: string; email: string }) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [manual, setManual] = useState('');
  const showManual = localStorage.getItem('manday_show_manual_login') === '1';

  const devLogin = async () => {
    setBusy(true); setErr('');
    try { onLogin(await api.devLogin()); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f7fb' }}>
      <div style={{ width: 360, background: '#fff', borderRadius: 14, padding: 32, boxShadow: '0 6px 24px rgba(0,0,0,.08)' }}>
        <div style={{ fontWeight: 800, fontSize: 22, color: '#4f6ef7', marginBottom: 4 }}>Manday</div>
        <div style={{ color: '#7a7f8c', fontSize: 13, marginBottom: 24 }}>轻量版工作管理平台</div>
        <button onClick={devLogin} disabled={busy}
          style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: '#4f6ef7', color: '#fff',
            fontSize: 15, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? '登录中…' : '一键登录（开发账号）'}
        </button>
        {err && <div style={{ marginTop: 12, color: '#e5484d', fontSize: 12, wordBreak: 'break-all' }}>{err}</div>}
        {showManual && (
          <div style={{ marginTop: 16 }}>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="粘贴 JWT token"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 12 }} />
            <button onClick={() => { if (manual.trim()) { api.loginWithToken(manual.trim()); onLogin({ id: localStorage.getItem('userId') ?? '', name: 'Token 用户', email: '' }); } }}
              style={{ marginTop: 8, width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
              用 token 登录
            </button>
          </div>
        )}
        <button onClick={() => localStorage.setItem('manday_show_manual_login', showManual ? '0' : '1')}
          style={{ marginTop: 16, border: 'none', background: 'none', color: '#7a7f8c', fontSize: 12, cursor: 'pointer' }}>
          {showManual ? '收起手动登录' : 'SSO 未配置？手动粘贴 token →'}
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<'table' | 'kanban' | 'dashboard'>('table');
  const { aiOpen, toggleAI } = useUi();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activeBoard, setActiveBoard] = useState<{ id: string; name: string } | null>({ id: 'demo-board', name: 'Demo' });
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null>(() =>
    getToken() ? { id: localStorage.getItem('userId') ?? '', name: '', email: '' } : null);
  const setBoard = useItems((s) => s.setBoard);

  if (!user) return <Login onLogin={setUser} />;

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
          <span style={{ color: '#7a7f8c', fontSize: 12 }}>{user.name || user.email || '已登录'}</span>
          <button onClick={() => { clearToken(); localStorage.removeItem('userId'); location.reload(); }}
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff', cursor: 'pointer', fontSize: 12 }}>退出</button>
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
