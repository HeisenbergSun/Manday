/**
 * 日历视图 — 按 Board 第一个 date 列展示条目（月历，点击条目打开详情）
 */
import { useMemo, useState } from 'react';
import { useItems } from '../store';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

export function CalendarView({ onOpenItem }: { onOpenItem?: (itemId: string) => void }) {
  const { items, columns } = useItems();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [selected, setSelected] = useState<string | null>(null);

  const dateCol = useMemo(() => columns.find((c: any) => c.type === 'date'), [columns]);

  /** items 按 date 分桶（YYYY-MM-DD → 条目列表） */
  const buckets = useMemo(() => {
    const map: Record<string, any[]> = {};
    if (!dateCol) return map;
    for (const it of Object.values(items) as any[]) {
      const v = it.values?.[dateCol.id];
      if (!v) continue;
      const day = String(v).slice(0, 10);
      (map[day] ??= []).push(it);
    }
    return map;
  }, [items, dateCol]);

  /** 月历格子（周一起始） */
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const offset = (first.getDay() + 6) % 7; // 周一=0
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const out: { day: number | null; key: string }[] = [];
    for (let i = 0; i < offset; i++) out.push({ day: null, key: 'pad' + i });
    for (let d = 1; d <= daysInMonth; d++) out.push({ day: d, key: `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    return out;
  }, [cursor]);

  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const move = (delta: number) => {
    let m = cursor.m + delta, y = cursor.y;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    setCursor({ y, m });
    setSelected(null);
  };

  if (!dateCol) {
    return <div style={{ padding: 40, color: '#7a7f8c', fontSize: 14 }}>📅 这个 Board 还没有日期列——去表格视图添加一个「日期」列，条目就能按截止日期显示在日历上</div>;
  }

  const selItems = selected ? buckets[selected] ?? [] : [];

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 月历主体 */}
      <div style={{ flex: 1, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={() => move(-1)} style={navBtn}>‹</button>
          <b style={{ fontSize: 15 }}>{cursor.y} 年 {cursor.m + 1} 月</b>
          <button onClick={() => move(1)} style={navBtn}>›</button>
          <button onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }); setSelected(todayKey); }}
            style={{ ...navBtn, width: 'auto', padding: '4px 10px', fontSize: 12 }}>今天</button>
          <span style={{ fontSize: 12, color: '#7a7f8c', marginLeft: 'auto' }}>按「{dateCol.name}」列展示</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
          {WEEK.map((w) => <div key={w} style={{ textAlign: 'center', fontSize: 12, color: '#7a7f8c', padding: 4 }}>{w}</div>)}
          {cells.map((c) => {
            const list = c.day ? buckets[c.key] ?? [] : [];
            const isToday = c.key === todayKey;
            const isSel = c.key === selected;
            return (
              <div key={c.key} onClick={() => c.day && setSelected(c.key)}
                style={{
                  minHeight: 86, borderRadius: 8, padding: 6, fontSize: 12, cursor: c.day ? 'pointer' : 'default',
                  background: isSel ? '#eef1fe' : '#fff', border: isToday ? '2px solid #4f6ef7' : '1px solid #e6e8ef',
                  opacity: c.day ? 1 : 0.4,
                }}>
                {c.day && <div style={{ fontWeight: isToday ? 800 : 500, color: isToday ? '#4f6ef7' : '#33333f', marginBottom: 4 }}>{c.day}</div>}
                {list.slice(0, 3).map((it) => (
                  <div key={it.id} onClick={(e) => { e.stopPropagation(); onOpenItem?.(it.id); }}
                    style={{ background: '#eef1fe', color: '#4f6ef7', borderRadius: 5, padding: '2px 6px',
                      marginBottom: 3, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.name}
                  </div>
                ))}
                {list.length > 3 && <div style={{ fontSize: 10, color: '#7a7f8c' }}>还有 {list.length - 3} 条…</div>}
              </div>
            );
          })}
        </div>
      </div>
      {/* 当日侧栏 */}
      {selected && (
        <div style={{ width: 280, borderLeft: '1px solid #e6e8ef', background: '#fff', padding: 16, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <b style={{ fontSize: 14 }}>{selected}（{selItems.length}）</b>
            <button onClick={() => setSelected(null)} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
          {selItems.length === 0 && <div style={{ color: '#7a7f8c', fontSize: 13 }}>这一天没有条目</div>}
          {selItems.map((it) => (
            <div key={it.id} onClick={() => onOpenItem?.(it.id)}
              style={{ border: '1px solid #e6e8ef', borderRadius: 8, padding: '8px 10px', marginBottom: 8,
                cursor: 'pointer', fontSize: 13 }}>
              {it.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff',
  cursor: 'pointer', fontSize: 14, lineHeight: 1,
};
