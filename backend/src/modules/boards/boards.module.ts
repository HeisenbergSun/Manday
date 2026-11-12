/**
 * Boards 服务 — Board/Group/Column CRUD + 可见性过滤 + 回收站
 */
import { Injectable, Controller, Get, Post, Patch, Delete, Body, Param, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { can } from './acl';

/** 可见性过滤 SQL：Board 权限 > 部门 > 全员（P0 规则，权限治理用） */
const VISIBLE_WHERE = `
  (b.visibility = 'company'
   OR b.visibility = 'department' AND b.department_id IN (
     SELECT department_id FROM user_departments WHERE user_id = $1)
   OR b.owner_id = $1
   OR EXISTS (SELECT 1 FROM board_permissions bp
              WHERE bp.board_id = b.id AND bp.subject_type = 'user' AND bp.subject_id = $1)
   OR EXISTS (SELECT 1 FROM board_permissions bp
              JOIN user_departments ud ON ud.department_id = bp.subject_id AND bp.subject_type = 'department'
              WHERE bp.board_id = b.id AND ud.user_id = $1))`;

@Injectable()
export class BoardsService {
  constructor(private pg: Pool) {}

  /** 我能看到的 Board 列表（含我在其中的角色，供前端灰控件） */
  async listForUser(userId: string) {
    const { rows } = await this.pg.query(
      `SELECT b.*, bp.role AS my_role, d.name AS department_name
       FROM boards b
       LEFT JOIN departments d ON d.id = b.department_id
       LEFT JOIN board_permissions bp ON bp.board_id = b.id AND bp.subject_type = 'user' AND bp.subject_id = $1
       WHERE b.is_archived = false AND ${VISIBLE_WHERE}
       ORDER BY b.created_at DESC`,
      [userId],
    );
    return rows;
  }

  async create(userId: string, dto: { name: string; departmentId?: string; visibility?: string }) {
    const { rows } = await this.pg.query(
      `INSERT INTO boards (name, department_id, visibility, owner_id)
       VALUES ($1,$2,COALESCE($3,'department'),$4) RETURNING *`,
      [dto.name, dto.departmentId, dto.visibility, userId],
    );
    const board = rows[0];
    // 默认三组 + Owner 权限
    await this.pg.query(
      `INSERT INTO board_groups (board_id, name, position) VALUES ($1,'待办',1),($1,'进行中',2),($1,'已完成',3)`,
      [board.id],
    );
    await this.pg.query(
      `INSERT INTO board_permissions (board_id, subject_type, subject_id, role)
       VALUES ($1,'user',$2,'owner') ON CONFLICT DO NOTHING`,
      [board.id, userId],
    );
    return board;
  }

  /** 回收站（P0 刚需）：列出已删除条目，支持恢复 */
  async recycleBin(boardId: string, userRole: any) {
    if (!can(userRole, 'read')) throw new Error('FORBIDDEN');
    const { rows } = await this.pg.query(
      `SELECT id, name, deleted_at FROM items
       WHERE board_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
      [boardId],
    );
    return rows;
  }

  async restore(itemIds: string[], userRole: any, userId: string) {
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    await this.pg.query(`UPDATE items SET deleted_at = NULL WHERE id = ANY($1::uuid[])`, [itemIds]);
    await this.pg.query(
      `INSERT INTO audit_logs (user_id, action, target, source)
       VALUES ($1,'item.restore',$2,'ui')`,
      [userId, `items:${itemIds.length}`],
    );
    return { restored: itemIds.length };
  }
}

@Controller('boards')
export class BoardsController {
  constructor(private svc: BoardsService) {}
  @Get() list(@Req() req) { return this.svc.listForUser(req.user.id); }
  @Post() create(@Req() req, @Body() dto: any) { return this.svc.create(req.user.id, dto); }
  @Get(':id/recycle-bin') recycle(@Req() req) { return this.svc.recycleBin(req.params.id, req.user.role); }
  @Post(':id/restore') restore(@Req() req, @Body() b: { itemIds: string[] }) {
    return this.svc.restore(b.itemIds, req.user.role, req.user.id);
  }
}

@Module({ controllers: [BoardsController], providers: [BoardsService] })
export class BoardsModule {}
