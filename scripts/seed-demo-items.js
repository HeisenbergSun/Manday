/**
 * 向演示 Board（App 2.0 项目）灌入 / 刷新示例条目（Neon/本地库通用）
 *
 * 幂等：按 (board_id, name) 自然键 upsert，重复运行只会刷新到最新，不会重复插入。
 * 修复要点（P1 收尾）：
 *   - 旧版「已有条目就跳过」导致演示板永远停在旧开发状态 —— 现改为始终刷新。
 *   - people 值写真实用户 UUID，并把 people 列 settings.members 刷新为真实用户，
 *     消除假 id u1/u2（看板/工作量/分析视图曾因此把 UUID 当人名显示）。
 *   - status 用列 labels 里的合法状态值，不再写「未开始」这类无效值。
 */
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

  const { rows: cols } = await pool.query(`SELECT id,name,type,settings FROM board_columns WHERE board_id=$1`, [boardId]);
  const statusCol = cols.find(c => c.type === 'status');
  const prioCol = cols.find(c => c.type === 'dropdown' || /prio|优先/.test(c.name || ''));
  const peopleCol = cols.find(c => c.type === 'people');
  const dateCol = cols.find(c => c.type === 'date');

  // 真实用户（按创建顺序）
  const { rows: users } = await pool.query(`SELECT id,name FROM users ORDER BY created_at`);
  if (!users.length) { console.log('用户表为空，无法分配负责人'); process.exit(1); }

  // ① 把 people 列 settings.members 刷新为真实用户（消除 u1/u2 假 id，保证旧逻辑也能解析姓名）
  if (peopleCol) {
    const palette = ['#579bfc', '#00c875', '#fdab3d', '#e2445c', '#9d67f8', '#00d1d1'];
    const members = users.slice(0, 8).map((u, i) => ({ id: u.id, name: u.name, color: palette[i % palette.length] }));
    const settings = { ...(peopleCol.settings || {}), members };
    await pool.query(`UPDATE board_columns SET settings=$2::jsonb WHERE id=$1`, [peopleCol.id, JSON.stringify(settings)]);
  }

  // ② 合法状态值：优先取 status 列 labels，缺省集合用默认三态
  const labels = (statusCol?.settings?.labels ?? []).map((l) => typeof l === 'string' ? l : l.label).filter(Boolean);
  const fallbackLabels = labels.length ? labels : ['待办', '进行中', '已完成'];
  const pickStatus = (want) => fallbackLabels.includes(want) ? want : fallbackLabels[0];

  // ③ 演示数据：状态用合法 label，负责人用真实用户 UUID
  const demo = [
    ['用户登录模块', '进行中', '高'],
    ['SSO 企微对接', '待办', '中'],
    ['看板视图', '进行中', '高'],
    ['Excel 导入', '待办', '低'],
    ['通知中心', '已完成', '中'],
  ];
  const groupOf = (status) =>
    (status === '已完成' ? gid['已完成'] : status === '进行中' ? gid['进行中'] : gid['待办']) || g[0]?.id;

  // jsonb 标量写入（value = '"进行中"'，不是 jsonb 字符串包）
  const put = (itemId, colId, val) => pool.query(
    `INSERT INTO item_values (item_id, board_id, column_id, value) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (item_id, column_id) DO UPDATE SET value = EXCLUDED.value`,
    [itemId, boardId, colId, JSON.stringify(val)]);

  for (let n = 0; n < demo.length; n++) {
    const [name, wantStatus, prio] = demo[n];
    const status = pickStatus(wantStatus);
    const group = groupOf(status);
    // 按 (board_id, name) 幂等取条目
    const found = await pool.query(
      `SELECT id FROM items WHERE board_id=$1 AND name=$2 ORDER BY position LIMIT 1`, [boardId, name]);
    let itemId;
    if (found.rows.length) {
      itemId = found.rows[0].id;
      await pool.query(`UPDATE items SET group_id=$2, position=$3 WHERE id=$1`, [itemId, group, n + 1]);
    } else {
      const ins = await pool.query(
        `INSERT INTO items (board_id, group_id, name, position, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [boardId, group, name, n + 1, users[0].id]);
      itemId = ins.rows[0].id;
    }
    if (statusCol) await put(itemId, statusCol.id, status);
    if (prioCol) await put(itemId, prioCol.id, prio);
    if (peopleCol) await put(itemId, peopleCol.id, users[n % users.length].id);
    if (dateCol) {
      const d = new Date(Date.now() + (n - 1) * 3 * 86400_000);
      await put(itemId, dateCol.id, d.toISOString().slice(0, 10));
    }
  }

  const { rows: c } = await pool.query(`SELECT count(*) c FROM items WHERE board_id=$1`, [boardId]);
  const { rows: pv } = await pool.query(
    `SELECT i.name, c.name col, iv.value
       FROM item_values iv JOIN items i ON i.id=iv.item_id JOIN board_columns c ON c.id=iv.column_id
      WHERE i.board_id=$1 ORDER BY i.name, c.name`, [boardId]);
  console.log('演示条目总数:', c[0].c);
  console.log('刷新后各列值:', JSON.stringify(pv));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
