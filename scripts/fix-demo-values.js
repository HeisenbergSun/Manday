/**
 * 一次性修数：把历史 seed 写入的"双重编码"值纠正为 jsonb 标量，并补齐 people/date 列
 * 双重编码示例：value = '"进行中"'::jsonb  →  正确应为 value = '"进行中"'::jsonb（同）
 * 实际错误是：value = '"\\"进行中\\""'::jsonb（jsON 字符串里又包了一层引号）
 */
const fs = require('fs');
const m = {};
fs.readFileSync(__dirname + '/../backend/.env', 'utf8').split(/\r?\n/).forEach((l) => {
  const i = l.indexOf('='); if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
});
const { Pool } = require('../backend/node_modules/pg');
const pool = new Pool({ connectionString: m.DATABASE_URL });

(async () => {
  // 1) 解掉多余的转义引号：把以 \" 开头结尾的字符串还原
  const r1 = await pool.query(`
    UPDATE item_values
       SET value = to_jsonb(trim(both '"' from (value #>> '{}')))
     WHERE jsonb_typeof(value) = 'string'
       AND (value #>> '{}') LIKE '"%"'
    RETURNING item_id, column_id, value`);
  console.log('解转义修复:', r1.rowCount, '行');

  // 2) 补 people / date 列值（仅针对没有值的条目）
  const { rows: boards } = await pool.query(`SELECT id FROM boards WHERE name = 'App 2.0 项目' LIMIT 1`);
  if (!boards.length) { console.log('无演示 Board'); await pool.end(); return; }
  const boardId = boards[0].id;

  const { rows: cols } = await pool.query(
    `SELECT id, type, settings FROM board_columns WHERE board_id = $1`, [boardId]);
  const peopleCol = cols.find((c) => c.type === 'people');
  const dateCol = cols.find((c) => c.type === 'date');
  const members = peopleCol?.settings?.members?.map((x) => x.id) ?? [];

  const { rows: items } = await pool.query(
    `SELECT id, name FROM items WHERE board_id = $1 AND deleted_at IS NULL ORDER BY position`, [boardId]);

  let filled = 0;
  for (let i = 0; i < items.length; i++) {
    if (peopleCol && members.length) {
      const res = await pool.query(
        `INSERT INTO item_values (item_id, board_id, column_id, value) VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (item_id, column_id) DO NOTHING`,
        [items[i].id, boardId, peopleCol.id, JSON.stringify(members[i % members.length])]);
      filled += res.rowCount;
    }
    if (dateCol) {
      const d = new Date(Date.now() + (i - 1) * 3 * 86400_000).toISOString().slice(0, 10);
      const res = await pool.query(
        `INSERT INTO item_values (item_id, board_id, column_id, value) VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (item_id, column_id) DO NOTHING`,
        [items[i].id, boardId, dateCol.id, JSON.stringify(d)]);
      filled += res.rowCount;
    }
  }
  console.log('补齐 people/date 值:', filled, '行');

  // 3) 校验
  const { rows: chk } = await pool.query(
    `SELECT jsonb_typeof(v.value) AS t, v.value #>> '{}' AS raw, count(*) AS c
       FROM item_values v JOIN items i ON i.id = v.item_id
      WHERE i.board_id = $1 GROUP BY 1,2 ORDER BY c DESC`, [boardId]);
  console.table(chk);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
