/**
 * 自动化引擎模块 — BullMQ worker 包装
 * 本地开发未配置 REDIS_URL 时跳过 worker 注册（HTTP 服务仍可启动），
 * 生产环境 docker compose 里必须提供 Redis。
 */
import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AutomationWorker, NotificationService } from './automation.worker';

const HAS_REDIS = !!process.env.REDIS_URL;

@Module({})
export class AutomationModule {
  static register(): DynamicModule {
    return {
      module: AutomationModule,
      imports: HAS_REDIS
        ? [BullModule.registerQueue({ name: 'automation', connection: { url: process.env.REDIS_URL } })]
        : [],
      providers: HAS_REDIS ? [AutomationWorker, NotificationService] : [NotificationService],
      exports: [NotificationService],
    };
  }
}
