/**
 * 条目详情侧边栏 — 评论 / 子任务 / 变更历史 三个 tab
 * 所有请求统一走 api 封装（带 Authorization），并对非数组响应做兜底
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

type Tab = 'updates' | 'subitems' | 'history';

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** 审计 action → 中文句子片段（五段式历史的“改了什么”段） */
function historyActionText(h: any): string {
  const map: Record<string, string> = {
    'cell.update': '修改了单元格', 'cell.create': '填写了单元格',
    'item.create': '创建了条目', 'item.rename': '重命名了条目',
    'item.delete': '删除了条目', 'item.restore': '恢复了条目',
    'column.create': '添加了列', 'column.rename': '重命名了列',
    'subitem.create': '添加了子任务', 'subitem.done': '勾选了子任务',
  };
  const a = String(h.action ?? '');
  if (map[a]) return map[a];
  if (a.includes('cell')) return `更新了 ${h.field ?? '字段'}`;
  return a || '有变更';
}

export function ItemDetail({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('updates');
  const [data, setData] = useState<{ updates: any[]; subitems: any[]; history: any[] }>({
    updates: [], subitems: [], history: [],
  });
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState('');
  const [subDraft, setSubDraft] = useState('');
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

  /** 新建子任务 */
  async function addSubitem() {
    const name = subDraft.trim();
    if (!name) return;
    setSubDraft('');
    try {
      await api.addSubitem(itemId, name);
      await load();
    } catch (e) {
      setErr(`创建子任务失败：${(e as Error).message}`);
      setSubDraft(name);
    }
  }

  /** 勾选/取消子任务完成 */
  async function toggleSub(s: any) {
    // 乐观更新，失败回滚
    setData((d) => ({ ...d, subitems: d.subitems.map((x) => x.id === s.id ? { ...x, done: !x.done } : x) }));
    try {
      await api.updateItem(s.id, { done: !s.done });
    } catch (e) {
      setErr(`更新失败：${(e as Error).message}`);
      await load();
    }
  }

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
          <div key={s.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #e6e8ef', fontSize: 13 }}>
            <input type="checkbox" checked={!!s.done} onChange={() => toggleSub(s)}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#00c875' }} />
            <span style={s.done ? { textDecoration: 'line-through', color: '#a0a4b1' } : undefined}>{s.name}</span>
          </div>
        ))}
        {tab === 'subitems' && data.subitems.length === 0 && (
          <div style={{ color: '#7a7f8c', fontSize: 12 }}>暂无子任务</div>
        )}

        {tab === 'history' && data.history.map((h: any, i: number) => (
          <div key={i} style={{ fontSize: 12, color: '#7a7f8c', padding: '6px 0', borderBottom: '1px dashed #e6e8ef' }}>
            {/* 五段式历史：谁 / 何时 / 改了什么 / 从什么 / 到什么 */}
            <b style={{ color: '#25272c' }}>{h.actor ?? '系统'}</b>{' '}
            {historyActionText(h)}
            {h.before_val != null && h.before_val !== '' && (
              <span style={{ marginLeft: 4 }}>从 <code style={{ background: '#f3f4f9', borderRadius: 4, padding: '0 4px' }}>{String(h.before_val)}</code></span>
            )}
            {h.after_val != null && h.after_val !== '' && (
              <span style={{ marginLeft: 4 }}>{h.before_val != null && h.before_val !== '' ? '改为' : '设为'} <code style={{ background: '#eef1fe', borderRadius: 4, padding: '0 4px', color: '#4f6ef7' }}>{String(h.after_val)}</code></span>
            )}
            {h.source === 'ai' && <span style={{ color: '#9d3dd7', marginLeft: 6, fontSize: 11 }}>AI 操作</span>}
            {h.created_at && <div style={{ marginTop: 2 }}>{new Date(h.created_at).toLocaleString('zh-CN')}</div>}
          </div>
        ))}
        {tab === 'history' && data.history.length === 0 && (
          <div style={{ color: '#7a7f8c', fontSize: 12 }}>暂无变更记录</div>
        )}
      </div>

      {tab === 'subitems' && (
        <div style={{ padding: 12, borderTop: '1px solid #e6e8ef', display: 'flex', gap: 6 }}>
          <input value={subDraft} onChange={(e) => setSubDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addSubitem(); }}
            placeholder="新建子任务，回车添加"
            style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13, outline: 'none' }} />
          <button onClick={addSubitem} disabled={!subDraft.trim()}
          style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: subDraft.trim() ? '#4f6ef7' : '#c5c9d4',
            color: '#fff', cursor: 'pointer', fontSize: 13 }}>添加</button>
        </div>
      )}

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
