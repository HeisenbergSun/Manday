/**
 * 日历视图 — 月历/周历 + 拖拽改日期
 * 第二十三批全面升级：月视图/周视图切换 + 拖拽条目改日期 + 条目计数 + 周视图列式布局
 * DOM 契约（e2e 依赖）：
 *   [data-cal-mode] [data-cal-day] [data-cal-item]
 */
import { useCallback, useMemo, useState } from 'react';
import { useItems, useToast } from '../store';
import { api } from '../api';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

const navBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff',
  cursor: 'pointer', fontSize: 14, lineHeight: 1,
};

export function CalendarView({ onOpenItem }: { onOpenItem?: (itemId: string) => void }) {
  const { items, columns } = useItems();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [calMode, setCalMode] = useState<'month' | 'week'>('month');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const dateCol = useMemo(() => columns.find((c: any) => c.type === 'date'), [columns]);

  /** items 按 date 分桶（YYYY-MM-DD -> 条目列表） */
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
  const monthCells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const out: { day: number | null; key: string }[] = [];
    for (let i = 0; i < offset; i++) out.push({ day: null, key: 'pad' + i });
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ day: d, key: `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
    return out;
  }, [cursor]);

  /** 周视图格子（7 天） */
  const weekCells = useMemo(() => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7);
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const out: { day: number; key: string; weekday: string; isToday: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ day: d.getDate(), key, weekday: WEEK[i], isToday: key === todayKey });
    }
    return out;
  }, [weekOffset]);

  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const moveMonth = (delta: number) => {
    let m = cursor.m + delta, y = cursor.y;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    setCursor({ y, m });
    setSelected(null);
  };

  const moveWeek = (delta: number) => {
    setWeekOffset((w) => w + delta);
    setSelected(null);
  };

  /** 拖拽条目到日期格子 -> 改 date 列值 */
  const onDropToDate = useCallback(async (dayKey: string) => {
    if (!draggingId || !dateCol) { setDraggingId(null); return; }
    const store = useItems.getState();
    const item = store.items[draggingId];
    if (!item) { setDraggingId(null); return; }
    const prev = (item as any).values?.[dateCol.id] ?? null;
    if (prev === dayKey) { setDraggingId(null); return; }
    store.patchItem(draggingId, { values: { ...(item as any).values, [dateCol.id]: dayKey } } as any);
    try {
      const r: any = await api.updateCell(draggingId, dateCol.id, dayKey, item.version);
      if (r?.version) store.patchItem(draggingId, { version: r.version } as any);
      useToast.getState().toast(`已移至 ${dayKey}`, 'success');
    } catch {
      store.patchItem(draggingId, { values: { ...(item as any).values, [dateCol.id]: prev } } as any);
      useToast.getState().toast('移动失败，已回滚', 'error');
    }
    setDraggingId(null);
  }, [draggingId, dateCol]);

  if (!dateCol) {
    return <div style={{ padding: 40, color: '#7a7f8c', fontSize: 14 }}>这个 Board 还没有日期列——去表格视图添加一个「日期」列，条目就能按截止日期显示在日历上</div>;
  }

  const selItems = selected ? buckets[selected] ?? [] : [];
  const monthLabel = `${cursor.y} 年 ${cursor.m + 1} 月`;
  const weekLabel = weekCells.length > 0
    ? `${weekCells[0].key.slice(5).replace('-', '/')} ~ ${weekCells[6].key.slice(5).replace('-', '/')}`
    : '';
  const totalCount = Object.values(buckets).reduce((s, l) => s + l.length, 0);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column' }}>
        {/* 工具条 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          {/* 月/周切换 */}
          <div style={{ display: 'flex', borderRadius: 8, border: '1px solid #e6e8ef', overflow: 'hidden' }}>
            <button data-cal-mode="month" onClick={() => setCalMode('month')}
              style={{ padding: '5px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                background: calMode === 'month' ? '#4f6ef7' : '#fff', color: calMode === 'month' ? '#fff' : '#7a7f8c' }}>
              月视图
            </button>
            <button data-cal-mode="week" onClick={() => setCalMode('week')}
              style={{ padding: '5px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                background: calMode === 'week' ? '#4f6ef7' : '#fff', color: calMode === 'week' ? '#fff' : '#7a7f8c' }}>
              周视图
            </button>
          </div>
          {/* 导航 */}
          {calMode === 'month' ? (
            <>
              <button onClick={() => moveMonth(-1)} style={navBtn}>‹</button>
              <b style={{ fontSize: 15, minWidth: 100, textAlign: 'center' }}>{monthLabel}</b>
              <button onClick={() => moveMonth(1)} style={navBtn}>›</button>
            </>
          ) : (
            <>
              <button onClick={() => moveWeek(-1)} style={navBtn}>‹</button>
              <b style={{ fontSize: 15, minWidth: 120, textAlign: 'center' }}>{weekLabel}</b>
              <button onClick={() => moveWeek(1)} style={navBtn}>›</button>
            </>
          )}
          <button onClick={() => {
            const d = new Date();
            setCursor({ y: d.getFullYear(), m: d.getMonth() });
            setWeekOffset(0);
            setSelected(todayKey);
          }} style={{ ...navBtn, width: 'auto', padding: '4px 10px', fontSize: 12 }}>今天</button>
          <span style={{ fontSize: 12, color: '#7a7f8c', marginLeft: 'auto' }}>
            按「{dateCol.name}」列展示 · 共 {totalCount} 条目 · 拖拽条目可改日期
          </span>
        </div>

        {calMode === 'month' ? (
          /* ── 月视图 ── */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, flex: 1, overflow: 'auto' }}>
            {WEEK.map((w) => <div key={w} style={{ textAlign: 'center', fontSize: 12, color: '#7a7f8c', padding: 4 }}>{w}</div>)}
            {monthCells.map((c) => {
              const list = c.day ? buckets[c.key] ?? [] : [];
              const isToday = c.key === todayKey;
              const isSel = c.key === selected;
              return (
                <div key={c.key} data-cal-day={c.key}
                  onClick={() => c.day && setSelected(c.key)}
                  onDragOver={(e) => c.day && e.preventDefault()}
                  onDrop={() => c.day && onDropToDate(c.key)}
                  style={{
                    minHeight: 86, borderRadius: 8, padding: 6, fontSize: 12, cursor: c.day ? 'pointer' : 'default',
                    background: isSel ? '#eef1fe' : '#fff', border: isToday ? '2px solid #4f6ef7' : '1px solid #e6e8ef',
                    opacity: c.day ? 1 : 0.4,
                  }}>
                  {c.day && (
                    <div style={{ fontWeight: isToday ? 800 : 500, color: isToday ? '#4f6ef7' : '#33333f', marginBottom: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>{c.day}</span>
                      {list.length > 0 && <span style={{ fontSize: 10, background: '#4f6ef7', color: '#fff', borderRadius: 8, padding: '0 5px', fontWeight: 600 }}>{list.length}</span>}
                    </div>
                  )}
                  {list.slice(0, 3).map((it) => (
                    <div key={it.id} data-cal-item={it.id}
                      draggable
                      onDragStart={() => setDraggingId(it.id)}
                      onDragEnd={() => setDraggingId(null)}
                      onClick={(e) => { e.stopPropagation(); onOpenItem?.(it.id); }}
                      style={{ background: '#eef1fe', color: '#4f6ef7', borderRadius: 5, padding: '2px 6px',
                        marginBottom: 3, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        cursor: 'grab', opacity: draggingId === it.id ? 0.4 : 1 }}>
                      {it.name}
                    </div>
                  ))}
                  {list.length > 3 && <div style={{ fontSize: 10, color: '#7a7f8c' }}>还有 {list.length - 3} 条…</div>}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── 周视图 ── */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6, flex: 1, overflow: 'hidden' }}>
            {weekCells.map((c) => {
              const list = buckets[c.key] ?? [];
              return (
                <div key={c.key} data-cal-day={c.key}
                  onClick={() => setSelected(c.key)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDropToDate(c.key)}
                  style={{
                    borderRadius: 8, padding: 8, fontSize: 12, cursor: 'pointer',
                    background: selected === c.key ? '#eef1fe' : '#fafbfc',
                    border: c.isToday ? '2px solid #4f6ef7' : '1px solid #e6e8ef',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
                  }}>
                  <div style={{ fontWeight: c.isToday ? 800 : 600, color: c.isToday ? '#4f6ef7' : '#33333f', marginBottom: 6,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                    <span>{c.weekday} {c.day}日</span>
                    {list.length > 0 && <span style={{ fontSize: 10, background: '#4f6ef7', color: '#fff', borderRadius: 8, padding: '0 5px', fontWeight: 600 }}>{list.length}</span>}
                  </div>
                  <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                    {list.length === 0 ? (
                      <div style={{ color: '#a0a4b1', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>无条目</div>
                    ) : list.map((it) => (
                      <div key={it.id} data-cal-item={it.id}
                        draggable
                        onDragStart={() => setDraggingId(it.id)}
                        onDragEnd={() => setDraggingId(null)}
                        onClick={(e) => { e.stopPropagation(); onOpenItem?.(it.id); }}
                        style={{ background: '#fff', border: '1px solid #e6e8ef', borderRadius: 6, padding: '6px 8px',
                          marginBottom: 4, fontSize: 12, cursor: 'grab', opacity: draggingId === it.id ? 0.4 : 1,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {it.name}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
            <div key={it.id} data-cal-item={it.id}
              draggable
              onDragStart={() => setDraggingId(it.id)}
              onDragEnd={() => setDraggingId(null)}
              onClick={() => onOpenItem?.(it.id)}
              style={{ border: '1px solid #e6e8ef', borderRadius: 8, padding: '8px 10px', marginBottom: 8,
                cursor: 'pointer', fontSize: 13, opacity: draggingId === it.id ? 0.4 : 1 }}>
              {it.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
