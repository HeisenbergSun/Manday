/**
 * P3-2 文件附件 — 上传 / 列表 / 下载 / 删除
 * cell value 存附件元数据 JSON 数组 [{id,name,size,mime}]（Grid chip 渲染源）
 * 文件本体落 backend/uploads/，元数据落 attachments 表
 * 权限：上传/删除需 board editor+，下载/列表需可见（viewer 可下载）
 */
import { Controller, Get, Post, Delete, Param, Req, Res, UseInterceptors, UploadedFile, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { Pool } from 'pg';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

/** multer(busboy) 默认按 latin1 解码 multipart 文件名 → 中文乱码；仅当含高位字符时重解码为 utf8 */
function fixFileName(s: string): string {
  if (!s || !/[^\x00-\x7f]/.test(s)) return s;
  try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; }
}

@Controller()
export class AttachmentsController {
  constructor(private readonly pg: Pool) {}

  /** 与 items.controller.resolveBoardRole 同规则 */
  private async resolveBoardRole(boardId: string, userId: string): Promise<string | null> {
    const { rows } = await this.pg.query(
      `SELECT b.owner_id, b.visibility, bp.role,
              EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = $2
                      AND ud.department_id = b.department_id) AS in_dept
       FROM boards b
       LEFT JOIN board_permissions bp ON bp.board_id = b.id AND bp.subject_type = 'user' AND bp.subject_id = $2
       WHERE b.id = $1`,
      [boardId, userId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    if (r.role) return r.role;
    if (r.owner_id === userId) return 'owner';
    if (r.visibility === 'company') return 'editor';
    if (r.visibility === 'department' && r.in_dept) return 'editor';
    return 'viewer';
  }

  /** 附件元数据合并写回 attachment 列 cell（JSON 数组） */
  private async syncCellValue(itemId: string, columnId: string, boardId: string) {
    const { rows: at } = await this.pg.query(
      `SELECT id, file_name AS name, size, mime_type AS mime FROM item_attachments WHERE item_id = $1 AND column_id = $2 ORDER BY created_at`,
      [itemId, columnId],
    );
    await this.pg.query(
      `INSERT INTO item_values (item_id, column_id, board_id, value)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (item_id, column_id) DO UPDATE SET value = $4::jsonb`,
      [itemId, columnId, boardId, JSON.stringify(at)],
    );
    await this.pg.query(`UPDATE items SET version = version + 1 WHERE id = $1`, [itemId]);
    return at;
  }

  @Post('items/:itemId/attachments')
  @UseInterceptors(FileInterceptor('file', { storage: multer.memoryStorage(), defParamCharset: 'utf8' } as any))
  async upload(@Req() req: any, @Param('itemId') itemId: string, @UploadedFile() file: any) {
    const it = (await this.pg.query(`SELECT board_id FROM items WHERE id = $1 AND deleted_at IS NULL`, [itemId])).rows[0];
    if (!it) throw new NotFoundException('条目不存在');
    const boardId: string = it.board_id;
    const role = await this.resolveBoardRole(boardId, req.user.id);
    if (!role || role === 'viewer' || role === 'commenter') throw new ForbiddenException('无上传权限');
    if (!file) throw new BadRequestException('缺少文件');
    if (file.size > MAX_SIZE) throw new BadRequestException('文件超过 20MB 限制');
    const col = (await this.pg.query(`SELECT id FROM board_columns WHERE id = $1 AND type = 'attachment'`, [req.body?.columnId])).rows[0];
    if (!col) throw new BadRequestException('columnId 必须指向 attachment 列');

    const storedName = crypto.randomUUID() + path.extname(file.originalname).slice(0, 20);
    fs.writeFileSync(path.join(UPLOADS_DIR, storedName), file.buffer);
    const { rows } = await this.pg.query(
      `INSERT INTO item_attachments (item_id, board_id, column_id, file_name, mime_type, size, stored_name, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, file_name AS name, size, mime_type AS mime`,
      [itemId, boardId, req.body.columnId, fixFileName(file.originalname), file.mimetype, file.size, storedName, req.user.id],
    );
    const list = await this.syncCellValue(itemId, req.body.columnId, boardId);
    const { rows: v } = await this.pg.query(`SELECT version FROM items WHERE id = $1`, [itemId]);
    return { attachment: rows[0], attachments: list, version: v[0]?.version };
  }

  @Get('boards/:boardId/items/:itemId/attachments')
  async list(@Req() req: any, @Param('itemId') itemId: string, @Param('boardId') boardId: string) {
    const { rows } = await this.pg.query(
      `SELECT id, column_id, file_name AS name, size, mime_type AS mime, created_at FROM item_attachments WHERE item_id = $1 AND board_id = $2 ORDER BY created_at`,
      [itemId, boardId],
    );
    return rows;
  }

  @Get('attachments/:id/file')
  async download(@Req() req: any, @Param('id') id: string, @Res() res: any) {
    const { rows } = await this.pg.query(`SELECT * FROM item_attachments WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException('附件不存在');
    const a = rows[0];
    const role = await this.resolveBoardRole(a.board_id, req.user.id);
    if (!role) throw new ForbiddenException('无下载权限');
    const fp = path.join(UPLOADS_DIR, a.stored_name);
    if (!fs.existsSync(fp)) throw new NotFoundException('文件已丢失');
    res.setHeader('Content-Type', a.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.file_name)}`);
    return res.send(fs.readFileSync(fp));
  }

  @Delete('attachments/:id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const { rows } = await this.pg.query(`SELECT * FROM item_attachments WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException('附件不存在');
    const a = rows[0];
    const role = await this.resolveBoardRole(a.board_id, req.user.id);
    if (!role || (role !== 'owner' && role !== 'admin' && a.created_by !== req.user.id)) throw new ForbiddenException('仅上传者或负责人可删除');
    fs.unlinkSync(path.join(UPLOADS_DIR, a.stored_name));
    await this.pg.query(`DELETE FROM item_attachments WHERE id = $1`, [id]);
    const list = await this.syncCellValue(a.item_id, a.column_id, a.board_id);
    const { rows: v } = await this.pg.query(`SELECT version FROM items WHERE id = $1`, [a.item_id]);
    return { ok: true, attachments: list, version: v[0]?.version };
  }
}
