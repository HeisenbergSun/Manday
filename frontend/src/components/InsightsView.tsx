/**
 * 分析视图 — board 级自定义 Dashboard（复用 DashboardEditor 的 widget 编辑）
 * 首次打开自动创建 board 分析 dashboard，并预置默认图表（状态/成员/日期/分组）
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import { DashboardEditor } from './DashboardEditor';

const DEFAULT_WIDGETS: { type: string; title: string; config: any }[] = [
  { type: 'pie', title: '状态分布', config: { groupBy: '状态' } },
  { type: 'rank', title: '成员负载', config: {} },
  { type: 'bar', title: '状态计数', config: { groupBy: '状态', metric: 'count' } },
  { type: 'battery', title: '完成进度', config: {} },
];

export function InsightsView({ boardId, onOpenItem, onBack }: { boardId: string; onOpenItem?: (itemId: string) => void; onBack?: () => void }) {
  const [dashId, setDashId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d: any = await api.getOrCreateBoardDashboard(boardId);
        if (!alive) return;
        // 首次（无 widget）先预置默认图表，再挂载 DashboardEditor
        const dd: any = await api.getDashboard(d.id);
        if (alive && (dd?.widgets ?? []).length === 0) {
          for (const w of DEFAULT_WIDGETS) {
            const config = { ...w.config, boardIds: [boardId] };
            await api.addWidget(d.id, { type: w.type, title: w.title, config }).catch(() => {});
          }
        }
        if (alive) setDashId(d.id);
      } catch { /* 忽略 */ }
    })();
    return () => { alive = false; };
  }, [boardId]);

  if (!dashId) {
    return <div style={{ padding: 40, color: '#7a7f8c', fontSize: 14 }}>加载分析…</div>;
  }
  return <DashboardEditor dashboardId={dashId} onBack={onBack ?? (() => {})} onOpenItem={onOpenItem} />;
}
