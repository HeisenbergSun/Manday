/**
 * Workload 视图（P1-8）— 按人员列聚合：每人的条目数 / 已完成 / 已逾期，横向条形图
 * 取第一个人员列；人员列值兼容 string / {id,label} / 数组
 */
import { useMemo, useState } from 'react';
import { useItems } from '../store';
import { Icon } from './Icons';
import { doneLabelsOf } from '../theme';
import { useCompanyUsers, personNames, membersOf } from '../people';
import { parseLocal, startOfDay, addDaysStr } from '../dateUtils';

export function WorkloadView({ onOpenItem }: { onOpenItem?: (itemId: string) => void }) {
  const { items, columns } = useItems();
  const users = useCompanyUsers();
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
    // 统一解析：真实用户 UUID → 姓名；回退 settings.members 假 id；最后原值
    const members = membersOf(peopleCol);
    const today = startOfDay(new Date()).getTime();
    for (const it of Object.values(items) as any[]) {
      const raw = it.values?.[peopleCol.id];
      const names = personNames(raw, users, members);
      if (!names.length) bump('（未分配）').total++, bump('（未分配）').ids.push(it.id);
      for (const n of names) {
        const s = bump(n);
        s.total++; s.ids.push(it.id);
        if (statusCol && doneSet.has(String(it.values?.[statusCol.id] ?? ''))) s.done++;
        if (dateCol && it.values?.[dateCol.id] && startOfDay(parseLocal(String(it.values[dateCol.id]))).getTime() < today
          && !(statusCol && doneSet.has(String(it.values?.[statusCol.id] ?? '')))) s.overdue++;
      }
    }
    return [...map.entries()].map(([name, s]) => ({ name, ...s })).sort((a, b) => b.total - a.total);
  }, [items, peopleCol, statusCol, dateCol, doneSet, users]);

  const max = Math.max(1, ...stats.map((s) => s.total));

  // ---- P1-8+ 按日负载热力条：未来 14 天（含「逾期」桶）----
  const DAYS = 14;
  const today0 = startOfDay(new Date());
  const dayList = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDaysStr(today0, i)), []);
  const heat = useMemo(() => {
    // per person: { overdue: [{id,name}], days: { 'YYYY-MM-DD': [{id,name}] } }
    const res = new Map<string, { overdue: { id: string; name: string }[]; days: Record<string, { id: string; name: string }[]> }>();
    if (!peopleCol || !dateCol) return res;
    const members = membersOf(peopleCol);
    for (const it of Object.values(items) as any[]) {
      const raw = it.values?.[peopleCol.id];
      const names = personNames(raw, users, members);
      if (!names.length) names.push('（未分配）');
      const due = it.values?.[dateCol.id] ? String(it.values[dateCol.id]).slice(0, 10) : '';
      const isDone = statusCol && doneSet.has(String(it.values?.[statusCol.id] ?? ''));
      for (const n of names) {
        if (!res.has(n)) res.set(n, { overdue: [], days: {} });
        const r = res.get(n)!;
        if (due && dayList.includes(due)) {
          if (!r.days[due]) r.days[due] = [];
          r.days[due].push({ id: it.id, name: it.name });
        } else if (due && !isDone && startOfDay(parseLocal(due)).getTime() < today0.getTime()) {
          r.overdue.push({ id: it.id, name: it.name });
        }
      }
    }
    return res;
  }, [items, peopleCol, dateCol, statusCol, doneSet, dayList, users]);

  const [openDay, setOpenDay] = useState<{ person: string; key: string } | null>(null);
  const heatLevel = (n: number) => n <= 0 ? '#f0f1f5' : n === 1 ? '#bcd0fb' : n <= 3 ? '#7f9cf8' : n <= 5 ? '#4f6ef7' : '#e2445c';

  return (
    <div style={{ padding: 20, background: '#fff', height: '100%', overflow: 'auto' }} data-workload-root>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <b style={{ fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="users" size={16} color="#4f6ef7" />Workload 工作量</b>
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
            <span style={{ color: '#7a7f8c', fontSize: 12 }}>{s.total} 条 · {s.done} 完成{ s.overdue ? ` · ${s.overdue} 逾期` : ''}</span>
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
          {dateCol && (
            <div data-workload-heat={s.name} style={{ marginTop: 6, display: 'flex', gap: 3, alignItems: 'flex-end' }}>
              {(() => {
                const r = heat.get(s.name);
                const ov = r?.overdue.length ?? 0;
                const cells: { key: string; n: number }[] = ov > 0
                  ? [{ key: 'overdue', n: ov }, ...dayList.map((d) => ({ key: d, n: r?.days[d]?.length ?? 0 }))]
                  : dayList.map((d) => ({ key: d, n: r?.days[d]?.length ?? 0 }));
                return cells.map((c) => (
                  <div key={c.key} data-heat-cell={c.key} data-heat-count={c.n}
                    onClick={() => setOpenDay(c.n > 0 ? { person: s.name, key: c.key } : null)}
                    title={c.key === 'overdue' ? `逾期 ${c.n} 条` : `${c.key}：${c.n} 条`}
                    style={{ width: 22, height: 22, borderRadius: 5, background: heatLevel(c.n), cursor: c.n > 0 ? 'pointer' : 'default',
                      fontSize: 10, color: c.n > 2 ? '#fff' : '#5a5f6c', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      outline: openDay?.person === s.name && openDay?.key === c.key ? '2px solid #4f6ef7' : 'none' }}>
                    {c.n > 0 ? c.n : ''}
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      ))}
      {openDay && (() => {
        const r = heat.get(openDay.person);
        const list = openDay.key === 'overdue' ? (r?.overdue ?? []) : (r?.days[openDay.key] ?? []);
        if (!list.length) return null;
        return (
          <div data-workload-day-panel style={{ marginTop: 20, padding: 14, background: '#f7f8fb', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <b style={{ fontSize: 13 }}>
                {openDay.person} · {openDay.key === 'overdue' ? '逾期' : `${openDay.key}`} · {list.length} 条
              </b>
              <button onClick={() => setOpenDay(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
            {list.map((x) => (
              <div key={x.id} onClick={() => onOpenItem?.(x.id)}
                style={{ fontSize: 12, padding: '5px 10px', background: '#fff', borderRadius: 7, marginBottom: 5, cursor: 'pointer' }}>
                {x.name}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
