/**
 * 模块化单体根模块 — 内部模块边界清晰，为未来拆分留口，但绝不微服务化
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './modules/auth/auth.module';
import { GuardModule } from './modules/auth/auth.guard';
import { BoardsModule } from './modules/boards/boards.module';
import { ItemsModule } from './modules/items/items.module';
import { ImportModule } from './modules/import/import.module';
import { ItemDetailModule } from './modules/items/item-detail.module';
import { NotificationModule } from './modules/notification/notification.module';
import { SearchModule } from './modules/search/search.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AutomationApiModule } from './modules/automation/automation-api.module';
import { AdminModule } from './modules/admin/admin.module';
import { TemplateModule } from './modules/template/template.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AutomationModule } from './modules/automation/automation.module';
import { AiModule } from './ai/ai.module';
import { DatabaseModule } from './database.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,   // 全局单例 pg Pool
    // 200 人规模基础限流：防脚本滥用，非安全边界
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 600 }]),
    AuthModule,        // SSO OAuth（企微/飞书策略模式）+ 首登建户 + 部门同步
    BoardsModule,      // Board/Group/Column + 权限(统一 ACL 入口)
    ItemsModule,       // Item CRUD + 动态列值 + 批量操作 + 回收站
    ImportModule,      // Excel 导入：解析预览 + 智能列映射 + 确认写入
    ItemDetailModule,  // 条目详情：评论/子任务/变更历史 + @提及通知
    NotificationModule,// 通知中心：高优先级实时推 + 其余每日摘要归并
    SearchModule,      // 全局搜索：pg_trgm，只搜可见 Board
    DashboardModule,   // 跨 Board 聚合：battery/numbers/status-dist（可见性过滤）
    AutomationApiModule,// 自动化配方中心：预置模板 + AI 创建统一入口（action 白名单校验）
    AdminModule,        // 管理后台：组织架构树 + 批量用户导入（幂等）
    TemplateModule,     // 模板中心：5 套预置工作流模板，一键实例化 Board
    RealtimeModule,    // Socket.IO：board:{id} / user:{id} 房间
    AutomationModule.register(),  // BullMQ 异步自动化引擎（无 REDIS_URL 时自动降级跳过）
    AiModule,          // WorkBuddy 企业版 AI 集成
    GuardModule,       // 全局 JWT 守卫（/auth/* 与 /health 公开）
  ],
  controllers: [require('./health.controller').HealthController],
})
export class AppModule {}
