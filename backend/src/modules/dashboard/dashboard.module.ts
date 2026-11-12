/**
 * Dashboard — 跨 Board 聚合（P1 范围提前实现 3 个预置组件的数据端）
 * widgets.type: battery(进度) / number(汇总) / chart(状态分布)
 */
import { Injectable, Controller, Get, Post, Body, Param, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DashboardService {
  constructor(private pg: Pool) {}

  /** Battery 进度条：多 Board 完成率（status='已完成' 占比） */
  async battery(userId: string, boardIds: string[]) {
    const { rows } = await this.pg.query(
      `SELECT b.id, b.name,
              count(i.id) FILTER (WHERE v.value->>'label' IN ('已完成','Done')) AS done,
              count(i.id) AS total
       FROM boards b
       LEFT JOIN items i ON i.board_id = b.id AND i.deleted_at IS NULL
       LEFT JOIN item_values v ON v.item_id = i.id
       LEFT JOIN board_columns c ON c.id = v.column_id AND c.type = 'status'
       WHERE b.id = ANY($1::uuid[]) AND ${VISIBLE_SQL}
       GROUP BY b.id, b.name`,
      [boardIds, userId],
    );
    return rows.map((r) => ({ ...r, percent: r.total ? Math.round((r.done / r.total) * 100) : 0 }));
  }

  /** 数字汇总：count/sum 指标 */
  async numbers(userId: string, boardIds: string[]) {
    const { rows } = await this.pg.query(
      `SELECT b.name,
              count(DISTINCT i.id) AS items,
              count(DISTINCT i.id) FILTER (WHERE i.deleted_at IS NOT NULL) AS trashed
       FROM boards b LEFT JOIN items i ON i.board_id = b.id
       WHERE b.id = ANY($1::uuid[]) AND ${VISIBLE_SQL} GROUP BY b.name`,
      [boardIds, userId],
    );
    return rows;
  }

  /** 状态分布（饼图数据）：按 status 列的 value->>label 分组 */
  async statusDist(userId: string, boardIds: string[]) {
    const { rows } = await this.pg.query(
      `SELECT COALESCE(v.value->>'label','未设置') AS label, count(*) AS cnt
       FROM item_values v
       JOIN board_columns c ON c.id = v.column_id AND c.type = 'status'
       JOIN items i ON i.id = v.item_id AND i.deleted_at IS NULL
       JOIN boards b ON b.id = i.board_id
       WHERE i.board_id = ANY($1::uuid[]) AND ${VISIBLE_SQL}
       GROUP BY label ORDER BY cnt DESC`,
      [boardIds, userId],
    );
    return rows;
  }
}

const VISIBLE_SQL = `(b.visibility = 'company'
  OR b.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $2)
  OR b.owner_id = $2
  OR EXISTS (SELECT 1 FROM board_permissions bp WHERE bp.board_id = b.id AND bp.subject_type='user' AND bp.subject_id=$2))`;

@Controller('dashboards')
export class DashboardController {
  constructor(private svc: DashboardService) {}
  @Get('battery') battery(@Req() req, @Body() b: { boardIds: string[] }) {
    return this.svc.battery(req.user.id, b.boardIds);
  }
  @Get('numbers') numbers(@Req() req, @Body() b: { boardIds: string[] }) {
    return this.svc.numbers(req.user.id, b.boardIds);
  }
  @Get('status-dist') dist(@Req() req, @Body() b: { boardIds: string[] }) {
    return this.svc.statusDist(req.user.id, b.boardIds);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
