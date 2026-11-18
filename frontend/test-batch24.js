/**
 * Batch 24 e2e — 三个交互需求验证
 * 1. 行点击不自动打开详情（只有 Open 按钮才打开）
 * 2. 弹窗点击外部区域自动关闭
 * 3. 单击即可编辑（不再需要双击）
 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const API = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let errors = [];
const assert = (c, m) => { if (!c) { errors.push(m); console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const req = async (auth, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

const { Pool } = require('C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/manday/backend/node_modules/pg');
const pg = new Pool({ connectionString: 'postgresql://neondb_owner:npg_7BnQ5ysHkARh@ep-rough-tree-a1ee1err-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' });
const purge = async () => { const r = await pg.query("DELETE FROM boards WHERE name LIKE 'B24-%' RETURNING name"); return r.rowCount; };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch24-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  // ── 登录 ──
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));
  const removed = await purge();
  if (removed) console.log(`[cleanup-pre] removed ${removed} leftover boards`);

  // ── 建板 + 列 + 条目 ──
  const bid = (await req(auth, 'POST', '/boards', { name: 'B24-Interact', visibility: 'private' })).body.id;
  assert(bid, 'Board created');
  const txtCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '任务描述', type: 'text' })).body;
  const statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' })).body;
  await req(auth, 'POST', `/boards/${bid}/items`, { name: '测试条目A' });
  await req(auth, 'POST', `/boards/${bid}/items`, { name: '测试条目B' });
  await sleep(500);

  // ── 导航到测试板 ──
  // 通过左侧 WorkspaceNav 点击对应 board
  await page.evaluate((boardName) => {
    const items = [...document.querySelectorAll('span,div,a,button')];
    const target = items.find((el) => el.textContent.trim() === boardName && el.offsetParent !== null);
    if (target) target.click();
  }, 'B24-Interact');
  await sleep(2500);

  // ════════════════════════════════════════
  // 需求1：行点击不自动打开详情
  // ════════════════════════════════════════
  console.log('\n--- 需求1：行点击不自动打开详情 ---');

  // 1a: 点击行单元格（非 Open 按钮）后不打开详情
  const cellBefore = await page.$('[data-grid-cell]');
  if (cellBefore) {
    await cellBefore.click();
    await sleep(800);
  }
  const detailAfterCellClick = await page.$('[data-item-detail]');
  assert(!detailAfterCellClick, '1a: 点击行单元格后不自动打开详情面板');

  // 1b: 点击 Open 按钮后打开详情
  const openBtn = await page.$('[data-grid-open]');
  if (openBtn) {
    await openBtn.click();
    await sleep(1000);
  }
  const detailAfterOpen = await page.$('[data-item-detail]');
  assert(!!detailAfterOpen, '1b: 点击 Open 按钮后打开详情面板');

  // 关闭详情
  const closeDetail = await page.$('[data-item-detail] button[title="关闭"]');
  if (closeDetail) { await closeDetail.click(); await sleep(500); }
  else { await page.keyboard.press('Escape'); await sleep(500); }

  // ════════════════════════════════════════
  // 需求2：弹窗点击外部区域自动关闭
  // ════════════════════════════════════════
  console.log('\n--- 需求2：弹窗点击外部区域自动关闭 ---');

  // 2a: 列与分组面板
  const mgrTrigger = await page.$('[data-mgr-trigger]');
  if (mgrTrigger) {
    await mgrTrigger.click();
    await sleep(800);
    const panelBefore = await page.$('[data-mgr-panel]');
    assert(!!panelBefore, '2a-1: 列与分组面板打开');

    // 点击外部（页面底部空白区域）
    await page.mouse.click(400, 850);
    await sleep(800);
    const panelAfter = await page.$('[data-mgr-panel]');
    assert(!panelAfter, '2a-2: 点击外部后列与分组面板关闭');
  } else {
    assert(false, '2a-1: 列与分组面板打开 (trigger not found)');
    assert(false, '2a-2: 点击外部后列与分组面板关闭');
  }

  // 2b: 视图面板
  const viewsTrigger = await page.$('[data-views-trigger]');
  if (viewsTrigger) {
    await viewsTrigger.click();
    await sleep(800);
    const panelBefore = await page.$('[data-views-panel]');
    assert(!!panelBefore, '2b-1: 视图面板打开');

    await page.mouse.click(400, 850);
    await sleep(800);
    const panelAfter = await page.$('[data-views-panel]');
    assert(!panelAfter, '2b-2: 点击外部后视图面板关闭');
  } else {
    assert(false, '2b-1: 视图面板打开 (trigger not found)');
    assert(false, '2b-2: 点击外部后视图面板关闭');
  }

  // 2c: 自动化面板
  const autoTrigger = await page.$('[data-auto-trigger]');
  if (autoTrigger) {
    await autoTrigger.click();
    await sleep(800);
    const panelBefore = await page.$('[data-auto-panel]');
    assert(!!panelBefore, '2c-1: 自动化面板打开');

    await page.mouse.click(400, 850);
    await sleep(800);
    const panelAfter = await page.$('[data-auto-panel]');
    assert(!panelAfter, '2c-2: 点击外部后自动化面板关闭');
  } else {
    assert(false, '2c-1: 自动化面板打开 (trigger not found)');
    assert(false, '2c-2: 点击外部后自动化面板关闭');
  }

  // 2d: 成员弹窗
  const membersTrigger = await page.$('[data-members-trigger]');
  if (membersTrigger) {
    await membersTrigger.click();
    await sleep(800);
    const panelBefore = await page.$('[data-members-panel]');
    assert(!!panelBefore, '2d-1: 成员弹窗打开');

    await page.mouse.click(400, 850);
    await sleep(800);
    const panelAfter = await page.$('[data-members-panel]');
    assert(!panelAfter, '2d-2: 点击外部后成员弹窗关闭');
  } else {
    assert(false, '2d-1: 成员弹窗打开 (trigger not found)');
    assert(false, '2d-2: 点击外部后成员弹窗关闭');
  }

  // ════════════════════════════════════════
  // 需求3：单击即可编辑
  // ════════════════════════════════════════
  console.log('\n--- 需求3：单击即可编辑 ---');

  // 确保面板都关了
  await page.mouse.click(400, 850);
  await sleep(500);

  // 3a: 单击名称列单元格
  const nameCell = await page.$('td[data-col="name"]');
  if (nameCell) {
    await nameCell.click();
    await sleep(1000);
    const editor = await page.$('[data-grid-editor]');
    assert(!!editor, '3a: 单击名称列单元格即可进入编辑模式');
    if (editor) { await page.keyboard.press('Escape'); await sleep(500); }
  } else {
    assert(false, '3a: 单击名称列单元格即可进入编辑模式 (cell not found)');
  }

  // 3b: 单击其他列单元格
  const otherCell = await page.$('td[data-col]:not([data-col="name"])');
  if (otherCell) {
    await otherCell.click();
    await sleep(1000);
    const editor2 = await page.$('[data-grid-editor], input[data-grid-editor], select');
    assert(!!editor2, '3b: 单击其他列单元格即可进入编辑模式');
    if (editor2) { await page.keyboard.press('Escape'); await sleep(500); }
  } else {
    assert(false, '3b: 单击其他列单元格即可进入编辑模式 (cell not found)');
  }

  // ════════════════════════════════════════
  // 汇总
  // ════════════════════════════════════════
  console.log('\n=== 汇总 ===');
  if (errors.length) {
    console.log(`❌ ${errors.length} 项失败:`);
    errors.forEach((e) => console.log('   - ' + e));
  } else {
    console.log('✅ 全部通过');
  }

  // 清理测试板
  await purge();
  await browser.close();
  await pg.end();
  process.exit(errors.length > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
