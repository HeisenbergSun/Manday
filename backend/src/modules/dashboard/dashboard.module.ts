/**
 * Dashboard — 跨 Board 聚合（battery 进度 / number 汇总 / status 分布 / 逾期 / 负载排行 / 动态流）
 * 注意：请求参数走 GET ?boardIds=a,b（GET + @Body 在前端拿不到 body）
 */
import { Injectable, Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';

const DONE_SQL = `sv.value IS NULL OR sv.value #>> '{}' NOT IN ('已完成','Done')`;

@Injectable()
export class DashboardService {
  constructor(private pg: Pool) {}

  async battery(userId: string, boardIds: string[]) {
    const { rows } = await this.pg.query(
      `SELECT b.id, b.name,
              count(DISTINCT i.id) FILTER (WHERE v.value #>> '{}' IN ('已完成','Done')) AS done,
              count(DISTINCT i.id) AS total
       FROM boards b
       LEFT JOIN items i ON i.board_id = b.id AND i.deleted_at IS NULL
       LEFT JOIN board_columns c ON c.board_id = b.id AND c.type = 'status'
       LEFT JOIN item_values v ON v.item_id = i.id AND v.column_id = c.id
       WHERE b.id = ANY($1::uuid[]) AND ${VISIBLE_SQL}
       GROUP BY b.id, b.name
       ORDER BY b.name`,
      [boardIds, userId],
    );
    return rows.map((r) => {
      const total = Number(r.total) || 0;
      const done = Number(r.done) || 0;
      return { id: r.id, name: r.name, done, total, percent: total ? Math.round((done / total) * 100) : 0 };
    });
  }

  async numbers(userId: string, boardIds: string[]) {
    const { rows } = await this.pg.query(
      `SELECT b.name,
              count(DISTINCT i.id) FILTER (WHERE i.deleted_at IS NULL) AS items,
              count(DISTINCT i.id) FILTER (WHERE i.deleted_at IS NOT NULL) AS trashed
       FROM boards b LEFT JOIN items i ON i.board_id = b.id
       WHERE b.id = ANY($1::uuid[]) AND ${VISIBLE_SQL} GROUP BY b.name`,
      [boardIds, userId],
    );
    return rows;
  }

  async statusDist(userId: string, boardIds: string[]) {
    const { rows } = await this.pg.query(
      `SELECT COALESCE(v.value #>> '{}', '未设置') AS label, count(*) AS cnt
       FROM item_values v
       JOIN board_columns c ON c.id = v.column_id AND c.type = 'status'
       JOIN items i ON i.id = v.item_id AND i.deleted_at IS NULL
       JOIN boards b ON b.id = i.board_id
       WHERE i.board_id = ANY($1::uuid[]) AND ${VISIBLE_SQL}
       GROUP BY label ORDER BY cnt DESC`,
      [boardIds, userId],
    );
    return rows.map((r) => ({ label: r.label, cnt: Number(r.cnt) }));
  }

  /** 跨 Board 逾期任务（截止日已过且未完成，可见板内，Top 20） */
  async overdue(userId: string) {
    const { rows } = await this.pg.query(
      `SELECT i.id, i.name, b.name AS board, (v.value #>> '{}') AS due,
              sc.id AS status_col_id, sv.value #>> '{}' AS status
       FROM items i
       JOIN boards b ON b.id = i.board_id AND ${VISIBLE_U}
       JOIN board_columns c ON c.board_id = b.id AND c.type = 'date'
       JOIN item_values v ON v.item_id = i.id AND v.column_id = c.id
       LEFT JOIN board_columns sc ON sc.board_id = b.id AND sc.type = 'status'
       LEFT JOIN item_values sv ON sv.item_id = i.id AND sv.column_id = sc.id
       WHERE i.deleted_at IS NULL
         AND (v.value #>> '{}') <> ''
         AND (v.value #>> '{}')::date < current_date
         AND ${DONE_SQL}
       ORDER BY (v.value #>> '{}')::date
       LIMIT 20`,
      [userId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, board: r.board, due: r.due, status: r.status ?? '' }));
  }

  /** 成员负载排行：可见板内未完成条目按人员列聚合（值存用户 id，join users 取名），Top 10 */
  async workloadRank(userId: string) {
    const { rows } = await this.pg.query(
      `WITH pairs AS (
         SELECT i.id AS item_id, u2.name
         FROM item_values v
         JOIN board_columns c ON c.id = v.column_id AND c.type = 'people'
         JOIN items i ON i.id = v.item_id AND i.deleted_at IS NULL
         JOIN boards b ON b.id = i.board_id AND ${VISIBLE_U}
         LEFT JOIN board_columns sc ON sc.board_id = b.id AND sc.type = 'status'
         LEFT JOIN item_values sv ON sv.item_id = i.id AND sv.column_id = sc.id
         LEFT JOIN LATERAL (
           SELECT (CASE WHEN jsonb_typeof(x) = 'object' THEN x->>'id' ELSE x #>> '{}' END) AS uid
           FROM jsonb_array_elements(v.value) x WHERE jsonb_typeof(v.value) = 'array'
           UNION ALL
           SELECT v.value #>> '{}' WHERE jsonb_typeof(v.value) = 'string'
         ) p ON true
         LEFT JOIN users u2 ON u2.id::text = p.uid
         WHERE u2.name IS NOT NULL AND ${DONE_SQL}
       )
       SELECT name, count(*) AS cnt FROM pairs GROUP BY name ORDER BY cnt DESC LIMIT 10`,
      [userId],
    );
    return rows.map((r) => ({ name: r.name, cnt: Number(r.cnt) }));
  }

  /** 近期动态：可见板内条目相关 audit 日志，Top 15 */
  async activity(userId: string) {
    const { rows } = await this.pg.query(
      `SELECT a.action, a.created_at, u.name AS actor,
              COALESCE(i.name, a.after_val->>'name', a.target) AS target_name,
              b.name AS board
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN items i ON i.id = regexp_replace(a.target, '^item:', '')::uuid AND i.deleted_at IS NULL
       LEFT JOIN boards b ON b.id = i.board_id AND ${VISIBLE_U}
       WHERE a.target LIKE 'item:%'
       ORDER BY a.created_at DESC
       LIMIT 60`,
      [userId],
    );
    // 可见性在 SQL 里以 b 判断过滤（无板可见的行丢弃）
    return rows.filter((r) => r.board).slice(0, 15)
      .map((r) => ({ action: r.action, actor: r.actor ?? '', target: r.target_name, board: r.board, at: r.created_at }));
  }

  // ================= 自定义 Dashboard（BI 图表）=================

  /** 是否有权访问该 dashboard：本人创建，或同部门团队共享 */
  private async canAccess(userId: string, dashboardId: string): Promise<boolean> {
    const { rows } = await this.pg.query(
      `SELECT 1 FROM dashboards d
       WHERE d.id = $1 AND (d.created_by = $2
         OR d.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $2))`,
      [dashboardId, userId]);
    return rows.length > 0;
  }

  async listDashboards(userId: string) {
    const { rows } = await this.pg.query(
      `SELECT d.id, d.name, d.created_at, d.created_by = $1 AS is_owner,
              (d.department_id IS NOT NULL) AS is_team
       FROM dashboards d
       WHERE d.created_by = $1
          OR d.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $1)
       ORDER BY d.created_at`, [userId]);
    return rows;
  }

  async createDashboard(userId: string, name: string, scope: 'personal' | 'team' = 'personal') {
    const deptId = scope === 'team'
      ? (await this.pg.query(`SELECT department_id FROM user_departments WHERE user_id = $1 LIMIT 1`, [userId])).rows[0]?.department_id ?? null
      : null;
    const { rows } = await this.pg.query(
      `INSERT INTO dashboards (name, created_by, department_id) VALUES ($1,$2,$3) RETURNING id, name, created_at`, [name, userId, deptId]);
    return { ...rows[0], is_team: scope === 'team' };
  }

  async renameDashboard(userId: string, id: string, name: string) {
    if (!(await this.canAccess(userId, id))) throw new Error('NOT_FOUND');
    await this.pg.query(`UPDATE dashboards SET name=$1 WHERE id=$2`, [name, id]);
    return { ok: true };
  }

  /** 复制 dashboard（含全部 widget） */
  async duplicateDashboard(userId: string, id: string) {
    const src = (await this.pg.query(`SELECT * FROM dashboards WHERE id=$1`, [id])).rows[0];
    if (!src) throw new Error('NOT_FOUND');
    if (!(await this.canAccess(userId, id))) throw new Error('NOT_FOUND');
    const client = await this.pg.connect();
    try {
      await client.query('BEGIN');
      const nb = await client.query(
        `INSERT INTO dashboards (name, created_by, department_id) VALUES ($1,$2,$3) RETURNING id`,
        [`${src.name}（副本）`, userId, src.department_id]);
      const nid = nb.rows[0].id;
      const widgets = (await client.query(`SELECT type, title, config, position FROM widgets WHERE dashboard_id=$1 ORDER BY position`, [id])).rows;
      for (const w of widgets) {
        await client.query(
          `INSERT INTO widgets (dashboard_id, type, title, config, position) VALUES ($1,$2,$3,$4::jsonb,$5)`,
          [nid, w.type, w.title, JSON.stringify(w.config ?? {}), w.position]);
      }
      await client.query('COMMIT');
      return { id: nid, name: `${src.name}（副本）` };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteDashboard(userId: string, id: string) {
    if (!(await this.canAccess(userId, id))) throw new Error('NOT_FOUND');
    await this.pg.query(`DELETE FROM dashboards WHERE id=$1`, [id]);
    return { ok: true };
  }

  async getDashboard(userId: string, id: string) {
    if (!(await this.canAccess(userId, id))) return null;
    const d = (await this.pg.query(`SELECT id, name, created_by, department_id FROM dashboards WHERE id=$1`, [id])).rows[0];
    if (!d) return null;
    const { rows: widgets } = await this.pg.query(
      `SELECT id, type, title, config, position FROM widgets WHERE dashboard_id=$1 ORDER BY position, created_at`, [id]);
    return { ...d, widgets: widgets.map((w) => ({ ...w, config: w.config ?? {} })) };
  }

  async addWidget(userId: string, dashboardId: string, dto: { type: string; title?: string; config?: any }) {
    if (!(await this.canAccess(userId, dashboardId))) throw new Error('NOT_FOUND');
    const pos = (await this.pg.query(`SELECT COALESCE(MAX(position),0)+1 AS p FROM widgets WHERE dashboard_id=$1`, [dashboardId])).rows[0].p;
    const { rows } = await this.pg.query(
      `INSERT INTO widgets (dashboard_id, type, title, config, position) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id, type, title, config, position`,
      [dashboardId, dto.type, dto.title ?? '', JSON.stringify(dto.config ?? {}), pos]);
    return { ...rows[0], config: rows[0].config ?? {} };
  }

  async updateWidget(userId: string, dashboardId: string, widgetId: string, dto: { title?: string; type?: string; config?: any }) {
    if (!(await this.canAccess(userId, dashboardId))) throw new Error('NOT_FOUND');
    await this.pg.query(
      `UPDATE widgets SET title=COALESCE($1,title), type=COALESCE($2,type), config=COALESCE($3::jsonb,config)
       WHERE id=$4 AND dashboard_id=$5`,
      [dto.title ?? null, dto.type ?? null, dto.config ? JSON.stringify(dto.config) : null, widgetId, dashboardId]);
    return { ok: true };
  }

  async reorderWidgets(userId: string, dashboardId: string, order: string[]) {
    if (!(await this.canAccess(userId, dashboardId))) throw new Error('NOT_FOUND');
    for (let i = 0; i < order.length; i++) {
      await this.pg.query(`UPDATE widgets SET position=$1 WHERE id=$2 AND dashboard_id=$3`, [i, order[i], dashboardId]);
    }
    return { ok: true };
  }

  async deleteWidget(userId: string, dashboardId: string, widgetId: string) {
    if (!(await this.canAccess(userId, dashboardId))) throw new Error('NOT_FOUND');
    await this.pg.query(`DELETE FROM widgets WHERE id=$1 AND dashboard_id=$2`, [widgetId, dashboardId]);
    return { ok: true };
  }

  /** widget 数据端点：根据 type+config 动态取数（userId 作为可见性参数） */
  async widgetData(userId: string, widget: { type: string; config: any }) {
    const cfg = widget.config ?? {};
    const boardIds: string[] = Array.isArray(cfg.boardIds) ? cfg.boardIds : (cfg.boardId ? [cfg.boardId] : []);
    if (widget.type === 'battery') return this.battery(userId, boardIds);
    if (widget.type === 'rank') return this.workloadRank(userId);
    if (widget.type === 'activity') return this.activity(userId);
    if (!boardIds.length) return [];

    if (widget.type === 'number') {
      // 多指标：一次查 sum/avg/count/min/max，前端按 aggs 挑选
      const { rows } = await this.pg.query(
        `SELECT sum((v.value #>> '{}')::numeric) AS s, avg((v.value #>> '{}')::numeric) AS a,
                count(*) AS c, min((v.value #>> '{}')::numeric) AS mn, max((v.value #>> '{}')::numeric) AS mx
         FROM item_values v
         JOIN board_columns c ON c.id = v.column_id AND c.type = 'number' AND c.name = $3
         JOIN items i ON i.id = v.item_id AND i.deleted_at IS NULL
         JOIN boards b ON b.id = i.board_id
         WHERE i.board_id = ANY($1::uuid[]) AND ${VISIBLE_SQL}
         AND (v.value #>> '{}') ~ '^-?[0-9.]+$'`,
        [boardIds, userId, cfg.column]);
      const r = rows[0] ?? {};
      const aggs: string[] = Array.isArray(cfg.aggs) && cfg.aggs.length ? cfg.aggs : ['sum'];
      const map: Record<string, number> = { sum: Number(r.s) || 0, avg: Number(r.a) || 0, count: Number(r.c) || 0, min: Number(r.mn) || 0, max: Number(r.mx) || 0 };
      const items = aggs.map((a) => ({ label: ({ sum: '合计', avg: '平均', count: '计数', min: '最小', max: '最大' } as any)[a] ?? a, value: map[a] ?? 0, agg: a }));
      return { value: items[0]?.value ?? 0, items };
    }

    if (widget.type === 'bar' || widget.type === 'pie') {
      const metric = cfg.metric === 'sum' ? 'sum' : 'count';
      if (metric === 'sum') {
        const { rows } = await this.pg.query(
          `SELECT v.value #>> '{}' AS label, sum((mv.value #>> '{}')::numeric) AS value
           FROM item_values v
           JOIN board_columns c ON c.id = v.column_id AND c.name = $3
           JOIN items i ON i.id = v.item_id AND i.deleted_at IS NULL
           JOIN boards b ON b.id = i.board_id
           JOIN item_values mv ON mv.item_id = i.id
           JOIN board_columns mc ON mc.id = mv.column_id AND mc.type = 'number' AND mc.name = $4
           WHERE i.board_id = ANY($1::uuid[]) AND ${VISIBLE_SQL}
           GROUP BY label ORDER BY value DESC LIMIT 20`,
          [boardIds, userId, cfg.groupBy, cfg.metricColumn]);
        return rows.map((r) => ({ label: r.label ?? '（空）', value: Number(r.value) || 0 }));
      }
      const { rows } = await this.pg.query(
        `SELECT v.value #>> '{}' AS label, count(*) AS value
         FROM item_values v
         JOIN board_columns c ON c.id = v.column_id AND c.name = $3
         JOIN items i ON i.id = v.item_id AND i.deleted_at IS NULL
         JOIN boards b ON b.id = i.board_id
         WHERE i.board_id = ANY($1::uuid[]) AND ${VISIBLE_SQL}
         GROUP BY label ORDER BY value DESC LIMIT 20`,
        [boardIds, userId, cfg.groupBy]);
      return rows.map((r) => ({ label: r.label ?? '（空）', value: Number(r.value) || 0 }));
    }

    if (widget.type === 'line' || widget.type === 'area') {
      const { rows } = await this.pg.query(
        `SELECT v.value #>> '{}' AS date, count(*) AS value
         FROM item_values v
         JOIN board_columns c ON c.id = v.column_id AND c.type = 'date' AND c.name = $3
         JOIN items i ON i.id = v.item_id AND i.deleted_at IS NULL
         JOIN boards b ON b.id = i.board_id
         WHERE i.board_id = ANY($1::uuid[]) AND ${VISIBLE_SQL}
         GROUP BY date ORDER BY date`,
        [boardIds, userId, cfg.dateColumn]);
      return rows.map((r) => ({ date: String(r.date).slice(0, 10), value: Number(r.value) || 0 }));
    }

    if (widget.type === 'combo') {
      // 双轴：柱=按 groupBy 计数，线=按 metricColumn 求和
      const { rows } = await this.pg.query(
        `SELECT v.value #>> '{}' AS label, count(*) AS bar,
                COALESCE(sum((mv.value #>> '{}')::numeric), 0) AS line
         FROM item_values v
         JOIN board_columns c ON c.id = v.column_id AND c.name = $3
         JOIN items i ON i.id = v.item_id AND i.deleted_at IS NULL
         JOIN boards b ON b.id = i.board_id
         LEFT JOIN item_values mv ON mv.item_id = i.id
         LEFT JOIN board_columns mc ON mc.id = mv.column_id AND mc.type = 'number' AND mc.name = $4
         WHERE i.board_id = ANY($1::uuid[]) AND ${VISIBLE_SQL}
         GROUP BY label ORDER BY bar DESC LIMIT 20`,
        [boardIds, userId, cfg.groupBy, cfg.metricColumn]);
      return rows.map((r) => ({ label: r.label ?? '（空）', bar: Number(r.bar) || 0, line: Number(r.line) || 0 }));
    }

    if (widget.type === 'gantt') {
      const { rows } = await this.pg.query(
        `SELECT i.id, i.name, b.name AS board,
                (sv.value #>> '{}') AS start,
                (ev.value #>> '{}') AS end
         FROM items i
         JOIN boards b ON b.id = i.board_id
         JOIN board_columns sc ON sc.board_id = b.id AND sc.type = 'date' AND sc.name = $3
         JOIN item_values sv ON sv.item_id = i.id AND sv.column_id = sc.id
         LEFT JOIN board_columns ec ON ec.board_id = b.id AND ec.type = 'date' AND ec.name = $4
         LEFT JOIN item_values ev ON ev.item_id = i.id AND ev.column_id = ec.id
         WHERE i.board_id = ANY($1::uuid[]) AND i.deleted_at IS NULL AND ${VISIBLE_SQL}
           AND (sv.value #>> '{}') <> ''
         ORDER BY start LIMIT 30`,
        [boardIds, userId, cfg.startColumn, cfg.endColumn]);
      return rows.map((r) => ({ id: r.id, name: r.name, board: r.board, start: String(r.start).slice(0, 10), end: r.end ? String(r.end).slice(0, 10) : String(r.start).slice(0, 10) }));
    }

    if (widget.type === 'table') {
      const limit = Math.min(Number(cfg.limit) || 20, 50);
      const { rows } = await this.pg.query(
        `SELECT i.id, i.name, b.name AS board, i.created_at
         FROM items i JOIN boards b ON b.id = i.board_id
         WHERE i.board_id = ANY($1::uuid[]) AND i.deleted_at IS NULL AND ${VISIBLE_SQL}
         ORDER BY i.created_at DESC LIMIT $3`,
        [boardIds, userId, limit]);
      return rows.map((r) => ({ id: r.id, name: r.name, board: r.board, at: r.created_at }));
    }
    return [];
  }
}

const VISIBLE_SQL = `(b.visibility = 'company'
  OR b.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $2)
  OR b.owner_id = $2
  OR EXISTS (SELECT 1 FROM board_permissions bp WHERE bp.board_id = b.id AND bp.subject_type='user' AND bp.subject_id=$2))`;
/** 同 VISIBLE_SQL，但用户参数为 $1（无 boardIds 的查询用） */
const VISIBLE_U = VISIBLE_SQL.replace(/\$2/g, '$1');

/** 解析 ?boardIds=a,b 或重复参数 ?boardIds=a&boardIds=b */
function parseIds(q: string | string[] | undefined): string[] {
  if (!q) return [];
  const arr = Array.isArray(q) ? q : String(q).split(',');
  return arr.map((s) => s.trim()).filter(Boolean);
}

@Controller('dashboards')
export class DashboardController {
  constructor(private svc: DashboardService) {}

  @Get('battery')
  battery(@Req() req, @Query('boardIds') q: string) {
    return this.svc.battery(req.user.id, parseIds(q));
  }

  @Get('numbers')
  numbers(@Req() req, @Query('boardIds') q: string) {
    return this.svc.numbers(req.user.id, parseIds(q));
  }

  @Get('status-dist')
  dist(@Req() req, @Query('boardIds') q: string) {
    return this.svc.statusDist(req.user.id, parseIds(q));
  }

  @Get('overdue')
  overdue(@Req() req) {
    return this.svc.overdue(req.user.id);
  }

  @Get('workload-rank')
  rank(@Req() req) {
    return this.svc.workloadRank(req.user.id);
  }

  @Get('activity')
  activity(@Req() req) {
    return this.svc.activity(req.user.id);
  }

  // ---- 自定义 Dashboard CRUD ----
  @Get() list(@Req() req) { return this.svc.listDashboards(req.user.id); }
  @Post() create(@Req() req, @Body() b: { name: string; scope?: 'personal' | 'team' }) { return this.svc.createDashboard(req.user.id, b.name, b.scope ?? 'personal'); }
  @Get(':id') get(@Req() req, @Param('id') id: string) { return this.svc.getDashboard(req.user.id, id); }
  @Post(':id/duplicate') duplicate(@Req() req, @Param('id') id: string) { return this.svc.duplicateDashboard(req.user.id, id); }
  @Patch(':id') rename(@Req() req, @Param('id') id: string, @Body() b: { name: string }) { return this.svc.renameDashboard(req.user.id, id, b.name); }
  @Delete(':id') remove(@Req() req, @Param('id') id: string) { return this.svc.deleteDashboard(req.user.id, id); }
  @Post(':id/widgets') addWidget(@Req() req, @Param('id') id: string, @Body() b: { type: string; title?: string; config?: any }) { return this.svc.addWidget(req.user.id, id, b); }
  @Post(':id/widgets/reorder') reorderWidgets(@Req() req, @Param('id') id: string, @Body() b: { order: string[] }) { return this.svc.reorderWidgets(req.user.id, id, b.order ?? []); }
  @Patch(':id/widgets/:wid') updateWidget(@Req() req, @Param('id') id: string, @Param('wid') wid: string, @Body() b: { title?: string; type?: string; config?: any }) { return this.svc.updateWidget(req.user.id, id, wid, b); }
  @Delete(':id/widgets/:wid') deleteWidget(@Req() req, @Param('id') id: string, @Param('wid') wid: string) { return this.svc.deleteWidget(req.user.id, id, wid); }
  @Get(':id/widgets/:wid/data') widgetData(@Req() req, @Param('id') id: string, @Param('wid') wid: string) {
    return this.svc.getDashboard(req.user.id, id).then((d) => {
      const w = d?.widgets?.find((x) => x.id === wid);
      if (!w) return [];
      return this.svc.widgetData(req.user.id, w);
    });
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
