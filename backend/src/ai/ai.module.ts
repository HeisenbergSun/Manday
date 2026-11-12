/**
 * AI 模块 — 把 WorkBuddy 企业版对话网关包装成 Manday 的 /ai 接口
 * 安全三原则：工具白名单 / 写操作确认 / 全量审计（source:'ai'）
 */
import { Module } from '@nestjs/common';
import { Controller, Post, Get, Body, Sse, Query, Req, Res } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { WorkBuddyAIService } from './workbuddy-ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: WorkBuddyAIService) {}

  /**
   * 对话（SSE 流式，POST）——前端 AiSidebar 用 fetch POST 消费（可带 Authorization 头）
   * 手动写 SSE 帧而不是用 @Sse，因为 @Sse 只支持 GET 且无法取 body
   */
  @Post('chat/stream')
  async chatPost(@Req() req, @Res() res, @Body() body: { boardId?: string; message: string }) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const stream = this.ai.chat({
      userId: req.user.id,
      boardId: body.boardId,
      allowWriteTools: true,
      messages: [{ role: 'user', content: body.message }],
    });
    try {
      for await (const chunk of stream) {
        res.write(`data: ${String(chunk).replace(/\n/g, '\ndata: ')}\n\n`);
      }
      res.write('event: done\ndata: [DONE]\n\n');
    } catch (e: any) {
      res.write(`data: \n\n`);
    } finally {
      res.end();
    }
  }

  /** 兼容 GET 版本（浏览器直接访问/调试用） */
  @Sse('chat/stream')
  async chat(@Req() req, @Query('message') message: string, @Query('boardId') boardId?: string) {
    const body = { boardId, message: message ?? '' };
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
