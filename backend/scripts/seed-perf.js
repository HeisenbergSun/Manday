/**
 * 性能种子：创建 PERFBIG-* 测试板（默认 5000 条目 + 10 列 + 4 组）
 * 用法: node scripts/seed-perf.js [N]
 * 直连 SQL 批量生成，用于大数据量基线测量与回归前清理（PERFBIG-% 前缀）
 */
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') });

const N = parseInt(process.argv[2] ?? '5000', 10);
const NAME = 'PERFBIG-5000';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const t0 = Date.now();
  // 清理旧的 perf 板（按名）
  await pool.query(`DELETE FROM boards WHERE name = $1`, [NAME]);
  const board = (await pool.query(
    `INSERT INTO boards (name, visibility, owner_id) VALUES ($1, 'private', (SELECT id FROM users WHERE email LIKE 'dev%' LIMIT 1)) RETURNING id`, [NAME])).rows[0];
  await pool.query(
    `INSERT INTO board_permissions (board_id, subject_type, subject_id, role)
     VALUES ($1, 'user', (SELECT id FROM users WHERE email LIKE 'dev%' LIMIT 1), 'owner') ON CONFLICT DO NOTHING`, [board.id]);
  const groups = await pool.query(
    `INSERT INTO board_groups (board_id, name, position) SELECT $1, '组-' || g, g FROM generate_series(1,4) g RETURNING id, position`, [board.id]);
  const gids = groups.rows.sort((a, b) => a.position - b.position).map((r) => r.id);
  const cols = await pool.query(
    `INSERT INTO board_columns (board_id, name, type, position, settings)
     SELECT $1, c.name, c.type, c.pos, '{}'::jsonb FROM (VALUES
       ('负责人','people',1),('状态','status',2),('开始日期','date',3),('截止日期','date',4),
       ('预算','number',5),('备注','longtext',6),('优先级','dropdown',7),('标签','tags',8),
       ('复选','checkbox',9),('进度','rating',10)
     ) AS c(name,type,pos) RETURNING id, position`, [board.id]);
  const colIds = cols.rows.sort((a, b) => a.position - b.position).map((r) => r.id);
  const statusCol = colIds[1], peopleCol = colIds[0], endCol = colIds[3];

  // 5000 条目
  await pool.query(
    `INSERT INTO items (board_id, group_id, name, position)
     SELECT $1, (SELECT id FROM board_groups WHERE board_id = $1 ORDER BY position OFFSET (i % 4) LIMIT 1),
            '条目-' || i, i
     FROM generate_series(1, $2) i`, [board.id, N]);

  // 值：状态 / 负责人（占位 label）/ 截止日期 / 数字（每条 4 个 cell → 2 万行）
  await pool.query(
    `INSERT INTO item_values (item_id, column_id, board_id, value)
     SELECT i.id, $2, $1, to_jsonb((ARRAY['未开始','进行中','已完成','阻塞'])[1 + (i.position::int % 4)])
     FROM items i WHERE i.board_id = $1`, [board.id, statusCol]);
  await pool.query(
    `INSERT INTO item_values (item_id, column_id, board_id, value)
     SELECT i.id, $2, $1, to_jsonb(jsonb_build_array(jsonb_build_object('id', 'u' || (i.position::int % 20), 'label', '成员-' || (i.position::int % 20))))
     FROM items i WHERE i.board_id = $1`, [board.id, peopleCol]);
  await pool.query(
    `INSERT INTO item_values (item_id, column_id, board_id, value)
     SELECT i.id, $2, $1, to_jsonb(to_char(now() + (i.position || ' days')::interval, 'YYYY-MM-DD'))
     FROM items i WHERE i.board_id = $1`, [board.id, endCol]);
  await pool.query(
    `INSERT INTO item_values (item_id, column_id, board_id, value)
     SELECT i.id, $2, $1, to_jsonb(i.position * 100)
     FROM items i WHERE i.board_id = $1`, [board.id, colIds[4]]);

  const cnt = await pool.query(`SELECT count(*) c FROM items WHERE board_id = $1`, [board.id]);
  console.log(`✓ ${NAME}: ${cnt.rows[0].c} items, ${cols.rows.length} cols, ${groups.rows.length} groups, board=${board.id}, ${Date.now() - t0}ms`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
