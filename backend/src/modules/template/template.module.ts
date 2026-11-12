/**
 * 模板中心 — 预置工作流模板（治理抓手：避免 200 人各造各的 Board）
 * 模板使用：从模板创建 Board 时复制 groups/columns 结构
 * 模板变更推送：markDirty 标记后由定时任务提示各实例 Board Owner 同步
 */
import { Injectable, Controller, Get, Post, Param, Body, Req, Module } from '@nestjs/common';
import { Pool } from 'pg';

interface BoardTemplate {
  key: string; name: string; description: string;
  groups: string[];
  columns: { type: string; name: string; settings?: object }[];
}

/** 5 套预置模板（覆盖技术/市场/通用场景，试点期按反馈扩充） */
export const TEMPLATES: BoardTemplate[] = [
  {
    key: 'project', name: '项目任务管理', description: '通用项目跟踪：按阶段分组，状态/负责人/截止日',
    groups: ['规划', '进行中', '已完成'],
    columns: [
      { type: 'status', name: '状态', settings: { labels: [
        { label: '待办', color: '#8a90a3' }, { label: '进行中', color: '#579bfc' },
        { label: '阻塞', color: '#e2445c' }, { label: '已完成', color: '#00c875' }] } },
      { type: 'people', name: '负责人' },
      { type: 'date', name: '截止日期' },
      { type: 'dropdown', name: '优先级', settings: { options: [
        { label: '高', color: '#e2445c' }, { label: '中', color: '#fdab3d' }, { label: '低', color: '#579bfc' }] } },
    ],
  },
  {
    key: 'backlog', name: '需求池', description: '产品需求收集与排期评审',
    groups: ['待评审', '已排期', '开发中', '已发布'],
    columns: [
      { type: 'status', name: '评审状态' }, { type: 'people', name: '产品负责人' },
      { type: 'number', name: '工作量估算(人天)' }, { type: 'text', name: '来源' },
    ],
  },
  {
    key: 'weekly', name: '周报追踪', description: '成员每周目标与实际进展',
    groups: ['本周', '上周', '逾期'],
    columns: [{ type: 'people', name: '成员' }, { type: 'date', name: '周截止' }, { type: 'checkbox', name: '已提交' }],
  },
  {
    key: 'campaign', name: '市场活动', description: '活动策划到复盘全流程',
    groups: ['筹备', '执行中', '已结束'],
    columns: [{ type: 'status', name: '状态' }, { type: 'people', name: '负责人' },
      { type: 'date', name: '活动日期' }, { type: 'number', name: '预算' }],
  },
  {
    key: 'hiring', name: '招聘管线', description: '候选人流转：筛选→面试→Offer',
    groups: ['简历筛选', '面试中', 'Offer', '已入职'],
    columns: [{ type: 'status', name: '阶段' }, { type: 'people', name: '面试官' }, { type: 'date', name: '面试时间' }],
  },
];

@Injectable()
export class TemplateService {
  constructor(private pg: Pool) {}

  list() { return TEMPLATES; }

  /** 从模板实例化 Board：复制 groups/columns，一条事务 */
  async instantiate(templateKey: string, name: string, userId: string, departmentId?: string) {
    const tpl = TEMPLATES.find((t) => t.key === templateKey);
    if (!tpl) throw new Error('TEMPLATE_NOT_FOUND');
    const client = await this.pg.connect();
    try {
      await client.query('BEGIN');
      const { rows: br } = await client.query(
        `INSERT INTO boards (name, department_id, visibility, owner_id) VALUES ($1,$2,'department',$3) RETURNING id`,
        [name, departmentId, userId],
      );
      const boardId = br[0].id;
      for (const [i, g] of tpl.groups.entries()) {
        await client.query(`INSERT INTO board_groups (board_id, name, position) VALUES ($1,$2,$3)`, [boardId, g, i + 1]);
      }
      for (const [i, c] of tpl.columns.entries()) {
        await client.query(
          `INSERT INTO board_columns (board_id, type, name, settings, position) VALUES ($1,$2,$3,$4::jsonb,$5)`,
          [boardId, c.type, c.name, JSON.stringify(c.settings ?? {}), i + 1]);
      }
      await client.query(
        `INSERT INTO board_permissions (board_id, subject_type, subject_id, role) VALUES ($1,'user',$2,'owner')
         ON CONFLICT DO NOTHING`, [boardId, userId]);
      await client.query('COMMIT');
      return { boardId };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
}

@Controller('templates')
export class TemplateController {
  constructor(private svc: TemplateService) {}
  @Get() list() { return this.svc.list(); }
  @Post(':key/instantiate')
  use(@Req() req, @Param('key') key: string, @Body() b: { name: string; departmentId?: string }) {
    return this.svc.instantiate(key, b.name, req.user.id, b.departmentId);
  }
}

@Module({ controllers: [TemplateController], providers: [TemplateService] })
export class TemplateModule {}
