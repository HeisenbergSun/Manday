/**
 * Dashboard — 跨 Board 聚合（battery 进度 / number 汇总 / status 分布 / 逾期 / 负载排行 / 动态流）
 * 注意：请求参数走 GET ?boardIds=a,b（GET + @Body 在前端拿不到 body）
 */
import { Injectable, Controller, Get, Query, Req, Module } from '@nestjs/common';
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
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
