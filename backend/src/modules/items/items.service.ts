/**
 * Items 服务核心 — JSONB 动态列值的读写与批量操作
 * 性能要点（专家评审定稿）：
 * - 全 Board 查询一次拉平 item_values，50~200ms
 * - 写入走 (item_id, column_id) upsert，version++ 做 LWW 冲突检测
 * - 排序键 position 用浮点中间值，避免整表重排
 */
import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { can, BoardRole } from '../boards/acl';

@Injectable()
export class ItemsService {
  constructor(private readonly pg: Pool) {}

  /** 读取整个 Board（含动态列值）——一次查询拉平，免 N+1 */
  async getBoardItems(boardId: string, userRole: BoardRole | null) {
    if (!can(userRole, 'read')) throw new Error('FORBIDDEN');
    const { rows } = await this.pg.query(
      `SELECT i.id, i.group_id, i.name, i.position, i.version,
              jsonb_agg(jsonb_build_object('k', iv.column_id, 'v', iv.value #>> '{}')) AS kv
       FROM items i
       LEFT JOIN item_values iv ON iv.item_id = i.id
       WHERE i.board_id = $1 AND i.deleted_at IS NULL AND i.parent_item_id IS NULL
       GROUP BY i.id
       ORDER BY i.position`,
      [boardId],
    );
    // jsonb_agg 组装成 {columnId: value}（jsonb_object_agg 在 Neon/pg 驱动上有 field name 解析 bug，弃用）
    return rows.map((r) => {
      const values: Record<string, unknown> = {};
      for (const kv of r.kv ?? []) values[kv.k] = kv.v;
      return { ...r, values };
    });
  }

  /** Board 分组（看板视图的列） */
  async listGroups(boardId: string) {
    const { rows } = await this.pg.query(
      `SELECT id, name, position, color FROM board_groups WHERE board_id = $1 ORDER BY position`,
      [boardId],
    );
    return rows;
  }

  /**
   * 更新单元格（LWW）：客户端携带已知 version，不匹配则 409 提示刷新
   * 同步触发 event:item.updated → BullMQ(automation) + WS 广播由调用方编排
   */
  async updateCell(
    itemId: string, columnId: string, value: unknown,
    clientVersion: number, userRole: BoardRole | null, userId: string,
  ) {
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    // 列级权限：settings.editable = 'owner' 时仅 owner 角色可编辑该列
    const col = (await this.pg.query(`SELECT settings FROM board_columns WHERE id = $1`, [columnId])).rows[0];
    if (col?.settings?.editable === 'owner' && userRole !== 'owner') throw new Error('FORBIDDEN_COLUMN');
    const client = await this.pg.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE items SET version = version + 1
         WHERE id = $1 AND version = $2 AND deleted_at IS NULL
         RETURNING version`,
        [itemId, clientVersion],
      );
      if (!rows.length) { await client.query('ROLLBACK'); throw new Error('CONFLICT'); }

      await client.query(
        `INSERT INTO item_values (item_id, column_id, board_id, value)
         SELECT $1, $2, board_id, $3::jsonb FROM items WHERE id = $1
         ON CONFLICT (item_id, column_id)
         DO UPDATE SET value = EXCLUDED.value`,
        [itemId, columnId, JSON.stringify(value ?? null)],
      );
      await client.query(
        `INSERT INTO audit_logs (user_id, action, target, after_val, source)
         VALUES ($1, 'item.cell.update', $2, $3::jsonb, 'ui')`,
        [userId, `item:${itemId}`, JSON.stringify({ columnId, value })],
      );
      await client.query('COMMIT');
      return { version: rows[0].version };
    } finally { client.release(); }
  }

  /** 批量重排序（拖拽）：一次事务写入新 position */
  async reorder(orders: { id: string; position: number }[], userRole: BoardRole | null, userId: string) {
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    if (!orders?.length) return { updated: 0 };
    const client = await this.pg.connect();
    try {
      await client.query('BEGIN');
      for (const o of orders) {
        await client.query(`UPDATE items SET position = $2 WHERE id = $1`, [o.id, o.position]);
      }
      await client.query(
        `INSERT INTO audit_logs (user_id, action, target, source) VALUES ($1,'items.reorder',$2,'ui')`,
        [userId, `items:${orders.length}`]);
      await client.query('COMMIT');
      return { updated: orders.length };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }

  /** 软删除 → 回收站（P0 刚需） */
  /** 创建条目（P0）：默认放第一个分组，初始 version=1 */
  async createItem(boardId: string, name: string, groupId: string | null, userRole: BoardRole | null, userId: string) {
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    let gid = groupId;
    if (!gid) {
      const { rows } = await this.pg.query(
        `SELECT id FROM board_groups WHERE board_id = $1 ORDER BY position LIMIT 1`, [boardId]);
      gid = rows[0]?.id;
    }
    const { rows } = await this.pg.query(
      `INSERT INTO items (board_id, group_id, name, position, version, created_by)
       VALUES ($1,$2,$3,$4,1,$5) RETURNING id, group_id, name, version`,
      [boardId, gid, name || '新条目', Date.now() / 1000, userId],
    );
    await this.pg.query(
      `INSERT INTO audit_logs (user_id, action, target, source) VALUES ($1,'item.create',$2,'ui')`,
      [userId, `item:${rows[0].id}`],
    );
    return rows[0];
  }

  /** 更新条目本体：改名 / 换分组 / 勾选完成（子任务） */
  async updateItem(itemId: string, patch: { name?: string; groupId?: string; done?: boolean }, userRole: BoardRole | null, userId: string) {
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.name !== undefined) { sets.push(`name = $${sets.length + 1}`); args.push(patch.name); }
    if (patch.groupId !== undefined) { sets.push(`group_id = $${sets.length + 1}`); args.push(patch.groupId); }
    if (patch.done !== undefined) { sets.push(`done = $${sets.length + 1}`); args.push(patch.done); }
    if (!sets.length) return { ok: true };
    sets.push('version = version + 1');
    args.push(itemId);
    const { rows } = await this.pg.query(
      `UPDATE items SET ${sets.join(', ')} WHERE id = $${args.length} AND deleted_at IS NULL RETURNING id, name, group_id, version`,
      args,
    );
    if (rows.length) {
      await this.pg.query(
        `INSERT INTO audit_logs (user_id, action, target, source) VALUES ($1,'item.update',$2,'ui')`,
        [userId, `item:${itemId}`],
      );
    }
    return rows[0] ?? null;
  }

  /** 创建子任务：挂在父条目下，同 Board/分组，初始未完成 */
  async createSubItem(parentItemId: string, name: string, userRole: BoardRole | null, userId: string) {
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    const p = (await this.pg.query(`SELECT board_id, group_id FROM items WHERE id = $1 AND deleted_at IS NULL`, [parentItemId])).rows[0];
    if (!p) throw new Error('PARENT_NOT_FOUND');
    const pos = (await this.pg.query(`SELECT COALESCE(MAX(position),0)+1 AS p FROM items WHERE parent_item_id = $1`, [parentItemId])).rows[0].p;
    const { rows } = await this.pg.query(
      `INSERT INTO items (board_id, group_id, parent_item_id, name, position, version, created_by)
       VALUES ($1,$2,$3,$4,$5,1,$6) RETURNING id, parent_item_id, name, done, version`,
      [p.board_id, p.group_id, parentItemId, name || '新子任务', pos, userId]);
    await this.pg.query(
      `INSERT INTO audit_logs (user_id, action, target, source) VALUES ($1,'subitem.create',$2,'ui')`,
      [userId, `item:${parentItemId}`]);
    return rows[0];
  }

  async softDelete(itemIds: string[], userRole: BoardRole | null, userId: string) {
    if (!can(userRole, 'delete')) throw new Error('FORBIDDEN');
    await this.pg.query(
      `UPDATE items SET deleted_at = now()
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [itemIds],
    );
    await this.pg.query(
      `INSERT INTO audit_logs (user_id, action, target, source)
       VALUES ($1, 'item.soft_delete', $2, 'ui')`,
      [userId, `items:${itemIds.length}`],
    );
    return { moved: itemIds.length };
  }

  /** 批量编辑（P0 刚需）：一次事务内批量 upsert 列值 */
  async batchUpdate(
    changes: { itemId: string; columnId: string; value: unknown }[],
    userRole: BoardRole | null, userId: string,
  ) {
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    const client = await this.pg.connect();
    try {
      await client.query('BEGIN');
      for (const c of changes) {
        await client.query(
          `INSERT INTO item_values (item_id, column_id, board_id, value)
           SELECT $1, $2, board_id, $3::jsonb FROM items WHERE id = $1
           ON CONFLICT (item_id, column_id) DO UPDATE SET value = EXCLUDED.value`,
          [c.itemId, c.columnId, JSON.stringify(c.value ?? null)],
        );
        await client.query(`UPDATE items SET version = version + 1 WHERE id = $1`, [c.itemId]);
      }
      await client.query(
        `INSERT INTO audit_logs (user_id, action, target, source)
         VALUES ($1, 'item.batch_update', $2, 'ui')`,
        [userId, `count:${changes.length}`],
      );
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    return { updated: changes.length };
  }
}
