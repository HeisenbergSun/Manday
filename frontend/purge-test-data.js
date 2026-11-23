/**
 * 统一 purge 测试残留 board/folder/dashboard（兜底）
 * 规则：以 B/P/F/D 数字前缀开头（B28/P1/F1/D1 等）+ 明确的测试名
 * 白名单（正式数据）不受影响：官网改版项目 / 移动端 App 项目 等
 */
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const TEST_RE = `name ~ '^[BPFD][0-9]'
  OR name IN ('测试','测试时','测试01','测试板','测试分组','盘1','盘2','菜单盘','菜单组','混排板','混排盘')`;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await c.connect();
    const b = await c.query(`DELETE FROM boards WHERE ${TEST_RE}`);
    const f = await c.query(`DELETE FROM board_folders WHERE ${TEST_RE}`);
    const d = await c.query(`DELETE FROM dashboards WHERE ${TEST_RE}`);
    console.log(`[purge] boards=${b.rowCount} folders=${f.rowCount} dashboards=${d.rowCount}`);
  } catch (e) {
    console.error('[purge] failed:', e.message);
  } finally {
    await c.end().catch(() => {});
    process.exit(0);
  }
})();
