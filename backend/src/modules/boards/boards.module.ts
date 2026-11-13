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

  /** Board 级角色解析（与 items.controller.resolveRoleForItem 同一规则） */
  private async resolveRole(boardId: string, userId: string) {
    const { rows: br } = await this.pg.query(
      `SELECT b.owner_id, b.visibility, bp.role,
              EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = $2
                      AND ud.department_id = b.department_id) AS in_dept
       FROM boards b
       LEFT JOIN board_permissions bp ON bp.board_id = b.id AND bp.subject_type = 'user' AND bp.subject_id = $2
       WHERE b.id = $1`, [boardId, userId]);
    if (!br.length) return null;
    const r = br[0];
    return r.role ?? (r.owner_id === userId ? 'owner'
      : (r.visibility === 'company' || (r.visibility === 'department' && r.in_dept)) ? 'editor' : 'viewer');
  }

  /** Board 详情（条目 + 动态列 + 分组，一次性返回，前端冷启动/冲突重载用） */
  async detail(boardId: string, userId: string) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'read')) throw new Error('FORBIDDEN');
    const { rows: b } = await this.pg.query(
      `SELECT * FROM boards WHERE id = $1 AND is_archived = false`, [boardId]);
    if (!b.length) throw new Error('NOT_FOUND');
    const { rows: columns } = await this.pg.query(
      `SELECT * FROM board_columns WHERE board_id = $1 ORDER BY position`, [boardId]);
    const { rows: groups } = await this.pg.query(
      `SELECT id, name, position, color FROM board_groups WHERE board_id = $1 ORDER BY position`, [boardId]);
    const { rows: items } = await this.pg.query(
      `SELECT i.id, i.group_id, i.name, i.position, i.version,
              jsonb_agg(jsonb_build_object('k', iv.column_id, 'v', iv.value #>> '{}')) AS kv
       FROM items i
       LEFT JOIN item_values iv ON iv.item_id = i.id
       WHERE i.board_id = $1 AND i.deleted_at IS NULL AND i.parent_item_id IS NULL
       GROUP BY i.id ORDER BY i.position`, [boardId]);
    const itemRows = items.map((r) => {
      const values: Record<string, unknown> = {};
      for (const kv of r.kv ?? []) values[kv.k] = kv.v;
      return { ...r, values };
    });
    return { board: b[0], columns, groups, items: itemRows };
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
  async recycleBin(boardId: string, userId: string) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'read')) throw new Error('FORBIDDEN');
    const { rows } = await this.pg.query(
      `SELECT id, name, deleted_at FROM items
       WHERE board_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
      [boardId],
    );
    return rows;
  }

  async restore(itemIds: string[], userId: string) {
    const bid = (await this.pg.query(`SELECT board_id FROM items WHERE id = $1`, [itemIds[0]])).rows[0]?.board_id;
    const userRole = bid ? await this.resolveRole(bid, userId) : null;
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    await this.pg.query(`UPDATE items SET deleted_at = NULL WHERE id = ANY($1::uuid[])`, [itemIds]);
    await this.pg.query(
      `INSERT INTO audit_logs (user_id, action, target, source)
       VALUES ($1,'item.restore',$2,'ui')`,
      [userId, `items:${itemIds.length}`],
    );
    return { restored: itemIds.length };
  }

  /** —— 列管理 —— */
  async addColumn(boardId: string, userId: string, dto: { name: string; type: string; settings?: any }) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    if (!['text', 'status', 'people', 'date', 'number'].includes(dto.type)) throw new Error('BAD_TYPE');
    const settings = dto.settings ?? (dto.type === 'status'
      ? { labels: [{ label: '待办', color: '#8a90a3' }, { label: '进行中', color: '#579bfc' }, { label: '已完成', color: '#00c875' }], doneLabels: ['已完成'] }
      : {});
    const pos = (await this.pg.query(`SELECT COALESCE(MAX(position),0)+1 AS p FROM board_columns WHERE board_id = $1`, [boardId])).rows[0].p;
    const { rows } = await this.pg.query(
      `INSERT INTO board_columns (board_id, type, name, settings, position) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *`,
      [boardId, dto.type, dto.name, JSON.stringify(settings), pos]);
    await this.pg.query(`INSERT INTO audit_logs (user_id, action, target, source) VALUES ($1,'column.create',$2,'ui')`, [userId, dto.name]);
    return rows[0];
  }

  async renameColumn(boardId: string, colId: string, userId: string, dto: { name?: string; settings?: any }) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    const { rows } = await this.pg.query(
      `UPDATE board_columns SET
         name = COALESCE($3, name),
         settings = COALESCE($4::jsonb, settings)
       WHERE id = $2 AND board_id = $1 RETURNING *`,
      [boardId, colId, dto.name ?? null, dto.settings ? JSON.stringify(dto.settings) : null]);
    if (!rows.length) throw new Error('NOT_FOUND');
    return rows[0];
  }

  async deleteColumn(boardId: string, colId: string, userId: string) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    await this.pg.query(`DELETE FROM item_values WHERE column_id = $1`, [colId]);
    await this.pg.query(`DELETE FROM board_columns WHERE id = $1 AND board_id = $2`, [colId, boardId]);
    await this.pg.query(`INSERT INTO audit_logs (user_id, action, target, source) VALUES ($1,'column.delete',$2,'ui')`, [userId, colId]);
    return { deleted: true };
  }

  /** —— 分组管理 —— */
  async addGroup(boardId: string, userId: string, dto: { name: string }) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    const pos = (await this.pg.query(`SELECT COALESCE(MAX(position),0)+1 AS p FROM board_groups WHERE board_id = $1`, [boardId])).rows[0].p;
    const { rows } = await this.pg.query(
      `INSERT INTO board_groups (board_id, name, position) VALUES ($1,$2,$3) RETURNING *`,
      [boardId, dto.name, pos]);
    return rows[0];
  }

  async renameGroup(boardId: string, gid: string, userId: string, dto: { name?: string; color?: string }) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    const { rows } = await this.pg.query(
      `UPDATE board_groups SET name = COALESCE($3, name), color = COALESCE($4, color)
       WHERE id = $2 AND board_id = $1 RETURNING *`,
      [boardId, gid, dto.name ?? null, dto.color ?? null]);
    if (!rows.length) throw new Error('NOT_FOUND');
    return rows[0];
  }

  async deleteGroup(boardId: string, gid: string, userId: string) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    await this.pg.query(`UPDATE items SET group_id = NULL WHERE group_id = $1`, [gid]);
    await this.pg.query(`DELETE FROM board_groups WHERE id = $1 AND board_id = $2`, [gid, boardId]);
    return { deleted: true };
  }

  /** —— 成员与权限 —— */
  /** Board 成员列表：owner + 显式授权的用户，带姓名邮箱 */
  async listMembers(boardId: string, userId: string) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'read')) throw new Error('FORBIDDEN');
    const owner = (await this.pg.query(`SELECT owner_id FROM boards WHERE id = $1`, [boardId])).rows[0]?.owner_id;
    const { rows } = await this.pg.query(
      `SELECT u.id, u.name, u.email, u.avatar_url,
              CASE WHEN u.id = $2 THEN 'owner' ELSE bp.role END AS role,
              (u.id = $2) AS is_owner
       FROM board_permissions bp
       JOIN users u ON u.id = bp.subject_id
       WHERE bp.board_id = $1 AND bp.subject_type = 'user'
       ORDER BY (u.id = $2) DESC, u.name`,
      [boardId, owner]);
    const ownerRow = owner
      ? (await this.pg.query(`SELECT id, name, email, avatar_url FROM users WHERE id = $1`, [owner])).rows[0]
      : null;
    const ids = new Set(rows.map((r) => r.id));
    const list = ownerRow && !ids.has(ownerRow.id)
      ? [{ ...ownerRow, role: 'owner', is_owner: true }, ...rows]
      : rows;
    return list;
  }

  /** 添加成员（已有则改角色） */
  async addMember(boardId: string, userId: string, dto: { userId: string; role: string }) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    if (!['owner', 'editor', 'viewer', 'guest'].includes(dto.role)) throw new Error('BAD_ROLE');
    const u = (await this.pg.query(`SELECT id, name, email FROM users WHERE id = $1`, [dto.userId])).rows[0];
    if (!u) throw new Error('USER_NOT_FOUND');
    const owner = (await this.pg.query(`SELECT owner_id FROM boards WHERE id = $1`, [boardId])).rows[0]?.owner_id;
    if (dto.userId === owner) throw new Error('OWNER_ALREADY');
    await this.pg.query(
      `INSERT INTO board_permissions (board_id, subject_type, subject_id, role)
       VALUES ($1,'user',$2,$3)
       ON CONFLICT (board_id, subject_type, subject_id) DO UPDATE SET role = EXCLUDED.role`,
      [boardId, dto.userId, dto.role]);
    return { ...u, role: dto.role, is_owner: false };
  }

  /** 移除成员 */
  async removeMember(boardId: string, targetUserId: string, userId: string) {
    const userRole = await this.resolveRole(boardId, userId);
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    const owner = (await this.pg.query(`SELECT owner_id FROM boards WHERE id = $1`, [boardId])).rows[0]?.owner_id;
    if (targetUserId === owner) throw new Error('CANNOT_REMOVE_OWNER');
    await this.pg.query(
      `DELETE FROM board_permissions WHERE board_id = $1 AND subject_type = 'user' AND subject_id = $2`,
      [boardId, targetUserId]);
    return { removed: true };
  }

  /** 可选成员列表（全公司用户） */
  async listUsers() {
    const { rows } = await this.pg.query(
      `SELECT id, name, email FROM users WHERE status = 'active' ORDER BY name LIMIT 200`);
    return rows;
  }
}

@Controller('users')
export class UsersController {
  constructor(private svc: BoardsService) {}
  @Get() list(@Req() req) { return this.svc.listUsers(); }
}

@Controller('boards')
export class BoardsController {
  constructor(private svc: BoardsService) {}
  @Get() list(@Req() req) { return this.svc.listForUser(req.user.id); }
  @Post() create(@Req() req, @Body() dto: any) { return this.svc.create(req.user.id, dto); }
  @Get(':id') detail(@Req() req, @Param('id') id: string) {
    return this.svc.detail(id, req.user.id);
  }
  @Post(':id/columns') addColumn(@Req() req, @Param('id') id: string, @Body() b: { name: string; type: string; settings?: any }) {
    return this.svc.addColumn(id, req.user.id, b);
  }
  @Patch(':id/columns/:colId') renameColumn(@Req() req, @Param('id') id: string, @Param('colId') colId: string, @Body() b: { name?: string; settings?: any }) {
    return this.svc.renameColumn(id, colId, req.user.id, b);
  }
  @Delete(':id/columns/:colId') deleteColumn(@Req() req, @Param('id') id: string, @Param('colId') colId: string) {
    return this.svc.deleteColumn(id, colId, req.user.id);
  }
  @Post(':id/groups') addGroup(@Req() req, @Param('id') id: string, @Body() b: { name: string }) {
    return this.svc.addGroup(id, req.user.id, b);
  }
  @Patch(':id/groups/:gid') renameGroup(@Req() req, @Param('id') id: string, @Param('gid') gid: string, @Body() b: { name?: string; color?: string }) {
    return this.svc.renameGroup(id, gid, req.user.id, b);
  }
  @Delete(':id/groups/:gid') deleteGroup(@Req() req, @Param('id') id: string, @Param('gid') gid: string) {
    return this.svc.deleteGroup(id, gid, req.user.id);
  }
  @Get(':id/members') listMembers(@Req() req, @Param('id') id: string) {
    return this.svc.listMembers(id, req.user.id);
  }
  @Post(':id/members') addMember(@Req() req, @Param('id') id: string, @Body() b: { userId: string; role: string }) {
    return this.svc.addMember(id, req.user.id, b);
  }
  @Delete(':id/members/:memberId') removeMember(@Req() req, @Param('id') id: string, @Param('memberId') memberId: string) {
    return this.svc.removeMember(id, memberId, req.user.id);
  }
  @Get(':id/recycle-bin') recycle(@Req() req, @Param('id') id: string) { return this.svc.recycleBin(id, req.user.id); }
  @Post(':id/restore') restore(@Req() req, @Body() b: { itemIds: string[] }) {
    return this.svc.restore(b.itemIds, req.user.id);
  }
}

@Module({ controllers: [BoardsController, UsersController], providers: [BoardsService] })
export class BoardsModule {}
