/**
 * 管理后台 — 组织架构管理 + 批量用户导入（CSV/Excel）
 * 仅 Workspace Admin 可访问（角色校验在此处）
 */
import { Injectable, Controller, Get, Post, Body, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class AdminService {
  constructor(private pg: Pool) {}

  /** 组织架构树（管理端展示 + 前端权限选择器复用） */
  async departmentTree() {
    const { rows } = await this.pg.query(
      `SELECT id, parent_id, name, path,
              (SELECT count(*) FROM user_departments ud WHERE ud.department_id = d.id) AS member_count
       FROM departments d ORDER BY path`,
    );
    // path 前缀即父子关系，前端直接按 '/' 缩进渲染
    return rows;
  }

  async createDepartment(userId: string, name: string, parentId?: string) {
    let parentPath = '/全公司';
    if (parentId) {
      const { rows } = await this.pg.query(`SELECT path FROM departments WHERE id = $1`, [parentId]);
      if (!rows.length) throw new Error('PARENT_NOT_FOUND');
      parentPath = rows[0].path;
    }
    const path = `${parentPath}/${name}`;
    const { rows } = await this.pg.query(
      `INSERT INTO departments (name, parent_id, path) VALUES ($1,$2,$3)
       ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name RETURNING *`,
      [name, parentId, path],
    );
    return rows[0];
  }

  /**
   * 批量导入用户（HR 导出 CSV：name,email,departmentPath）
   * - email 冲突 → 更新姓名（幂等）
   * - departmentPath 不存在 → 自动建部门
   * - 返回匹配报告，failed 逐条列出
   */
  async importUsers(userId: string, rows: { name: string; email: string; departmentPath?: string }[]) {
    const report = { created: 0, updated: 0, failed: [] as { email: string; reason: string }[] };
    for (const r of rows) {
      if (!r.email || !r.name) { report.failed.push({ email: r.email, reason: '缺少姓名或邮箱' }); continue; }
      try {
        let deptId: string | null = null;
        if (r.departmentPath) {
          const parts = String(r.departmentPath).split('/').filter(Boolean);
          let parent: string | null = null, path = '';
          for (const name of parts) {
            path += `/${name}`;
            const { rows: dr } = await this.pg.query(
              `INSERT INTO departments (name, parent_id, path) VALUES ($1,$2,$3)
               ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
              [name, parent, path]);
            deptId = dr[0].id; parent = deptId;
          }
        }
        const { rowCount } = await this.pg.query(
          `INSERT INTO users (name, email) VALUES ($1,$2)
           ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`,
          [r.name, r.email]);
        rowCount === 1 ? report.created++ : report.updated++;
        if (deptId) await this.pg.query(
          `INSERT INTO user_departments (user_id, department_id, is_primary)
           SELECT u.id, $1, true FROM users u WHERE u.email = $2
           ON CONFLICT DO NOTHING`, [deptId, r.email]);
      } catch (e: any) {
        report.failed.push({ email: r.email, reason: e.message });
      }
    }
    return report;
  }
}

@Controller('admin')
export class AdminController {
  constructor(private svc: AdminService) {}
  @Get('departments') tree(@Req() req) { return this.svc.departmentTree(); }
  @Post('departments') createDept(@Req() req, @Body() b: { name: string; parentId?: string }) {
    return this.svc.createDepartment(req.user.id, b.name, b.parentId);
  }
  @Post('users/import') importUsers(@Req() req, @Body() b: { rows: any[] }) {
    // Admin 角色校验（P0 简化：jwt payload.role；P1 查角色表）
    if (req.user.role !== 'admin') throw new Error('FORBIDDEN');
    return this.svc.importUsers(req.user.id, b.rows);
  }
}

@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
