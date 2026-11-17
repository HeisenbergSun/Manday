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
  /** P2-2：预置示例数据（名称统一以「示例：」开头，前端可一键删除） */
  samples?: { group: string; values: Record<string, unknown> }[];
  /** 第二十二批：建板时预置的命名视图（预设可视化） */
  views?: { name: string; viewType: string; config?: object }[];
}

/** 预设视图集（第二十二批）：各模板默认套用的六种视图 */
export const PRESET_VIEWS: { name: string; viewType: string; config?: object }[] = [
  { name: '⚡ 表格', viewType: 'table', config: {} },
  { name: '⚡ 看板', viewType: 'kanban', config: {} },
  { name: '⚡ 日历', viewType: 'calendar', config: {} },
  { name: '⚡ 甘特', viewType: 'gantt', config: {} },
  { name: '⚡ Workload', viewType: 'workload', config: {} },
  { name: '⚡ 分析', viewType: 'insights', config: {} },
];

/** 示例条目名前缀（识别 + 一键删除用） */
export const SAMPLE_PREFIX = '示例：';

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
    samples: [
      { group: '规划', values: { '状态': '待办', '负责人': null, '截止日期': '2026-11-20', '优先级': '中' } },
      { group: '进行中', values: { '状态': '进行中', '截止日期': '2026-11-25', '优先级': '高' } },
      { group: '已完成', values: { '状态': '已完成', '截止日期': '2026-11-10', '优先级': '低' } },
      { group: '规划', values: { '状态': '待办', '截止日期': '2026-12-01', '优先级': '低' } },
      { group: '进行中', values: { '状态': '阻塞', '截止日期': '2026-11-18', '优先级': '高' } },
    ],
  },
  {
    key: 'backlog', name: '需求池', description: '产品需求收集与排期评审',
    groups: ['待评审', '已排期', '开发中', '已发布'],
    columns: [
      { type: 'status', name: '评审状态' }, { type: 'people', name: '产品负责人' },
      { type: 'number', name: '工作量估算(人天)' }, { type: 'text', name: '来源' },
    ],
    samples: [
      { group: '待评审', values: { '工作量估算(人天)': 3, '来源': '客户反馈' } },
      { group: '待评审', values: { '工作量估算(人天)': 8, '来源': '内部提案' } },
      { group: '已排期', values: { '工作量估算(人天)': 13, '来源': 'OKR 拆解' } },
      { group: '开发中', values: { '工作量估算(人天)': 21, '来源': '技术优化' } },
      { group: '已发布', values: { '工作量估算(人天)': 5, '来源': '客户反馈' } },
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
    samples: [
      { group: '筹备', values: { '预算': 50000, '活动日期': '2026-12-15' } },
      { group: '筹备', values: { '预算': 20000, '活动日期': '2027-01-10' } },
      { group: '执行中', values: { '预算': 80000, '活动日期': '2026-11-20' } },
      { group: '已结束', values: { '预算': 30000, '活动日期': '2026-10-28' } },
      { group: '已结束', values: { '预算': 12000, '活动日期': '2026-09-15' } },
    ],
  },
  {
    key: 'hiring', name: '招聘管线', description: '候选人流转：筛选→面试→Offer',
    groups: ['简历筛选', '面试中', 'Offer', '已入职'],
    columns: [{ type: 'status', name: '阶段' }, { type: 'people', name: '面试官' }, { type: 'date', name: '面试时间' }],
    samples: [
      { group: '简历筛选', values: { '面试时间': '2026-11-21' } },
      { group: '面试中', values: { '面试时间': '2026-11-18' } },
      { group: '面试中', values: { '面试时间': '2026-11-19' } },
      { group: 'Offer', values: { '面试时间': '2026-11-14' } },
      { group: '已入职', values: { '面试时间': '2026-10-30' } },
    ],
  },
];

@Injectable()
export class TemplateService {
  constructor(private pg: Pool) {}

  list() { return TEMPLATES; }

  /** 从模板实例化 Board：复制 groups/columns（+可选示例条目），一条事务 */
  async instantiate(templateKey: string, name: string, userId: string, departmentId?: string, withSamples = false) {
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
      // 第二十二批：预置命名视图（预设可视化）
      for (const [i, vw] of (tpl.views ?? PRESET_VIEWS).entries()) {
        await client.query(
          `INSERT INTO board_views (board_id, name, view_type, config, position) VALUES ($1,$2,$3,$4::jsonb,$5)`,
          [boardId, vw.name, vw.viewType, JSON.stringify(vw.config ?? {}), i + 1]);
      }
      // P2-2：预置示例条目（名称带前缀，前端可一键删除）
      if (withSamples && tpl.samples?.length) {
        const { rows: gs } = await client.query(`SELECT id, name FROM board_groups WHERE board_id = $1`, [boardId]);
        const { rows: cs } = await client.query(`SELECT id, name FROM board_columns WHERE board_id = $1`, [boardId]);
        for (const [i, s] of tpl.samples.entries()) {
          const gid = gs.find((g) => g.name === s.group)?.id ?? null;
          const { rows: ir } = await client.query(
            `INSERT INTO items (board_id, group_id, name, position, version, created_by)
             VALUES ($1,$2,$3,$4,1,$5) RETURNING id`,
            [boardId, gid, SAMPLE_PREFIX + '样例条目 ' + (i + 1), Date.now() / 1000 + i, userId],
          );
          for (const [colName, val] of Object.entries(s.values)) {
            const col = cs.find((c) => c.name === colName);
            if (!col || val == null) continue;
            await client.query(
              `INSERT INTO item_values (item_id, column_id, board_id, value) VALUES ($1,$2,$3,$4::jsonb)
               ON CONFLICT (item_id, column_id) DO UPDATE SET value = EXCLUDED.value`,
              [ir[0].id, col.id, boardId, JSON.stringify(val)],
            );
          }
        }
      }
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
  use(@Req() req, @Param('key') key: string, @Body() b: { name: string; departmentId?: string; withSamples?: boolean }) {
    return this.svc.instantiate(key, b.name, req.user.id, b.departmentId, !!b.withSamples);
  }
}

@Module({ controllers: [TemplateController], providers: [TemplateService] })
export class TemplateModule {}
