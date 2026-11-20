/**
 * Dashboard 编辑页 — Monday 式 BI 工作台
 * - 网格布局：widget 可拖拽排序 + 右下角拖拽调整大小（跨列/跨行）
 * - 图表可新增 / 编辑（含切换类型）/ 删除
 * - 支持 11 种图表：数字卡(多指标)/进度/柱/饼/折线/面积/双轴/甘特/表格/排行/动态
 * - 每个 widget 可关联多个 board，跨板按「列名+类型」聚合
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api';

const COLORS = ['#579bfc', '#00c875', '#fdab3d', '#e2445c', '#9d3dd7', '#00d1d1', '#ff8a65', '#a25ddc'];
const WIDGET_TYPES: { type: string; label: string; icon: string; desc: string }[] = [
  { type: 'number', label: '数字卡', icon: '🔢', desc: '多 Board 多指标聚合' },
  { type: 'bar', label: '柱状图', icon: '📊', desc: '跨 Board 分组统计' },
  { type: 'pie', label: '饼图', icon: '🥧', desc: '分组占比' },
  { type: 'line', label: '折线图', icon: '📈', desc: '按日期趋势' },
  { type: 'area', label: '面积图', icon: '🏔️', desc: '按日期趋势（填充）' },
  { type: 'combo', label: '双轴图', icon: '📶', desc: '柱 + 线双指标' },
  { type: 'gantt', label: '甘特图', icon: '📅', desc: '条目时间条' },
  { type: 'battery', label: '进度条', icon: '🔋', desc: '完成百分比' },
  { type: 'table', label: '表格', icon: '📋', desc: '条目列表' },
  { type: 'rank', label: '成员排行', icon: '👥', desc: '未完成负载' },
  { type: 'activity', label: '动态流', icon: '🕒', desc: '近期操作' },
];

/** 仪表盘模板：一键生成一组 widget（列名按模板约定，创建时绑定用户选定的 board） */
const TEMPLATES: { name: string; icon: string; desc: string; widgets: { type: string; title: string; config: any }[] }[] = [
  {
    name: '项目总览', icon: '📋', desc: '进度 + 状态分布 + 预算 + 甘特 + 表格',
    widgets: [
      { type: 'battery', title: '完成进度', config: {} },
      { type: 'bar', title: '状态分布', config: { groupBy: '状态', metric: 'count' } },
      { type: 'number', title: '预算', config: { column: '预算', aggs: ['sum', 'avg', 'count'] } },
      { type: 'gantt', title: '时间安排', config: { startColumn: '开始日期', endColumn: '截止日期' } },
      { type: 'table', title: '条目列表', config: { limit: 20 } },
    ],
  },
  {
    name: '团队负载', icon: '👥', desc: '成员排行 + 动态 + 逾期',
    widgets: [
      { type: 'rank', title: '成员负载排行', config: {} },
      { type: 'activity', title: '近期动态', config: {} },
      { type: 'bar', title: '状态分布', config: { groupBy: '状态', metric: 'count' } },
    ],
  },
  {
    name: '销售漏斗', icon: '🥧', desc: '按阶段占比 + 金额汇总 + 趋势',
    widgets: [
      { type: 'pie', title: '阶段占比', config: { groupBy: '阶段' } },
      { type: 'number', title: '金额', config: { column: '金额', aggs: ['sum', 'avg'] } },
      { type: 'line', title: '成交趋势', config: { dateColumn: '成交日期' } },
    ],
  },
];

interface Widget { id: string; type: string; title: string; config: any; }

function BarChart({ data, valueKey = 'value' }: { data: any[]; valueKey?: string }) {
  data = Array.isArray(data) ? data : [];
  const mx = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, padding: '6px 0' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#5a6072' }}>{d[valueKey]}</span>
          <div style={{ width: '100%', maxWidth: 40, height: `${(Number(d[valueKey]) / mx) * 78}px`, minHeight: 3, background: COLORS[i % COLORS.length], borderRadius: '4px 4px 0 0' }} />
          <span style={{ fontSize: 10, color: '#7a7f8c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 60, transform: 'rotate(-25deg)', transformOrigin: 'top' }}>{d.label}</span>
        </div>
      ))}
      {data.length === 0 && <span style={{ color: '#a0a4b1', fontSize: 12 }}>暂无数据</span>}
    </div>
  );
}

function PieChart({ data }: { data: { label: string; value: number }[] }) {
  data = Array.isArray(data) ? data : [];
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={110} height={110} viewBox="0 0 110 110">
        <circle cx={55} cy={55} r={R} fill="none" stroke="#eef0f5" strokeWidth={16} />
        {data.map((d, i) => {
          const frac = d.value / total;
          const seg = <circle key={i} cx={55} cy={55} r={R} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={16} strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C} transform="rotate(-90 55 55)" />;
          acc += frac; return seg;
        })}
        <text x={55} y={59} textAnchor="middle" fontSize={16} fontWeight={700} fill="#25272c">{total}</text>
      </svg>
      <div style={{ flex: 1 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            <b>{d.value}</b>
            <span style={{ color: '#a0a4b1', width: 40, textAlign: 'right' }}>{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ data, fill = false }: { data: { date: string; value: number }[]; fill?: boolean }) {
  data = Array.isArray(data) ? data : [];
  const W = 300, H = 110, P = 22;
  const mx = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? (W - P * 2) / (data.length - 1) : 0;
  const xy = (i: number) => ({ x: P + i * step, y: H - P - (data[i].value / mx) * (H - P * 2) });
  const pts = data.map((_, i) => `${xy(i).x},${xy(i).y}`).join(' ');
  return (
    <svg width="100%" height={130} viewBox={`0 0 ${W} ${H + 10}`} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={P} x2={W - P} y1={H - P - f * (H - P * 2)} y2={H - P - f * (H - P * 2)} stroke="#eef0f5" strokeWidth={1} />)}
      {data.length > 1 && fill && <polygon points={`${P},${H - P} ${pts} ${W - P},${H - P}`} fill={`${COLORS[0]}22`} />}
      {data.length > 1 && <polyline points={pts} fill="none" stroke={COLORS[0]} strokeWidth={2} />}
      {data.map((d, i) => <circle key={i} cx={xy(i).x} cy={xy(i).y} r={3} fill={COLORS[0]} />)}
    </svg>
  );
}

function ComboChart({ data }: { data: { label: string; bar: number; line: number }[] }) {
  data = Array.isArray(data) ? data : [];
  const W = 300, H = 110, P = 22;
  const mxB = Math.max(1, ...data.map((d) => d.bar));
  const mxL = Math.max(1, ...data.map((d) => d.line));
  const step = data.length > 1 ? (W - P * 2) / data.length : 0;
  const bw = Math.min(20, step * 0.5);
  const xy = (i: number) => ({ x: P + step * i + step / 2, y: H - P - (data[i].line / mxL) * (H - P * 2) });
  const pts = data.map((_, i) => `${xy(i).x},${xy(i).y}`).join(' ');
  return (
    <svg width="100%" height={130} viewBox={`0 0 ${W} ${H + 10}`} preserveAspectRatio="none">
      {data.map((d, i) => {
        const bx = P + step * i + (step - bw) / 2;
        const bh = (d.bar / mxB) * (H - P * 2);
        return <rect key={i} x={bx} y={H - P - bh} width={bw} height={bh} rx={2} fill={COLORS[0]} />;
      })}
      {data.length > 1 && <polyline points={pts} fill="none" stroke={COLORS[3]} strokeWidth={2} />}
      {data.map((d, i) => <circle key={i} cx={xy(i).x} cy={xy(i).y} r={3} fill={COLORS[3]} />)}
    </svg>
  );
}

function GanttChart({ data, onOpenItem }: { data: { id: string; name: string; board: string; start: string; end: string }[]; onOpenItem?: (id: string) => void }) {
  data = Array.isArray(data) ? data : [];
  const days = data.map((d) => ({ s: new Date(d.start).getTime(), e: new Date(d.end).getTime() }));
  const min = Math.min(...days.map((d) => d.s), Date.now() - 7 * 86400000);
  const max = Math.max(...days.map((d) => d.e), Date.now() + 7 * 86400000);
  const span = Math.max(1, max - min);
  const DAY = 86400000;
  return (
    <div>
      {data.map((d, i) => (
        <div key={d.id} onClick={() => onOpenItem?.(d.id)} title="点击打开条目详情"
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, cursor: 'pointer' }}>
          <span style={{ width: 90, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
          <div style={{ flex: 1, height: 12, background: '#f0f1f5', borderRadius: 6, position: 'relative' }}>
            <div style={{ position: 'absolute', left: `${((days[i].s - min) / span) * 100}%`, width: `${Math.max(((days[i].e - days[i].s) / span) * 100, 3)}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 6 }} />
          </div>
          <span style={{ fontSize: 10, color: '#a0a4b1', width: 60, textAlign: 'right' }}>{d.start?.slice(5)}</span>
        </div>
      ))}
      {data.length === 0 && <span style={{ color: '#a0a4b1', fontSize: 12 }}>暂无数据</span>}
    </div>
  );
}

function WidgetCard({ dashboardId, widget, onDelete, onEdit, onResize, onOpenItem }: {
  dashboardId: string; widget: Widget; onDelete: () => void; onEdit: () => void;
  onResize: (w: number, h: number) => void; onOpenItem?: (id: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null); setErr(''); // type/config 变化时先清空，避免旧数据喂给新图表组件
    api.widgetData(dashboardId, widget.id).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [dashboardId, widget.id, widget.type, JSON.stringify(widget.config)]);

  const title = widget.title || WIDGET_TYPES.find((t) => t.type === widget.type)?.label || widget.type;
  const boardIds = widget.config?.boardIds ?? [];

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = widget.config?.w ?? 2, startH = widget.config?.h ?? 2;
    let latest = { w: startW, h: startH };
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(1, Math.min(6, startW + Math.round((ev.clientX - startX) / 80)));
      const h = Math.max(1, Math.min(4, startH + Math.round((ev.clientY - startY) / 60)));
      latest = { w, h };
      setSize({ w, h });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onResize(latest.w, latest.h);
      setSize(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div data-widget={widget.type} style={{ height: '100%', boxSizing: 'border-box', background: '#fff', borderRadius: 12, border: '1px solid #e6e8ef', padding: 14, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <b style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</b>
        <span style={{ fontSize: 11, color: '#a0a4b1', whiteSpace: 'nowrap' }}>{boardIds.length ? `${boardIds.length} 板` : ''}</span>
        <span onClick={onEdit} title="编辑" data-widget-edit style={{ cursor: 'pointer', color: '#4f6ef7', fontSize: 13 }}>⚙</span>
        <span onClick={onDelete} title="删除" style={{ cursor: 'pointer', color: '#e2445c', fontSize: 13 }}>✕</span>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', zIndex: 0 }}>
        {err && <span style={{ color: '#e2445c', fontSize: 12 }}>加载失败</span>}
        {!data && !err && <span style={{ color: '#a0a4b1', fontSize: 12 }}>加载中…</span>}
        {data && widget.type === 'number' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {(Array.isArray(data.items) ? data.items : [{ label: '合计', value: data.value }]).map((it: any) => (
              <div key={it.label}>
                <div style={{ fontSize: 26, fontWeight: 800, color: COLORS[0] }}>{Number(it.value).toLocaleString()}</div>
                <div style={{ fontSize: 11, color: '#7a7f8c' }}>{it.label}</div>
              </div>
            ))}
          </div>
        )}
        {data && widget.type === 'battery' && (
          <div>{data.map((b: any) => (
            <div key={b.id} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}><b>{b.name}</b><span style={{ color: '#7a7f8c' }}>{b.percent}%</span></div>
              <div style={{ height: 8, background: '#eef0f5', borderRadius: 4 }}><div style={{ width: `${b.percent}%`, height: '100%', borderRadius: 4, background: b.percent >= 80 ? '#00c875' : b.percent >= 40 ? '#579bfc' : '#fdab3d' }} /></div>
            </div>
          ))}</div>
        )}
        {data && widget.type === 'bar' && <BarChart data={data} />}
        {data && widget.type === 'pie' && <PieChart data={data} />}
        {data && widget.type === 'line' && <LineChart data={data} />}
        {data && widget.type === 'area' && <LineChart data={data} fill />}
        {data && widget.type === 'combo' && <ComboChart data={data} />}
        {data && widget.type === 'gantt' && <GanttChart data={data} onOpenItem={onOpenItem} />}
        {data && widget.type === 'table' && (
          <div>{data.map((r: any) => (
            <div key={r.id} onClick={() => onOpenItem?.(r.id)} title="点击打开条目详情"
              style={{ display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid #f5f6fa', cursor: 'pointer' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ color: '#a0a4b1', fontSize: 11 }}>{r.board}</span>
            </div>
          ))}</div>
        )}
        {data && widget.type === 'rank' && (
          <div>{data.map((r: any, i: number) => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: '#a0a4b1', width: 16 }}>{i + 1}</span><b style={{ flex: 1 }}>{r.name}</b><span style={{ color: '#7a7f8c' }}>{r.cnt} 条</span>
            </div>
          ))}</div>
        )}
        {data && widget.type === 'activity' && (
          <div>{data.map((a: any, i: number) => (
            <div key={i} style={{ fontSize: 12, marginBottom: 5, display: 'flex', gap: 5 }}>
              <b>{a.actor}</b><span style={{ color: '#7a7f8c' }}>{a.action.replace(/item\.|board\./g, '')}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.target}</span>
            </div>
          ))}</div>
        )}
      </div>
      {/* 右下角调整大小手柄（draggable=false + 拖拽排序 dragstart 判断隔离） */}
      <span onMouseDown={startResize} draggable={false} title="拖动调整大小" data-widget-resize
        style={{ position: 'absolute', right: 4, bottom: 4, width: 20, height: 20, cursor: 'nwse-resize',
          background: '#f2f4fa', border: '1px solid #c3c8d4', borderRadius: 5, color: '#7a7f8c',
          fontSize: 13, lineHeight: '18px', textAlign: 'center', zIndex: 999, touchAction: 'none' }}>⤡</span>
      {/* 调整大小时的尺寸提示 */}
      {size && (
        <div style={{ position: 'absolute', right: 28, bottom: 6, background: '#3a3f4d', color: '#fff',
          borderRadius: 6, padding: '2px 8px', fontSize: 11, zIndex: 6, pointerEvents: 'none' }}>
          {size.w} × {size.h}
        </div>
      )}
    </div>
  );
}

export function DashboardEditor({ dashboardId, onBack, onOpenItem }: { dashboardId: string; onBack: () => void; onOpenItem?: (id: string) => void }) {
  const [dash, setDash] = useState<{ id: string; name: string; widgets: Widget[] } | null>(null);
  const [boards, setBoards] = useState<any[]>([]);
  const [editing, setEditing] = useState<Widget | null | 'new'>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.getDashboard(dashboardId).then((d) => setDash(d)).catch((e) => setErr((e as Error).message));
  }, [dashboardId]);
  useEffect(() => { load(); api.getBoards().then((d) => setBoards(Array.isArray(d) ? d : [])).catch(() => {}); }, [load]);

  const applyTemplate = async (template: { widgets: { type: string; title: string; config: any }[] }, boardId: string) => {
    for (const w of template.widgets) {
      const config = { ...w.config };
      if (boardId) config.boardIds = [boardId];
      await api.addWidget(dashboardId, { type: w.type, title: w.title, config }).catch(() => {});
    }
    setTemplateOpen(false);
    load();
  };

  const removeWidget = async (wid: string) => {
    if (!confirm('删除这个图表？')) return;
    await api.deleteWidget(dashboardId, wid).catch(() => {});
    load();
  };

  const saveWidget = async (type: string, title: string, config: any) => {
    if (editing === 'new') await api.addWidget(dashboardId, { type, title, config }).catch((e) => alert(`添加失败：${(e as Error).message}`));
    else if (editing && typeof editing === 'object') await api.updateWidget(dashboardId, editing.id, { type, title, config }).catch((e) => alert(`保存失败：${(e as Error).message}`));
    setEditing(null); load();
  };

  const resizeWidget = async (w: Widget, nw: number, nh: number) => {
    await api.updateWidget(dashboardId, w.id, { config: { ...w.config, w: nw, h: nh } }).catch(() => {});
    load();
  };

  const dropWidget = async (fromId: string, toId: string) => {
    const list = dash?.widgets ?? [];
    const from = list.findIndex((x) => x.id === fromId);
    const to = list.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDash((d) => d ? { ...d, widgets: next } : d);
    await api.reorderWidgets(dashboardId, next.map((x) => x.id)).catch(() => {});
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={onBack} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#7a7f8c' }}>←</button>
        <b style={{ fontSize: 17 }}>📊 {dash?.name ?? '仪表盘'}</b>
        <span style={{ fontSize: 12, color: '#7a7f8c' }}>{dash?.widgets.length ?? 0} 个图表 · 拖拽排序 · 右下角调整大小</span>
        <button data-add-widget onClick={() => setEditing('new')}
          style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          ＋ 添加图表
        </button>
      </div>
      {err && <div style={{ color: '#e2445c', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {dash?.widgets.length === 0 && (
        <div style={{ padding: 60, textAlign: 'center', color: '#7a7f8c', fontSize: 14 }}>
          还没有图表——点「＋ 添加图表」手动搭建，或
          <button data-template-trigger onClick={() => setTemplateOpen(true)}
            style={{ border: 'none', background: 'none', color: '#4f6ef7', cursor: 'pointer', fontSize: 14, fontWeight: 600, textDecoration: 'underline' }}>
            从模板快速创建
          </button>
        </div>
      )}
      <div data-dash-grid style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gridAutoRows: 104, gap: 14 }}>
        {(dash?.widgets ?? []).map((w) => (
          <div key={w.id} data-widget-slot draggable
            onDragStart={(e) => {
              // 拖拽源是 resize 手柄时，取消排序拖拽，让 resize 的 mousemove 正常触发
              if ((e.target as HTMLElement).closest('[data-widget-resize]')) { e.preventDefault(); return; }
              e.dataTransfer.setData('text/plain', w.id);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); dropWidget(e.dataTransfer.getData('text/plain'), w.id); }}
            style={{ gridColumn: `span ${w.config?.w ?? 2}`, gridRow: `span ${w.config?.h ?? 2}`, minWidth: 0, overflow: 'hidden' }}>
            <WidgetCard dashboardId={dashboardId} widget={w}
              onDelete={() => removeWidget(w.id)} onEdit={() => setEditing(w)} onResize={(nw, nh) => resizeWidget(w, nw, nh)} onOpenItem={onOpenItem} />
          </div>
        ))}
      </div>
      {editing && (
        <WidgetConfigModal boards={boards} initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSave={saveWidget} />
      )}
      {templateOpen && (
        <TemplateModal boards={boards} onClose={() => setTemplateOpen(false)} onCreate={applyTemplate} />
      )}
    </div>
  );
}

/** 模板选择弹窗：选模板 + 绑定数据源 board，批量生成 widget */
function TemplateModal({ boards, onClose, onCreate }: {
  boards: any[]; onClose: () => void; onCreate: (t: { widgets: { type: string; title: string; config: any }[] }, boardId: string) => void;
}) {
  const [boardId, setBoardId] = useState('');
  return (
    <div data-template-modal onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,30,.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxHeight: '88vh', overflow: 'auto', background: '#fff', borderRadius: 14, padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <b style={{ fontSize: 15 }}>从模板创建</b>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: '#5a6072', marginBottom: 6 }}>数据源 Board（模板图表将绑定到这个 Board）</div>
        <select value={boardId} onChange={(e) => setBoardId(e.target.value)}
          style={{ width: '100%', padding: '9px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13, marginBottom: 16 }}>
          <option value="">选择 Board…</option>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {TEMPLATES.map((t) => (
          <div key={t.name} data-template={t.name} onClick={() => { if (boardId) onCreate(t, boardId); }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, border: '1px solid #e6e8ef', borderRadius: 10, cursor: boardId ? 'pointer' : 'not-allowed', marginBottom: 10, opacity: boardId ? 1 : 0.55 }}>
            <span style={{ fontSize: 24 }}>{t.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: '#7a7f8c' }}>{t.desc}</div>
            </div>
            <span style={{ color: '#4f6ef7', fontSize: 13 }}>创建 →</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WidgetConfigModal({ boards, initial, onClose, onSave }: {
  boards: any[]; initial: Widget | null; onClose: () => void; onSave: (type: string, title: string, config: any) => void;
}) {
  const isEdit = !!initial;
  const [type, setType] = useState<string>(initial?.type ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [boardIds, setBoardIds] = useState<string[]>(initial?.config?.boardIds ?? []);
  const [groupBy, setGroupBy] = useState(initial?.config?.groupBy ?? '');
  const [metric, setMetric] = useState<'count' | 'sum'>(initial?.config?.metric ?? 'count');
  const [metricColumn, setMetricColumn] = useState(initial?.config?.metricColumn ?? '');
  const [column, setColumn] = useState(initial?.config?.column ?? '');
  const [aggs, setAggs] = useState<string[]>(initial?.config?.aggs ?? ['sum']);
  const [dateColumn, setDateColumn] = useState(initial?.config?.dateColumn ?? '');
  const [startColumn, setStartColumn] = useState(initial?.config?.startColumn ?? '');
  const [endColumn, setEndColumn] = useState(initial?.config?.endColumn ?? '');
  const [limit, setLimit] = useState(initial?.config?.limit ?? 20);
  const [colNames, setColNames] = useState<{ cat: string[]; num: string[]; date: string[] }>({ cat: [], num: [], date: [] });

  useEffect(() => {
    if (!boardIds.length) { setColNames({ cat: [], num: [], date: [] }); return; }
    let alive = true;
    Promise.all(boardIds.map((id) => api.getBoard(id).catch(() => null))).then((list) => {
      if (!alive) return;
      const cat = new Set<string>(), num = new Set<string>(), date = new Set<string>();
      for (const d of list) for (const c of (d?.columns ?? [])) {
        if (['status', 'dropdown', 'tags', 'people', 'text'].includes(c.type)) cat.add(c.name);
        else if (c.type === 'number') num.add(c.name);
        else if (c.type === 'date') date.add(c.name);
      }
      setColNames({ cat: [...cat], num: [...num], date: [...date] });
    }).catch(() => {});
    return () => { alive = false; };
  }, [JSON.stringify(boardIds)]);

  const toggleBoard = (id: string) => setBoardIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const toggleAgg = (a: string) => setAggs((s) => s.includes(a) ? s.filter((x) => x !== a) : [...s, a]);

  const needsBoard = ['number', 'battery', 'bar', 'pie', 'line', 'area', 'combo', 'gantt', 'table'].includes(type);
  const canSave = type && (['rank', 'activity'].includes(type) || boardIds.length)
    && (type !== 'number' || column) && (type !== 'bar' || groupBy) && (type !== 'pie' || groupBy)
    && (type !== 'combo' || (groupBy && metricColumn)) && (type !== 'line' && type !== 'area' || dateColumn)
    && (type !== 'gantt' || startColumn);

  const buildConfig = () => {
    const cfg: any = { boardIds };
    if (type === 'number') { cfg.column = column; cfg.aggs = aggs; }
    if (type === 'bar') { cfg.groupBy = groupBy; cfg.metric = metric; if (metric === 'sum') cfg.metricColumn = metricColumn; }
    if (type === 'pie') { cfg.groupBy = groupBy; cfg.metric = 'count'; }
    if (type === 'line' || type === 'area') cfg.dateColumn = dateColumn;
    if (type === 'combo') { cfg.groupBy = groupBy; cfg.metricColumn = metricColumn; }
    if (type === 'gantt') { cfg.startColumn = startColumn; cfg.endColumn = endColumn; }
    if (type === 'table') cfg.limit = limit;
    return cfg;
  };

  const select = (v: string, onChange: (s: string) => void, opts: string[], placeholder: string) => (
    <select value={v} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const field = (label: string, el: React.ReactNode) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: '#5a6072', marginBottom: 4 }}>{label}</div>
      {el}
    </div>
  );

  return (
    <div data-widget-modal onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,30,.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 640, maxHeight: '88vh', overflow: 'auto', background: '#fff', borderRadius: 14, padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <b style={{ fontSize: 15 }}>{isEdit ? '编辑图表' : '添加图表'}</b>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        {/* 类型选择：新建与编辑均可切换 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 16 }}>
          {WIDGET_TYPES.map((t) => (
            <div key={t.type} data-widget-type={t.type} onClick={() => setType(t.type)}
              style={{ padding: 10, border: type === t.type ? '2px solid #4f6ef7' : '1px solid #e6e8ef', borderRadius: 10, cursor: 'pointer', textAlign: 'center', background: type === t.type ? '#eef1fe' : '#fafbfd' }}>
              <div style={{ fontSize: 20 }}>{t.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4 }}>{t.label}</div>
            </div>
          ))}
        </div>

        {field('标题', <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="可选" style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }} />)}

        {needsBoard && field('数据源 Board（可多选，跨 Board 按同名列聚合）', (
          <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid #e6e8ef', borderRadius: 8, padding: 6 }}>
            {boards.map((b) => (
              <label key={b.id} data-board-option={b.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}>
                <input type="checkbox" checked={boardIds.includes(b.id)} onChange={() => toggleBoard(b.id)} />
                <span>{b.name}</span>
              </label>
            ))}
            {boards.length === 0 && <span style={{ color: '#a0a4b1', fontSize: 12, padding: 6 }}>暂无 Board</span>}
          </div>
        ))}

        {type === 'number' && (
          <>
            {field('数值列', select(column, setColumn, colNames.num, '数值列（跨板同名）'))}
            {field('指标（多选）', (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {['sum', 'avg', 'count', 'min', 'max'].map((a) => (
                  <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={aggs.includes(a)} onChange={() => toggleAgg(a)} />
                    {({ sum: '合计', avg: '平均', count: '计数', min: '最小', max: '最大' } as any)[a]}
                  </label>
                ))}
              </div>
            ))}
          </>
        )}

        {type === 'bar' && (
          <>
            {field('分组列', select(groupBy, setGroupBy, colNames.cat, '分组列（状态/多选/人员等）'))}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>{field('指标', select(metric as string, (s) => setMetric(s as any), ['count', 'sum'], '指标'))}</div>
              {metric === 'sum' && <div style={{ flex: 1 }}>{field('数值列', select(metricColumn, setMetricColumn, colNames.num, '数值列'))}</div>}
            </div>
          </>
        )}

        {type === 'pie' && field('分组列', select(groupBy, setGroupBy, colNames.cat, '分组列'))}

        {(type === 'line' || type === 'area') && field('日期列', select(dateColumn, setDateColumn, colNames.date, '日期列（跨板同名）'))}

        {type === 'combo' && (
          <>
            {field('分组列（柱）', select(groupBy, setGroupBy, colNames.cat, '分组列'))}
            {field('数值列（线）', select(metricColumn, setMetricColumn, colNames.num, '数值列'))}
          </>
        )}

        {type === 'gantt' && (
          <>
            {field('开始日期列', select(startColumn, setStartColumn, colNames.date, '开始日期列'))}
            {field('结束日期列（可选）', select(endColumn, setEndColumn, colNames.date, '结束日期列'))}
          </>
        )}

        {type === 'table' && field('显示条数', select(String(limit), (s) => setLimit(Number(s)), ['10', '20', '50'], '条数'))}

        <button data-widget-save disabled={!canSave}
          onClick={() => onSave(type, title.trim() || WIDGET_TYPES.find((t) => t.type === type)?.label || '', buildConfig())}
          style={{ marginTop: 18, width: '100%', padding: 11, borderRadius: 9, border: 'none', background: canSave ? '#4f6ef7' : '#c3c8d4', color: '#fff', cursor: canSave ? 'pointer' : 'default', fontSize: 14, fontWeight: 600 }}>
          {isEdit ? '保存' : '添加'}
        </button>
      </div>
    </div>
  );
}
