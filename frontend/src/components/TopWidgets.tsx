/**
 * 通知铃铛 + 全局搜索（Cmd+K 面板雏形）
 */
import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { Icon } from './Icons';

export function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r: any = await api.unread();
        setCount(Number(r?.count) || 0);
        setItems(Array.isArray(r?.items) ? r.items : []);
      } catch { /* 接口未就绪/未登录时不打扰用户 */ }
    };
    load();
    const t = setInterval(load, 60_000);        // 未读轮询兜底；实时推送走 WS
    return () => clearInterval(t);
  }, []);

  // 点击铃铛/弹窗外部区域时自动关闭弹窗
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (rootRef.current && !rootRef.current.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button data-bell onClick={() => setOpen(!open)} style={{
        position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: 5, display: 'inline-flex', alignItems: 'center' }}>
        <Icon name="bell" size={19} color="#5a6072" />
        {count > 0 && <span data-bell-dot style={{
          position: 'absolute', top: 3, right: 2, width: 7, height: 7, borderRadius: '50%',
          background: '#e2445c', border: '1.5px solid #fff' }} />}
      </button>
      {open && (
        <div data-notif-popover style={{ position: 'absolute', right: 0, top: 34, width: 300, background: '#fff',
          border: '1px solid #e6e8ef', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 60,
          maxHeight: 420, overflowY: 'auto' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid #e6e8ef' }}>通知</div>
          {items.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#7a7f8c', fontSize: 13 }}>没有未读</div>}
          {/* 统一落点三分区（P0-9）：提及我的 / 分配与到期 / 看板动态 */}
          {([
            ['mention', '提及我的', ['mention']],
            ['assign', '分配与到期', ['assign', 'due']],
            ['board', '看板动态', ['automation', 'daily_digest']],
          ] as [string, string, string[]][]).map(([key, title, types]) => {
            const list = items.filter((n) => types.includes(n.type));
            if (!list.length) return null;
            return (
              <div key={key}>
                <div style={{ padding: '7px 14px 3px', fontSize: 11, fontWeight: 700, color: '#a0a4b1' }}>{title}</div>
                {list.map((n: any) => (
                  <div key={n.id} style={{ padding: '8px 14px', fontSize: 12, borderBottom: '1px solid #f0f2f7' }}>
                    <b>{({ mention: '@提及', assign: '指派给我', due: '即将到期', automation: '自动化', daily_digest: '每日摘要' } as Record<string, string>)[n.type] ?? n.type}</b>
                    <span style={{ color: '#7a7f8c', marginLeft: 6 }}>{new Date(n.created_at).toLocaleDateString('zh-CN')}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Cmd+K 全局搜索（P0 标题模糊） */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const timer = useRef<any>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(!open); }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpenSearch = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('manday:open-search', onOpenSearch);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('manday:open-search', onOpenSearch);
    };
  }, [open]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!q) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r: any = await api.search(q);
        setResults(Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : []);
      } catch { setResults([]); }
    }, 200);   // 200ms debounce
  }, [q]);

  if (!open) return null;
  return (
    <div onClick={() => setOpen(false)} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 100,
      display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 520, background: '#fff', borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,.2)',
        overflow: 'hidden', height: 'fit-content' }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="搜索条目、Board…（⌘K）"
          style={{ width: '100%', border: 'none', outline: 'none', padding: '16px 18px', fontSize: 15 }} />
        {results.map((r) => (
          <div key={r.id} style={{ padding: '10px 18px', fontSize: 13, borderTop: '1px solid #f0f2f7', cursor: 'pointer' }}>
            <b>{r.name}</b>
            <span style={{ color: '#7a7f8c', marginLeft: 8, fontSize: 12 }}>{r.board_name}</span>
          </div>
        ))}
        {q && results.length === 0 && <div style={{ padding: 20, color: '#7a7f8c', fontSize: 13, textAlign: 'center' }}>无结果</div>}
      </div>
    </div>
  );
}
