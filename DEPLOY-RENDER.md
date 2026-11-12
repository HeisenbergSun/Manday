# Render 免费云部署指引（15 分钟上线）

> 目标：零成本把 Manday 部署到公网试用。免费层限制见文末。

## 一、部署步骤

### 1. 推送到 GitHub
```bash
cd manday
git init && git add -A && git commit -m "Manday 初始提交"
# 在 GitHub 建一个私有仓库（如 manday），然后：
git remote add origin https://github.com/<你的用户名>/manday.git
git push -u origin main
```
私有仓库即可，Render 免费层支持私有仓库。

### 2. Render 一键部署
1. 打开 https://dashboard.render.com → 注册/登录（可用 GitHub 账号直接登录，**无需绑卡**）
2. 左侧 **Blueprints** → **New Blueprint Instance** → 选择你的 manday 仓库
3. Render 会自动读取 `render.yaml`，识别出：
   - `manday` Web 服务（Docker，免费层）
   - `manday-db` PostgreSQL（免费层）
4. 点 **Apply** → 等待构建（约 5~10 分钟）

### 3. 首次启动自动完成
- 容器启动时检测到空库 → 自动执行 `db/schema.sql` 建表
- `SEED_DEMO=true` → 自动写入演示数据（部门/用户/示例 Board）
- 访问分配的域名（形如 `https://manday-xxxx.onrender.com`）即可试用

### 4. 登录试用（无 SSO 时的临时方式）
SSO 未配置时登录接口会返回 `SSO_NOT_CONFIGURED`。临时登录：
1. 到 Render 服务页 **Shell** 执行：
   ```bash
   node -e "console.log(require('jsonwebtoken').sign({sub:'<seed里的用户id>',email:'demo@internal'}, process.env.JWT_SECRET, {expiresIn:'7d'}))"
   ```
2. 前端把 token 放进请求头 `Authorization: Bearer <token>`（或先用 seed 用户的邮箱直接在界面占位登录，视前端逻辑而定）

## 二、部署架构（单容器，同源零 CORS）

```
render.yaml (Blueprint)
├── web 服务（Dockerfile 多阶段构建）
│   ├── 后端 dist + 依赖
│   ├── 前端 dist → /public（express 静态托管 + SPA 兜底）
│   ├── 首次启动自动建表 + 演示数据
│   └── /health 健康检查
└── 免费 PostgreSQL（DATABASE_URL 自动注入）
```
Redis 未配置 → 自动化引擎自动降级跳过（代码已支持，不影响试用）。

## 三、免费层限制（重要）

| 项目 | 限制 | 影响 |
|---|---|---|
| 休眠 | 15 分钟无访问自动休眠 | 再次打开约等 1 分钟唤醒 |
| 免费 PG | **30 天过期** | 到期前导出数据或升级 $7/月 |
| 实例规格 | 512MB RAM / 共享 CPU | 试用没问题，200 人生产必须升级 |
| 构建 | 每月有限额 | 频繁改代码会耗尽 |

**想"持续在线且免费"** → Oracle Cloud Always Free（免费 ARM VM 4核24G，永不休眠，但需注册验证信用卡 + 自己用 docker compose 运维，仓库里的 `docker-compose.yml` 可直接用）。

## 四、更新部署
改完代码 `git push` 即自动重新部署（autoDeploy: true）。
