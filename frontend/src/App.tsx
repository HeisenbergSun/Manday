import { useEffect, useState } from 'react';
import { BoardTable } from './components/BoardTable';
import { Kanban } from './components/Kanban';
import { CalendarView } from './components/CalendarView';
import { GanttView } from './components/GanttView';
import { WorkloadView } from './components/WorkloadView';
import { AiSidebar } from './components/AiSidebar';
import { ItemDetail } from './components/ItemDetail';
import { NotificationBell, CommandPalette } from './components/TopWidgets';
import { WorkspaceNav } from './components/WorkspaceNav';
import { DashboardPage } from './components/DashboardPage';
import { NewBoardModal } from './components/NewBoardModal';
import { useItems, useUi } from './store';
import { api, getToken, clearToken } from './api';
import { joinBoard, leaveBoard } from './socket';

/** 回收站 — 列出已删条目，支持恢复（后端 /boards/:id/recycle-bin） */
function TrashView({ boardId }: { boardId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  const load = () => api.recycleBin(boardId)
    .then((d: any) => setRows(Array.isArray(d) ? d : []))
    .catch((e) => setMsg((e as Error).message));
  useEffect(() => { load(); }, [boardId]);

  const restore = async (ids: string[]) => {
    try {
      await api.restoreItems(boardId, ids);
      setMsg(`已恢复 ${ids.length} 条`);
      load();
    } catch (e) { setMsg(`恢复失败：${(e as Error).message}`); }
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>🗑 回收站（{rows.length}）</div>
      {msg && <div style={{ background: '#eef1fe', color: '#4f6ef7', borderRadius: 8, padding: '7px 12px',
        fontSize: 12, marginBottom: 10 }}>{msg}</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
          background: '#fff', borderRadius: 10, border: '1px solid #e6e8ef', marginBottom: 8 }}>
          <span style={{ flex: 1, fontSize: 13 }}>{r.name}</span>
          <span style={{ color: '#7a7f8c', fontSize: 12 }}>
            删除于 {new Date(r.deleted_at).toLocaleString('zh-CN')}</span>
          <button onClick={() => restore([r.id])} style={{ padding: '5px 12px', borderRadius: 7,
            border: '1px solid #e6e8ef', background: '#fff', cursor: 'pointer', fontSize: 12 }}>恢复</button>
        </div>
      ))}
      {rows.length === 0 && !msg && (
        <div style={{ color: '#7a7f8c', fontSize: 13 }}>回收站是空的</div>
      )}
    </div>
  );
}

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
  const [view, setView] = useState<'table' | 'kanban' | 'calendar' | 'gantt' | 'workload' | 'dashboard' | 'trash'>('table');
  const { aiOpen, toggleAI } = useUi();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activeBoard, setActiveBoard] = useState<{ id: string; name: string } | null>(null);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null>(() =>
    getToken() ? { id: localStorage.getItem('userId') ?? '', name: '', email: '' } : null);
  const setBoard = useItems((s) => s.setBoard);
  const groups = useItems((s) => s.groups);

  // 登录后自动打开第一个可见 Board
  useEffect(() => {
    if (!user || activeBoard) return;
    api.getBoards().then((bs) => {
      if (Array.isArray(bs) && bs.length) setActiveBoard({ id: bs[0].id, name: bs[0].name });
    }).catch(() => {});
  }, [user?.id, activeBoard?.id]);

  // 加载当前 Board 数据 + 订阅实时推送
  useEffect(() => {
    if (!user || !activeBoard?.id) return;
    const boardId = activeBoard.id;
    api.getBoard(boardId as string).then((d: any) => setBoard(d.items ?? [], d.columns ?? [], d.groups ?? [], d.myRole)).catch(() => {});
    // P1-4：读取我的 board 偏好 → 应用默认视图（仅本人生效）
    api.getPrefs(boardId as string).then((p: any) => {
      const dv = p?.default_view;
      if (dv && ['table', 'kanban', 'calendar', 'gantt', 'workload', 'dashboard'].includes(dv)) setView(dv);
    }).catch(() => {});
    joinBoard(boardId);
    return () => leaveBoard(boardId);
  }, [user?.id, activeBoard?.id]);

  if (!user) return <Login onLogin={setUser} />;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f6f7fb' }}>
      <header style={{ height: 52, background: '#fff', borderBottom: '1px solid #e6e8ef', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: '#4f6ef7' }}>Manday</div>
        <nav style={{ display: 'flex', gap: 4 }}>
          {(['table', 'kanban', 'calendar', 'gantt', 'workload', 'dashboard', 'trash'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
                background: view === v ? '#eef1fe' : 'transparent', color: view === v ? '#4f6ef7' : '#7a7f8c',
                fontWeight: view === v ? 600 : 400 }}>
              {v === 'table' ? '▤ 表格' : v === 'kanban' ? '▦ 看板' : v === 'calendar' ? '📅 日历' : v === 'gantt' ? '📈 甘特' : v === 'workload' ? '🧑‍💼 Workload' : v === 'dashboard' ? '📊 Dashboard' : '🗑 回收站'}
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
          {!activeBoard ? (
            <div style={{ padding: 48, color: '#7a7f8c', fontSize: 14 }}>← 从左侧选择一个 Board，或新建一个</div>
          ) : view === 'table' ? <BoardTable boardId={activeBoard.id} onOpenItem={setDetailId} />
            : view === 'kanban' ? <Kanban groups={groups.length ? groups.map((g) => ({ id: g.id, name: g.name })) : [{ id: 'default', name: '全部条目' }]} boardId={activeBoard.id} />
            : view === 'calendar' ? <CalendarView onOpenItem={setDetailId} />
            : view === 'gantt' ? <GanttView onOpenItem={setDetailId} />
            : view === 'workload' ? <WorkloadView onOpenItem={setDetailId} />
            : view === 'trash' ? <TrashView boardId={activeBoard.id} /> : <DashboardPage boardIds={[activeBoard.id]} />}
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
            if (d) { setBoard(d.items, d.columns, (d as any).groups, d.myRole); setActiveBoard({ id: boardId, name: '新 Board' }); }
          }} />
      )}
    </div>
  );
}
