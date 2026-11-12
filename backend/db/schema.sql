-- Manday 核心数据模型 (PostgreSQL 14+)
-- 对应方案 v3.0：模块化单体 + JSONB 动态列

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- 全局标题模糊搜索

-- ========== 组织架构 ==========
CREATE TABLE departments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id   UUID REFERENCES departments(id),
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,             -- ltree 风格路径 '/公司/技术部/前端组'
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_no   TEXT UNIQUE,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,    -- WorkBuddy/SSO 身份匹配键
  avatar_url    TEXT,
  status        TEXT DEFAULT 'active',   -- active / disabled
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_departments (
  user_id       UUID REFERENCES users(id),
  department_id UUID REFERENCES departments(id),
  is_primary    BOOLEAN DEFAULT true,
  PRIMARY KEY (user_id, department_id)
);

-- ========== Board 结构 ==========
CREATE TABLE boards (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID REFERENCES departments(id),  -- 归属部门
  name        TEXT NOT NULL,
  description TEXT,
  visibility  TEXT DEFAULT 'department',  -- private / department / shared / company
  owner_id    UUID REFERENCES users(id),
  is_archived BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE board_groups (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id   UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT DEFAULT '#579bfc',
  position   DOUBLE PRECISION NOT NULL,
  is_collapsed BOOLEAN DEFAULT false
);

CREATE TABLE board_columns (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id   UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- text/number/status/people/date/dropdown/checkbox/link/connect...
  name       TEXT NOT NULL,
  settings   JSONB NOT NULL DEFAULT '{}',  -- status 标签、下拉选项、列级权限等
  position   DOUBLE PRECISION NOT NULL
);

CREATE TABLE items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id    UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  group_id    UUID REFERENCES board_groups(id),
  parent_item_id UUID REFERENCES items(id),      -- 子任务
  name        TEXT NOT NULL,
  position    DOUBLE PRECISION NOT NULL,          -- LexoRank 类排序键
  created_by  UUID REFERENCES users(id),
  version     INTEGER NOT NULL DEFAULT 1,         -- LWW 冲突检测
  deleted_at  TIMESTAMPTZ,                        -- 软删除 → 回收站
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 动态列值：窄表 + JSONB
CREATE TABLE item_values (
  item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  column_id  UUID NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
  board_id   UUID NOT NULL,                      -- 冗余，免 join
  value      JSONB,
  PRIMARY KEY (item_id, column_id)
);
CREATE INDEX idx_item_values_board ON item_values(board_id);
CREATE INDEX idx_items_name_trgm ON items USING gin (name gin_trgm_ops);  -- 全局搜索
-- GIN 索引按筛选场景按需建，例如：
-- CREATE INDEX idx_iv_status ON item_values USING gin (value jsonb_path_ops) WHERE board_columns.type='status';

-- ========== 权限（P1 扩展列级/行级）==========
CREATE TABLE board_permissions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id     UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,   -- user / department / group
  subject_id   UUID NOT NULL,
  role         TEXT NOT NULL,   -- owner / editor / viewer / guest
  UNIQUE (board_id, subject_type, subject_id)
);

-- ========== 协作与审计 ==========
CREATE TABLE updates (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,        -- mention / assign / due / automation
  payload    JSONB NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- 200 人通知聚合：按 (user_id, date_trunc('day')) 摘要归并由服务层实现

CREATE TABLE audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID,
  action     TEXT NOT NULL,        -- item.update / board.create / ai.write ...
  target     TEXT NOT NULL,        -- 'item:{uuid}' 等
  before_val JSONB,
  after_val  JSONB,
  source     TEXT DEFAULT 'ui',    -- ui / ai / api —— AI 写操作标记
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE attachments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id    UUID REFERENCES items(id) ON DELETE CASCADE,
  update_id  UUID REFERENCES updates(id) ON DELETE CASCADE,
  file_key   TEXT NOT NULL,        -- MinIO 对象键（随机化文件名）
  orig_name  TEXT NOT NULL,
  size       BIGINT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========== 自动化与 AI ==========
CREATE TABLE automations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id   UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  trigger    JSONB NOT NULL,   -- {type:'status_changed', to:'Done'}
  condition  JSONB,
  action     JSONB NOT NULL,   -- {type:'notify', userIds:[...]} / {type:'move_group'}
  enabled    BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_conversations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id),
  board_id   UUID REFERENCES boards(id),   -- 当前上下文 Board
  title      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,   -- user / assistant / tool
  content         JSONB NOT NULL,
  tool_calls      JSONB,           -- function calling 记录（可审计）
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dashboards (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID REFERENCES departments(id),
  name          TEXT NOT NULL,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE widgets (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,   -- battery / number / chart
  config       JSONB NOT NULL,  -- {boardIds:[...], metric:'count', groupBy:'status'}
  position     INT
);
