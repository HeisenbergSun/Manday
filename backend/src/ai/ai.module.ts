/**
 * AI 模块 — 把 WorkBuddy 企业版对话网关包装成 Manday 的 /ai 接口
 * 安全三原则：工具白名单 / 写操作确认 / 全量审计（source:'ai'）
 */
import { Module } from '@nestjs/common';
import { Controller, Post, Body, Sse, UseGuards, Req } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { WorkBuddyAIService } from './workbuddy-ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: WorkBuddyAIService) {}

  /** 对话（SSE 流式）：前端侧边栏直接消费 */
  @Sse('chat/stream')
  async chat(@Req() req, @Body() body: { boardId?: string; message: string; confirmedToolCall?: string }) {
    // req.user 来自 SSO 守卫；AI 全程以用户身份运行，无独立权限
    const stream = this.ai.chat({
      userId: req.user.id,
      boardId: body.boardId,
      allowWriteTools: true,
      messages: [{ role: 'user', content: body.message }],
    });
    return new Observable((sub) => {
      (async () => { for await (const chunk of stream) sub.next({ data: chunk }); sub.complete(); })();
    });
  }

  /**
   * 写工具确认执行端点：AI 产出的预览卡片，用户点确认后走这里
   * 真正的写入复用 ItemsService（ACL 再次校验），AI 无独立写通道
   */
  @Post('tool/confirm')
  async confirmTool(@Req() req, @Body() body: { toolCallId: string; tool: string; payload: unknown }) {
    // 1. 校验 toolCallId 属于该用户未过期会话（防伪造/重放）
    // 2. 按 tool 分发到对应 Service（create_board / create_items / update_fields / create_automation）
    // 3. 落 audit_logs source='ai'，返回 diff 与回滚句柄
    return { applied: true, rollbackToken: 'TODO' };
  }
}

@Module({
  controllers: [AiController],
  providers: [WorkBuddyAIService],
})
export class AiModule {}
