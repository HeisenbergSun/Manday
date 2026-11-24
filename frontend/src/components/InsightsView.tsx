/**
 * 分析视图（第二十二批）— 板内预设可视化：状态环形图 / 成员负载 / 月度截止柱状 / 分组完成率
 * 纯 SVG + CSS，无图表库依赖；数据全部来自 store（items/columns/groups）
 */
import { useMemo } from 'react';
import { useItems } from '../store';
import { Icon } from './Icons';
import { doneLabelsOf } from '../theme';
import { useCompanyUsers, personNames, membersOf } from '../people';

const PALETTE = ['#579bfc', '#00c875', '#fdab3d', '#e2445c', '#9d67f8', '#00d1d1', '#f5b3d1', '#8a90a3'];

function scalar(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') { const o = v as any; return String(o.label ?? o.name ?? o.id ?? ''); }
  return String(v);
}

/** SVG 环形图：用 stroke-dasharray 画扇区 */
function Donut({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div data-insights-status style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width={140} height={140} viewBox="0 0 140 140">
        <circle cx={70} cy={70} r={R} fill="none" stroke="#f0f1f5" strokeWidth={20} />
        {total > 0 && data.map((d, i) => {
          const frac = d.value / total;
          const el = (
            <circle key={i} cx={70} cy={70} r={R} fill="none" stroke={d.color} strokeWidth={20}
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C}
              transform="rotate(-90 70 70)" />
          );
          acc += frac;
          return el;
        })}
        <text x={70} y={66} textAnchor="middle" fontSize={22} fontWeight={700} fill="#1f2330">{total}</text>
        <text x={70} y={84} textAnchor="middle" fontSize={11} fill="#7a7f8c">条目</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((d, i) => (
          <div key={i} data-insights-legend={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, display: 'inline-block' }} />
            <span style={{ color: '#1f2330' }}>{d.label || '（未设置）'}</span>
            <span style={{ color: '#7a7f8c' }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InsightsView({ onOpenItem }: { onOpenItem?: (itemId: string) => void }) {
  const { items, columns, groups } = useItems();
  const users = useCompanyUsers();
  const list = useMemo(() => Object.values(items) as any[], [items]);
  const statusCol = columns.find((c: any) => c.type === 'status');
  const dateCol = columns.find((c: any) => c.type === 'date');
  const peopleCol = columns.find((c: any) => c.type === 'people');
  const doneSet = statusCol ? doneLabelsOf(statusCol.settings) : new Set<string>();

  // ① 状态分布（含未设置的条目）
  const statusData = useMemo(() => {
    if (!statusCol) return [];
    const labels: { label: string; color: string }[] = (statusCol.settings?.labels ?? []) as any;
    const counts = new Map<string, number>();
    let none = 0;
    for (const it of list) {
      const v = scalar(it.values?.[statusCol.id]);
      if (!v) none++;
      else counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const out = labels.map((l, i) => ({ label: l.label ?? l as any, value: counts.get(l.label ?? (l as any)) ?? 0, color: l.color ?? PALETTE[i % PALETTE.length] }));
    for (const [k, n] of counts) if (!labels.some((l) => (l.label ?? l) === k)) out.push({ label: k, value: n, color: PALETTE[out.length % PALETTE.length] });
    if (none) out.push({ label: '（未设置）', value: none, color: '#f0f1f5' });
    return out;
  }, [list, statusCol]);

  // ② 成员负载（未完成条目数）；统一解析真实用户 UUID / 假 id / 姓名
  const memberData = useMemo(() => {
    if (!peopleCol) return [];
    const members = membersOf(peopleCol);
    const map = new Map<string, number>();
    for (const it of list) {
      if (statusCol && doneSet.has(String(it.values?.[statusCol.id] ?? ''))) continue;
      const raw = it.values?.[peopleCol.id];
      const names = personNames(raw, users, members);
      if (!names.length) map.set('（未分配）', (map.get('（未分配）') ?? 0) + 1);
      for (const n of names) map.set(n, (map.get(n) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }));
  }, [list, peopleCol, statusCol, doneSet, users]);

  // ③ 月度截止分布（未来 6 个月 + 逾期）
  const monthData = useMemo(() => {
    if (!dateCol) return [];
    const now = new Date();
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const months: { label: string; value: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push({ label: `${d.getMonth() + 1}月`, value: 0 });
    }
    let overdue = 0;
    const curKey = key(now);
    for (const it of list) {
      const v = String(it.values?.[dateCol.id] ?? '').slice(0, 10);
      if (!v) continue;
      const mk = v.slice(0, 7);
      const idx = months.findIndex((m) => {
        const d = new Date(now.getFullYear(), now.getMonth() + months.indexOf(m), 1);
        return key(d) === mk;
      });
      if (mk < curKey) overdue++;
      else if (idx >= 0) months[idx].value++;
    }
    return [{ label: '逾期', value: overdue, color: '#e2445c' }, ...months.map((m, i) => ({ ...m, color: '#579bfc' }))];
  }, [list, dateCol]);

  // ④ 分组完成率
  const groupData = useMemo(() => {
    return (groups.length ? groups : [{ id: 'x', name: '全部条目' }]).map((g: any, i) => {
      const rows = list.filter((it) => groups.length ? it.group_id === g.id : true);
      const done = statusCol ? rows.filter((it) => doneSet.has(String(it.values?.[statusCol.id] ?? ''))).length : 0;
      return { label: g.name, total: rows.length, done, color: PALETTE[i % PALETTE.length] };
    });
  }, [list, groups, statusCol, doneSet]);

  const maxMonth = Math.max(1, ...monthData.map((m) => m.value));

  return (
    <div data-insights-view style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 980 }}>
      <b style={{ fontSize: 15, color: '#1f2330', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="chart" size={16} color="#4f6ef7" />分析</b>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e6e8ef' }}>
          <b style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>状态分布</b>
          {statusData.length ? <Donut data={statusData} /> : <span style={{ color: '#7a7f8c', fontSize: 13 }}>板上还没有状态列</span>}
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e6e8ef' }}>
          <b style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>成员负载（未完成条目）</b>
          {memberData.length ? memberData.map((m, i) => (
            <div key={i} data-insights-member={m.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13 }}>
              <span style={{ width: 90, color: '#1f2330', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
              <div style={{ flex: 1, height: 14, background: '#f0f1f5', borderRadius: 7, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (m.value / Math.max(1, ...memberData.map((x) => x.value))) * 100)}%`, height: '100%', background: m.color }} />
              </div>
              <span style={{ width: 24, textAlign: 'right', color: '#7a7f8c' }}>{m.value}</span>
            </div>
          )) : <span style={{ color: '#7a7f8c', fontSize: 13 }}>板上还没有人员列</span>}
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e6e8ef' }}>
          <b style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>截止日期分布</b>
          {monthData.length ? (
            <div data-insights-month style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 130 }}>
              {monthData.map((m, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#7a7f8c' }}>{m.value || ''}</span>
                  <div style={{ width: 26, height: `${Math.max(2, (m.value / maxMonth) * 92)}px`, background: m.color, borderRadius: 5, minHeight: 2 }} />
                  <span style={{ fontSize: 12, color: '#7a7f8c' }}>{m.label}</span>
                </div>
              ))}
            </div>
          ) : <span style={{ color: '#7a7f8c', fontSize: 13 }}>板上还没有日期列</span>}
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e6e8ef' }}>
          <b style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>分组完成率</b>
          {groupData.map((g, i) => (
            <div key={i} data-insights-group={g.label} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: '#1f2330' }}>{g.label}</span>
                <span style={{ color: '#7a7f8c' }}>{g.done}/{g.total}</span>
              </div>
              <div style={{ height: 10, background: '#f0f1f5', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: `${g.total ? (g.done / g.total) * 100 : 0}%`, height: '100%', background: '#00c875' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {onOpenItem && <span style={{ display: 'none' }} />}
    </div>
  );
}
