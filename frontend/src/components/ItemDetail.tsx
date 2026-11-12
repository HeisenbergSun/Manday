/**
 * 条目详情侧边栏 — 评论 / 子任务 / 变更历史 三个 tab
 * 所有请求统一走 api 封装（带 Authorization），并对非数组响应做兜底
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

type Tab = 'updates' | 'subitems' | 'history';

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

export function ItemDetail({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('updates');
  const [data, setData] = useState<{ updates: any[]; subitems: any[]; history: any[] }>({
    updates: [], subitems: [], history: [],
  });
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState('');
  const [item, setItem] = useState<any>(null);

  const load = async () => {
    setErr('');
    try {
      const [updates, subitems, history] = await Promise.all([
        api.itemUpdates(itemId).catch(() => []),
        api.itemSubitems(itemId).catch(() => []),
        api.itemHistory(itemId).catch(() => []),
      ]);
      setData({ updates: arr(updates), subitems: arr(subitems), history: arr(history) });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    api.item(itemId).then(setItem).catch(() => setItem(null));
  }, [itemId]);

  async function postUpdate() {
    if (!draft.trim()) return;
    const text = draft;
    setDraft('');
    try {
      await api.addItemUpdate(itemId, text);
      setData((d) => ({ ...d, updates: [...d.updates] }));
      await load();
    } catch (e) {
      setErr((e as Error).message);
      setDraft(text);
    }
  }

  const authorName = (u: any) => u?.author?.name ?? u?.author_name ?? '成员';

  return (
    <aside style={{ width: 420, background: '#fff', borderLeft: '1px solid #e6e8ef', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #e6e8ef' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {(['updates', 'subitems', 'history'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13,
              background: tab === t ? '#eef1fe' : 'transparent', color: tab === t ? '#4f6ef7' : '#7a7f8c',
            }}>
              {{ updates: '动态', subitems: '子任务', history: '历史' }[t]}
            </button>
          ))}
          <button onClick={onClose} title="关闭" style={{
            marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer',
            color: '#7a7f8c', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
        {item?.name && (
          <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: '#25272c' }}>{item.name}</div>
        )}
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {err && <div style={{ color: '#e2445c', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        {tab === 'updates' && data.updates.map((u: any, i: number) => (
          <div key={u.id ?? i} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#579bfc', color: '#fff',
              fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {(authorName(u) || '?')[0]}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              <b>{authorName(u)}</b>
              {u.created_at && <span style={{ color: '#7a7f8c', fontSize: 11, marginLeft: 6 }}>
                {new Date(u.created_at).toLocaleString('zh-CN')}</span>}
              <div style={{ whiteSpace: 'pre-wrap' }}>{u.body}</div>
            </div>
          </div>
        ))}
        {tab === 'updates' && data.updates.length === 0 && (
          <div style={{ color: '#7a7f8c', fontSize: 12 }}>还没有动态，写下第一条吧</div>
        )}

        {tab === 'subitems' && data.subitems.map((s: any, i: number) => (
          <div key={s.id ?? i} style={{ padding: '8px 0', borderBottom: '1px solid #e6e8ef', fontSize: 13 }}>
            ☐ {s.name}
          </div>
        ))}
        {tab === 'subitems' && data.subitems.length === 0 && (
          <div style={{ color: '#7a7f8c', fontSize: 12 }}>暂无子任务</div>
        )}

        {tab === 'history' && data.history.map((h: any, i: number) => (
          <div key={i} style={{ fontSize: 12, color: '#7a7f8c', padding: '6px 0', borderBottom: '1px dashed #e6e8ef' }}>
            <b style={{ color: '#25272c' }}>{h.actor ?? '系统'}</b> {h.action ?? h.type}
            {h.source === 'ai' && <span style={{ color: '#9d3dd7', marginLeft: 6, fontSize: 11 }}>AI 操作</span>}
            {h.created_at && <div style={{ marginTop: 2 }}>{new Date(h.created_at).toLocaleString('zh-CN')}</div>}
          </div>
        ))}
        {tab === 'history' && data.history.length === 0 && (
          <div style={{ color: '#7a7f8c', fontSize: 12 }}>暂无变更记录</div>
        )}
      </div>

      {tab === 'updates' && (
        <div style={{ padding: 12, borderTop: '1px solid #e6e8ef' }}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="写更新，@ 提及同事…"
            style={{ width: '100%', height: 56, border: '1px solid #e6e8ef', borderRadius: 8, padding: 8,
              fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <button onClick={postUpdate} style={{ float: 'right', marginTop: 6, padding: '6px 14px', borderRadius: 7,
            border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 13 }}>发布</button>
        </div>
      )}
    </aside>
  );
}
