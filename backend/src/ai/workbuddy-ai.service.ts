/**
 * Manday × Scania WorkBuddy 企业版 AI 集成适配器
 *
 * 实现说明：
 * - 底层走腾讯云 CodeBuddy Agent SDK（@tencent-ai/agent-sdk），专享版（cloudhosted）模式。
 * - 鉴权：CODEBUDDY_API_KEY + CODEBUDDY_INTERNET_ENVIRONMENT=cloudhosted。
 *   专享版由 API Key 自动解析企业实例（scania.copilot.qq.com），无需显式 endpoint；
 *   显式传 endpoint 反而会在本环境被安全策略拦截，故不传。
 * - 看板数据接入：通过 SDK 的 createSdkMcpServer + tool() 暴露两个「只读」工具
 *   （list_boards / get_board_data），在 query() 的 options.mcpServers 注入。
 *   tools:[] 仍禁用内置文件/终端工具，AI 只能通过这些只读工具访问看板数据。
 *
 * 安全原则（对应方案 v3.0）：
 * 1. AI 身份 = 当前用户代理；只读工具复用 BoardsService 的可见性过滤 + 列权限过滤，
 *    因此 AI 只能读到「当前用户有权看到」的数据，无法越权。
 * 2. 只读工具直接执行；写工具（后续）必须走「预览→确认→执行」，全程 source:'ai' 审计。
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { query, createSdkMcpServer, tool } from '@tencent-ai/agent-sdk';
import { z } from 'zod';
import { BoardsService } from '../modules/boards/boards.module';

export interface ChatRequest {
  /** 当前用户上下文（权限边界） */
  userId: string;
  /** 当前所在 Board（侧边栏上下文感知） */
  boardId?: string;
  messages: { role: 'user' | 'assistant' | 'tool'; content: unknown }[];
  /** 本轮是否允许写工具（纯对话阶段暂未启用） */
  allowWriteTools: boolean;
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

@Injectable()
export class WorkBuddyAIService {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigService, private readonly boards: BoardsService) {
    this.apiKey = config.get('WORKBUDDY_AI_API_KEY') || '';
    // 未配置则用企业默认模型（CLI 的 auto）
    this.model = config.get('WORKBUDDY_AI_MODEL') || '';
  }

  /** 是否已配置好 AI 网关 */
  get configured(): boolean {
    return !!this.apiKey;
  }

  /** 构建只读看板数据工具（每次 chat 按当前用户上下文创建，避免跨请求串号） */
  private buildMandayServer(userId: string, currentBoardId?: string) {
    return createSdkMcpServer({
      name: 'manday',
      version: '1.0.0',
      tools: [
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
              return { content: [{ type: 'text', text: `查询看板列表失败：${e?.message ?? e}` }], isError: true };
            }
          },
        ),
        tool(
          'get_board_data',
          '读取指定看板的完整数据：列定义、分组、条目及其列值（列名已映射、状态已取 label、人员已解析为姓名）。' +
          '用于回答「哪些任务逾期」「某成员的工作负荷」「某看板进度」等需要看板数据的问题。' +
          'boardId 省略时使用当前上下文看板。',
          { boardId: z.string().optional() },
          async ({ boardId }: { boardId?: string }) => {
            const bid = boardId || currentBoardId;
            if (!bid) return { content: [{ type: 'text', text: '未指定看板，请先用 list_boards 工具查询看板 id。' }], isError: true };
            try {
              const d: any = await this.boards.detail(bid, userId);
              const users = await this.boards.listUsers();
              // 列名映射（去重：同名列加类型后缀，保证 values 键唯一）
              const used = new Set<string>();
              const columns = (d.columns ?? []).map((c: any) => {
                let label = c.name;
                if (used.has(label)) label = `${label}(${c.type})`;
                used.add(label);
                return { id: c.id, name: label, type: c.type };
              });
              const colById = Object.fromEntries((d.columns ?? []).map((c: any) => [c.id, c]));
              const groupById = Object.fromEntries((d.groups ?? []).map((g: any) => [g.id, g.name]));
              const items = (d.items ?? []).map((it: any) => {
                const values: Record<string, unknown> = {};
                for (const [cid, v] of Object.entries(it.values ?? {})) {
                  const col = colById[cid];
                  if (!col) continue;
                  let label = col.name;
                  const vals = columns.find((x: any) => x.id === cid);
                  if (vals) label = vals.name;
                  values[label] = parseValue(col, v, users);
                }
                return { name: it.name, group: groupById[it.group_id] ?? '', values };
              });
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    board: d.board?.name,
                    today: new Date().toISOString().slice(0, 10),
                    columns: columns.map((c: any) => ({ name: c.name, type: c.type })),
                    groups: (d.groups ?? []).map((g: any) => g.name),
                    items,
                  }),
                }],
              };
            } catch (e: any) {
              return { content: [{ type: 'text', text: `读取看板失败：${e?.message ?? e}` }], isError: true };
            }
          },
        ),
      ],
    });
  }

  /** 流式对话：转发到 Scania WorkBuddy 企业版（CodeBuddy 专享版），逐段 yield 文本 */
  async *chat(req: ChatRequest): AsyncGenerator<string> {
    if (!this.apiKey) {
      yield '⚠️ 未配置 AI 网关（WORKBUDDY_AI_API_KEY），请联系管理员在 .env 中配置后重启后端。';
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
    let q;
    try {
      q = query({
        prompt,
        options: {
          // 纯对话安全：禁用内置文件/终端工具；看板数据走下方只读 MCP 工具
          tools: [],
          // 只读看板工具（复用 BoardsService 的权限过滤）
          mcpServers: { manday: this.buildMandayServer(req.userId, req.boardId) },
          // 只允许本服务的只读工具自动执行；其余（含未来写工具）一律拒绝
          canUseTool: async (toolName: string) => {
            if (toolName.includes('list_boards') || toolName.includes('get_board_data')) {
              return { behavior: 'allow' as const };
            }
            return { behavior: 'deny' as const, message: '当前仅支持只读看板查询工具。' };
          },
          permissionMode: 'default',
          ...(this.model ? { model: this.model } : {}),
          systemPrompt: {
            append:
              '你是 Manday（企业内部轻量级 Monday.com 替代品）内置的 AI 助手。' +
              `今天是 ${today}。` +
              '你现在拥有两个只读工具：list_boards（列出看板）和 get_board_data（读取看板数据，返回列定义、分组、条目及列值）。' +
              '当用户问「哪些任务逾期」「某人的工作负荷」「看板进度」「我有哪些看板」等需要数据的问题时，' +
              '务必先调用这些工具读取真实数据，再基于数据回答，不要凭空猜测或说「我无法读取数据」。' +
              '逾期判断：日期列的值 < 今天，且该条目状态列（status，如 Done/已完成）尚未标记为完成。' +
              '工作负荷：统计 people 列中各成员被指派的未完成条目数量。' +
              '回答要简洁、准确、用中文；若数据不足或权限受限（某些列不可见），如实说明。',
          },
          env: {
            CODEBUDDY_API_KEY: this.apiKey,
            CODEBUDDY_INTERNET_ENVIRONMENT: 'cloudhosted',
          },
        },
      });
    } catch (e: any) {
      yield `⚠️ 初始化 AI 网关失败：${e?.message ?? e}`;
      return;
    }

    try {
      for await (const message of q) {
        if (message.type === 'assistant') {
          const blocks = (message as any).message?.content ?? [];
          for (const block of blocks) {
            if (block.type === 'text' && block.text) yield block.text;
          }
        }
      }
    } catch (e: any) {
      yield `\n⚠️ AI 请求出错：${e?.message ?? e}`;
    }
  }
}
