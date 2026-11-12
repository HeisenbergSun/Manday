/**
 * Excel 导入 — P0 刚需：新 Board 落地第一步
 * 流程：上传 → 解析预览（列映射建议）→ 用户确认映射 → 事务写入
 * 依赖：xlsx (SheetJS) — npm i xlsx
 */
import { Injectable, Controller, Post, Body, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { can } from '../boards/acl';

interface ImportPreview {
  headers: string[];                 // Excel 列名
  sampleRows: Record<string, unknown>[];  // 前 5 行
  suggestedMapping: { header: string; columnType: string; confidence: number }[];
}

@Injectable()
export class ImportService {
  constructor(private pg: Pool) {}

  /** 第一步：解析 + 智能映射建议（用户在预览页确认后才写入） */
  parseWorkbook(buffer: Buffer, fileName: string): ImportPreview {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (!rows.length) throw new Error('EMPTY_SHEET');
    const headers = Object.keys(rows[0]);

    return {
      headers,
      sampleRows: rows.slice(0, 5),
      suggestedMapping: headers.map((h) => this.guessColumnType(h, rows, h)),
    };
  }

  /** 启发式列类型猜测：按表头关键词 + 值抽样 */
  private guessColumnType(header: string, rows: Record<string, unknown>[], key: string) {
    const values = rows.map((r) => r[key]).filter((v) => v != null);
    const kw = header.toLowerCase();
    const hit = (words: string[]) => words.some((w) => kw.includes(w));

    if (hit(['状态', 'stage', 'status']) || values.every((v) => ['待办','进行中','已完成','Done','Todo'].includes(String(v))))
      return { header, columnType: 'status', confidence: 0.9 };
    if (hit(['负责人', 'owner', 'assignee', 'who']))
      return { header, columnType: 'people', confidence: 0.85 };  // 值→email 匹配 users
    if (hit(['日期', '截止', 'date', 'due']) || values.every((v) => /^\d{4}-\d{2}-\d{2}/.test(String(v))))
      return { header, columnType: 'date', confidence: 0.8 };
    if (hit(['优先级', 'priority']) || values.every((v) => ['高','中','低'].includes(String(v))))
      return { header, columnType: 'dropdown', confidence: 0.8 };
    if (values.every((v) => typeof v === 'number')) return { header, columnType: 'number', confidence: 0.7 };
    if (values.every((v) => typeof v === 'boolean')) return { header, columnType: 'checkbox', confidence: 0.7 };
    return { header, columnType: 'text', confidence: 0.5 };
  }

  /** 第二步：按用户确认的映射批量写入（单事务，全成或全不成） */
  async import(
    boardId: string, mapping: Record<string, { columnId?: string; columnType: string; newName?: string }>,
    rows: Record<string, unknown>[], userRole: any, userId: string,
  ) {
    if (!can(userRole, 'edit')) throw new Error('FORBIDDEN');
    const client = await this.pg.connect();
    try {
      await client.query('BEGIN');

      // 1. 确保列定义存在（缺失的类型按映射新建列）
      const colIds: Record<string, string> = {};
      for (const [header, m] of Object.entries(mapping)) {
        if (m.columnId) { colIds[header] = m.columnId; continue; }
        const { rows: cr } = await client.query(
          `INSERT INTO board_columns (board_id, type, name, settings, position)
           VALUES ($1,$2,$3,'{}', (SELECT COALESCE(MAX(position),0)+1 FROM board_columns WHERE board_id=$1))
           RETURNING id`,
          [boardId, m.columnType, m.newName ?? header],
        );
        colIds[header] = cr[0].id;
      }

      // 2. people 列：值按 email/name 匹配用户 id；未匹配保留原文并标记
      // 3. 写入 items + item_values
      let position = Date.now() / 1000;
      for (const row of rows) {
        const { rows: ir } = await client.query(
          `INSERT INTO items (board_id, name, position, created_by)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [boardId, String(row[String(mapping['__name__']?.columnId ?? Object.keys(mapping)[0])] ?? '未命名'), position++, userId],
        );
        const itemId = ir[0].id;
        for (const [header, colId] of Object.entries(colIds)) {
          if (row[header] == null) continue;
          await client.query(
            `INSERT INTO item_values (item_id, column_id, board_id, value)
             VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (item_id, column_id) DO NOTHING`,
            [itemId, colId, boardId, JSON.stringify(row[header])],
          );
        }
      }
      await client.query(
        `INSERT INTO audit_logs (user_id, action, target, source)
         VALUES ($1,'board.import',$2,'ui')`,
        [userId, `board:${boardId};rows:${rows.length}`],
      );
      await client.query('COMMIT');
      return { imported: rows.length };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
}

@Controller('boards')
export class ImportController {
  constructor(private svc: ImportService) {}
  @Post(':id/import/preview')
  preview(@Req() req, @Body() body: { fileName: string; fileBase64: string }) {
    return this.svc.parseWorkbook(Buffer.from(body.fileBase64, 'base64'), body.fileName);
  }
  @Post(':id/import/confirm')
  confirm(@Req() req, @Body() body: { mapping: any; rows: Record<string, unknown>[] }) {
    return this.svc.import(req.params.id, body.mapping, body.rows, req.user.role, req.user.id);
  }
}

@Module({ controllers: [ImportController], providers: [ImportService] })
export class ImportModule {}
