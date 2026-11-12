/**
 * 条目详情侧边栏 — 评论 / 子任务 / 变更历史 三个 tab
 * 复用列渲染器注册表展示字段值
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

type Tab = 'updates' | 'subitems' | 'history';

export function ItemDetail({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('updates');
  const [data, setData] = useState<any>({ updates: [], subitems: [], history: [] });
  const [draft, setDraft] = useState('');

  useEffect(() => {
    (async () => {
      const [updates, subitems, history] = await Promise.all([
        fetch(`/api/items/${itemId}/updates`).then((r) => r.json()),
        fetch(`/api/items/${itemId}/subitems`).then((r) => r.json()),
        fetch(`/api/items/${itemId}/history`).then((r) => r.json()),
      ]);
      setData({ updates, subitems, history });
    })();
  }, [itemId]);

  async function postUpdate() {
    if (!draft.trim()) return;
    await fetch(`/api/items/${itemId}/updates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: draft }),
    });
    setDraft('');
    const updates = await fetch(`/api/items/${itemId}/updates`).then((r) => r.json());
    setData((d: any) => ({ ...d, updates }));
  }

  return (
    <aside style={{ width: 420, background: '#fff', borderLeft: '1px solid #e6e8ef', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #e6e8ef', display: 'flex', gap: 8, alignItems: 'center' }}>
        {(['updates', 'subitems', 'history'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13,
            background: tab === t ? '#eef1fe' : 'transparent', color: tab === t ? '#4f6ef7' : '#7a7f8c',
          }}>
            {{ updates: '动态', subitems: '子任务', history: '历史' }[t]}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', cursor: 'pointer', color: '#7a7f8c' }} onClick={onClose}>✕</span>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {tab === 'updates' && data.updates.map((u: any) => (
          <div key={u.id} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#579bfc', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {u.author.name[0]}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              <b>{u.author.name}</b> <span style={{ color: '#7a7f8c', fontSize: 11 }}>{new Date(u.created_at).toLocaleString('zh-CN')}</span>
              <div>{u.body}</div>
            </div>
          </div>
        ))}

        {tab === 'subitems' && data.subitems.map((s: any) => (
          <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid #e6e8ef', fontSize: 13 }}>☐ {s.name}</div>
        ))}

        {tab === 'history' && data.history.map((h: any, i: number) => (
          <div key={i} style={{ fontSize: 12, color: '#7a7f8c', padding: '6px 0', borderBottom: '1px dashed #e6e8ef' }}>
            <b style={{ color: '#25272c' }}>{h.actor ?? '系统'}</b> {h.action}
            {h.source === 'ai' && <span style={{ color: '#9d3dd7', marginLeft: 6, fontSize: 11 }}>AI 操作</span>}
            <div style={{ marginTop: 2 }}>{new Date(h.created_at).toLocaleString('zh-CN')}</div>
          </div>
        ))}
      </div>

      {tab === 'updates' && (
        <div style={{ padding: 12, borderTop: '1px solid #e6e8ef' }}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="写更新，@ 提及同事…"
            style={{ width: '100%', height: 56, border: '1px solid #e6e8ef', borderRadius: 8, padding: 8, fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit' }} />
          <button onClick={postUpdate} style={{ float: 'right', marginTop: 6, padding: '6px 14px', borderRadius: 7, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 13 }}>发布</button>
        </div>
      )}
    </aside>
  );
}
