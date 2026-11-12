/**
 * 健康检查 — docker healthcheck 与 Uptime Kuma 探测端点
 */
import { Controller, Get } from '@nestjs/common';
import { Pool } from 'pg';
import { Public } from './modules/auth/auth.guard';

@Controller()
export class HealthController {
  constructor(private pg: Pool) {}

  @Public()
  @Get('health')
  async health() {
    try {
      await this.pg.query('SELECT 1');
      return { status: 'ok', db: 'up', ts: Date.now() };
    } catch {
      return { status: 'degraded', db: 'down', ts: Date.now() };
    }
  }
}
