/**
 * Dashboard 页 — Battery 进度 / 数字汇总 / 状态分布（对接后端预置组件）
 */
import { useEffect, useState } from 'react';
import { api } from '../api';

const COLORS = ['#579bfc', '#00c875', '#fdab3d', '#e2445c', '#9d3dd7', '#00d1d1'];

export function DashboardPage({ boardIds }: { boardIds: string[] }) {
  const [battery, setBattery] = useState<any[]>([]);
  const [dist, setDist] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const key = boardIds.join(',');

  useEffect(() => {
    if (!boardIds.length) { setBattery([]); setDist([]); return; }
    let alive = true;
    setLoading(true); setErr('');
    Promise.all([api.dashboardBattery(boardIds), api.dashboardStatusDist(boardIds)])
      .then(([b, d]) => {
        if (!alive) return;
        // 兜底：非数组响应一律当空数组，避免 .map/.reduce 直接炸白屏
        setBattery(Array.isArray(b) ? b : []);
        setDist(Array.isArray(d) ? d : []);
      })
      .catch((e) => { if (alive) { setErr((e as Error).message); setBattery([]); setDist([]); } })
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
    </div>
  );
}
