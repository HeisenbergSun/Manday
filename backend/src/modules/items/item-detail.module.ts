/**
 * 条目详情 — 评论 Updates / 子任务 / 变更历史
 * P0 范围：评论+@提及解析；Item 历史直接读 audit_logs
 */
import { Injectable, Controller, Get, Post, Param, Body, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class ItemDetailService {
  constructor(private pg: Pool) {}

  /** 条目本体 */
  async getDetail(itemId: string) {
    const { rows } = await this.pg.query(
      `SELECT id, board_id, group_id, name, position, version, created_at
       FROM items WHERE id = $1 AND deleted_at IS NULL`,
      [itemId],
    );
    if (!rows.length) return null;
    const { rows: vals } = await this.pg.query(
      `SELECT column_id, value #>> '{}' AS value FROM item_values WHERE item_id = $1`, [itemId]);
    return { ...rows[0], values: Object.fromEntries(vals.map((v) => [v.column_id, v.value])) };
  }

  /** 评论列表（含 @提及用户 id，前端渲染高亮） */
  async getUpdates(itemId: string) {
    const { rows } = await this.pg.query(
      `SELECT u.id, u.body, u.created_at, u.user_id,
              json_build_object('id', us.id, 'name', us.name, 'email', us.email) AS author,
              (SELECT json_agg(json_build_object('id', m.id, 'name', m.name))
               FROM users m WHERE u.body ~ ('@' || m.name)) AS mentions
       FROM updates u JOIN users us ON us.id = u.user_id
       WHERE u.item_id = $1 ORDER BY u.created_at ASC`,
      [itemId],
    );
    return rows;
  }

  /** 发评论 + @提及 → 通知（Mentions 命中即写 notifications，服务层聚合） */
  async addUpdate(itemId: string, userId: string, body: string) {
    const { rows } = await this.pg.query(
      `INSERT INTO updates (item_id, user_id, body) VALUES ($1,$2,$3) RETURNING id, created_at`,
      [itemId, userId, body],
    );
    // 解析 @提及（P0 简化：全名匹配；P1 换输入联想组件直接传 userId）
    const names = [...body.matchAll(/@([\p{Script=Han}\w]+)/gu)].map((m) => m[1]);
    if (names.length) {
      await this.pg.query(
        `INSERT INTO notifications (user_id, type, payload)
         SELECT us.id, 'mention', jsonb_build_object('itemId', $1::uuid, 'updateId', $2::uuid)
         FROM users us WHERE us.name = ANY($3::text[]) AND us.id <> $4::uuid`,
        [itemId, rows[0].id, names, userId],
      );
    }
    return rows[0];
  }

  /** 子任务：复用 items 表 parent_item_id */
  async getSubItems(itemId: string) {
    const { rows } = await this.pg.query(
      `SELECT id, name, done, position, version FROM items
       WHERE parent_item_id = $1 AND deleted_at IS NULL ORDER BY position`,
      [itemId],
    );
    return rows;
  }

  /** 变更历史：审计日志倒序（who/when/before→after） */
  async getHistory(itemId: string) {
    const { rows } = await this.pg.query(
      `SELECT a.action, a.before_val, a.after_val, a.source, a.created_at,
              us.name AS actor
       FROM audit_logs a LEFT JOIN users us ON us.id = a.user_id
       WHERE a.target = $1 ORDER BY a.created_at DESC LIMIT 50`,
      [`item:${itemId}`],
    );
    return rows;
  }
}

@Controller('items/:id')
export class ItemDetailController {
  constructor(private svc: ItemDetailService) {}
  /** 条目本体（标题等），前端详情头部用；注意要放在具体子路由之后定义顺序无关，但路由 'items/:id' 已隔离 */
  @Get() detail(@Param('id') id: string) { return this.svc.getDetail(id); }

  @Get('updates') updates(@Param('id') id: string) { return this.svc.getUpdates(id); }
  @Post('updates') addUpdate(@Req() req, @Param('id') id: string, @Body() b: { body: string }) {
    return this.svc.addUpdate(id, req.user.id, b.body);
  }
  @Get('subitems') subItems(@Param('id') id: string) { return this.svc.getSubItems(id); }
  @Get('history') history(@Param('id') id: string) { return this.svc.getHistory(id); }
}

@Module({ controllers: [ItemDetailController], providers: [ItemDetailService] })
export class ItemDetailModule {}
