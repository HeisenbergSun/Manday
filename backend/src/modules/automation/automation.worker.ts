/**
 * 自动化引擎 — BullMQ 异步 worker（专家定稿：绝不同步执行）
 * 流程：item 变更 → 入队 → worker 匹配 trigger → condition → action
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

interface AutomationJob {
  boardId: string;
  itemId: string;
  event: { type: string; field?: string; to?: unknown; from?: unknown };
  actorUserId: string;
}

/** 通知服务：实时推送 + 聚合落库（每日摘要由定时任务归并）——须定义在 AutomationWorker 之前（装饰器元数据在类定义时求值） */
@Injectable()
export class NotificationService {
  constructor(private readonly pg: Pool) {}
  push(userIds: string[], payload: unknown) {
    // 实际实现：写 notifications 表（read_at null）+ WS notifyUser
  }
}

@Processor('automation')
export class AutomationWorker extends WorkerHost {
  constructor(private readonly pg: Pool, private readonly notify: NotificationService) {
    super();
  }

  async process(job: Job<AutomationJob>) {
    const { boardId, itemId, event, actorUserId } = job.data;
    const { rows: rules } = await this.pg.query(
      `SELECT * FROM automations WHERE board_id = $1 AND enabled = true`,
      [boardId],
    );

    for (const rule of rules) {
      if (!matchTrigger(rule.trigger, event)) continue;
      if (rule.condition && !(await matchCondition(rule.condition, boardId, itemId))) continue;

      const a = rule.action;
      switch (a.type) {
        case 'notify':            // 通知指定人/负责人（服务层做每日聚合）
          this.notify.push(a.userIds ?? ['@assignee'], { itemId, reason: 'automation', ruleId: rule.id });
          break;
        case 'move_group':        // 状态改 Done → 移到已完成组
          await this.pg.query(`UPDATE items SET group_id = $1 WHERE id = $2`, [a.groupId, itemId]);
          break;
        case 'update_field':
          await this.pg.query(
            `INSERT INTO item_values (item_id, column_id, board_id, value)
             SELECT $1, $2, board_id, $3::jsonb FROM items WHERE id = $1
             ON CONFLICT (item_id, column_id) DO UPDATE SET value = EXCLUDED.value`,
            [itemId, a.columnId, JSON.stringify(a.value)],
          );
          break;
        default:
          // 未知 action 类型：告警不中断（JSON schema 带版本号，向前兼容）
          console.warn(`[automation] unknown action type: ${a.type}`);
      }
      // 自动化写入同样审计，source:'automation'
      await this.pg.query(
        `INSERT INTO audit_logs (user_id, action, target, source)
         VALUES ($1, 'automation.run', $2, 'automation')`,
        [actorUserId, `rule:${rule.id}`],
      );
    }
  }
}

function matchTrigger(trigger: any, event: AutomationJob['event']): boolean {
  if (trigger.type !== event.type) return false;
  if (trigger.to && trigger.to !== event.to) return false;
  if (trigger.field && trigger.field !== event.field) return false;
  return true;
}
async function matchCondition(condition: any, boardId: string, itemId: string): Promise<boolean> {
  // P0 内置配方用不到复杂条件，预留扩展点
  return true;
}
