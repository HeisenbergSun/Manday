/**
 * 自动化配方 API — 预置配方模板 + CRUD + AI 创建入口
 * AI 路径：自然语言 → /ai chat 翻译成 trigger/condition/action JSON → 用户确认卡片 → POST 此接口
 */
import { Injectable, Controller, Get, Post, Delete, Param, Body, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';

/** P0 预置配方模板（前端自动化中心直接列出，一键套用） */
export const RECIPE_TEMPLATES = [
  { key: 'status_done_move', name: '状态改为已完成 → 移动到「已完成」组',
    trigger: { type: 'status_changed', to: '已完成' }, action: { type: 'move_group' } },
  { key: 'due_soon_notify', name: '截止前 1 天 → 通知负责人',
    trigger: { type: 'date_arriving', days: 1 }, action: { type: 'notify', userIds: ['@assignee'] } },
  { key: 'assigned_notify', name: '条目被指派给我 → 通知我',
    trigger: { type: 'assignee_changed', to: '@self' }, action: { type: 'notify', userIds: ['@assignee'] } },
  { key: 'mention_notify', name: '评论 @我 → 通知我',
    trigger: { type: 'mention', to: '@self' }, action: { type: 'notify', userIds: ['@mentioned'] } },
  { key: 'overdue_highlight', name: '逾期未完成 → 标红优先级列',
    trigger: { type: 'date_passing' }, action: { type: 'update_field', columnId: 'prio', value: '⚠ 逾期' } },
  { key: 'created_notify_board', name: '新条目创建 → 通知 Board Owner',
    trigger: { type: 'item_created' }, action: { type: 'notify', userIds: ['@owner'] } },
];

@Injectable()
export class AutomationApiService {
  constructor(private pg: Pool) {}

  templates() { return RECIPE_TEMPLATES; }

  async list(boardId: string) {
    const { rows } = await this.pg.query(
      `SELECT * FROM automations WHERE board_id = $1 ORDER BY created_at DESC`, [boardId]);
    return rows;
  }

  /** 统一入口：模板套用、手工配置、AI 翻译结果都走这里（AI 调用时 source='ai'） */
  async create(boardId: string, userId: string, dto: {
    trigger: object; condition?: object; action: object; source?: string; name?: string }) {
    // 校验 action 类型在白名单内（AI 翻译结果不可信，防注入任意 action）
    const allowedActions = ['notify', 'move_group', 'update_field'];
    if (!allowedActions.includes((dto.action as any).type)) throw new Error('ACTION_NOT_ALLOWED');
    const { rows } = await this.pg.query(
      `INSERT INTO automations (board_id, trigger, condition, action, created_by)
       VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5) RETURNING *`,
      [boardId, JSON.stringify(dto.trigger), JSON.stringify(dto.condition ?? {}),
       JSON.stringify(dto.action), userId],
    );
    await this.pg.query(
      `INSERT INTO audit_logs (user_id, action, target, source)
       VALUES ($1,'automation.create',$2,$3)`,
      [userId, `rule:${rows[0].id}`, dto.source ?? 'ui']);
    return rows[0];
  }

  async remove(id: string, userId: string) {
    await this.pg.query(`DELETE FROM automations WHERE id = $1`, [id]);
    return { deleted: true };
  }
}

@Controller('boards/:id/automations')
export class AutomationApiController {
  constructor(private svc: AutomationApiService) {}
  @Get('templates') templates() { return this.svc.templates(); }
  @Get() list(@Param('id') id: string) { return this.svc.list(id); }
  @Post() create(@Req() req, @Param('id') id: string, @Body() dto: any) {
    return this.svc.create(id, req.user.id, dto);
  }
  @Delete(':autoId') remove(@Req() req, @Param('autoId') id: string) {
    return this.svc.remove(id, req.user.id);
  }
}

@Module({ controllers: [AutomationApiController], providers: [AutomationApiService] })
export class AutomationApiModule {}
