/**
 * Workload 视图（P1-8）— 按人员列聚合：每人的条目数 / 已完成 / 已逾期，横向条形图
 * 取第一个人员列；人员列值兼容 string / {id,label} / 数组
 */
import { useMemo, useState } from 'react';
import { useItems } from '../store';
import { doneLabelsOf } from '../theme';

function scalar(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') { const o = v as any; return String(o.label ?? o.name ?? o.id ?? ''); }
  return String(v);
}

export function WorkloadView({ onOpenItem }: { onOpenItem?: (itemId: string) => void }) {
  const { items, columns } = useItems();
  const peopleCols = useMemo(() => columns.filter((c: any) => c.type === 'people'), [columns]);
  const [colId, setColId] = useState<string>('');
  const peopleCol = peopleCols.find((c: any) => c.id === colId) ?? peopleCols[0];
  const statusCol = columns.find((c: any) => c.type === 'status');
  const dateCol = columns.find((c: any) => c.type === 'date');
  const doneSet = statusCol ? doneLabelsOf(statusCol.settings) : new Set<string>();

  const stats = useMemo(() => {
    const map = new Map<string, { total: number; done: number; overdue: number; ids: string[] }>();
    const bump = (name: string) => {
      if (!map.has(name)) map.set(name, { total: 0, done: 0, overdue: 0, ids: [] });
      return map.get(name)!;
    };
    if (!peopleCol) return [];
    const today = new Date(new Date().toDateString()).getTime();
    for (const it of Object.values(items) as any[]) {
      const raw = it.values?.[peopleCol.id];
      const names = Array.isArray(raw) ? raw.map(scalar).filter(Boolean) : raw ? [scalar(raw)].filter(Boolean) : [];
      if (!names.length) bump('（未分配）').total++, bump('（未分配）').ids.push(it.id);
      for (const n of names) {
        const s = bump(n);
        s.total++; s.ids.push(it.id);
        if (statusCol && doneSet.has(String(it.values?.[statusCol.id] ?? ''))) s.done++;
        if (dateCol && it.values?.[dateCol.id] && new Date(String(it.values[dateCol.id]).slice(0, 10)).getTime() < today
          && !(statusCol && doneSet.has(String(it.values?.[statusCol.id] ?? '')))) s.overdue++;
      }
    }
    return [...map.entries()].map(([name, s]) => ({ name, ...s })).sort((a, b) => b.total - a.total);
  }, [items, peopleCol, statusCol, dateCol, doneSet]);

  const max = Math.max(1, ...stats.map((s) => s.total));

  return (
    <div style={{ padding: 20, background: '#fff', height: '100%', overflow: 'auto' }} data-workload-root>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <b style={{ fontSize: 15 }}>🧑‍💼 Workload 工作量</b>
        {peopleCols.length > 1 && (
          <select value={peopleCol?.id} onChange={(e) => setColId(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #e6e8ef', fontSize: 12 }}>
            {peopleCols.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <span style={{ fontSize: 12, color: '#7a7f8c' }}>按「{peopleCol?.name ?? '—'}」列统计 · 总数 / 已完成 / 已逾期</span>
      </div>
      {!peopleCol && <div style={{ padding: 40, color: '#7a7f8c', fontSize: 14 }}>这个 Board 还没有人员列——去表格视图添加一个「人员」列即可统计工作量</div>}
      {peopleCol && stats.length === 0 && <div style={{ padding: 40, color: '#7a7f8c', fontSize: 14 }}>还没有条目分配人员</div>}
      {stats.map((s) => (
        <div key={s.name} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, marginBottom: 4 }}>
            <b>{s.name}</b>
            <span style={{ color: '#7a7f8c', fontSize: 12 }}>{s.total} 条 · ✅ {s.done} 完成{ s.overdue ? ` · 🔴 ${s.overdue} 逾期` : ''}</span>
          </div>
          <div style={{ height: 18, background: '#f0f1f5', borderRadius: 9, overflow: 'hidden', position: 'relative' }}>
            <div style={{ width: `${(s.total / max) * 100}%`, height: '100%', background: '#4f6ef7', borderRadius: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8,
              color: '#fff', fontSize: 11 }}>{s.total}</div>
          </div>
          <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {s.ids.slice(0, 8).map((id) => (
              <span key={id} onClick={() => onOpenItem?.(id)}
                style={{ fontSize: 11, background: '#eef1fe', color: '#4f6ef7', borderRadius: 8, padding: '1px 8px', cursor: 'pointer' }}>
                {items[id]?.name?.slice(0, 12) ?? id.slice(0, 6)}
              </span>
            ))}
            {s.ids.length > 8 && <span style={{ fontSize: 11, color: '#a0a4b1' }}>+{s.ids.length - 8}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
