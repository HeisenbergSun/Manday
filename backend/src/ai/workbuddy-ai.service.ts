/**
 * Manday × Scania WorkBuddy 企业版 AI 集成适配器
 *
 * 实现说明：
 * - 底层走腾讯云 CodeBuddy Agent SDK（@tencent-ai/agent-sdk），专享版（cloudhosted）模式。
 * - 鉴权：CODEBUDDY_API_KEY + CODEBUDDY_INTERNET_ENVIRONMENT=cloudhosted。
 * - 看板数据接入：通过 SDK 的 createSdkMcpServer + tool() 暴露看板工具，在 query() 的 options.mcpServers 注入。
 *   tools:[] 禁用内置文件/终端工具，AI 只能通过这些工具访问看板数据。
 *
 * 安全三原则（对应方案 v3.0）：
 * 1. AI 身份 = 当前用户代理；读工具复用 BoardsService 的可见性过滤 + 列权限过滤，无法越权。
 * 2. 读工具直接执行；写工具（update_fields / create_items）在 SDK 内**只产出预览 + 登记 pending**，
 *    绝不直接落库。真正的写入走 HTTP 端点 /ai/tool/confirm，二次 ACL 校验 + source:'ai' 审计。
 * 3. pending 一次性、10 分钟过期、按 userId 隔离，防伪造/重放。
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { query, createSdkMcpServer, tool } from '@tencent-ai/agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BoardsService } from '../modules/boards/boards.module';
import { ItemsService } from '../modules/items/items.service';
import { DashboardService } from '../modules/dashboard/dashboard.module';
import { can, BoardRole } from '../modules/boards/acl';

export interface ChatRequest {
  /** 当前用户上下文（权限边界） */
  userId: string;
  /** 当前所在 Board（侧边栏上下文感知） */
  boardId?: string;
  messages: { role: 'user' | 'assistant' | 'tool'; content: unknown }[];
  /** 本轮是否允许写工具（已启用） */
  allowWriteTools: boolean;
}

/** 流式输出事件：文本 or 待确认的写工具调用 */
export type AiStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; tool: string; summary: string; payload: unknown };

/** pending 写操作记录（confirm 时消费） */
interface PendingRecord {
  userId: string;
  tool: 'update_fields' | 'create_items';
  boardId: string;
  payload: any;
  createdAt: number;
}

/** 把单个列值（JSON 文本形态）人性化：status → label，people → 姓名，其余原样 */
function parseValue(col: { type: string }, raw: unknown, users: { id: string; name: string }[]): unknown {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  if (col.type === 'status') {
    try { const j = JSON.parse(s); return j?.label ?? s; } catch { return s; }
  }
  if (col.type === 'people') {
    const toName = (x: unknown): string => {
      if (x == null) return '';
      if (typeof x === 'object') { const o = x as any; const id = String(o.id ?? o.name ?? ''); return users.find((u) => u.id === id)?.name ?? o.name ?? id; }
      const id = String(x);
      return users.find((u) => u.id === id)?.name ?? id;
    };
    try {
      const j = JSON.parse(s);
      const arr = Array.isArray(j) ? j : [j];
      return arr.map(toName).filter(Boolean);
    } catch {
      return [toName(s)].filter(Boolean);
    }
  }
  return s;
}

function err(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** 写值归一化：status 存纯标签字符串（isItemDone 依赖 String(v) 匹配 doneLabels）；兼容 AI 传 {label,color} 对象 */
function normalizeWriteValue(col: { type: string }, value: unknown): unknown {
  if (col.type === 'status' && value && typeof value === 'object' && (value as any).label != null) {
    return (value as any).label;
  }
  return value;
}

@Injectable()
export class WorkBuddyAIService {
  private readonly apiKey: string;
  private readonly model: string;
  /** 待确认写操作（一次性、按 userId 隔离、10 分钟过期） */
  private readonly pending = new Map<string, PendingRecord>();
  private readonly PENDING_TTL_MS = 10 * 60 * 1000;

  constructor(
    config: ConfigService,
    private readonly boards: BoardsService,
    private readonly items: ItemsService,
    private readonly dashboards: DashboardService,
  ) {
    this.apiKey = config.get('WORKBUDDY_AI_API_KEY') || '';
    this.model = config.get('WORKBUDDY_AI_MODEL') || '';
  }

  /** 是否已配置好 AI 网关 */
  get configured(): boolean {
    return !!this.apiKey;
  }

  /** 构建看板工具（每次 chat 按当前用户上下文创建，避免跨请求串号） */
  private buildMandayServer(
    userId: string,
    currentBoardId: string | undefined,
    allowWrite: boolean,
    onWrite: (rec: { id: string; tool: string; summary: string; payload: unknown }) => void,
  ) {
    const tools: any[] = [
      tool(
        'list_boards',
        '列出当前用户可见的所有看板（含名称、归属部门、我的角色）。用于回答「我有哪些看板」「某个看板叫什么」等问题，或不确定看板 id 时先列出。',
        {},
        async () => {
          try {
            const list = await this.boards.listForUser(userId);
            const slim = list.map((b: any) => ({
              id: b.id, name: b.name, department_name: b.department_name, my_role: b.my_role,
            }));
            return { content: [{ type: 'text', text: JSON.stringify(slim) }] };
          } catch (e: any) {
            return err(`查询看板列表失败：${e?.message ?? e}`);
          }
        },
      ),
      tool(
        'get_board_data',
        '读取指定看板的完整数据：列定义（含 id/名称/类型/设置）、分组、条目（含 id/名称/分组/列值）。' +
        '用于回答「哪些任务逾期」「某成员的工作负荷」等问题，也用于写操作前定位 itemId 与 columnId。' +
        '每条 item 的 values 按列名索引（便于阅读），valuesById 按列 id 索引（便于回传写工具）。' +
        'status 列的 settings.doneLabels 给出「完成」标签；boardId 省略时用当前上下文看板。',
        { boardId: z.string().optional() },
        async ({ boardId }: { boardId?: string }) => {
          const bid = boardId || currentBoardId;
          if (!bid) return err('未指定看板，请先用 list_boards 工具查询看板 id。');
          try {
            const d: any = await this.boards.detail(bid, userId);
            const users = await this.boards.listUsers();
            const used = new Set<string>();
            const columns = (d.columns ?? []).map((c: any) => {
              let label = c.name;
              if (used.has(label)) label = `${label}(${c.type})`;
              used.add(label);
              return { id: c.id, name: label, type: c.type, settings: c.settings ?? {} };
            });
            const colById = Object.fromEntries((d.columns ?? []).map((c: any) => [c.id, c]));
            const groupById = Object.fromEntries((d.groups ?? []).map((g: any) => [g.id, g.name]));
            const items = (d.items ?? []).map((it: any) => {
              const values: Record<string, unknown> = {};
              const valuesById: Record<string, unknown> = {};
              for (const [cid, v] of Object.entries(it.values ?? {})) {
                const col = colById[cid];
                if (!col) continue;
                const colLabel = (columns.find((x: any) => x.id === cid) as any)?.name ?? col.name;
                const parsed = parseValue(col, v, users);
                values[colLabel] = parsed;
                valuesById[cid] = parsed;
              }
              return { id: it.id, name: it.name, group: groupById[it.group_id] ?? '', values, valuesById };
            });
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  board: d.board?.name,
                  today: new Date().toISOString().slice(0, 10),
                  columns: columns.map((c: any) => ({ id: c.id, name: c.name, type: c.type, settings: c.settings })),
                  groups: (d.groups ?? []).map((g: any) => g.name),
                  items,
                }),
              }],
            };
          } catch (e: any) {
            return err(`读取看板失败：${e?.message ?? e}`);
          }
        },
      ),
      tool(
        'get_workspace_overview',
        '生成跨看板的工作台总览，用于回答「本周进展周报」「各项目进度汇总」「团队整体情况」等问题。' +
        '一次性返回：每个可见看板的进度（总条目/已完成/完成率）、整体状态分布、逾期任务 Top 20、成员负载 Top 10、近期动态 Top 15。' +
        '数据已按当前用户可见性过滤，无越权。回答周报类问题时，先调用本工具取数据，再组织成结构化中文周报。',
        {},
        async () => {
          try {
            const list = await this.boards.listForUser(userId);
            const boardIds = (list ?? []).map((b: any) => b.id);
            const overview: any = {
              generated_at: new Date().toISOString(),
              boards: [], status_distribution: [], overdue: [], workload_top: [], recent_activity: [],
            };
            if (!boardIds.length) {
              overview.note = '当前用户没有可见看板';
              return { content: [{ type: 'text', text: JSON.stringify(overview) }] };
            }
            const [battery, statusDist, overdue, workload, activity] = await Promise.all([
              this.dashboards.battery(userId, boardIds),
              this.dashboards.statusDist(userId, boardIds),
              this.dashboards.overdue(userId),
              this.dashboards.workloadRank(userId),
              this.dashboards.activity(userId),
            ]);
            overview.boards = battery;
            overview.status_distribution = statusDist;
            overview.overdue = overdue;
            overview.workload_top = workload;
            overview.recent_activity = activity;
            return { content: [{ type: 'text', text: JSON.stringify(overview) }] };
          } catch (e: any) {
            return err(`读取工作台总览失败：${e?.message ?? e}`);
          }
        },
      ),
    ];

    // —— 写工具：只在 SDK 内产出预览 + 登记 pending，绝不落库 ——
    if (allowWrite) {
      tools.push(
        tool(
          'update_fields',
          '批量修改看板条目的列值（写操作，需用户确认后才真正生效）。' +
          '例：把若干任务的状态标记为「已完成」、修改负责人、设置截止日期。' +
          '参数 changes 为数组，每项 { itemId, columnId, value }：itemId/columnId 取 get_board_data 返回的 id；' +
          'status 列的 value 用标签文字（须与 settings.doneLabels 或 settings.labels 一致）；' +
          'date 用 "YYYY-MM-DD"；number 用数字；checkbox 用 true/false；其余用文本。' +
          '本工具只返回变更预览（diff），绝不直接写入；用户点确认后才会执行。',
          {
            boardId: z.string().optional(),
            changes: z.array(z.object({ itemId: z.string(), columnId: z.string(), value: z.any() })).min(1).max(500),
          },
          async ({ boardId, changes }: { boardId?: string; changes: { itemId: string; columnId: string; value: unknown }[] }): Promise<CallToolResult> => {
            const bid = boardId || currentBoardId;
            if (!bid) return err('未指定看板，请先用 list_boards / get_board_data 确认看板 id。');
            const role = await this.boards.resolveRole(bid, userId);
            if (!can(role, 'edit')) return err('你对当前看板没有编辑权限，无法执行写操作。');
            try {
              const d: any = await this.boards.detail(bid, userId);
              const itemMap = new Map<string, any>((d.items ?? []).map((i: any) => [i.id, i]));
              const colMap = new Map<string, any>((d.columns ?? []).map((c: any) => [c.id, c]));
              const users = await this.boards.listUsers();
              const diff: string[] = [];
              const valid: { itemId: string; columnId: string; value: unknown }[] = [];
              for (const c of changes) {
                const it = itemMap.get(c.itemId);
                if (!it) { diff.push(`⚠️ 条目 ${c.itemId} 不存在，已跳过`); continue; }
                const col = colMap.get(c.columnId);
                if (!col) { diff.push(`⚠️ 「${it.name}」的列 ${c.columnId} 不存在，已跳过`); continue; }
                if (col.type === 'formula') { diff.push(`⚠️ 「${it.name}」的「${col.name}」是公式列（只读），已跳过`); continue; }
                if (col.type === 'attachment') { diff.push(`⚠️ 「${it.name}」的「${col.name}」是附件列（由上传维护），已跳过`); continue; }
                if ((col.settings?.editPermission ?? col.settings?.editable) === 'owner' && role !== 'owner') {
                  diff.push(`⚠️ 「${it.name}」的「${col.name}」仅负责人可编辑，已跳过`); continue;
                }
                const old = parseValue(col, it.values?.[c.columnId], users);
                const next = normalizeWriteValue(col, c.value);
                diff.push(`「${it.name}」的「${col.name}」：${old == null ? '（空）' : String(old)} → ${next == null ? '（空）' : String(next)}`);
                valid.push({ itemId: c.itemId, columnId: c.columnId, value: next });
              }
              if (!valid.length) return err('没有可执行的变更：' + diff.join('；'));
              const summary = `批量更新 ${valid.length} 个单元格`;
              const id = randomUUID();
              this.pending.set(id, { userId, tool: 'update_fields', boardId: bid, payload: { changes: valid }, createdAt: Date.now() });
              onWrite({ id, tool: 'update_fields', summary, payload: { changes: valid } });
              return { content: [{ type: 'text', text: `已生成变更预览（未执行，待用户确认）：\n${diff.join('\n')}` }] };
            } catch (e: any) {
              return err(`生成预览失败：${e?.message ?? e}`);
            }
          },
        ),
        tool(
          'create_items',
          '在看板中新建条目（写操作，需用户确认后才真正创建）。参数 items 为数组，每项 { name, groupId? }；groupId 可省略（放入第一个分组）。',
          {
            boardId: z.string().optional(),
            items: z.array(z.object({ name: z.string().min(1), groupId: z.string().optional() })).min(1).max(100),
          },
          async ({ boardId, items }: { boardId?: string; items: { name: string; groupId?: string }[] }): Promise<CallToolResult> => {
            const bid = boardId || currentBoardId;
            if (!bid) return err('未指定看板，请先用 list_boards / get_board_data 确认看板 id。');
            const role = await this.boards.resolveRole(bid, userId);
            if (!can(role, 'edit')) return err('你对当前看板没有编辑权限，无法创建条目。');
            try {
              const d: any = await this.boards.detail(bid, userId);
              const groupById = Object.fromEntries((d.groups ?? []).map((g: any) => [g.id, g.name]));
              const diff = items.map((it) => `新增「${it.name}」${it.groupId ? '→ 分组「' + (groupById[it.groupId] ?? it.groupId) + '」' : ''}`);
              const summary = `新建 ${items.length} 个条目`;
              const id = randomUUID();
              this.pending.set(id, { userId, tool: 'create_items', boardId: bid, payload: { items }, createdAt: Date.now() });
              onWrite({ id, tool: 'create_items', summary, payload: { items } });
              return { content: [{ type: 'text', text: `已生成新建预览（未执行，待用户确认）：\n${diff.join('\n')}` }] };
            } catch (e: any) {
              return err(`生成预览失败：${e?.message ?? e}`);
            }
          },
        ),
      );
    }

    return createSdkMcpServer({ name: 'manday', version: '1.0.0', tools });
  }

  /**
   * 写工具确认执行端点：消费 pending 记录，二次 ACL 校验后真正写入。
   * 前端只传 toolCallId；payload 以服务端登记为准（防篡改）。
   */
  async confirmTool(toolCallId: string, userId: string) {
    const rec = this.pending.get(toolCallId);
    if (!rec) throw new ForbiddenException('无效或已过期的确认请求，请重新发起');
    if (rec.userId !== userId) throw new ForbiddenException('无权确认该操作');
    if (Date.now() - rec.createdAt > this.PENDING_TTL_MS) {
      this.pending.delete(toolCallId);
      throw new ForbiddenException('确认请求已过期（超过 10 分钟），请重新发起');
    }
    this.pending.delete(toolCallId); // 一次性消费
    const role = await this.boards.resolveRole(rec.boardId, userId);
    if (!can(role, 'edit')) throw new ForbiddenException('你已失去对该看板的编辑权限');

    if (rec.tool === 'update_fields') {
      const res = await this.items.batchUpdate(rec.payload.changes, role, userId, 'ai');
      return { applied: true, updated: res.updated };
    }
    // create_items
    const created: any[] = [];
    for (const it of rec.payload.items) {
      created.push(await this.items.createItem(rec.boardId, it.name, it.groupId ?? null, role, userId, 'ai'));
    }
    return { applied: true, created: created.length };
  }

  /** 流式对话：转发到 Scania WorkBuddy 企业版（CodeBuddy 专享版），逐段 yield 文本/工具调用 */
  async *chat(req: ChatRequest): AsyncGenerator<AiStreamEvent> {
    const text = (t: string): AiStreamEvent => ({ type: 'text', text: t });
    if (!this.apiKey) {
      yield text('⚠️ 未配置 AI 网关（WORKBUDDY_AI_API_KEY），请联系管理员在 .env 中配置后重启后端。');
      return;
    }

    const prompt = (() => {
      const last = req.messages[req.messages.length - 1];
      if (!last) return '';
      if (typeof last.content === 'string') return last.content;
      return JSON.stringify(last.content ?? '');
    })();
    if (!prompt.trim()) return;

    const today = new Date().toISOString().slice(0, 10);
    const pendingWrites: { id: string; tool: string; summary: string; payload: unknown }[] = [];
    const server = this.buildMandayServer(req.userId, req.boardId, req.allowWriteTools, (rec) => pendingWrites.push(rec));

    let q;
    try {
      q = query({
        prompt,
        options: {
          // 纯对话安全：禁用内置文件/终端工具；看板数据走下方 MCP 工具
          tools: [],
          mcpServers: { manday: server },
          // 读工具直接执行；写工具在 SDK 内只产出预览（不落库），故可 allow，真正写入在 /ai/tool/confirm
          canUseTool: async (toolName: string) => {
            if (
              toolName.includes('list_boards') || toolName.includes('get_board_data') ||
              toolName.includes('get_workspace_overview') ||
              toolName.includes('update_fields') || toolName.includes('create_items')
            ) {
              return { behavior: 'allow' as const };
            }
            return { behavior: 'deny' as const, message: '当前仅支持看板查询、工作台总览与写预览工具。' };
          },
          permissionMode: 'default',
          ...(this.model ? { model: this.model } : {}),
          systemPrompt: {
            append:
              '你是 Manday（企业内部轻量级 Monday.com 替代品）内置的 AI 助手。' +
              `今天是 ${today}。` +
              '你拥有看板工具：list_boards（列看板）、get_board_data（读看板数据，返回列定义/分组/条目/列值，含 id 与 settings）、get_workspace_overview（跨看板总览：各板进度/状态分布/逾期/负载/动态，用于周报）。' +
              (req.allowWriteTools
                ? '你还拥有写工具：update_fields（批量改列值，如标记状态为已完成）、create_items（新建条目）。' +
                  '写工具只返回变更预览、不会立即生效；调用后你会拿到一份 diff，把它如实呈现给用户，并说明「已生成预览，待你确认执行」。' +
                  'status 列的 value 必须使用 get_board_data 返回的该列 settings.doneLabels（或 settings.labels）中的准确标签文字。'
                : '') +
              '当用户问「哪些任务逾期」「某人的工作负荷」「看板进度」等需要数据的问题时，务必先调用工具读真实数据再回答，不要凭空猜测。' +
              '用户当前打开了某个看板（get_board_data 省略 boardId 即读当前看板）。当用户说「这个看板 / 这些任务 / 本看板」时，默认指当前打开的看板：' +
              '先用 get_board_data 读当前看板数据，再基于数据判断，不要动辄反问「哪个看板」。只有当前看板数据明显对不上、或用户明确提到多个看板时，才用 list_boards 或请用户澄清。' +
              '当用户要求「把某些任务标记为完成/修改/新增」等写操作时，调用对应写工具生成预览。' +
              '逾期判断：日期列的值 < 今天，且状态列尚未标记为完成。工作负荷：统计 people 列各成员未完成条目数。' +
              '当用户要求「周报」「进展总结」「项目进度」等跨看板汇总时，用 get_workspace_overview 一次性取数据，组织成结构化中文周报（各项目进度 + 逾期风险 + 团队负载 + 近期动态）。' +
              '回答简洁、准确、中文；数据不足或权限受限时如实说明。',
          },
          env: {
            CODEBUDDY_API_KEY: this.apiKey,
            CODEBUDDY_INTERNET_ENVIRONMENT: 'cloudhosted',
          },
        },
      });
    } catch (e: any) {
      yield text(`⚠️ 初始化 AI 网关失败：${e?.message ?? e}`);
      return;
    }

    try {
      for await (const message of q) {
        if (message.type === 'assistant') {
          const blocks = (message as any).message?.content ?? [];
          for (const block of blocks) {
            if (block.type === 'text' && block.text) yield text(block.text);
          }
        }
      }
    } catch (e: any) {
      yield text(`\n⚠️ AI 请求出错：${e?.message ?? e}`);
    }

    // 本轮产生的待确认写操作，作为结构化帧下发（前端渲染「确认执行」卡片）
    for (const pw of pendingWrites) {
      yield { type: 'tool_call', id: pw.id, tool: pw.tool, summary: pw.summary, payload: pw.payload };
    }
  }
}
