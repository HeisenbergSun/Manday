-- 演示数据：部门 + 用户 + 一个示例 Board（联调用）
INSERT INTO departments (name, path) VALUES
  ('全公司', '/全公司'),
  ('技术部', '/全公司/技术部'),
  ('市场部', '/全公司/市场部')
ON CONFLICT DO NOTHING;

INSERT INTO users (name, email) VALUES
  ('张伟', 'zhangwei@internal'), ('李娜', 'lina@internal'), ('王强', 'wangqiang@internal')
ON CONFLICT (email) DO NOTHING;

WITH d AS (SELECT id FROM departments WHERE path='/全公司/技术部'),
     b AS (
       INSERT INTO boards (name, visibility, owner_id)
       SELECT 'App 2.0 项目', 'department', (SELECT id FROM users WHERE name='张伟')
       RETURNING id
     ),
     g AS (
       INSERT INTO board_groups (board_id, name, position)
       SELECT id, x.name, x.pos FROM b, (VALUES ('待办',1),('进行中',2),('已完成',3)) x(name,pos)
       RETURNING id, name, board_id
     ),
     c AS (
       INSERT INTO board_columns (board_id, type, name, settings, position)
       SELECT id, x.type, x.name, x.settings::jsonb, x.pos FROM b,
         (VALUES
           ('status','状态','{"labels":[{"label":"待办","color":"#8a90a3"},{"label":"进行中","color":"#579bfc"},{"label":"已完成","color":"#00c875"}]}',1),
           ('people','负责人','{"members":[{"id":"u1","name":"张伟","color":"#579bfc"},{"id":"u2","name":"李娜","color":"#00c875"}]}',2),
           ('date','截止日期','{}',3)
         ) x(type,name,settings,pos)
       RETURNING id, type, board_id
     )
SELECT 1;
