/**
 * Manday × Scania WorkBuddy 企业版 AI 集成适配器
 *
 * 设计原则（对应方案 v3.0 第二章）：
 * 1. AI 身份 = 当前用户代理：所有工具调用透传用户 token，复用既有 ACL，无越权通道
 * 2. 只读工具直接执行；写工具必须"预览卡片 → 用户确认 → 执行"
 * 3. 所有 AI 写入打 source:'ai' 标记，落 audit_logs 可追溯、可撤销
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WorkBuddyAIConfig {
  /** WorkBuddy 企业版 AI 服务地址（由管理员在部署时配置） */
  baseUrl: string;
  /** 服务间调用凭证（仅后端持有，不下发前端） */
  apiKey: string;
  /** 模型标识，如工作台已配置的默认对话模型 */
  model: string;
}

export interface ChatRequest {
  /** 当前用户上下文（权限边界） */
  userId: string;
  /** 当前所在 Board（侧边栏上下文感知） */
  boardId?: string;
  messages: { role: 'user' | 'assistant' | 'tool'; content: unknown }[];
  /** 本轮允许的工具集：只读会话仅注入只读工具 */
  allowWriteTools: boolean;
}

/**
 * 统一走 WorkBuddy 企业版的对话网关（SSE 流式）。
 * 好处：模型切换/鉴权/审计/成本控制全部收口在公司已部署的 WorkBuddy，
 * Manday 只维护"工具定义 + 确认 + 审计"这一层，不自管 LLM Key。
 */
@Injectable()
export class WorkBuddyAIService {
  private readonly cfg: WorkBuddyAIConfig;

  constructor(config: ConfigService) {
    this.cfg = {
      // 本地开发/未配置网关时服务仍可启动；AI 调用时在 chat() 里给出明确报错
      baseUrl: config.get('WORKBUDDY_AI_BASE_URL') || '',
      apiKey: config.get('WORKBUDDY_AI_API_KEY') || '',
      model: config.get('WORKBUDDY_AI_MODEL', 'workbuddy-default'),
    };
  }

  /** 流式对话：转发到 WorkBuddy 企业版，返回 SSE 流 */
  async *chat(req: ChatRequest): AsyncGenerator<string> {
    if (!this.cfg.baseUrl || !this.cfg.apiKey) {
      yield '⚠️ WorkBuddy 企业版 AI 网关未配置（WORKBUDDY_AI_BASE_URL / WORKBUDDY_AI_API_KEY），请联系管理员在 .env 中配置。';
      return;
    }
    const res = await fetch(`${this.cfg.baseUrl}/v1/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: req.messages,
        tools: buildToolDefs(req.allowWriteTools),
        stream: true,
        // 透传业务上下文，供 WorkBuddy 侧审计与配额统计
        metadata: { product: 'manday', userId: req.userId, boardId: req.boardId },
      }),
    });
    if (!res.ok) throw new Error(`WorkBuddy AI gateway error: ${res.status}`);
    // 解析 SSE data 行，逐段 yield（此处略去具体 SSE 解析细节）
    yield* parseSSE(res.body!);
  }
}

/* ================= 工具定义（Agent + Function Calling） ================= */

const READ_TOOLS = [
  {
    name: 'search_items',
    description: '按关键词/状态/负责人/日期搜索当前用户可见的条目',
    parameters: { boardId: 'string?', keyword: 'string?', assigneeId: 'string?', status: 'string?' },
  },
  {
    name: 'get_board_schema',
    description: '获取 Board 的列定义、分组与统计摘要（不含未授权列值）',
    parameters: { boardId: 'string' },
  },
  {
    name: 'aggregate',
    description: '跨 Board 聚合统计：count/sum/平均，按状态、负责人分组',
    parameters: { boardIds: 'string[]', metric: 'count|sum', groupBy: 'status|assignee|date' },
  },
];

const WRITE_TOOLS = [
  {
    name: 'create_board',
    description: '用自然语言结构创建新看板（列定义+分组），需用户确认后执行',
    parameters: { name: 'string', columns: 'ColumnDef[]', groups: 'string[]' },
  },
  {
    name: 'create_items',
    description: '向指定 Board/Group 批量创建条目（>10 条需二次确认）',
    parameters: { boardId: 'string', groupId: 'string?', items: 'ItemInput[]' },
  },
  {
    name: 'update_fields',
    description: '批量更新条目字段值',
    parameters: { itemIds: 'string[]', changes: 'Record<columnId, value>' },
  },
  {
    name: 'create_automation',
    description: '把自然语言规则翻译为 trigger/condition/action 配置',
    parameters: { boardId: 'string', trigger: 'object', action: 'object', condition: 'object?' },
  },
];

function buildToolDefs(allowWrite: boolean) {
  return allowWrite ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
}

async function* parseSSE(body: ReadableStream): AsyncGenerator<string> {
  // 生产实现：按 '\n\n' 分帧解析 'data: {...}'，yield 增量文本与 tool_call 事件
  yield '';
}
