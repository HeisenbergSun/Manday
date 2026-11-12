/**
 * 全局搜索（P0 标题模糊搜索）— pg_trgm 索引，跨 Board 找条目
 * 前置：CREATE EXTENSION pg_trgm;
 *       CREATE INDEX idx_items_name_trgm ON items USING gin (name gin_trgm_ops);
 */
import { Injectable, Controller, Get, Query, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class SearchService {
  constructor(private pg: Pool) {}

  /** 只搜当前用户可见 Board 的条目（复用可见性 WHERE，AI search_items 工具也走这里） */
  async search(userId: string, q: string, limit = 30) {
    const { rows } = await this.pg.query(
      `SELECT i.id, i.name, i.board_id, b.name AS board_name,
              similarity(i.name, $2) AS score
       FROM items i
       JOIN boards b ON b.id = i.board_id
       WHERE i.deleted_at IS NULL AND i.name % $2
         AND (b.visibility = 'company'
              OR b.department_id IN (SELECT department_id FROM user_departments WHERE user_id = $1)
              OR b.owner_id = $1
              OR EXISTS (SELECT 1 FROM board_permissions bp
                         WHERE bp.board_id = b.id AND bp.subject_type='user' AND bp.subject_id=$1))
       ORDER BY score DESC LIMIT $3`,
      [userId, q, limit],
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
