# Manday — 轻量版工作管理平台

> 内部替代 Monday.com 的轻量 Work OS，200 人规模，内置对接 **Scania WorkBuddy 企业版** 的 AI 助手。

## 目录结构

```
manday/
├── db/schema.sql                    # PostgreSQL 核心数据模型
├── backend/                         # NestJS 模块化单体
│   ├── src/main.ts / app.module.ts  # 入口 + 模块边界
│   ├── src/modules/boards/acl.ts    # 统一 ACL 入口（全项目权限只经这一个函数）
│   ├── src/modules/items/items.service.ts  # JSONB 动态列读写 / LWW 409 / 批量 / 回收站
│   ├── src/realtime/realtime.gateway.ts    # Socket.IO 房间模型 + item 级 diff 推送
│   ├── src/modules/automation/automation.worker.ts  # BullMQ 异步自动化引擎
│   ├── src/ai/                      # WorkBuddy AI 集成（适配器 + 确认端点）
│   ├── package.json / .env.example
├── frontend/                        # Vite + React + TS
│   ├── src/components/BoardTable.tsx  # AG Grid 表格 + 列类型渲染器注册表
│   ├── src/components/Kanban.tsx      # dnd-kit 看板 + 乐观更新
│   ├── src/components/AiSidebar.tsx   # AI 侧边栏（SSE 流式 + 写操作确认卡片）
│   ├── src/store.ts / socket.ts / api.ts
│   └── package.json / vite.config.ts
├── docker-compose.yml               # 双机部署之应用机（含蓝绿/监控最小集）
├── prototype/index.html             # 可交互产品原型（表格/看板/AI 助手侧边栏）
└── README.md
```

## 快速启动

完整步骤、联调自检清单、生产双机部署与 Monday 迁移流程见 **[DEPLOYMENT.md](./DEPLOYMENT.md)**。

```bash
# 一行起本地依赖
docker compose -f docker-compose.dev.yml up -d
psql postgres://manday:manday@localhost:5432/manday -f db/schema.sql -f db/seed.sql
cd backend && npm i && cp .env.example .env && npm run start:dev   # :3000
cd frontend && npm i && npm run dev                                 # :5173
```

## 技术栈（定稿）

- 后端：NestJS 模块化单体 + PostgreSQL(JSONB 动态列) + Redis/BullMQ + Socket.IO
- 前端：React + TS + AG Grid Community(P0) → TanStack Table 自研(P1) + dnd-kit + Zustand
- AI：**Scania WorkBuddy 企业版对话网关**（模型/鉴权/审计收口在 WorkBuddy，Manday 只做工具定义 + 确认 + 审计）
- 部署：双机 Docker Compose（应用机 4C8G / 数据库机 4C16G，PG 主从流复制）

## WorkBuddy AI 集成配置

后端环境变量（由管理员配置，仅服务端持有）：

```env
WORKBUDDY_AI_BASE_URL=https://<workbuddy-enterprise-host>   # 企业版 AI 服务地址
WORKBUDDY_AI_API_KEY=<server-side-key>                      # 服务间凭证
WORKBUDDY_AI_MODEL=workbuddy-default                        # 企业版配置的默认模型
```

集成原则：
1. **权限 = 用户代理**：AI 工具调用透传当前用户 token，复用 Manday ACL，无越权通道
2. **写操作必须确认**：只读工具直接执行；create/update 类工具走"预览卡片→确认→执行"
3. **全量审计**：AI 写入打 `source:'ai'`，落 audit_logs，支持一键撤销
4. **降级**：WorkBuddy 网关不可用时，对话入口降级为结构化筛选 UI

## 运行原型

直接用浏览器打开 `prototype/index.html`，或：

```bash
cd prototype && python -m http.server 8080   # 或任意静态服务器
```

原型包含：Board 表格视图（行内编辑）、看板视图（拖拽）、AI 助手侧边栏（模拟 WorkBuddy 对话：查询任务、自然语言建列/建条目，写操作带确认卡片）。

## 已实现模块（截至 M1）

| 模块 | 文件 | 说明 |
|---|---|---|
| 统一 ACL | `backend/src/modules/boards/acl.ts` | 全项目权限唯一入口，P1 列级权限在此扩展 |
| 动态列值 | `backend/src/modules/items/items.service.ts` | JSONB 读写 / LWW 409 / 批量 / 回收站 / 审计 |
| 实时推送 | `backend/src/realtime/realtime.gateway.ts` | 房间订阅 + item 级 diff |
| 自动化 | `backend/src/modules/automation/automation.worker.ts` | BullMQ 异步引擎 |
| AI 集成 | `backend/src/ai/` | WorkBuddy 企业版网关 + 写确认端点 |
| SSO 认证 | `backend/src/modules/auth/auth.module.ts` | 企微/飞书策略模式 + 首登建户 + 部门同步 |
| Excel 导入 | `backend/src/modules/import/import.module.ts` | 解析预览 + 启发式列映射建议 + 事务写入 |
| 富列渲染 | `frontend/src/components/columnTypes.tsx` | status/people/dropdown 三端复用注册表 |
| Board CRUD | `backend/src/modules/boards/boards.module.ts` | 四档可见性过滤 + 默认三组 + 回收站恢复 |
| 条目详情 | `backend/src/modules/items/item-detail.module.ts` + `frontend ItemDetail.tsx` | 评论/子任务/历史 + @提及通知 |
| 通知中心 | `backend/src/modules/notification/` + `TopWidgets NotificationBell` | 高优先级实时推 + 每日摘要归并 |
| 全局搜索 | `backend/src/modules/search/` + `CommandPalette` | pg_trgm 模糊搜索，只搜可见 Board，⌘K 入口 |
| Dashboard | `backend/src/modules/dashboard/` + `DashboardPage.tsx` | Battery 进度 / 状态分布，跨 Board 可见性过滤 |
| 自动化配方 | `backend/src/modules/automation/automation-api.module.ts` | 6 个预置模板 + AI 创建统一入口（action 白名单） |
| 工作区导航 | `frontend/src/components/WorkspaceNav.tsx` | Board 列表 + 可见性色标 + 可折叠侧边栏 |
| Monday 迁移 | `scripts/migrate-monday.ts` | API 全量导出 + 列类型映射 + email 匹配 + dry-run 演练 |
| 实时通知 | backend notification→WS + `socket.ts` | 高优先级走 `user:{id}` 房间推送 + Web Notification |
| ACL 测试 | `backend/src/modules/boards/acl.spec.ts` | 权限唯一入口的回归保护（含敏感列钩子） |
| 管理后台 | `backend/src/modules/admin/admin.module.ts` | 组织架构树 + CSV 批量用户导入（幂等+报告） |
| 模板中心 | `backend/src/modules/template/` + `NewBoardModal.tsx` | 5 套预置模板一键实例化 Board |
| 表格/看板/AI 侧栏 | `frontend/src/components/` | AG Grid + dnd-kit + SSE 确认卡片 |

## 下一步待办（M1 → M2）

1. Board/Group/Column 的 CRUD 控制器与前端 Board 列表页
2. 条目详情侧边栏（子任务 / 评论 Updates / 附件 / Item 历史）
3. 回收站页面（恢复 / 彻底删除）
4. 通知中心 + 每日摘要聚合定时任务
5. 全局标题模糊搜索（pg_trgm）
6. AG Grid 行内编辑态与 WS 推送的合并渲染打磨
