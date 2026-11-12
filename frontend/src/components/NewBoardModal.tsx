/**
 * 新建 Board 弹窗 — 模板中心前端（5 套模板一键实例化）
 */
import { useEffect, useState } from 'react';

interface Tpl { key: string; name: string; description: string; groups: string[]; }

export function NewBoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (boardId: string) => void }) {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [selected, setSelected] = useState<string>('project');
  const [name, setName] = useState('');

  useEffect(() => {
    fetch('/api/templates').then((r) => r.json()).then(setTpls);
  }, []);

  async function create() {
    if (!name.trim()) return;
    const r = await fetch(`/api/templates/${selected}/instantiate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => r.json());
    onCreated(r.boardId);
    onClose();
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
      zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 620, background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 16px 48px rgba(0,0,0,.2)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>新建 Board</div>
        <div style={{ fontSize: 12, color: '#7a7f8c', marginBottom: 16 }}>建议从模板开始，保持团队结构一致</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {tpls.map((t) => (
            <div key={t.key} onClick={() => setSelected(t.key)} style={{
              border: selected === t.key ? '2px solid #4f6ef7' : '1px solid #e6e8ef',
              borderRadius: 10, padding: 12, cursor: 'pointer', background: selected === t.key ? '#eef1fe' : '#fff',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: '#7a7f8c', marginTop: 4 }}>{t.description}</div>
              <div style={{ fontSize: 11, color: '#579bfc', marginTop: 6 }}>{t.groups.join(' · ')}</div>
            </div>
          ))}
        </div>

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Board 名称"
          style={{ width: '100%', padding: '9px 12px', border: '1px solid #e6e8ef', borderRadius: 8,
            fontSize: 14, outline: 'none', marginBottom: 14 }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e6e8ef',
            background: 'none', cursor: 'pointer', fontSize: 13 }}>取消</button>
          <button onClick={create} style={{ padding: '8px 16px', borderRadius: 8, border: 'none',
            background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>创建</button>
        </div>
      </div>
    </div>
  );
}
