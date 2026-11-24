/**
 * 条目详情侧边栏 — 评论 / 子任务 / 变更历史 三个 tab
 * 所有请求统一走 api 封装（带 Authorization），并对非数组响应做兜底
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

type Tab = 'info' | 'updates' | 'subitems' | 'history';

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** P3-3 评论正文渲染：@提及的名字（后端 mentions 已解析）渲染为蓝色 chip */
function MentionText({ body, mentions }: { body: string; mentions: { id: string; name: string }[] }) {
  const names = new Set((mentions ?? []).map((m) => m.name));
  if (!names.size) return <>{body}</>;
  const parts = body.split(/(@[\p{Script=Han}\w]+)/gu);
  return <>
    {parts.map((p, i) =>
      p.startsWith('@') && names.has(p.slice(1))
        ? <span key={i} data-mention-chip={p.slice(1)} style={{ background: '#eef1fe', color: '#4f6ef7', borderRadius: 6, padding: '0 5px', fontSize: 12 }}>{p}</span>
        : <span key={i}>{p}</span>,
    )}
  </>;
}

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
  const [tab, setTab] = useState<Tab>('info');
  const [data, setData] = useState<{ updates: any[]; subitems: any[]; history: any[] }>({
    updates: [], subitems: [], history: [],
  });
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState('');
  // P3-3 @补全：输入 @xxx 时弹成员下拉；mentionUsers 全员名单（listUsers 懒加载一次）
  const [mentionUsers, setMentionUsers] = useState<{ id: string; name: string }[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null=关闭，''=刚输入 @
  const [draftRef] = useState<{ el: HTMLTextAreaElement | null }>({ el: null });
  const [subDraft, setSubDraft] = useState('');
  const [item, setItem] = useState<any>(null);
  // 信息 tab：列定义 + 公司成员（people 列用）
  const [columns, setColumns] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const refreshItem = async () => {
    const fresh = await api.item(itemId).catch(() => null);
    if (fresh) setItem(fresh);
  };

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
    api.item(itemId).then((it) => {
      setItem(it);
      setNameDraft(it?.name ?? '');
      if (it?.board_id) {
        api.getBoard(it.board_id).then((b: any) => setColumns(Array.isArray(b?.columns) ? b.columns : [])).catch(() => {});
      }
    }).catch(() => setItem(null));
    api.listUsers().then((us: any) => setUsers(Array.isArray(us) ? us : [])).catch(() => {});
  }, [itemId]);

  /** 保存条目名 */
  const saveName = async () => {
    setNameEditing(false);
    const name = nameDraft.trim();
    if (!name || name === item?.name) return;
    try {
      await api.updateItem(itemId, { name });
      await refreshItem();
    } catch (e) { setErr(`改名失败：${(e as Error).message}`); }
  };

  /** 保存字段值（LWW），成功后刷新拿最新 version */
  const saveField = async (colId: string, value: unknown) => {
    try {
      await api.updateCell(itemId, colId, value, item?.version ?? 1);
      await refreshItem();
    } catch (e) { setErr(`保存失败：${(e as Error).message}`); }
  };

  /** P3-3：光标前解析 @xxx（未闭合），拉全员名单供补全 */
  const onDraftChange = (e: any) => {
    const v = e.target.value;
    const caret = e.target.selectionStart ?? v.length;
    setDraft(v);
    draftRef.el = e.target;
    const m = v.slice(0, caret).match(/@([^\s@]*)$/);
    if (m) {
      setMentionQuery(m[1]);
      if (!mentionUsers.length) api.listUsers().then((us: any) => setMentionUsers(arr(us).map((u) => ({ id: u.id, name: u.name })))).catch(() => {});
    } else setMentionQuery(null);
  };

  /** P3-3：补全选择 → 替换未闭合的 @query 为 @全名 + 空格 */
  const pickMention = (name: string) => {
    const el = draftRef.el;
    const caret = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@([^\s@]*)$/, `@${name} `);
    setDraft(before + draft.slice(caret));
    setMentionQuery(null);
    setTimeout(() => el?.focus(), 0);
  };

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

  // 信息 tab：可编辑列（排除只读/系统维护列）
  const editableCols = columns.filter((c: any) => !['formula', 'mirror', 'dependency', 'attachment'].includes(c.type));
  /** people/tags 值可能是 JSON 数组字符串或数组，统一解析为 string[] */
  const cellArr = (colId: string): string[] => {
    const v = item?.values?.[colId];
    if (v == null) return [];
    if (Array.isArray(v)) return v.map(String);
    try { const j = JSON.parse(String(v)); return Array.isArray(j) ? j.map(String) : [String(v)]; } catch { return [String(v)]; }
  };
  const cellStr = (colId: string): string => {
    const v = item?.values?.[colId];
    return v == null ? '' : String(v);
  };
  const cellBool = (colId: string): boolean => {
    const v = item?.values?.[colId];
    return v === true || v === 'true' || v === 1 || v === '1';
  };

  return (
    <aside data-item-detail="1" style={{ width: 420, background: '#fff', borderLeft: '1px solid #e6e8ef', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #e6e8ef' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {(['info', 'updates', 'subitems', 'history'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13,
              background: tab === t ? '#eef1fe' : 'transparent', color: tab === t ? '#4f6ef7' : '#7a7f8c',
            }}>
              {{ info: '信息', updates: '动态', subitems: '子任务', history: '历史' }[t]}
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

        {tab === 'info' && (
          <div data-item-info="1">
            <div style={{ fontSize: 12, color: '#5a6072', marginBottom: 4 }}>条目名称</div>
            {nameEditing ? (
              <input data-item-name-input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setNameEditing(false); }}
                style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #4f6ef7', fontSize: 14, fontWeight: 600, outline: 'none', marginBottom: 14, boxSizing: 'border-box' }} />
            ) : (
              <div data-item-name onClick={() => setNameEditing(true)} title="点击重命名"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 14, fontWeight: 600, cursor: 'text', marginBottom: 14 }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item?.name ?? '（无名称）'}</span>
                <span style={{ color: '#a0a4b1', fontSize: 12 }}>✎</span>
              </div>
            )}

            {editableCols.map((c: any) => (
              <div key={c.id} data-item-field={c.id} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: '#5a6072', marginBottom: 4 }}>{c.name}</div>
                {c.type === 'checkbox' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={cellBool(c.id)} onChange={(e) => saveField(c.id, e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: '#00c875', cursor: 'pointer' }} />
                    <span style={{ color: '#7a7f8c' }}>{cellBool(c.id) ? '是' : '否'}</span>
                  </label>
                ) : c.type === 'status' ? (
                  <select data-item-field-select value={cellStr(c.id)} onChange={(e) => saveField(c.id, e.target.value)}
                    style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
                    <option value="">— 未设置 —</option>
                    {((c.settings?.labels ?? []) as any[]).filter((l: any) => !((c.settings?.inactiveLabels ?? []) as string[]).includes(l.label))
                      .map((l: any) => <option key={l.label} value={l.label}>{l.label}</option>)}
                  </select>
                ) : c.type === 'dropdown' ? (
                  <select value={cellStr(c.id)} onChange={(e) => saveField(c.id, e.target.value)}
                    style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
                    <option value="">— 未设置 —</option>
                    {((c.settings?.options ?? []) as any[]).map((o: any) => <option key={o.label} value={o.label}>{o.label}</option>)}
                  </select>
                ) : c.type === 'people' ? (
                  <select value={cellArr(c.id)[0] ?? ''} onChange={(e) => saveField(c.id, e.target.value ? [e.target.value] : [])}
                    style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
                    <option value="">— 未分配 —</option>
                    {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                ) : c.type === 'date' ? (
                  <input type="date" value={cellStr(c.id).slice(0, 10)} onChange={(e) => saveField(c.id, e.target.value)}
                    style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }} />
                ) : c.type === 'rating' ? (
                  <select value={cellStr(c.id)} onChange={(e) => saveField(c.id, Number(e.target.value))}
                    style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
                    <option value="">— 未评分 —</option>
                    {Array.from({ length: Number(c.settings?.max ?? 5) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{'\u2605'.repeat(n)}</option>)}
                  </select>
                ) : c.type === 'tags' ? (
                  <input defaultValue={cellArr(c.id).join(', ')} onBlur={(e) => saveField(c.id, e.target.value.split(/[,，;；]/).map((s: string) => s.trim()).filter(Boolean))}
                    placeholder="逗号分隔多个标签" style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }} />
                ) : c.type === 'number' ? (
                  <input type="number" defaultValue={cellStr(c.id)} onBlur={(e) => saveField(c.id, e.target.value)}
                    style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }} />
                ) : (
                  <input defaultValue={cellStr(c.id)} onBlur={(e) => saveField(c.id, e.target.value)}
                    placeholder="未设置" style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }} />
                )}
              </div>
            ))}
            {editableCols.length === 0 && (
              <div style={{ color: '#a0a4b1', fontSize: 12 }}>这个 Board 还没有可编辑的列</div>
            )}
          </div>
        )}

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
              <div style={{ whiteSpace: 'pre-wrap' }}><MentionText body={u.body} mentions={u.mentions} /></div>
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
        <div style={{ padding: 12, borderTop: '1px solid #e6e8ef', position: 'relative' }}>
          <textarea data-comment-input value={draft} onChange={onDraftChange} placeholder="写更新，@ 提及同事…"
            style={{ width: '100%', height: 56, border: '1px solid #e6e8ef', borderRadius: 8, padding: 8,
              fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          {mentionQuery !== null && (
            <div data-mention-menu style={{ position: 'absolute', left: 12, bottom: 84, width: 220, maxHeight: 180,
              overflowY: 'auto', background: '#fff', border: '1px solid #e6e8ef', borderRadius: 8,
              boxShadow: '0 4px 14px rgba(37,39,44,.12)', zIndex: 10 }}>
              {arr(mentionUsers).filter((u) => u.name.includes(mentionQuery)).map((u) => (
                <div key={u.id} data-mention-option={u.name} onClick={() => pickMention(u.name)}
                  style={{ padding: '7px 10px', fontSize: 13, color: '#25272c', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f9')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  @{u.name}
                </div>
              ))}
              {arr(mentionUsers).filter((u) => u.name.includes(mentionQuery)).length === 0 && (
                <div style={{ padding: '7px 10px', fontSize: 12, color: '#a0a4b1' }}>无匹配成员</div>
              )}
            </div>
          )}
          <button onClick={postUpdate} style={{ float: 'right', marginTop: 6, padding: '6px 14px', borderRadius: 7,
            border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 13 }}>发布</button>
        </div>
      )}
    </aside>
  );
}
