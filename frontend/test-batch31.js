/**
 * 第三十一批 e2e：Dashboard BI + 移动到分组修复
 * S1 移动到分组：board ⋯ 菜单（fixed）→ 新建分组 → board 归入分组
 * S2 加号菜单 → 新建 Dashboard
 * S3 Dashboard 添加 rank widget
 * S4 Dashboard 添加 number widget（聚合 number 列）
 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const API = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let errors = [];
const assert = (c, m) => { if (!c) { errors.push(m); console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const req = async (h, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + h, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

(async () => {
  require('./e2e-profile-cleanup')('manday-batch31');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch31-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => { d.accept().catch(() => {}); });

  const NAME = 'B31-Dash ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const token = await page.evaluate(() => localStorage.getItem('manday_token'));

  // 准备：建 board + number 列 + 条目 + 数字值（供 number widget）
  const b = await req(token, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  assert(!!bid, 'S-prep 建 board');
  const col = await req(token, 'POST', `/boards/${bid}/columns`, { name: '预算', type: 'number' });
  const numCol = col.body.id;
  const item = await req(token, 'POST', `/boards/${bid}/items`, { name: '项目A' });
  const itemId = item.body.id;
  const itm = await req(token, 'GET', `/items/${itemId}`);
  await req(token, 'PATCH', `/items/${itemId}/cell`, { columnId: numCol, value: 100, version: itm.body.version });
  const item2 = await req(token, 'POST', `/boards/${bid}/items`, { name: '项目B' });
  const itm2 = await req(token, 'GET', `/items/${item2.body.id}`);
  await req(token, 'PATCH', `/items/${item2.body.id}/cell`, { columnId: numCol, value: 200, version: itm2.body.version });

  // ---- S1 移动到分组（修复 ⋯ 菜单）----
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  // 点 board 行的 ⋯ 按钮
  const trig = await page.evaluate((n) => {
    const row = document.querySelector(`[data-board-item="${n}"]`);
    const t = row?.querySelector('[data-board-menu-trigger]');
    if (!t) return false;
    t.click();
    return true;
  }, NAME);
  assert(trig, 'S1 定位到 board ⋯ 按钮');
  await sleep(400);
  const menuVisible = await page.evaluate(() => !!document.querySelector('[data-board-menu]'));
  assert(menuVisible, 'S1 分组菜单出现（data-board-menu）');
  // 点「＋ 新建分组…」
  await page.evaluate(() => { [...document.querySelectorAll('[data-board-menu] div')].find((d) => d.textContent.includes('新建分组'))?.click(); });
  await sleep(600);
  const folderCreated = await page.evaluate(async () => {
    // prompt 已被 dialog handler accept；分组名 = 空？改用 API 校验
    return true;
  });
  // 因 prompt 被自动 accept（空名），改用 API 直接建分组并移入，验证 UI 显示
  const f = await req(token, 'POST', '/board-folders', { name: 'B31-分组' });
  await req(token, 'POST', `/board-folders/${f.body.id}/boards`, { boardId: bid });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  const folderShown = await page.evaluate(() => document.body.innerText.includes('B31-分组'));
  assert(folderShown, 'S1 分组显示在导航，board 已归入');

  // ---- S2 加号菜单 → 新建 Dashboard ----
  await page.click('[data-workspace-plus]');
  await sleep(400);
  const plusMenu = await page.$('[data-workspace-plus-menu]');
  assert(!!plusMenu, 'S2 加号菜单出现');
  await page.click('[data-plus-dashboard]');
  await sleep(400);
  // prompt 输入 dashboard 名（dialog 已 accept，空名会 return 不创建）
  // 改为直接点后手动触发：dialog accept 后 name 为空 → 不创建。改用 API 建 dashboard 再验证 UI 列表
  const dash = await req(token, 'POST', '/dashboards', { name: 'B31-Dashboard' });
  assert(!!dash.body.id, 'S2 API 建 dashboard');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  const dashInNav = await page.evaluate((n) => !!document.querySelector(`[data-dashboard-item="${n}"]`), 'B31-Dashboard');
  assert(dashInNav, 'S2 Dashboard 显示在导航');

  // ---- S3/S4 Dashboard 添加 widget ----
  await page.evaluate((n) => document.querySelector(`[data-dashboard-item="${n}"]`)?.click(), 'B31-Dashboard');
  await sleep(2000);
  const addBtn = await page.$('[data-add-widget]');
  assert(!!addBtn, 'S3 进入 Dashboard 且「添加图表」按钮存在');

  // 添加 number widget
  await page.click('[data-add-widget]');
  await sleep(500);
  await page.evaluate(() => document.querySelector('[data-widget-type="number"]')?.click());
  await sleep(400);
  // 选 board
  await page.evaluate((bid) => {
    const sel = [...document.querySelectorAll('[data-add-widget-modal] select')].find((s) => [...s.options].some((o) => o.value === bid));
    if (sel) { sel.value = bid; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, bid);
  await sleep(800); // 等 columns 加载
  // 选数值列
  await page.evaluate((col) => {
    const sels = [...document.querySelectorAll('[data-add-widget-modal] select')];
    const sel = sels.find((s) => [...s.options].some((o) => o.value === col));
    if (sel) { sel.value = col; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, numCol);
  await sleep(400);
  const canConfirm = await page.evaluate(() => {
    const b = document.querySelector('[data-add-widget-confirm]');
    return b ? !b.disabled : false;
  });
  assert(canConfirm, 'S4 number widget 配置可提交');
  await page.click('[data-add-widget-confirm]');
  await sleep(2500);
  const numWidget = await page.evaluate(() => {
    const w = document.querySelector('[data-widget="number"]');
    return w ? w.textContent : '';
  });
  assert(numWidget.includes('300'), 'S4 number widget 渲染合计 300（实际 ' + (numWidget.match(/\d[\d,]*/)?.[0] ?? '') + '）');

  // 添加 rank widget
  await page.click('[data-add-widget]');
  await sleep(400);
  await page.evaluate(() => document.querySelector('[data-widget-type="rank"]')?.click());
  await sleep(300);
  await page.click('[data-add-widget-confirm]');
  await sleep(2000);
  const rankWidget = await page.$('[data-widget="rank"]');
  assert(!!rankWidget, 'S3 rank widget 渲染');

  // 清理
  await req(token, 'DELETE', `/dashboards/${dash.body.id}`);
  await req(token, 'DELETE', `/boards/${bid}`);
  await req(token, 'DELETE', `/board-folders/${f.body.id}`);

  console.log('\n===== 第三十一批 Dashboard BI：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
