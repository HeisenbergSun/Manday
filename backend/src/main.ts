/**
 * Manday 后端入口 — NestJS 模块化单体
 * 运行: npm i && npm run start:dev  (需本地 PG + Redis，或 docker compose)
 * 云部署(Render/单容器): 同时托管前端静态文件（同源，免 CORS）
 */
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/http-exception.filter';
import * as path from 'path';
import * as express from 'express';
import * as fs from 'fs';

async function ensureSchema() {
  // 云端首次启动：PG 空库时自动执行 schema（+ 可选演示数据），免手工 migrate
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(`SELECT to_regclass('public.users') AS t`);
    if (!rows[0].t) {
      const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
      await pool.query(schema);
      console.log('[bootstrap] schema.sql 已执行（首次启动初始化）');
      if (process.env.SEED_DEMO === 'true') {
        const seed = fs.readFileSync(path.join(__dirname, '../db/seed.sql'), 'utf8');
        await pool.query(seed);
        console.log('[bootstrap] seed.sql 演示数据已写入');
      }
    }
  } catch (e) {
    console.warn('[bootstrap] 初始化 schema 跳过/失败（无 PG 时忽略）:', (e as Error).message);
  } finally {
    await pool.end();
  }
}

/** 幂等小迁移：已有库也能补上后加的表（schema.sql 仅空库首启时执行） */
async function ensureMinorSchema() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS board_views (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        board_id    UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        view_type   TEXT NOT NULL DEFAULT 'table',
        config      JSONB DEFAULT '{}'::jsonb,
        locked      BOOLEAN DEFAULT false,
        locked_by   UUID REFERENCES users(id),
        position    INT DEFAULT 0,
        created_by  UUID REFERENCES users(id),
        created_at  TIMESTAMPTZ DEFAULT now(),
        UNIQUE(board_id, name)
      );
      CREATE TABLE IF NOT EXISTS user_board_prefs (
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        board_id     UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        default_view TEXT DEFAULT 'table',
        view_id      UUID REFERENCES board_views(id) ON DELETE SET NULL,
        prefs        JSONB DEFAULT '{}'::jsonb,
        updated_at   TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, board_id)
      );`);
    console.log('[bootstrap] minor schema OK');
  } catch (e) {
    console.warn('[bootstrap] minor schema 跳过/失败:', (e as Error).message);
  } finally {
    await pool.end();
  }
}

async function bootstrap() {
  await ensureSchema();
  await ensureMinorSchema();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? true, credentials: true });

  // 前端调用带 /api 前缀 → 剥掉后转发给后端路由（同源部署，零 CORS 配置）
  // 标记 req.__api 供 SPA 兜底判断，避免 /api/xxx 被重写成 /xxx 后又被兜底吞掉
  app.use((req: any, _res: any, next: any) => {
    req.__api = false;
    if (req.url === '/api') { req.url = '/'; req.__api = true; }
    else if (req.url.startsWith('/api/')) { req.url = req.url.slice(4); req.__api = true; }
    next();
  });

  // 单容器部署：托管前端构建产物（本地开发无此目录时跳过）
  // 关键：SPA 兜底必须挂在 Nest 路由之前注册（init 后加路由会被 Nest 的 404 处理器挡住），
  // 因此用排除清单防止吞掉 API：__api 标记、/health、/ai、/socket.io、/auth
  const publicDir = path.join(__dirname, '../public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.use((req: any, res: any, next: any) => {
      if (
        req.method === 'GET' &&
        !req.__api &&
        !/^\/(health|ai|socket\.io)(\/|$)/.test(req.url) &&
        !req.url.startsWith('/auth')
      ) {
        return res.sendFile(path.join(publicDir, 'index.html'));
      }
      next();
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
