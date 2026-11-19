/**
 * 全局数据库模块 — 单例 pg Pool，供全部模块注入
 * 200 人规模：单 Pool（max 20）足够，绝不搞读写分离/分库
 */
import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

@Global()
@Module({
  providers: [
    {
      provide: Pool,
      useFactory: () => {
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL || 'postgres://manday:manday@localhost:5432/manday',
          max: Number(process.env.PG_POOL_MAX || 20),
          idleTimeoutMillis: 30000,
        });
        // 远端 Neon 偶发 ECONNRESET：挂 error handler 防 unhandled error 拖垮进程（pool 会自动重连）
        pool.on('error', (err) => console.warn('[pg] idle client error:', (err as Error).message));
        return pool;
      },
    },
  ],
  exports: [Pool],
})
export class DatabaseModule {}
