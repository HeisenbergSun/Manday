/**
 * Items 路由 — 之前只有 Service 没接 Controller（前端 404 的根因）
 * 角色解析：board_permissions 显式授权 > owner > company 可见(试用=editor) > 部门成员(editor)
 */
import { Controller, Get, Patch, Post, Body, Param, Req, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { ItemsService } from './items.service';
import { BoardRole } from '../boards/acl';

@Controller('boards')
export class BoardsItemsController {
  constructor(private readonly items: ItemsService, private readonly pg: Pool) {}

  /** 解析用户在某 Board 的角色（ACL 唯一身份来源） */
  private async resolveBoardRole(boardId: string, userId: string): Promise<BoardRole | null> {
    const { rows } = await this.pg.query(
      `SELECT b.owner_id, b.visibility, bp.role,
              EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = $2
                      AND ud.department_id = b.department_id) AS in_dept
       FROM boards b
       LEFT JOIN board_permissions bp ON bp.board_id = b.id AND bp.subject_type = 'user' AND bp.subject_id = $2
       WHERE b.id = $1`,
      [boardId, userId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    if (r.role) return r.role;
    if (r.owner_id === userId) return 'owner';
    if (r.visibility === 'company') return 'editor'; // P0 试用：公司可见即可编辑，P1 收紧
    if (r.visibility === 'department' && r.in_dept) return 'editor';
    return 'viewer'; // 其余可见者只读
  }

  @Post(':id/items')
  async createItem(@Req() req: any, @Param('id') boardId: string, @Body() b: { name?: string; groupId?: string }) {
    const role = await this.resolveBoardRole(boardId, req.user.id);
    return this.items.createItem(boardId, b.name ?? '', b.groupId ?? null, role, req.user.id);
  }

  @Get(':id/items')
  async getBoard(@Req() req: any, @Param('id') boardId: string) {
    const role = await this.resolveBoardRole(boardId, req.user.id);
    const items = await this.items.getBoardItems(boardId, role);
    const { rows: columns } = await this.pg.query(
      `SELECT id, type, name, settings, position FROM board_columns
       WHERE board_id = $1 ORDER BY position`, [boardId]);
    const groups = await this.items.listGroups(boardId);
    return { items, columns, groups };
  }
}

@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService, private readonly pg: Pool) {}

  /** item → board 角色解析（写操作入口统一走这里） */
  private async resolveRoleForItem(itemId: string, userId: string): Promise<{ role: BoardRole | null; boardId: string | null }> {
    const { rows } = await this.pg.query(`SELECT board_id FROM items WHERE id = $1`, [itemId]);
    if (!rows.length) throw new ForbiddenException();
    const boardId = rows[0].board_id;
    const { rows: br } = await this.pg.query(
      `SELECT b.owner_id, b.visibility, bp.role,
              EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = $2
                      AND ud.department_id = b.department_id) AS in_dept
       FROM boards b
       LEFT JOIN board_permissions bp ON bp.board_id = b.id AND bp.subject_type = 'user' AND bp.subject_id = $2
       WHERE b.id = $1`, [boardId, userId]);
    if (!br.length) return { role: null, boardId };
    const r = br[0];
    const role: BoardRole | null = r.role ?? (r.owner_id === userId ? 'owner'
      : (r.visibility === 'company' || (r.visibility === 'department' && r.in_dept)) ? 'editor' : 'viewer');
    return { role, boardId };
  }

  @Patch(':id/cell')
  async updateCell(@Req() req: any, @Param('id') itemId: string, @Body() b: { columnId: string; value: unknown; version: number }) {
    const { role } = await this.resolveRoleForItem(itemId, req.user.id);
    try {
      return await this.items.updateCell(itemId, b.columnId, b.value, b.version, role, req.user.id);
    } catch (e: any) {
      if (e?.message === 'FORBIDDEN_COLUMN') throw new ForbiddenException('该列仅负责人可编辑');
      if (e?.message === 'FORBIDDEN') throw new ForbiddenException();
      if (e?.message === 'CONFLICT') throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' });
      throw e;
    }
  }

  @Post('batch')
  async batchUpdate(@Req() req: any, @Body() b: { changes: { itemId: string; columnId: string; value: unknown }[] }) {
    // 取第一个 item 的 board 角色近似判断（P0 批量通常同 Board）
    if (!b.changes?.length) return { updated: 0 };
    const { role } = await this.resolveRoleForItem(b.changes[0].itemId, req.user.id);
    return this.items.batchUpdate(b.changes, role, req.user.id);
  }

  @Patch(':id')
  async updateItem(@Req() req: any, @Param('id') itemId: string, @Body() b: { name?: string; groupId?: string; done?: boolean }) {
    const { role } = await this.resolveRoleForItem(itemId, req.user.id);
    return this.items.updateItem(itemId, b, role, req.user.id);
  }

  @Post(':id/subitems')
  async createSubItem(@Req() req: any, @Param('id') itemId: string, @Body() b: { name: string }) {
    const { role } = await this.resolveRoleForItem(itemId, req.user.id);
    return this.items.createSubItem(itemId, b.name, role, req.user.id);
  }

  @Post('reorder')
  async reorder(@Req() req: any, @Body() b: { orders: { id: string; position: number }[] }) {
    if (!b.orders?.length) return { updated: 0 };
    const { role } = await this.resolveRoleForItem(b.orders[0].id, req.user.id);
    return this.items.reorder(b.orders, role, req.user.id);
  }

  @Post('soft-delete')
  async softDelete(@Req() req: any, @Body() b: { itemIds: string[] }) {
    if (!b.itemIds?.length) return { moved: 0 };
    const { role } = await this.resolveRoleForItem(b.itemIds[0], req.user.id);
    return this.items.softDelete(b.itemIds, role, req.user.id);
  }
}
