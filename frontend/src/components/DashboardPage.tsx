/**
 * Dashboard 页 — Battery 进度 / 数字汇总 / 状态分布（对接后端预置组件）
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

const COLORS = ['#579bfc', '#00c875', '#fdab3d', '#e2445c', '#9d3dd7', '#00d1d1'];

export function DashboardPage({ boardIds, onOpenItem }: { boardIds: string[]; onOpenItem?: (itemId: string) => void }) {
  const [battery, setBattery] = useState<any[]>([]);
  const [dist, setDist] = useState<any[]>([]);
  const [overdue, setOverdue] = useState<any[]>([]);
  const [rank, setRank] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const key = boardIds.join(',');

  useEffect(() => {
    if (!boardIds.length) { setBattery([]); setDist([]); return; }
    let alive = true;
    setLoading(true); setErr('');
    Promise.all([api.dashboardBattery(boardIds), api.dashboardStatusDist(boardIds),
      api.dashboardOverdue(), api.dashboardWorkloadRank(), api.dashboardActivity()])
      .then(([b, d, o, r, a]) => {
        if (!alive) return;
        setBattery(Array.isArray(b) ? b : []);
        setDist(Array.isArray(d) ? d : []);
        setOverdue(Array.isArray(o) ? o : []);
        setRank(Array.isArray(r) ? r : []);
        setActivity(Array.isArray(a) ? a : []);
      })
      .catch((e) => { if (alive) { setErr((e as Error).message); setBattery([]); setDist([]); setOverdue([]); setRank([]); setActivity([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [key]);

  const total = dist.reduce((s, d) => s + (Number(d?.cnt) || 0), 0);

  return (
    <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
      {err && (
        <div style={{ gridColumn: '1/-1', background: '#fff1f0', color: '#e2445c', borderRadius: 10,
          padding: '10px 14px', fontSize: 12 }}>加载失败：{err}</div>
      )}
      {loading && <div style={{ gridColumn: '1/-1', color: '#7a7f8c', fontSize: 12 }}>加载中…</div>}
      {/* Battery 进度条 */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e6e8ef' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>📊 各 Board 进度</div>
        {battery.map((b) => (
          <div key={b.id} style={{ marginBottom: 12, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <b>{b.name}</b><span style={{ color: '#7a7f8c' }}>{b.percent}% ({b.done}/{b.total})</span>
            </div>
            <div style={{ height: 8, background: '#eef0f5', borderRadius: 4 }}>
              <div style={{ width: `${b.percent}%`, height: '100%', borderRadius: 4,
                background: b.percent >= 80 ? '#00c875' : b.percent >= 40 ? '#579bfc' : '#fdab3d',
                transition: 'width .4s' }} />
            </div>
          </div>
        ))}
      </div>

      {/* 状态分布 */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e6e8ef' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>🧩 状态分布</div>
        {dist.map((d, i) => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length] }} />
            <span style={{ flex: 1 }}>{d.label}</span>
            <b>{d.cnt}</b>
            <span style={{ color: '#7a7f8c', width: 44, textAlign: 'right' }}>
              {total ? Math.round((d.cnt / total) * 100) : 0}%
            </span>
          </div>
        ))}
        {dist.length === 0 && <div style={{ color: '#7a7f8c', fontSize: 12 }}>暂无数据</div>}
      </div>

      {/* 跨板逾期任务（第十九批） */}
      <div data-dash-overdue style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e6e8ef' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>🔴 跨 Board 逾期任务</div>
        {overdue.map((o: any) => (
          <div key={o.id} data-overdue-row={o.name} onClick={() => onOpenItem?.(o.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '5px 8px', borderRadius: 7,
              cursor: 'pointer', marginBottom: 4, background: '#fff5f5' }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
            <span style={{ color: '#7a7f8c', fontSize: 11 }}>{o.board}</span>
            <span style={{ background: '#fdeaea', color: '#e2445c', borderRadius: 8, padding: '1px 8px', fontSize: 11 }}>{String(o.due).slice(0, 10)}</span>
          </div>
        ))}
        {overdue.length === 0 && <div style={{ color: '#00a25b', fontSize: 12 }}>🎉 没有逾期任务</div>}
      </div>

      {/* 成员负载排行（第十九批） */}
      <div data-dash-rank style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e6e8ef' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>👥 成员负载排行（未完成条目）</div>
        {(() => { const mx = Math.max(1, ...rank.map((r: any) => r.cnt)); return rank.map((r: any) => (
          <div key={r.name} style={{ marginBottom: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <b>{r.name}</b><span style={{ color: '#7a7f8c' }}>{r.cnt} 条</span>
            </div>
            <div style={{ height: 7, background: '#eef0f5', borderRadius: 4 }}>
              <div style={{ width: `${(r.cnt / mx) * 100}%`, height: '100%', borderRadius: 4,
                background: r.cnt / mx > 0.8 ? '#e2445c' : r.cnt / mx > 0.5 ? '#fdab3d' : '#579bfc', transition: 'width .4s' }} />
            </div>
          </div>
        )); })()}
        {rank.length === 0 && <div style={{ color: '#7a7f8c', fontSize: 12 }}>暂无分配记录</div>}
      </div>

      {/* 近期动态流（第十九批） */}
      <div data-dash-activity style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e6e8ef' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>🕒 近期动态</div>
        {activity.map((a: any, i: number) => (
          <div key={i} data-activity-row style={{ fontSize: 12, marginBottom: 6, display: 'flex', gap: 6 }}>
            <b>{a.actor}</b>
            <span style={{ color: '#7a7f8c' }}>{a.action.replace('item.', '').replace('board.', '')}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.target}</span>
            <span style={{ color: '#a0a4b1', fontSize: 11 }}>{new Date(a.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        {activity.length === 0 && <div style={{ color: '#7a7f8c', fontSize: 12 }}>暂无动态</div>}
      </div>
    </div>
  );
}
