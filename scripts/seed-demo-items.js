/** 向演示 Board 灌入示例条目（Neon/本地库通用） */
const fs = require('fs');
const m = {};
fs.readFileSync(__dirname + '/../backend/.env', 'utf8').split(/\r?\n/).forEach(l => {
  const i = l.indexOf('='); if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
});
const { Pool } = require('../backend/node_modules/pg');
const pool = new Pool({ connectionString: m.DATABASE_URL });

(async () => {
  const { rows: b } = await pool.query(`SELECT id FROM boards WHERE name='App 2.0 项目' LIMIT 1`);
  if (!b.length) { console.log('找不到演示 Board'); process.exit(1); }
  const boardId = b[0].id;
  const { rows: g } = await pool.query(`SELECT id,name FROM board_groups WHERE board_id=$1 ORDER BY position`, [boardId]);
  const gid = Object.fromEntries(g.map(r => [r.name, r.id]));
  const { rows: cols } = await pool.query(`SELECT id,type FROM board_columns WHERE board_id=$1`, [boardId]);
  const statusCol = cols.find(c => c.type === 'status')?.id;
  const prioCol = cols.find(c => c.type === 'dropdown' || /prio|优先/.test(c.name || ''))?.id;
  const peopleCol = cols.find(c => c.type === 'people')?.id;
  const dateCol = cols.find(c => c.type === 'date')?.id;
  const { rows: mem } = await pool.query(`SELECT id,name FROM users ORDER BY created_at LIMIT 2`);
  const peopleCol_meta = cols.find(c => c.type === 'people');
  const { rows: u } = await pool.query(`SELECT id FROM users WHERE name='张伟' LIMIT 1`);
  const uid = u[0]?.id;
  const { rows: ex } = await pool.query(`SELECT count(*) c FROM items WHERE board_id=$1`, [boardId]);
  if (ex[0].c > 0) { console.log('已有条目', ex[0].c, '个，跳过'); process.exit(0); }

  // people 列的 settings.members 里通常有演示成员的虚拟 id（u1/u2），优先用它
  let members = [];
  if (peopleCol_meta?.settings?.members) members = peopleCol_meta.settings.members.map(m => m.id);
  if (!members.length) members = mem.map(r => r.id);

  const demo = [
    ['用户登录模块', '进行中', '高'], ['SSO 企微对接', '未开始', '中'],
    ['看板视图', '进行中', '高'], ['Excel 导入', '未开始', '低'], ['通知中心', '已完成', '中'],
  ];
  let n = 0;
  for (const [name, status, prio] of demo) {
    const group = status === '已完成' ? gid['已完成'] : status === '进行中' ? gid['进行中'] : gid['待办'];
    const { rows: r } = await pool.query(
      `INSERT INTO items (board_id, group_id, name, position, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [boardId, group, name, Date.now() / 1000 + n * 0.001, uid]);
    // 注意：value 是 jsonb 标量（'"进行中"'），不是 jsonb 字符串包（'"\\"进行中\\""'）
    const put = (colId, val) => pool.query(
      `INSERT INTO item_values (item_id, board_id, column_id, value) VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (item_id, column_id) DO UPDATE SET value = EXCLUDED.value`,
      [r[0].id, boardId, colId, JSON.stringify(val)]);
    if (statusCol) await put(statusCol, status);
    if (prioCol) await put(prioCol, prio);
    if (peopleCol && members.length) await put(peopleCol, members[n % members.length]);
    if (dateCol) {
      const d = new Date(Date.now() + (n - 1) * 3 * 86400_000);
      await put(dateCol, d.toISOString().slice(0, 10));
    }
    n++;
  }
  const { rows: c } = await pool.query(`SELECT count(*) c FROM items WHERE board_id=$1`, [boardId]);
  console.log('演示条目总数:', c[0].c);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
