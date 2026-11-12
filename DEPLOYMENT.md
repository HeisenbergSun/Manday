# Manday 联调部署清单（按顺序执行）

## 1. 本地开发环境（10 分钟）
```bash
# 依赖容器
docker compose -f docker-compose.dev.yml up -d

# 建库 + 演示数据
psql postgres://manday:manday@localhost:5432/manday -f db/schema.sql -f db/seed.sql

# 后端
cd backend
cp .env.example .env        # 本地填 DATABASE_URL=postgres://manday:manday@localhost:5432/manday
npm i && npm run start:dev  # :3000

# 前端（另开终端）
cd frontend && npm i && npm run dev   # :5173
```

## 2. 联调自检清单（按依赖顺序）
- [ ] `GET /health` 返回 `{status:'ok', db:'up'}`
- [ ] `GET /auth/login` 返回 OAuth URL；callback 后拿到 token
- [ ] `GET /boards` 能看到 seed 里的「App 2.0 项目」
- [ ] 前端表格加载、单元格编辑后 `item_values` 落库 + `audit_logs` 有记录
- [ ] 双开浏览器：一边改单元格，另一边 1 秒内收到 `item:changed` 局部更新
- [ ] 看板拖拽 → group 变更 + WS 广播
- [ ] 评论 @张伟 → notifications 表落一条 + 铃铛实时 +1
- [ ] ⌘K 搜索命中条目名
- [ ] Excel 导入 preview → confirm，数据齐、映射正确
- [ ] 自动化：状态改「已完成」→ 触发 move_group（BullMQ 队列可见 job）
- [ ] AI：POST /ai/chat/stream 流式返回；写工具返回 [TOOL_CALL] → 前端确认卡片 → /ai/tool/confirm 落库且 audit_logs.source='ai'
- [ ] WorkBuddy 企业版网关不通时，AI 入口降级为筛选 UI（断网演练）

## 3. 生产部署（双机，见 docker-compose.yml + deploy/）
1. 数据库机：PG 主库 + 流复制从库 + postgres_exporter；`db/schema.sql` 初始化
2. 应用机：`docker compose up -d`（app/worker/nginx/redis/minio/uptime/prometheus/grafana）
3. Nginx 证书（acme.sh 自动续期），HSTS 已在 nginx.conf 开启
4. `.env` 只放应用机，密钥不入 Git
5. 备份任务上线：每日 pg_dump + WAL 归档 + MinIO mc mirror；跑一次恢复演练并记录 RTO
6. 告警通道接入企微/飞书机器人，分 P0 电话 / P1 群@ / P2 日报

## 4. Monday 数据迁移（切换前）
```bash
cd scripts
MONDAY_API_TOKEN=xxx DATABASE_URL=... npx ts-node migrate-monday.ts   # 先 dry-run
```
- 核对 dry-run 报告（条目数、未匹配负责人数）
- 书面确认迁移范围（活跃 Board + 近 90 天 updates）
- 旧系统冻结只读 → 执行全量迁移 → 新系统验证 → 留 2 周回退窗口
