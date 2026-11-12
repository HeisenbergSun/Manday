/**
 * 新建 Board 弹窗 — 模板中心前端（5 套模板一键实例化）
 * 所有请求走 api 封装（带 Authorization）+ 非数组响应兜底
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

interface Tpl { key: string; name: string; description: string; groups: string[]; }

export function NewBoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (boardId: string) => void }) {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [selected, setSelected] = useState<string>('project');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.templates()
      .then((d: any) => {
        const list: Tpl[] = Array.isArray(d) ? d : Array.isArray(d?.templates) ? d.templates : [];
        setTpls(list);
        if (list.length && !list.some((t) => t.key === selected)) setSelected(list[0].key);
      })
      .catch((e) => setErr(`模板加载失败：${(e as Error).message}`));
  }, []);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r: any = await api.instantiateTemplate(selected, name.trim());
      const boardId = r?.boardId ?? r?.id;
      if (!boardId) throw new Error('模板创建未返回 Board ID');
      onCreated(boardId);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
      zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 620, background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 16px 48px rgba(0,0,0,.2)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>新建 Board</div>
        <div style={{ fontSize: 12, color: '#7a7f8c', marginBottom: 16 }}>建议从模板开始，保持团队结构一致</div>

        {err && <div style={{ background: '#fff1f0', color: '#e2445c', borderRadius: 8, padding: '8px 12px',
          fontSize: 12, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {tpls.map((t) => (
            <div key={t.key} onClick={() => setSelected(t.key)} style={{
              border: selected === t.key ? '2px solid #4f6ef7' : '1px solid #e6e8ef',
              borderRadius: 10, padding: 12, cursor: 'pointer', background: selected === t.key ? '#eef1fe' : '#fff',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: '#7a7f8c', marginTop: 4 }}>{t.description}</div>
              <div style={{ fontSize: 11, color: '#579bfc', marginTop: 6 }}>{(t.groups ?? []).join(' · ')}</div>
            </div>
          ))}
          {tpls.length === 0 && !err && (
            <div style={{ fontSize: 12, color: '#7a7f8c', gridColumn: '1/-1' }}>模板加载中…</div>
          )}
        </div>

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Board 名称"
          style={{ width: '100%', padding: '9px 12px', border: '1px solid #e6e8ef', borderRadius: 8,
            fontSize: 14, outline: 'none', marginBottom: 14, boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e6e8ef',
            background: 'none', cursor: 'pointer', fontSize: 13 }}>取消</button>
          <button onClick={create} disabled={busy} style={{ padding: '8px 16px', borderRadius: 8, border: 'none',
            background: busy ? '#a9b6fb' : '#4f6ef7', color: '#fff',
            cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 500 }}>
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
