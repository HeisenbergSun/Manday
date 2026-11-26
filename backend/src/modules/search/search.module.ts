/**
 * 全局搜索（P0 标题模糊搜索）— 跨 Board 找条目
 * 匹配策略：名称/看板名的「包含」匹配（ILIKE 子串，大小写不敏感）。
 * 之前的 pg_trgm `%`（相似度 ≥0.3）对短中文词（如「登录」「开发」两字）几乎永远 0 相似度，导致「搜不到」，
 * 故改为 ILIKE 子串 + 前缀优先排序，更符合「搜内容」的直觉。
 */
import { Injectable, Controller, Get, Query, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class SearchService {
  constructor(private pg: Pool) {}

  /** 只搜当前用户可见 Board 的条目（复用可见性 WHERE）；名称前缀命中 > 名称包含 > 看板名包含 */
  async search(userId: string, q: string, limit = 30) {
    const term = (q ?? '').trim();
    if (!term) return [];
    // 转义 LIKE 通配符，用户输入的 % _ \ 按字面处理
    const escaped = term.replace(/[\\%_]/g, (m) => '\\' + m);
    const contains = `%${escaped}%`;
    const prefix = `${escaped}%`;
    const { rows } = await this.pg.query(
      `SELECT i.id, i.name, i.board_id, b.name AS board_name,
              CASE
                WHEN i.name ILIKE $4 THEN 0   -- 名称前缀命中
                WHEN i.name ILIKE $2 THEN 1   -- 名称包含命中
                ELSE 2                        -- 看板名包含命中
              END AS rank
       FROM items i
       JOIN boards b ON b.id = i.board_id
       WHERE i.deleted_at IS NULL
         AND (i.name ILIKE $2 OR b.name ILIKE $2)
         AND (b.visibility = 'company'
              OR b.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $1)
              OR b.owner_id = $1
              OR EXISTS (SELECT 1 FROM board_permissions bp
                         WHERE bp.board_id = b.id AND bp.subject_type='user' AND bp.subject_id=$1))
       ORDER BY rank ASC, i.name ASC
       LIMIT $3`,
      [userId, contains, limit, prefix],
    );
    return rows;
  }
}

@Controller('search')
export class SearchController {
  constructor(private svc: SearchService) {}
  @Get() search(@Req() req, @Query('q') q: string) { return this.svc.search(req.user.id, q); }
}

@Module({ controllers: [SearchController], providers: [SearchService] })
export class SearchModule {}
