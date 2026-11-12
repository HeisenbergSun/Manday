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
      useFactory: () =>
        new Pool({
          connectionString: process.env.DATABASE_URL || 'postgres://manday:manday@localhost:5432/manday',
          max: Number(process.env.PG_POOL_MAX || 20),
          idleTimeoutMillis: 30000,
        }),
    },
  ],
  exports: [Pool],
})
export class DatabaseModule {}
