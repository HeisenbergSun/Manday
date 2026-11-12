/**
 * 通知中心 + 每日摘要聚合（200 人规模的降噪刚需）
 * 策略：实时推送只发"高优先级"（@提及/指派）；其余进每日摘要（每天 09:00 归并一条）
 */
import { Injectable, Controller, Get, Post, Module, Req, Body, forwardRef, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

@Injectable()
export class NotificationService {
  constructor(
    private pg: Pool,
    @Inject(forwardRef(() => RealtimeGateway)) private ws: RealtimeGateway,
  ) {}

  /** 写通知。priority=high 立即 WS 推送 user:{id} 房间；normal 只落库等摘要 */
  async push(userId: string, type: string, payload: unknown, priority: 'high' | 'normal' = 'normal') {
    const { rows } = await this.pg.query(
      `INSERT INTO notifications (user_id, type, payload) VALUES ($1,$2,$3::jsonb) RETURNING id, created_at`,
      [userId, type, JSON.stringify(payload)],
    );
    if (priority === 'high') {
      // 实时触达替代前端轮询：WS 推送未读增量，前端铃铛即时 +1
      this.ws.notifyUser(userId, { id: rows[0].id, type, payload, created_at: rows[0].created_at });
    }
    return { priority, pushed: priority === 'high' };
  }

  /** 未读数（铃铛角标）+ 未读列表 */
  async unread(userId: string) {
    const { rows } = await this.pg.query(
      `SELECT id, type, payload, created_at FROM notifications
       WHERE user_id = $1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    return { count: rows.length, items: rows };
  }

  markRead(userId: string, ids?: string[]) {
    return this.pg.query(
      `UPDATE notifications SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL ${ids ? 'AND id = ANY($2::uuid[])' : ''}`,
      ids ? [userId, ids] : [userId],
    );
  }

  /**
   * 每日摘要：cron 09:00 归并昨日未读 → 一条 digest 通知（实时推送）
   * 生产用 @nestjs/schedule；此处以 rx interval 占位示意
   */
  async buildDailyDigest() {
    const { rows } = await this.pg.query(
      `SELECT user_id, count(*) AS cnt, json_agg(type) AS types
       FROM notifications WHERE read_at IS NULL AND created_at < now() - interval '1 day'
       GROUP BY user_id`,
    );
    for (const r of rows) {
      await this.push(r.user_id, 'daily_digest',
        { count: r.cnt, types: r.types }, 'high');
    }
    return { digests: rows.length };
  }
}

@Controller('notifications')
export class NotificationController {
  constructor(private svc: NotificationService) {}
  @Get('unread') unread(@Req() req) { return this.svc.unread(req.user.id); }
  @Post('read') read(@Req() req, @Body() b: { ids?: string[] }) { return this.svc.markRead(req.user.id, b.ids); }
}

@Module({ controllers: [NotificationController],
  providers: [NotificationService],
  imports: [forwardRef(() => require('../../realtime/realtime.module').RealtimeModule)] })
export class NotificationModule {}
