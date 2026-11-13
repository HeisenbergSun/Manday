/**
 * 自动化中心（P1-9）— 句子式配置：把常用自动化写成可填空的句子，选完即创建
 * 后端复用 automation-api.module：模板 + trigger/action 白名单 + BullMQ worker
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useItems } from '../store';

/** 句子模板：每个空位是一个下拉（值映射为 trigger/action JSON） */
type SentenceSpec = {
  key: string;
  render: (ctx: { statusLabels: string[]; groups: string[] }) => { parts: (string | { options: string[]; value: string; onChange: (v: string) => void })[] };
  build: (ctx: { statusColId?: string }) => { trigger: object; action: object; name: string };
};

const STATUS_OPTIONS = ['已完成', '进行中', '未开始', '阻塞'];

function SentenceRule({ boardId, onDone, flash }: { boardId: string; onDone: () => void; flash: (s: string) => void }) {
  const { columns, groups } = useItems();
  const statusCol = columns.find((c: any) => c.type === 'status');
  const statusLabels: string[] = statusCol
    ? ((statusCol.settings?.labels ?? []) as any[])
        .filter((l: any) => !((statusCol.settings?.inactiveLabels ?? []) as string[]).includes(l.label))
        .map((l: any) => l.label)
    : [];
  const groupNames: string[] = groups.map((g: any) => g.name);

  const [when, setWhen] = useState('status_changed');
  const [to, setTo] = useState(statusLabels[0] ?? STATUS_OPTIONS[0]);
  const [days, setDays] = useState('1');
  const [then, setThen] = useState('notify');
  const [group, setGroup] = useState(groupNames[0] ?? '');
  const [busy, setBusy] = useState(false);

  const whenOptions = [
    { v: 'status_changed', label: '条目状态变为' },
    { v: 'date_arriving', label: '条目截止日期临近' },
    { v: 'item_created', label: '新条目被创建' },
    { v: 'mention', label: '有人在评论里 @人' },
  ];
  const thenOptions = [
    { v: 'notify', label: '通知相关负责人' },
    { v: 'move_group', label: '移动到分组' },
    { v: 'update_field', label: '把优先级改为「⚠ 逾期」' },
  ];

  const create = async () => {
    if (busy) return;
    // 组装 trigger/action（与后端 worker matchTrigger 的类型对齐）
    let trigger: any = {}, action: any = {}, name = '';
    if (when === 'status_changed') { trigger = { type: 'status_changed', to }; name = `状态变为「${to}」→`; }
    else if (when === 'date_arriving') { trigger = { type: 'date_arriving', days: Number(days) || 1 }; name = `截止前 ${days} 天 →`; }
    else if (when === 'item_created') { trigger = { type: 'item_created' }; name = '新条目创建 →'; }
    else { trigger = { type: 'mention', to: '@self' }; name = '被 @提及 →'; }
    if (then === 'notify') { action = { type: 'notify', userIds: ['@assignee'] }; name += '通知负责人'; }
    else if (then === 'move_group') {
      const g = groups.find((x: any) => x.name === group);
      if (!g) { flash('请选择目标分组'); return; }
      action = { type: 'move_group', groupId: g.id }; name += `移动到「${group}」`;
    } else { action = { type: 'update_field', columnId: 'prio', value: '⚠ 逾期' }; name += '优先级标逾期'; }
    setBusy(true);
    try {
      await api.autoCreate(boardId, { trigger, action, name, source: 'ui-sentence' });
      flash('自动化已创建 ✅');
      onDone();
    } catch (e) { flash(`创建失败：${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const select = (opts: { v: string; label: string }[], value: string, onChange: (v: string) => void, tag: string) => (
    <select data-sentence-select={tag} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ padding: '3px 8px', borderRadius: 7, border: '1px solid #4f6ef7', fontSize: 13, color: '#4f6ef7', fontWeight: 600 }}>
      {opts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );

  return (
    <div style={{ background: '#f6f7fb', borderRadius: 10, padding: 12 }}>
      <b style={{ fontSize: 13 }}>用一句话创建自动化</b>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13, lineHeight: 2 }}>
        <b>当</b>
        {select(whenOptions, when, (v) => { setWhen(v); setThen(v === 'status_changed' ? 'move_group' : 'notify'); }, 'when')}
        {when === 'status_changed' && <>
          {select(statusLabels.length ? statusLabels.map((l) => ({ v: l, label: l })) : STATUS_OPTIONS.map((l) => ({ v: l, label: l })),
            to, setTo, 'status')}
          <span>时，</span>
        </>}
        {when === 'date_arriving' && <>
          <input data-sentence-days type="number" min="1" max="30" value={days} onChange={(e) => setDays(e.target.value)}
            style={{ width: 52, padding: '3px 6px', borderRadius: 7, border: '1px solid #4f6ef7', fontSize: 13 }} />
          <span>天时，</span>
        </>}
        {(when === 'item_created' || when === 'mention') && <span>时，</span>}
        <b>就</b>
        {select(thenOptions, then, setThen, 'then')}
        {then === 'move_group' && <>
          {select(groupNames.map((g) => ({ v: g, label: g })), group, setGroup, 'group')}
        </>}
        <button onClick={create} disabled={busy || (when === 'status_changed' && !statusLabels.length)}
          style={{ marginLeft: 'auto', padding: '6px 16px', borderRadius: 8, border: 'none', background: '#4f6ef7', color: '#fff',
            cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
          {busy ? '创建中…' : '创建自动化'}
        </button>
      </div>
      {when === 'status_changed' && !statusLabels.length && (
        <div style={{ fontSize: 12, color: '#b8860b', marginTop: 6 }}>⚠ 这个 Board 没有状态列——句子里的「状态」先用通用标签，请先去表格视图加状态列</div>
      )}
    </div>
  );
}

export function AutomationPanel({ boardId, onClose, flash }: { boardId: string; onClose: () => void; flash: (s: string) => void }) {
  const [rules, setRules] = useState<any[]>([]);
  const load = useCallback(async () => {
    const r: any = await api.autoList(boardId).catch(() => []);
    setRules(Array.isArray(r) ? r : []);
  }, [boardId]);
  useEffect(() => { load(); }, [load]);

  const remove = async (id: string, name: string) => {
    if (!confirm(`删除自动化「${name}」？`)) return;
    try { await api.autoRemove(boardId, id); await load(); flash('已删除自动化'); }
    catch (e) { flash(`删除失败：${(e as Error).message}`); }
  };

  const pretty = (r: any) => {
    const t = r.trigger ?? {}, a = r.action ?? {};
    const when = t.type === 'status_changed' ? `状态变为「${t.to}」`
      : t.type === 'date_arriving' ? `截止前 ${t.days} 天`
      : t.type === 'item_created' ? '新条目创建'
      : t.type === 'mention' ? '被 @提及'
      : t.type === 'assignee_changed' ? '被指派给我'
      : t.type ?? '—';
    const act = a.type === 'notify' ? '通知负责人'
      : a.type === 'move_group' ? '移动分组'
      : a.type === 'update_field' ? '改字段'
      : a.type ?? '—';
    return `${r.name || `${when} → ${act}`}（${when} → ${act}）`;
  };

  return (
    <div data-automation-panel="1" style={{ position: 'absolute', top: 52, left: 12, zIndex: 60, background: '#fff', borderRadius: 12,
      boxShadow: '0 8px 30px rgba(20,30,70,.15)', padding: 16, width: 560, maxHeight: '72vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <b style={{ fontSize: 14 }}>⚡ 自动化</b>
        <button onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>
      <SentenceRule boardId={boardId} onDone={load} flash={flash} />
      <b style={{ fontSize: 13, display: 'block', margin: '14px 0 6px' }}>本 Board 的自动化（{rules.length}）</b>
      {rules.length === 0 && <div style={{ fontSize: 12, color: '#7a7f8c' }}>还没有自动化——用上面的句子创建一个</div>}
      {rules.map((r) => (
        <div key={r.id} data-auto-rule={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0',
          borderBottom: '1px solid #f0f1f5', fontSize: 13 }}>
          <span style={{ flex: 1 }}>{pretty(r)}</span>
          <button onClick={() => remove(r.id, r.name || '自动化')} title="删除"
            style={{ border: 'none', background: 'none', color: '#e2445c', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      ))}
      <div style={{ marginTop: 10, fontSize: 12, color: '#7a7f8c', lineHeight: 1.7 }}>
        规则由后台异步执行（触发 → 匹配 → 动作），全部动作记录在审计日志
      </div>
    </div>
  );
}
