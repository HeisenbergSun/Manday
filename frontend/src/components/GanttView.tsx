/**
 * 甘特视图 — 按日期列展示条目时间条（周为单位的时间轴）
 * 有 1 个日期列：条 = 该日期当天；有 2 个日期列：第一条 = 开始、第二条 = 结束，条跨区间
 * 支持按分组折叠、今天参考线、点击条目打开详情
 */
import { useMemo, useState, useRef } from 'react';
import { useItems } from '../store';
import { api } from '../api';
import { isItemDone } from '../theme';

const DAY = 24 * 3600 * 1000;
const ROW_H = 32;
const CELL_W = 14;   // 每天像素宽
const LABEL_W = 180; // 左侧名称列宽

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

type GRow = { id: string; name: string; start: number; end: number; overdue: boolean; done: boolean };

export function GanttView({ onOpenItem }: { onOpenItem?: (itemId: string) => void }) {
  const { items, columns, groups } = useItems();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // P1-5：拖拽中的条目（本地预览偏移，天）+ 提示
  const [dragging, setDragging] = useState<{ id: string; dStart: number; dEnd: number } | null>(null);
  const [toast, setToast] = useState('');
  const dragRef = useRef<{ id: string; mode: 'move' | 'end' | 'start'; startX: number; baseStart: number; baseEnd: number } | null>(null);

  const dateCols = useMemo(() => columns.filter((c: any) => c.type === 'date'), [columns]);
  const startCol = dateCols[0];
  const endCol = dateCols[1] ?? null;

  /** 解析每条的 [start, end]（毫秒），至少有开始日期才显示 */
  const rows = useMemo(() => {
    if (!startCol) return [];
    const out: GRow[] = [];
    const today = startOfDay(new Date()).getTime();
    for (const it of Object.values(items) as any[]) {
      const s = it.values?.[startCol.id];
      if (!s) continue;
      const start = startOfDay(new Date(String(s).slice(0, 10))).getTime();
      const e = endCol ? it.values?.[endCol.id] : null;
      const end = e ? startOfDay(new Date(String(e).slice(0, 10))).getTime() : start;
      const [a, b] = start <= end ? [start, end] : [end, start];
      out.push({ id: it.id, name: it.name, start: a, end: b, overdue: b < today,
        done: isItemDone(columns as any[], it.values) });
    }
    return out.sort((x, y) => x.start - y.start);
  }, [items, startCol, endCol, columns]);

  /** 时间轴范围：所有条目 min~max 前后各留 3 天，最少覆盖 4 周 */
  const range = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    if (rows.length === 0) {
      const s = startOfDay(new Date()); s.setDate(s.getDate() - 7);
      const e = startOfDay(new Date()); e.setDate(e.getDate() + 21);
      return { from: s.getTime(), to: e.getTime(), today };
    }
    let from = Math.min(...rows.map((r) => r.start), today) - 3 * DAY;
    let to = Math.max(...rows.map((r) => r.end), today) + 3 * DAY;
    if (to - from < 28 * DAY) to = from + 28 * DAY;
    return { from, to, today };
  }, [rows]);

  /** 周表头刻度（对齐周一） */
  const weekTicks = useMemo(() => {
    const out: { label: string; left: number }[] = [];
    const first = new Date(range.from);
    const offset = (first.getDay() + 6) % 7;
    for (let t = range.from + offset * DAY; t <= range.to; t += 7 * DAY) {
      const d = new Date(t);
      out.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, left: ((t - range.from) / DAY) * CELL_W });
    }
    return out;
  }, [range]);

  const todayLeft = ((range.today - range.from) / DAY) * CELL_W;
  const timelineWidth = ((range.to - range.from) / DAY + 1) * CELL_W;

  const bar = (r: GRow) => {
    const dOff = dragging?.id === r.id ? dragging : null;
    const start = r.start + (dOff?.dStart ?? 0) * DAY;
    const end = Math.max(r.end + (dOff?.dEnd ?? 0) * DAY, start);
    const left = ((start - range.from) / DAY) * CELL_W;
    const width = Math.max(((end - start) / DAY + 1) * CELL_W, CELL_W);
    /** 可编辑甘特（P1-5）：整体拖=平移，右缘拖=改结束日期（单日期列时改当天），左缘拖=改开始日期 */
    const onBarMouseDown = (mode: 'move' | 'end' | 'start') => (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      dragRef.current = { id: r.id, mode, startX: e.clientX, baseStart: r.start, baseEnd: r.end, off: { dStart: 0, dEnd: 0 } } as any;
      const onMove = (ev: MouseEvent) => {
        const d = dragRef.current; if (!d) return;
        const days = Math.round((ev.clientX - d.startX) / CELL_W);
        if (d.mode === 'move') { setDragging({ id: d.id, dStart: days, dEnd: days }); (d as any).off = { dStart: days, dEnd: days }; }
        else if (d.mode === 'end') { const de = Math.max(days, d.baseStart === d.baseEnd ? 0 : -((d.baseEnd - d.baseStart) / DAY)); setDragging({ id: d.id, dStart: 0, dEnd: de }); (d as any).off = { dStart: 0, dEnd: de }; }
        else { const ds = Math.min(days, (d.baseEnd - d.baseStart) / DAY); setDragging({ id: d.id, dStart: ds, dEnd: 0 }); (d as any).off = { dStart: ds, dEnd: 0 }; }
      };
      const onUp = async () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const dg = dragRef.current; dragRef.current = null;
        const d = (dg as any)?.off as { dStart: number; dEnd: number } | undefined;
        setDragging(null);
        if (!dg || !d || (d.dStart === 0 && d.dEnd === 0)) return;
        const it = (Object.values(items) as any[]).find((x) => x.id === dg.id);
        if (!it) return;
        const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
        const newStart = fmt(dg.baseStart + d.dStart * DAY);
        const newEnd = fmt(Math.max(dg.baseEnd + d.dEnd * DAY, dg.baseStart + d.dStart * DAY));
        try {
          let version = it.version;
          if (endCol && dg.mode !== 'start') {
            // 双日期列：开始/结束分别保存
            if (fmt(dg.baseStart + d.dStart * DAY) !== String(it.values?.[startCol.id] ?? '').slice(0, 10)) {
              const r1: any = await api.updateCell(it.id, startCol.id, newStart, version);
              version = r1?.version ?? version;
            }
            if (fmt(dg.baseEnd + d.dEnd * DAY) !== String(it.values?.[endCol.id] ?? '').slice(0, 10)) {
              const r2: any = await api.updateCell(it.id, endCol.id, newEnd, version);
              version = r2?.version ?? version;
            }
          } else {
            // 单日期列：整体拖/右缘拖都只改开始日期
            await api.updateCell(it.id, startCol.id, newStart, version);
          }
          setToast(`「${r.name}」已更新为 ${newStart}${endCol && dg.mode !== 'start' ? ' ~ ' + newEnd : ''}`);
          setTimeout(() => setToast(''), 2600);
        } catch (err: any) {
          setToast(`保存失败：${err.message ?? err}`);
          setTimeout(() => setToast(''), 2600);
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    return (
      <div title={`${r.name}（拖动平移 · 边缘拉伸改日期）`}
        data-gantt-bar={r.id}
        style={{ position: 'absolute', top: 6, left, width, height: 20, borderRadius: 6,
          background: r.done ? '#eceef2' : r.overdue ? '#fdebec' : '#eef1fe',
          border: `1px solid ${r.done ? '#c3c8d4' : r.overdue ? '#e5484d' : '#4f6ef7'}`,
          color: r.done ? '#a0a4b1' : r.overdue ? '#e5484d' : '#4f6ef7', fontSize: 11, lineHeight: '18px', padding: '0 6px',
          boxSizing: 'border-box', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'grab',
          opacity: dOff ? 0.85 : 1, boxShadow: dOff ? '0 2px 8px rgba(79,110,247,.35)' : undefined }}
        onMouseDown={onBarMouseDown('move')}
        onClick={(e) => { e.stopPropagation(); if (!dragging) onOpenItem?.(r.id); }}>
        {r.name}{r.done ? ' · 已完成' : r.overdue ? ' · 已逾期' : ''}
        {/* 左右拉伸手柄 */}
        <span onMouseDown={(e) => { e.stopPropagation(); onBarMouseDown('start')(e); }} data-gantt-edge="start"
          style={{ position: 'absolute', left: 0, top: 0, width: 7, height: '100%', cursor: 'ew-resize' }} />
        <span onMouseDown={(e) => { e.stopPropagation(); onBarMouseDown('end')(e); }} data-gantt-edge="end"
          style={{ position: 'absolute', right: 0, top: 0, width: 7, height: '100%', cursor: 'ew-resize' }} />
      </div>
    );
  };

  /** 行：组头可折叠，条目行带时间条 */
  const renderRow = (label: string, isGroup: boolean, key: string, list: GRow[]) => {
    const isCollapsed = isGroup && !!collapsed[key];
    return (
      <div key={key}>
        {isGroup && (
          <div onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
            style={{ display: 'flex', alignItems: 'center', height: ROW_H, background: '#f3f4f9',
              borderBottom: '1px solid #eef0f5', cursor: 'pointer' }}>
            <div style={{ width: LABEL_W, flexShrink: 0, padding: '0 10px', fontSize: 12.5, fontWeight: 700, color: '#33333f',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isCollapsed ? '▸ ' : '▾ '}{label}（{list.length}）
            </div>
          </div>
        )}
        {!isGroup && (() => {
          const r = list[0];
          return (
            <div style={{ display: 'flex', alignItems: 'center', height: ROW_H, background: '#fff',
              borderBottom: '1px solid #eef0f5' }}>
              <div style={{ width: LABEL_W, flexShrink: 0, padding: '0 10px', fontSize: 13, color: '#444452',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
              <div style={{ position: 'relative', width: timelineWidth, height: '100%' }}>{bar(r)}</div>
            </div>
          );
        })()}
        {isGroup && !isCollapsed && list.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', height: ROW_H, background: '#fff',
            borderBottom: '1px solid #eef0f5' }}>
            <div style={{ width: LABEL_W, flexShrink: 0, padding: '0 10px 0 26px', fontSize: 13, color: '#444452',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
            <div style={{ position: 'relative', width: timelineWidth, height: '100%' }}>{bar(r)}</div>
          </div>
        ))}
      </div>
    );
  };

  /** 分组结构：有分组则按组折叠展示，否则平铺 */
  const body = useMemo(() => {
    if (groups.length === 0) {
      return rows.map((r) => renderRow(r.name, false, r.id, [r]));
    }
    const out: JSX.Element[] = [];
    const seen = new Set<string>();
    const pushGroup = (gName: string, gKey: string, list: GRow[]) => {
      list = list.filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
      out.push(renderRow(gName, true, gKey, list));
    };
    for (const g of groups) pushGroup(g.name, g.id, rows.filter((r) => (items as any)[r.id]?.group_id === g.id));
    // 未分组
    const groupedIds = new Set<string>();
    for (const g of groups) for (const r of rows) {
      const it = (Object.values(items) as any[]).find((x) => x.id === r.id);
      if (it?.group_id === g.id) groupedIds.add(r.id);
    }
    pushGroup('未分组', '__ungrouped', rows.filter((r) => !groupedIds.has(r.id)));
    return out;
  }, [rows, groups, collapsed, items]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
        <b style={{ fontSize: 15 }}>📈 甘特视图</b>
        <span style={{ fontSize: 12, color: '#7a7f8c' }}>
          按「{startCol?.name ?? '—'}」{endCol ? `～「${endCol.name}」` : ''}列展示 · {rows.length} 条 · 红色已逾期 · 灰色已完成 · 拖条平移/边缘拉伸改日期
        </span>
        {toast && <span data-gantt-toast style={{ fontSize: 12, color: '#4f6ef7' }}>{toast}</span>}
      </div>
      {/* 周刻度表头 */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e6e8ef' }}>
        <div style={{ width: LABEL_W, flexShrink: 0, padding: '4px 10px', fontSize: 11, color: '#7a7f8c', fontWeight: 600 }}>条目</div>
        <div style={{ position: 'relative', width: timelineWidth, height: 26, overflow: 'hidden' }}>
          {weekTicks.map((t, i) => (
            <div key={i} style={{ position: 'absolute', left: t.left, top: 4, fontSize: 11, color: '#7a7f8c',
              borderLeft: '1px solid #eef0f5', paddingLeft: 4 }}>{t.label}</div>
          ))}
        </div>
      </div>
      {/* 主体（今天参考线覆盖时间轴区域） */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div data-gantt-today="1" style={{ position: 'absolute', top: 0, bottom: 0, left: LABEL_W + todayLeft, width: 2,
          background: '#ffb224', opacity: 0.6, zIndex: 5, pointerEvents: 'none' }} />
        {!startCol ? (
          <div style={{ padding: 40, color: '#7a7f8c', fontSize: 14 }}>📈 这个 Board 还没有日期列——去表格视图添加一个「日期」列，条目就能以甘特图展示时间安排</div>
        ) : body.length ? body : <div style={{ padding: 40, color: '#7a7f8c', fontSize: 14 }}>还没有条目设置了日期</div>}
      </div>
    </div>
  );
}
