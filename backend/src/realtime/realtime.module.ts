/**
 * Realtime 模块 — Socket.IO 网关包装
 */
import { Module, forwardRef } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
