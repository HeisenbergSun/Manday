/**
 * Manday × Scania WorkBuddy 企业版 AI 集成适配器
 *
 * 实现说明：
 * - 底层走腾讯云 CodeBuddy Agent SDK（@tencent-ai/agent-sdk），专享版（cloudhosted）模式。
 * - 鉴权：CODEBUDDY_API_KEY + CODEBUDDY_INTERNET_ENVIRONMENT=cloudhosted。
 *   专享版由 API Key 自动解析企业实例（scania.copilot.qq.com），无需显式 endpoint；
 *   显式传 endpoint 反而会在本环境被安全策略拦截，故不传。
 * - 当前为「纯对话」模式：tools:[] 禁用内置文件/终端工具，避免 AI 触碰服务器文件系统。
 *   （后续要接入看板数据，可在此基础上用 SDK 的 MCP 自定义工具暴露 search_items 等。）
 *
 * 安全原则（对应方案 v3.0）：
 * 1. AI 身份 = 当前用户代理；写操作后续走「预览→确认→执行」，全程 source:'ai' 审计。
 * 2. 只读工具直接执行；写工具必须用户确认。
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { query } from '@tencent-ai/agent-sdk';

export interface ChatRequest {
  /** 当前用户上下文（权限边界） */
  userId: string;
  /** 当前所在 Board（侧边栏上下文感知） */
  boardId?: string;
  messages: { role: 'user' | 'assistant' | 'tool'; content: unknown }[];
  /** 本轮是否允许写工具（纯对话阶段暂未启用） */
  allowWriteTools: boolean;
}

@Injectable()
export class WorkBuddyAIService {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get('WORKBUDDY_AI_API_KEY') || '';
    // 未配置则用企业默认模型（CLI 的 auto）
    this.model = config.get('WORKBUDDY_AI_MODEL') || '';
  }

  /** 是否已配置好 AI 网关 */
  get configured(): boolean {
    return !!this.apiKey;
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

    let q;
    try {
      q = query({
        prompt,
        options: {
          // 纯对话：禁用内置工具，避免 AI 读/写服务器文件系统
          tools: [],
          permissionMode: 'default',
          ...(this.model ? { model: this.model } : {}),
          systemPrompt: {
            append:
              '你是 Manday（企业内部轻量级 Monday.com 替代品）内置的 AI 助手。' +
              '请用简洁、准确的中文回答用户关于看板、任务、进度、周报等的问题。' +
              '当前是纯对话模式，你无法直接读取看板数据，可引导用户提供必要的上下文。',
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
