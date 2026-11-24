/**
 * 自动化运行时（第二十一批）— 无 Redis 的同步执行路径 + 日期触发扫描 + 条件求值
 * 与 BullMQ worker（Redis 生产路径）共用触发匹配语义；本服务 emit() 直接内联执行规则。
 * 事件类型：status_changed / field_changed / assignee_changed / item_created / date_arriving / date_passing
 * 动作类型：notify / move_group / update_field / set_status
 * 条件：{ columnId, op: eq|ne|gt|lt|contains, value }
 */
import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

export interface AutomationEvent {
  type: string;
  field?: string;
  to?: unknown;
  from?: unknown;
  days?: number;
  mentions?: string[];
}

const DONE_LABELS = ['已完成', 'Done'];

async function loadItemValues(pg: Pool, itemId: string) {
  const { rows } = await pg.query(
    `SELECT c.id AS col_id, c.type, c.name, v.value
     FROM board_columns c
     LEFT JOIN item_values v ON v.column_id = c.id AND v.item_id = $1
     WHERE c.board_id = (SELECT board_id FROM items WHERE id = $1)`,
    [itemId],
  );
  const map = new Map<string, any>();
  for (const r of rows) map.set(r.col_id, { type: r.type, name: r.name, value: r.value });
  return map;
}

/** 触发匹配（扩展自 worker：支持 from / days） */
export function matchTrigger(trigger: any, event: AutomationEvent): boolean {
  if (trigger.type !== event.type) return false;
  // mention 触发：to='@self' 语义为「有人在评论里 @ 了人」即触发（board 级规则无单一「我」视角）
  if (trigger.type === 'mention') {
    return (event.mentions ?? []).length > 0;
  }
  if (trigger.field && trigger.field !== event.field) return false;
  if (trigger.to != null && String(trigger.to) !== String(event.to)) return false;
  if (trigger.from != null && String(trigger.from) !== String(event.from ?? '')) return false;
  return true;
}

/** 条件求值：对条目当前值比较 */
export async function matchCondition(pg: Pool, condition: any, itemId: string): Promise<boolean> {
  if (!condition || !condition.columnId) return true;
  const cols = await loadItemValues(pg, itemId);
  const cell = cols.get(condition.columnId);
  if (!cell) return false;
  const text = cell.value == null ? '' : typeof cell.value === 'object' ? JSON.stringify(cell.value) : String(cell.value);
  const num = Number(text);
  const target = condition.value;
  switch (condition.op) {
    case 'eq': return text === String(target);
    case 'ne': return text !== String(target);
    case 'gt': return isFinite(num) && num > Number(target);
    case 'lt': return isFinite(num) && num < Number(target);
    case 'contains': return text.includes(String(target));
    default: return true;
  }
}

/** 通知目标解析：@assignee → 人员列用户；@owner → 板主；@mentioned → 事件提及；其余视为显式用户 id */
async function resolveNotifyTargets(pg: Pool, userIds: string[], boardId: string, itemId: string, event: AutomationEvent): Promise<string[]> {
  const out = new Set<string>();
  for (const u of userIds ?? []) {
    if (u === '@assignee') {
      const cols = await loadItemValues(pg, itemId);
      const people = [...cols.values()].filter((c) => c.type === 'people' && c.value != null);
      const ids: string[] = [];
      for (const p of people) {
        if (typeof p.value === 'string') ids.push(p.value);
        else if (Array.isArray(p.value)) for (const x of p.value) ids.push(typeof x === 'object' ? (x.id ?? x) : String(x));
      }
      ids.forEach((id) => out.add(id));
    } else if (u === '@owner') {
      const { rows } = await pg.query(`SELECT owner_id FROM boards WHERE id = $1`, [boardId]);
      if (rows[0]) out.add(rows[0].owner_id);
    } else if (u === '@mentioned') {
      for (const m of event.mentions ?? []) out.add(m);
    } else out.add(u);
  }
  return [...out].filter(Boolean);
}

async function writeNotifications(pg: Pool, userIds: string[], itemId: string, ruleId: string) {
  for (const uid of userIds) {
    await pg.query(
      `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'automation', $2::jsonb)`,
      [uid, JSON.stringify({ itemId, reason: 'automation', ruleId })],
    );
  }
}

/** 执行一条板上全部匹配规则（与 worker 语义一致） */
export async function runRules(
  pg: Pool, boardId: string, itemId: string, event: AutomationEvent, actorUserId: string,
): Promise<number> {
  const { rows: rules } = await pg.query(
    `SELECT * FROM automations WHERE board_id = $1 AND enabled = true`, [boardId]);
  let ran = 0;
  for (const rule of rules) {
    if (!matchTrigger(rule.trigger, event)) continue;
    if (!(await matchCondition(pg, rule.condition, itemId))) continue;
    const a = rule.action;
    switch (a.type) {
      case 'notify': {
        const targets = await resolveNotifyTargets(pg, a.userIds ?? ['@assignee'], boardId, itemId, event);
        await writeNotifications(pg, targets, itemId, rule.id);
        break;
      }
      case 'move_group':
        await pg.query(`UPDATE items SET group_id = $1 WHERE id = $2`, [a.groupId, itemId]);
        break;
      case 'update_field':
        await pg.query(
          `INSERT INTO item_values (item_id, column_id, board_id, value)
           SELECT $1, $2, board_id, $3::jsonb FROM items WHERE id = $1
           ON CONFLICT (item_id, column_id) DO UPDATE SET value = EXCLUDED.value`,
          [itemId, a.columnId, JSON.stringify(a.value)],
        );
        break;
      case 'set_status': {
        // 找本板 status 列，把标签写入；a.label 不在该列标签集时跳过
        const { rows: sc } = await pg.query(
          `SELECT id, settings FROM board_columns WHERE board_id = $1 AND type = 'status' LIMIT 1`, [boardId]);
        if (!sc.length) break;
        const labels: string[] = (sc[0].settings?.labels ?? []).map((l: any) => l.label ?? l);
        if (a.label && !labels.includes(a.label)) break;
        await pg.query(
          `INSERT INTO item_values (item_id, column_id, board_id, value)
           SELECT $1, $2, board_id, $3::jsonb FROM items WHERE id = $1
           ON CONFLICT (item_id, column_id) DO UPDATE SET value = EXCLUDED.value`,
          [itemId, sc[0].id, JSON.stringify(a.label)],
        );
        break;
      }
      default:
        console.warn(`[automation] unknown action type: ${a.type}`);
    }
    await pg.query(
      `INSERT INTO audit_logs (user_id, action, target, source)
       VALUES ($1, 'automation.run', $2, 'automation')`,
      [actorUserId, `rule:${rule.id}`],
    );
    ran++;
  }
  return ran;
}

@Injectable()
export class AutomationRunner {
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly pg: Pool) {}

  /** 事件入口：当前为同步内联执行（Redis worker 路径保留给生产） */
  async emit(boardId: string, itemId: string, event: AutomationEvent, actorUserId: string) {
    try {
      await runRules(this.pg, boardId, itemId, event, actorUserId);
    } catch (e) {
      console.warn('[automation] emit failed:', (e as Error).message);
    }
  }

  /** 日期触发扫描：date_arriving（未来 N 天截止）+ date_passing（已逾期未完成） */
  async scanDateTriggers(boardId?: string): Promise<{ arriving: number; passing: number }> {
    let arriving = 0, passing = 0;
    // date_arriving：各规则声明 days，扫描截止日 = today + days 的条目
    const { rows: arrRules } = await this.pg.query(
      `SELECT DISTINCT board_id, (trigger->>'days')::int AS days FROM automations
       WHERE enabled = true AND trigger->>'type' = 'date_arriving'` + (boardId ? ` AND board_id = $1` : ''),
      boardId ? [boardId] : [],
    );
    for (const r of arrRules) {
      const { rows: items } = await this.pg.query(
        `SELECT i.id FROM items i
         JOIN board_columns c ON c.board_id = i.board_id AND c.type = 'date'
         JOIN item_values v ON v.item_id = i.id AND v.column_id = c.id
         WHERE i.board_id = $1 AND i.deleted_at IS NULL AND (v.value #>> '{}') <> ''
           AND CASE WHEN (v.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (v.value #>> '{}')::date END = (current_date + make_interval(days => $2))::date`,
        boardId ? [r.board_id, r.days] : [r.board_id, r.days],
      );
      for (const it of items) {
        const n = await runRules(this.pg, r.board_id, it.id, { type: 'date_arriving', days: r.days }, r.board_id);
        arriving += n;
      }
    }
    // date_passing：截止日 < today 且未完成
    const { rows: passRules } = await this.pg.query(
      `SELECT DISTINCT board_id FROM automations
       WHERE enabled = true AND trigger->>'type' = 'date_passing'` + (boardId ? ` AND board_id = $1` : ''),
      boardId ? [boardId] : [],
    );
    for (const r of passRules) {
      const { rows: items } = await this.pg.query(
        `SELECT i.id FROM items i
         JOIN board_columns c ON c.board_id = i.board_id AND c.type = 'date'
         JOIN item_values v ON v.item_id = i.id AND v.column_id = c.id
         LEFT JOIN board_columns sc ON sc.board_id = i.board_id AND sc.type = 'status'
         LEFT JOIN item_values sv ON sv.item_id = i.id AND sv.column_id = sc.id
         WHERE i.board_id = $1 AND i.deleted_at IS NULL AND (v.value #>> '{}') <> ''
           AND CASE WHEN (v.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (v.value #>> '{}')::date END < current_date
           AND (sv.value IS NULL OR sv.value #>> '{}' NOT IN ('已完成','Done'))`,
        [r.board_id],
      );
      for (const it of items) {
        const n = await runRules(this.pg, r.board_id, it.id, { type: 'date_passing' }, r.board_id);
        passing += n;
      }
    }
    return { arriving, passing };
  }

  /** 启动后每小时扫描一次（进程内轻量定时；生产可换 @nestjs/schedule） */
  onApplicationBootstrap() {
    this.scanTimer = setInterval(() => { this.scanDateTriggers().catch(() => {}); }, 60 * 60 * 1000);
    if (this.scanTimer && typeof this.scanTimer.unref === 'function') this.scanTimer.unref();
  }

  onApplicationShutdown() {
    if (this.scanTimer) clearInterval(this.scanTimer);
  }
}
