/**
 * Dashboard — 跨 Board 聚合（battery 进度 / number 汇总 / status 分布）
 * 注意：请求参数走 GET ?boardIds=a,b（GET + @Body 在前端拿不到 body）
 */
import { Injectable, Controller, Get, Query, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';

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
}

const VISIBLE_SQL = `(b.visibility = 'company'
  OR b.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $2)
  OR b.owner_id = $2
  OR EXISTS (SELECT 1 FROM board_permissions bp WHERE bp.board_id = b.id AND bp.subject_type='user' AND bp.subject_id=$2))`;

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
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
