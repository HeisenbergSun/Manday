/**
 * Dashboard 编辑页 — Monday 式 BI 工作台
 * 每个 widget 可关联多个 board，跨板按「列名 + 类型」聚合
 * 支持：数字卡 / 进度 / 柱状图 / 饼图 / 折线图 / 表格 / 成员排行 / 动态流
 * 图表可新增 / 编辑配置 / 删除 / 重命名
 */
import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const COLORS = ['#579bfc', '#00c875', '#fdab3d', '#e2445c', '#9d3dd7', '#00d1d1', '#ff8a65', '#a25ddc'];
const WIDGET_TYPES: { type: string; label: string; icon: string; desc: string }[] = [
  { type: 'number', label: '数字卡', icon: '🔢', desc: '多 Board 数值列聚合' },
  { type: 'battery', label: '进度条', icon: '🔋', desc: '多 Board 完成百分比' },
  { type: 'bar', label: '柱状图', icon: '📊', desc: '跨 Board 按列分组统计' },
  { type: 'pie', label: '饼图', icon: '🥧', desc: '跨 Board 分组占比' },
  { type: 'line', label: '折线图', icon: '📈', desc: '跨 Board 按日期趋势' },
  { type: 'table', label: '表格', icon: '📋', desc: '多 Board 条目列表' },
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

function WidgetCard({ dashboardId, widget, boards, onDelete, onEdit }: {
  dashboardId: string; widget: Widget; boards: any[]; onDelete: () => void; onEdit: () => void;
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
  const boardIds = widget.config?.boardIds ?? [];
  const boardHint = boardIds.length ? `${boardIds.length} 个 Board` : '';

  return (
    <div data-widget={widget.type} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e6e8ef', padding: 16, minHeight: 160, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <b style={{ fontSize: 13, flex: 1 }}>{title}</b>
        <span style={{ fontSize: 11, color: '#a0a4b1' }}>{boardHint}</span>
        <span onClick={onEdit} title="编辑配置" data-widget-edit
          style={{ cursor: 'pointer', color: '#4f6ef7', fontSize: 12 }}>⚙</span>
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
  const [editing, setEditing] = useState<Widget | null | 'new'>(null);
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

  const saveWidget = async (type: string, title: string, config: any) => {
    if (editing === 'new') {
      await api.addWidget(dashboardId, { type, title, config }).catch((e) => alert(`添加失败：${(e as Error).message}`));
    } else if (editing && typeof editing === 'object') {
      await api.updateWidget(dashboardId, editing.id, { title, config }).catch((e) => alert(`保存失败：${(e as Error).message}`));
    }
    setEditing(null);
    load();
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={onBack} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#7a7f8c' }}>←</button>
        <b style={{ fontSize: 17 }}>📊 {dash?.name ?? '仪表盘'}</b>
        <span style={{ fontSize: 12, color: '#7a7f8c' }}>{dash?.widgets.length ?? 0} 个图表</span>
        <button data-add-widget onClick={() => setEditing('new')}
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
            onDelete={() => removeWidget(w.id)} onEdit={() => setEditing(w)} />
        ))}
      </div>
      {editing && (
        <WidgetConfigModal boards={boards}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSave={saveWidget} />
      )}
    </div>
  );
}

/** 图表配置弹窗：新建（先选类型）或编辑（预填） */
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
  const [agg, setAgg] = useState(initial?.config?.agg ?? 'sum');
  const [dateColumn, setDateColumn] = useState(initial?.config?.dateColumn ?? '');
  const [limit, setLimit] = useState(initial?.config?.limit ?? 20);
  // 已选 board 的列（按列名去重，跨板匹配）
  const [colNames, setColNames] = useState<{ cat: string[]; num: string[]; date: string[] }>({ cat: [], num: [], date: [] });

  useEffect(() => {
    if (!boardIds.length) { setColNames({ cat: [], num: [], date: [] }); return; }
    let alive = true;
    Promise.all(boardIds.map((id) => api.getBoard(id).catch(() => null)))
      .then((list) => {
        if (!alive) return;
        const cat = new Set<string>(), num = new Set<string>(), date = new Set<string>();
        for (const d of list) {
          for (const c of (d?.columns ?? [])) {
            if (['status', 'dropdown', 'tags', 'people', 'text'].includes(c.type)) cat.add(c.name);
            else if (c.type === 'number') num.add(c.name);
            else if (c.type === 'date') date.add(c.name);
          }
        }
        setColNames({ cat: [...cat], num: [...num], date: [...date] });
      }).catch(() => {});
    return () => { alive = false; };
  }, [JSON.stringify(boardIds)]);

  const toggleBoard = (id: string) => setBoardIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const needsBoard = ['number', 'battery', 'bar', 'pie', 'line', 'table'].includes(type);
  const canSave = type && (['rank', 'activity'].includes(type) || boardIds.length)
    && (type !== 'number' || column) && (type !== 'bar' || groupBy) && (type !== 'pie' || groupBy) && (type !== 'line' || dateColumn);

  const buildConfig = () => {
    const cfg: any = { boardIds };
    if (type === 'number') { cfg.column = column; cfg.agg = agg; }
    if (type === 'bar') { cfg.groupBy = groupBy; cfg.metric = metric; if (metric === 'sum') cfg.metricColumn = metricColumn; }
    if (type === 'pie') { cfg.groupBy = groupBy; cfg.metric = 'count'; }
    if (type === 'line') cfg.dateColumn = dateColumn;
    if (type === 'table') cfg.limit = limit;
    return cfg;
  };

  const select = (v: string, onChange: (s: string) => void, opts: string[], placeholder: string) => (
    <select value={v} onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
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
      <div onClick={(e) => e.stopPropagation()} style={{ width: 620, maxHeight: '88vh', overflow: 'auto', background: '#fff', borderRadius: 14, padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <b style={{ fontSize: 15 }}>{isEdit ? '编辑图表' : '添加图表'}</b>
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
            {!isEdit && (
              <div style={{ fontSize: 12, color: '#7a7f8c', marginBottom: 14, cursor: 'pointer' }} onClick={() => setType('')}>← 返回选择图表类型</div>
            )}
            {field('标题', <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="可选"
              style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }} />)}

            {needsBoard && field('数据源 Board（可多选，跨 Board 按同名列聚合）', (
              <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid #e6e8ef', borderRadius: 8, padding: 6 }}>
                {boards.map((b) => (
                  <label key={b.id} data-board-option={b.name}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}>
                    <input type="checkbox" checked={boardIds.includes(b.id)} onChange={() => toggleBoard(b.id)} />
                    <span>{b.name}</span>
                  </label>
                ))}
                {boards.length === 0 && <span style={{ color: '#a0a4b1', fontSize: 12, padding: 6 }}>暂无 Board</span>}
              </div>
            ))}

            {type === 'number' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>{field('数值列', select(column, setColumn, colNames.num, '选择数值列（跨板同名）'))}</div>
                <div style={{ flex: 1 }}>{field('聚合', select(agg, setAgg, ['sum', 'avg', 'count', 'min', 'max'], '聚合方式'))}</div>
              </div>
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

            {type === 'line' && field('日期列', select(dateColumn, setDateColumn, colNames.date, '日期列（跨板同名）'))}

            {type === 'table' && field('显示条数', select(String(limit), (s) => setLimit(Number(s)), ['10', '20', '50'], '条数'))}

            <button data-widget-save disabled={!canSave}
              onClick={() => onSave(type, title.trim() || WIDGET_TYPES.find((t) => t.type === type)?.label || '', buildConfig())}
              style={{ marginTop: 18, width: '100%', padding: 11, borderRadius: 9, border: 'none', background: canSave ? '#4f6ef7' : '#c3c8d4', color: '#fff', cursor: canSave ? 'pointer' : 'default', fontSize: 14, fontWeight: 600 }}>
              {isEdit ? '保存' : '添加'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
