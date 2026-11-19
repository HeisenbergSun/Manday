/**
 * Dashboard 编辑页 — Monday 式 BI 工作台
 * 支持自定义 widget：数字卡 / 进度 / 柱状图 / 饼图 / 折线图 / 表格 / 成员排行 / 动态流
 * 每个 widget 绑定数据源（board + 列 + 聚合），SVG 自绘图表
 */
import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const COLORS = ['#579bfc', '#00c875', '#fdab3d', '#e2445c', '#9d3dd7', '#00d1d1', '#ff8a65', '#a25ddc'];
const WIDGET_TYPES: { type: string; label: string; icon: string; desc: string }[] = [
  { type: 'number', label: '数字卡', icon: '🔢', desc: '某数值列的合计/平均/计数' },
  { type: 'battery', label: '进度条', icon: '🔋', desc: 'Board 完成百分比' },
  { type: 'bar', label: '柱状图', icon: '📊', desc: '按某列分组统计' },
  { type: 'pie', label: '饼图', icon: '🥧', desc: '分组占比' },
  { type: 'line', label: '折线图', icon: '📈', desc: '按日期趋势' },
  { type: 'table', label: '表格', icon: '📋', desc: '条目列表' },
  { type: 'rank', label: '成员排行', icon: '👥', desc: '未完成条目负载' },
  { type: 'activity', label: '动态流', icon: '🕒', desc: '近期操作记录' },
];

interface Widget { id: string; type: string; title: string; config: any; }

function BarChart({ data, labelKey = 'label', valueKey = 'value' }: { data: any[]; labelKey?: string; valueKey?: string }) {
  const mx = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, padding: '6px 0' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#5a6072' }}>{d[valueKey]}</span>
          <div style={{ width: '100%', maxWidth: 40, height: `${(Number(d[valueKey]) / mx) * 80}px`, minHeight: 3,
            background: COLORS[i % COLORS.length], borderRadius: '4px 4px 0 0' }} />
          <span style={{ fontSize: 10, color: '#7a7f8c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 60, transform: 'rotate(-25deg)', transformOrigin: 'top' }}>{d[labelKey]}</span>
        </div>
      ))}
      {data.length === 0 && <span style={{ color: '#a0a4b1', fontSize: 12 }}>暂无数据</span>}
    </div>
  );
}

function PieChart({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={110} height={110} viewBox="0 0 110 110">
        <circle cx={55} cy={55} r={R} fill="none" stroke="#eef0f5" strokeWidth={16} />
        {data.map((d, i) => {
          const frac = d.value / total;
          const seg = (
            <circle key={i} cx={55} cy={55} r={R} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={16}
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C} transform="rotate(-90 55 55)" />
          );
          acc += frac;
          return seg;
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

function LineChart({ data }: { data: { date: string; value: number }[] }) {
  const W = 300, H = 120, P = 24;
  const mx = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? (W - P * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => `${P + i * step},${H - P - (d.value / mx) * (H - P * 2)}`);
  return (
    <svg width="100%" height={140} viewBox={`0 0 ${W} ${H + 12}`} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={P} x2={W - P} y1={H - P - f * (H - P * 2)} y2={H - P - f * (H - P * 2)} stroke="#eef0f5" strokeWidth={1} />
      ))}
      {pts.length > 1 && <polyline points={pts.join(' ')} fill="none" stroke={COLORS[0]} strokeWidth={2} />}
      {data.map((d, i) => <circle key={i} cx={P + i * step} cy={H - P - (d.value / mx) * (H - P * 2)} r={3} fill={COLORS[0]} />)}
    </svg>
  );
}

function WidgetCard({ dashboardId, widget, boards, onDelete, onEditTitle }: {
  dashboardId: string; widget: Widget; boards: any[]; onDelete: () => void; onEditTitle: (t: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    api.widgetData(dashboardId, widget.id)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [dashboardId, widget.id, JSON.stringify(widget.config)]);

  const title = widget.title || WIDGET_TYPES.find((t) => t.type === widget.type)?.label || widget.type;
  const boardName = (id: string) => boards.find((b) => b.id === id)?.name ?? id?.slice(0, 6) ?? '';

  return (
    <div data-widget={widget.type} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e6e8ef', padding: 16, minHeight: 160, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <b style={{ fontSize: 13, flex: 1 }}>{title}</b>
        <span style={{ fontSize: 11, color: '#a0a4b1' }}>{widget.config?.boardId ? boardName(widget.config.boardId) : ''}</span>
        <span onClick={() => onEditTitle(title)} title="重命名" style={{ cursor: 'pointer', color: '#a0a4b1', fontSize: 12 }}>✎</span>
        <span onClick={onDelete} title="删除" style={{ cursor: 'pointer', color: '#e2445c', fontSize: 12 }}>✕</span>
      </div>
      <div style={{ flex: 1 }}>
        {err && <span style={{ color: '#e2445c', fontSize: 12 }}>加载失败</span>}
        {!data && !err && <span style={{ color: '#a0a4b1', fontSize: 12 }}>加载中…</span>}
        {data && widget.type === 'number' && (
          <div style={{ fontSize: 42, fontWeight: 800, color: COLORS[0] }}>{Number(data.value).toLocaleString()}
            <span style={{ fontSize: 13, fontWeight: 400, color: '#7a7f8c', marginLeft: 8 }}>{data.label ?? ''}</span>
          </div>
        )}
        {data && widget.type === 'battery' && (
          <div>
            {data.map((b: any) => (
              <div key={b.id} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <b>{b.name}</b><span style={{ color: '#7a7f8c' }}>{b.percent}%</span>
                </div>
                <div style={{ height: 8, background: '#eef0f5', borderRadius: 4 }}>
                  <div style={{ width: `${b.percent}%`, height: '100%', borderRadius: 4, background: b.percent >= 80 ? '#00c875' : b.percent >= 40 ? '#579bfc' : '#fdab3d' }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {data && widget.type === 'bar' && <BarChart data={data} />}
        {data && widget.type === 'pie' && <PieChart data={data} />}
        {data && widget.type === 'line' && <LineChart data={data} />}
        {data && widget.type === 'table' && (
          <div>
            {data.map((r: any) => (
              <div key={r.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid #f5f6fa' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                <span style={{ color: '#a0a4b1', fontSize: 11 }}>{r.board}</span>
              </div>
            ))}
          </div>
        )}
        {data && widget.type === 'rank' && (
          <div>{data.map((r: any, i: number) => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: '#a0a4b1', width: 16 }}>{i + 1}</span>
              <b style={{ flex: 1 }}>{r.name}</b><span style={{ color: '#7a7f8c' }}>{r.cnt} 条</span>
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
    </div>
  );
}

export function DashboardEditor({ dashboardId, onBack }: { dashboardId: string; onBack: () => void }) {
  const [dash, setDash] = useState<{ id: string; name: string; widgets: Widget[] } | null>(null);
  const [boards, setBoards] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.getDashboard(dashboardId).then((d) => setDash(d)).catch((e) => setErr((e as Error).message));
  }, [dashboardId]);
  useEffect(() => { load(); api.getBoards().then((d) => setBoards(Array.isArray(d) ? d : [])).catch(() => {}); }, [load]);

  const removeWidget = async (wid: string) => {
    if (!confirm('删除这个图表？')) return;
    await api.deleteWidget(dashboardId, wid).catch(() => {});
    load();
  };

  const editTitle = async (w: Widget) => {
    const t = prompt('图表标题', w.title);
    if (t == null) return;
    await api.updateWidget(dashboardId, w.id, { title: t }).catch(() => {});
    load();
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={onBack} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#7a7f8c' }}>←</button>
        <b style={{ fontSize: 17 }}>📊 {dash?.name ?? '仪表盘'}</b>
        <span style={{ fontSize: 12, color: '#7a7f8c' }}>{dash?.widgets.length ?? 0} 个图表</span>
        <button data-add-widget onClick={() => setAdding(true)}
          style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          ＋ 添加图表
        </button>
      </div>
      {err && <div style={{ color: '#e2445c', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {dash?.widgets.length === 0 && (
        <div style={{ padding: 60, textAlign: 'center', color: '#7a7f8c', fontSize: 14 }}>
          还没有图表——点「＋ 添加图表」开始搭建你的数据看板
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {(dash?.widgets ?? []).map((w) => (
          <WidgetCard key={w.id} dashboardId={dashboardId} widget={w} boards={boards}
            onDelete={() => removeWidget(w.id)} onEditTitle={() => editTitle(w)} />
        ))}
      </div>
      {adding && (
        <AddWidgetModal boards={boards} onClose={() => setAdding(false)}
          onAdd={async (type, title, config) => {
            await api.addWidget(dashboardId, { type, title, config }).catch((e) => alert(`添加失败：${(e as Error).message}`));
            setAdding(false); load();
          }} />
      )}
    </div>
  );
}

function AddWidgetModal({ boards, onClose, onAdd }: { boards: any[]; onClose: () => void; onAdd: (type: string, title: string, config: any) => void }) {
  const [type, setType] = useState<string>('');
  const [title, setTitle] = useState('');
  const [boardId, setBoardId] = useState('');
  const [columns, setColumns] = useState<any[]>([]);
  const [groupBy, setGroupBy] = useState('');
  const [metricCol, setMetricCol] = useState('');
  const [dateCol, setDateCol] = useState('');
  const [agg, setAgg] = useState('sum');
  const [metric, setMetric] = useState<'count' | 'sum'>('count');
  const [limit, setLimit] = useState(20);

  // 选 board 后加载其列
  useEffect(() => {
    if (!boardId) { setColumns([]); return; }
    api.getBoard(boardId).then((d: any) => setColumns(d.columns ?? [])).catch(() => setColumns([]));
  }, [boardId]);

  const numCols = columns.filter((c) => c.type === 'number');
  const dateCols = columns.filter((c) => c.type === 'date');
  const catCols = columns.filter((c) => ['status', 'dropdown', 'tags', 'people', 'text'].includes(c.type));

  const needsBoard = ['number', 'battery', 'bar', 'pie', 'line', 'table'].includes(type);

  const buildConfig = () => {
    if (type === 'number') return { boardId, columnId: metricCol, agg, label: aggLabel(agg) };
    if (type === 'battery') return { boardId };
    if (type === 'bar') return { boardId, groupBy, metric, metricColumnId: metric === 'sum' ? metricCol : undefined };
    if (type === 'pie') return { boardId, groupBy, metric: 'count' };
    if (type === 'line') return { boardId, dateColumnId: dateCol };
    if (type === 'table') return { boardId, limit };
    return {};
  };

  const aggLabel = (a: string) => ({ sum: '合计', avg: '平均', count: '计数', min: '最小', max: '最大' } as any)[a] ?? a;

  const canSave = type && (['rank', 'activity'].includes(type) || boardId)
    && (type !== 'number' || metricCol) && (type !== 'bar' || groupBy) && (type !== 'pie' || groupBy) && (type !== 'line' || dateCol);

  const select = (v: string, onChange: (s: string) => void, opts: { value: string; label: string }[], placeholder: string) => (
    <select value={v} onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <div data-add-widget-modal onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,30,.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxHeight: '88vh', overflow: 'auto', background: '#fff', borderRadius: 14, padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <b style={{ fontSize: 15 }}>添加图表</b>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        {!type ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {WIDGET_TYPES.map((t) => (
              <div key={t.type} data-widget-type={t.type} onClick={() => setType(t.type)}
                style={{ padding: 14, border: '1px solid #e6e8ef', borderRadius: 10, cursor: 'pointer', textAlign: 'center', background: '#fafbfd' }}>
                <div style={{ fontSize: 24 }}>{t.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{t.label}</div>
                <div style={{ fontSize: 10, color: '#a0a4b1', marginTop: 2 }}>{t.desc}</div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: '#7a7f8c', marginBottom: 14, cursor: 'pointer' }} onClick={() => setType('')}>← 返回选择图表类型</div>
            <label style={{ fontSize: 12, color: '#5a6072' }}>标题</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="可选"
              style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13, marginBottom: 10 }} />

            {needsBoard && (
              <>
                <label style={{ fontSize: 12, color: '#5a6072' }}>数据源 Board</label>
                {select(boardId, setBoardId, boards.map((b) => ({ value: b.id, label: b.name })), '选择 Board')}
              </>
            )}

            {type === 'number' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <div style={{ flex: 1 }}>{select(metricCol, setMetricCol, numCols.map((c) => ({ value: c.id, label: c.name })), '数值列')}</div>
                <div style={{ flex: 1 }}>{select(agg, setAgg, [{ value: 'sum', label: '合计' }, { value: 'avg', label: '平均' }, { value: 'count', label: '计数' }, { value: 'min', label: '最小' }, { value: 'max', label: '最大' }], '聚合')}</div>
              </div>
            )}

            {type === 'bar' && (
              <div style={{ marginTop: 10 }}>
                {select(groupBy, setGroupBy, catCols.map((c) => ({ value: c.id, label: c.name })), '分组列（状态/多选等）')}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <div style={{ flex: 1 }}>{select(metric, setMetric as any, [{ value: 'count', label: '计数' }, { value: 'sum', label: '求和' }], '指标')}</div>
                  {metric === 'sum' && <div style={{ flex: 1 }}>{select(metricCol, setMetricCol, numCols.map((c) => ({ value: c.id, label: c.name })), '数值列')}</div>}
                </div>
              </div>
            )}

            {type === 'pie' && (
              <div style={{ marginTop: 10 }}>{select(groupBy, setGroupBy, catCols.map((c) => ({ value: c.id, label: c.name })), '分组列')}</div>
            )}

            {type === 'line' && (
              <div style={{ marginTop: 10 }}>{select(dateCol, setDateCol, dateCols.map((c) => ({ value: c.id, label: c.name })), '日期列')}</div>
            )}

            {type === 'table' && (
              <div style={{ marginTop: 10 }}>{select(String(limit), (s) => setLimit(Number(s)), [{ value: '10', label: '10 条' }, { value: '20', label: '20 条' }, { value: '50', label: '50 条' }], '条数')}</div>
            )}

            <button data-add-widget-confirm disabled={!canSave}
              onClick={() => onAdd(type, title.trim() || WIDGET_TYPES.find((t) => t.type === type)?.label || '', buildConfig())}
              style={{ marginTop: 18, width: '100%', padding: 11, borderRadius: 9, border: 'none', background: canSave ? '#4f6ef7' : '#c3c8d4', color: '#fff', cursor: canSave ? 'pointer' : 'default', fontSize: 14, fontWeight: 600 }}>
              添加
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
