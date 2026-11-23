import { useEffect, useState } from 'react';
import { useToast } from './store';
import { BoardTable } from './components/BoardTable';
import { Kanban } from './components/Kanban';
import { CalendarView } from './components/CalendarView';
import { GanttView } from './components/GanttView';
import { WorkloadView } from './components/WorkloadView';
import { InsightsView } from './components/InsightsView';
import { AiSidebar } from './components/AiSidebar';
import { ItemDetail } from './components/ItemDetail';
import { NotificationBell, CommandPalette } from './components/TopWidgets';
import { WorkspaceNav } from './components/WorkspaceNav';
import { DashboardPage } from './components/DashboardPage';
import { DashboardEditor } from './components/DashboardEditor';
import { NewBoardModal } from './components/NewBoardModal';
import { OnboardingModal } from './components/OnboardingModal';
import { Icon } from './components/Icons';

/** 视图导航配置（SVG 图标 + 文案） */
const VIEWS = [
  { id: 'table', icon: 'table', label: '表格' },
  { id: 'kanban', icon: 'kanban', label: '看板' },
  { id: 'calendar', icon: 'calendar', label: '日历' },
  { id: 'gantt', icon: 'gantt', label: '甘特' },
  { id: 'workload', icon: 'users', label: 'Workload' },
  { id: 'insights', icon: 'chart', label: '分析' },
  { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { id: 'trash', icon: 'trash', label: '回收站' },
] as const;
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
      <div style={{ width: 360, background: '#fff', borderRadius: 16, padding: 36, boxShadow: '0 12px 40px rgba(20,30,70,.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#4f6ef7,#7b5cf0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18, boxShadow: '0 3px 10px rgba(79,110,247,.35)' }}>M</div>
          <div style={{ fontWeight: 800, fontSize: 22, color: '#25272c', letterSpacing: .3 }}>Manday</div>
        </div>
        <div style={{ color: '#7a7f8c', fontSize: 13, marginBottom: 26 }}>轻量版工作管理平台</div>
        <button onClick={devLogin} disabled={busy}
          style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#4f6ef7,#5b7cf6)', color: '#fff',
            fontSize: 15, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', boxShadow: '0 4px 12px rgba(79,110,247,.3)' }}>
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
  const [view, setView] = useState<'table' | 'kanban' | 'calendar' | 'gantt' | 'workload' | 'insights' | 'dashboard' | 'trash'>('table');
  const { aiOpen, toggleAI } = useUi();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activeBoard, setActiveBoard] = useState<{ id: string; name: string } | null>(null);
  const [allBoards, setAllBoards] = useState<any[]>([]);
  const [workspaceDashboard, setWorkspaceDashboard] = useState(false);
  const [activeDashboardId, setActiveDashboardId] = useState<string | null>(null);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  // #65 移动端侧边抽屉
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // P2-1：首次登录问卷引导（每用户只出现一次）
  const [onboarding, setOnboarding] = useState(false);
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null>(() =>
    getToken() ? { id: localStorage.getItem('userId') ?? '', name: '', email: '' } : null);
  useEffect(() => {
    if (!user?.id) return;
    if (localStorage.getItem('manday_onboarded_' + user.id)) return;
    // 只有「零看板」的新用户才弹问卷——老用户（已有看板）不打扰
    api.getBoards().then((list: any[]) => { if (Array.isArray(list) && list.length === 0) setOnboarding(true); }).catch(() => {});
  }, [user?.id]);
  const setBoard = useItems((s) => s.setBoard);
  const setLoading = useItems((s) => s.setLoading);
  const groups = useItems((s) => s.groups);

  // 登录后加载所有可见 Board + 自动打开第一个
  useEffect(() => {
    if (!user || activeBoard) return;
    api.getBoards().then((bs) => {
      if (Array.isArray(bs)) {
        setAllBoards(bs);
        if (bs.length) setActiveBoard({ id: bs[0].id, name: bs[0].name });
      }
    }).catch(() => {});
  }, [user?.id, activeBoard?.id]);

  // 加载当前 Board 数据 + 订阅实时推送
  useEffect(() => {
    if (!user || !activeBoard?.id) return;
    const boardId = activeBoard.id;
    setLoading(true);
    api.getBoard(boardId as string)
      .then((d: any) => setBoard(d.items ?? [], d.columns ?? [], d.groups ?? [], d.myRole))
      .catch(() => {})
      .finally(() => setLoading(false));
    // P1-4：读取我的 board 偏好 → 应用默认视图（仅本人生效）
    api.getPrefs(boardId as string).then((p: any) => {
      const dv = p?.default_view;
      if (dv && ['table', 'kanban', 'calendar', 'gantt', 'workload', 'insights', 'dashboard'].includes(dv)) setView(dv);
    }).catch(() => {});
    joinBoard(boardId);
    return () => leaveBoard(boardId);
  }, [user?.id, activeBoard?.id]);

  // #60 断线重连后全量 refetch：补齐断线期间错过的变更
  useEffect(() => {
    const onReconnected = () => {
      if (!user || !activeBoard?.id) return;
      api.getBoard(activeBoard.id)
        .then((d: any) => setBoard(d.items ?? [], d.columns ?? [], d.groups ?? [], d.myRole))
        .catch(() => {});
    };
    window.addEventListener('manday:reconnected', onReconnected);
    return () => window.removeEventListener('manday:reconnected', onReconnected);
  }, [user?.id, activeBoard?.id]);

  if (!user) return <Login onLogin={setUser} />;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f6f7fb' }}>
      {/* #65 移动端适配样式 */}
      <style>{`
        [data-mobile-burger] { display: none; }
        @media (max-width: 768px) {
          [data-mobile-burger] { display: inline-flex; }
          [data-sidenav] { position: fixed; left: 0; top: 52px; bottom: 0; z-index: 90;
            transform: translateX(-100%); transition: transform .2s; background: #fff;
            box-shadow: 4px 0 20px rgba(0,0,0,.12); }
          [data-sidenav].open { transform: none; }
          [data-sidenav-overlay] { display: none; }
          [data-sidenav-overlay].open { display: block; position: fixed; inset: 0; top: 52px; z-index: 80; background: rgba(15,18,30,.28); }
          header nav { overflow-x: auto; max-width: 55vw; }
          header [data-desktop-hint] { display: none !important; }
        }
      `}</style>
      <header style={{ height: 52, background: '#fff', borderBottom: '1px solid #e6e8ef', boxShadow: '0 1px 3px rgba(20,30,70,.04)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16 }}>
        <button data-mobile-burger onClick={() => setMobileNavOpen((v) => !v)}
          style={{ padding: '5px 9px', borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff',
            cursor: 'pointer', fontSize: 15, alignItems: 'center' }}>☰</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#4f6ef7,#7b5cf0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14, boxShadow: '0 2px 8px rgba(79,110,247,.35)' }}>M</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#25272c', letterSpacing: .3 }}>Manday</div>
        </div>
        <nav style={{ display: 'flex', gap: 4 }}>
          {activeDashboardId ? (
            <button onClick={() => setActiveDashboardId(null)}
              style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
                background: '#eef1fe', color: '#4f6ef7', fontWeight: 600 }}>
              ← 返回
            </button>
          ) : workspaceDashboard || !activeBoard ? (
            <button onClick={() => { setWorkspaceDashboard(true); setActiveBoard(null); setActiveDashboardId(null); }}
              style={{ padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
                background: '#e5eaff', color: '#4f6ef7', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="workspace" size={15} />
              工作台
            </button>
          ) : (
            VIEWS.map((v) => (
              <button key={v.id} onClick={() => setView(v.id)}
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
                  background: view === v.id ? '#e5eaff' : 'transparent', color: view === v.id ? '#4f6ef7' : '#7a7f8c',
                  fontWeight: view === v.id ? 600 : 400, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name={v.icon} size={15} />
                {v.label}
              </button>
            ))
          )}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span data-desktop-hint style={{ color: '#7a7f8c', fontSize: 12 }}>⌘K 搜索</span>
          <span style={{ color: '#7a7f8c', fontSize: 12 }}>{user.name || user.email || '已登录'}</span>
          <button onClick={() => { clearToken(); localStorage.removeItem('userId'); location.reload(); }}
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff', cursor: 'pointer', fontSize: 12 }}>退出</button>
          <NotificationBell />
          <button onClick={toggleAI} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="sparkle" size={14} color="#fff" strokeWidth={2.2} />
            AI 助手
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* #65 移动端抽屉式侧边栏 */}
        <div data-sidenav-overlay className={mobileNavOpen ? 'open' : ''}
          onClick={() => setMobileNavOpen(false)} />
        <div data-sidenav className={mobileNavOpen ? 'open' : ''}
          style={{ display: 'flex', height: '100%', overflow: 'hidden', flexShrink: 0 }}>
          <WorkspaceNav activeId={activeBoard?.id} dashboardActive={workspaceDashboard} activeDashboardId={activeDashboardId}
            onOpen={(b) => { setActiveBoard(b); setWorkspaceDashboard(false); setActiveDashboardId(null); setView('table'); setMobileNavOpen(false); }}
            onOpenDashboard={() => { setWorkspaceDashboard(true); setActiveBoard(null); setActiveDashboardId(null); setMobileNavOpen(false); }}
            onOpenCustomDashboard={(id) => { setActiveDashboardId(id); setWorkspaceDashboard(false); setActiveBoard(null); setMobileNavOpen(false); }}
            onNewDashboard={() => {
              const name = prompt('Dashboard 名称');
              if (!name || !name.trim()) return;
              const team = confirm('设为团队共享 Dashboard？\n\n点「确定」= 团队共享（部门成员可见可编辑）\n点「取消」= 仅个人');
              api.createDashboard(name.trim(), team ? 'team' : 'personal').then((d: any) => { setActiveDashboardId(d.id); setWorkspaceDashboard(false); setActiveBoard(null); }).catch((e) => alert(`创建失败：${(e as Error).message}`));
            }}
            onNewBoard={() => setNewBoardOpen(true)} />
        </div>
        <main style={{ flex: 1, overflow: 'auto' }}>
          {activeDashboardId ? (
            <DashboardEditor dashboardId={activeDashboardId} onBack={() => setActiveDashboardId(null)} onOpenItem={setDetailId} />
          ) : workspaceDashboard || !activeBoard ? (
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#25272c', margin: '4px 4px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="workspace" size={18} color="#4f6ef7" />
                工作台 <span style={{ fontSize: 12, fontWeight: 400, color: '#7a7f8c' }}>· 跨 {allBoards.length} 个 Board 的全局总览</span>
              </div>
              <DashboardPage boardIds={allBoards.map((b) => b.id)} onOpenItem={(id) => setDetailId(id)} />
            </div>
          ) : view === 'table' ? <BoardTable boardId={activeBoard.id} onOpenItem={setDetailId} onSwitchView={setView as (v: string) => void } />
            : view === 'kanban' ? <Kanban groups={groups.length ? groups.map((g) => ({ id: g.id, name: g.name })) : [{ id: 'default', name: '全部条目' }]} boardId={activeBoard.id} />
            : view === 'calendar' ? <CalendarView onOpenItem={setDetailId} />
            : view === 'gantt' ? <GanttView onOpenItem={setDetailId} />
            : view === 'workload' ? <WorkloadView onOpenItem={setDetailId} />
            : view === 'insights' ? <InsightsView onOpenItem={setDetailId} />
            : view === 'trash' ? <TrashView boardId={activeBoard.id} /> : <DashboardPage boardIds={[activeBoard.id]} onOpenItem={setDetailId} />}
        </main>
        {detailId && <ItemDetail itemId={detailId} onClose={() => setDetailId(null)} />}
        {aiOpen && <AiSidebar boardId={activeBoard?.id} />}
      </div>
      <CommandPalette />
      <ToastHost />
      {onboarding && (
        <OnboardingModal userId={user?.id ?? ''}
          onDone={(boardId) => {
            setOnboarding(false);
            api.getBoard(boardId).then((d: any) => {
              setBoard(d.items ?? [], d.columns ?? [], d.groups ?? [], d.myRole);
              setActiveBoard({ id: boardId, name: '我的第一个看板' });
            }).catch(() => {});
          }} />
      )}
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

/** 统一 toast 宿主（第二十批）：右下角浮层，2.6s 自动消失 */
export function ToastHost() {
  const toasts = useToast((s) => s.toasts);
  const bg = { info: '#3a3f4d', success: '#00a25b', error: '#e2445c' } as const;
  return (
    <div data-toast-host style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map((t) => (
        <div key={t.id} data-toast-kind={t.kind}
          style={{ background: bg[t.kind], color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13,
            boxShadow: '0 4px 16px rgba(20,30,70,.25)', maxWidth: 320 }}>{t.msg}</div>
      ))}
    </div>
  );
}
