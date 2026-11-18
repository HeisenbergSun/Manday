/**
 * Batch 27 — App 2.0 数据刷新 + 多视图人员显示修复验证
 *
 * 覆盖：
 *   A. 表格视图 people 单元格显示真实姓名（非 UUID）；status 无「未开始」等无效值
 *   B. 看板视图卡片人员头像是真实姓名（data-kanban-people 非 UUID）
 *   C. 甘特视图行显示人员头像（data-gantt-people 为真实姓名）
 *   D. Workload 视图按真实姓名聚合（data-workload-heat 不含 UUID）
 *   E. 分析视图成员负载为真实姓名（data-insights-member 不含 UUID）
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
const isUuid = (s) => /[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(s));

(async () => {
    require('./e2e-profile-cleanup')('manday-batch27');
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch27-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // 打开 App 2.0 项目
  const opened = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.trim() === 'App 2.0 项目');
    if (!nodes.length) return false;
    nodes[nodes.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  console.log('open App 2.0:', opened);
  await sleep(1800);
  assert(opened, 'A0 找到并打开 App 2.0 项目 board');

  // 拿到真实用户列表（做映射校验）
  const users = (await req(auth, 'GET', '/users')).body;
  const userNames = new Set((Array.isArray(users) ? users : []).map((u) => u.name));
  console.log('真实用户:', [...userNames].join(','));

  const switchView = async (kw) => {
    await page.evaluate((k) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(k));
      b?.click();
    }, kw);
    await sleep(1100);
  };

  // ===== A. 表格视图 =====
  await switchView('表格');
  await sleep(500);
  const gridPeople = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-grid-cell]')];
    return cells.map((td) => td.textContent.trim()).filter((t) => t.includes('张') || t.includes('李') || t.includes('王') || /[0-9a-f]{8}-/.test(t));
  });
  console.log('  表格 people 单元格:', JSON.stringify(gridPeople));
  assert(gridPeople.length > 0, 'A1 表格视图有人员单元格');
  assert(gridPeople.some((t) => userNames.size && [...userNames].some((n) => t.includes(n))), 'A2 表格人员显示真实姓名');
  assert(!gridPeople.some(isUuid), 'A3 表格人员不显示 UUID');

  // 状态列不含无效值「未开始」
  const statuses = await page.evaluate(() => {
    const tds = [...document.querySelectorAll('[data-grid-cell]')];
    return tds.map((td) => td.textContent.trim()).filter((t) => ['未开始', '待办', '进行中', '已完成'].includes(t));
  });
  console.log('  状态值:', JSON.stringify(statuses));
  assert(!statuses.includes('未开始'), 'A4 状态列不再有无效值「未开始」');

  // ===== B. 看板视图 =====
  await switchView('看板');
  const kanbanPeople = await page.evaluate(() =>
    [...document.querySelectorAll('[data-kanban-people]')].map((n) => n.getAttribute('data-kanban-people')));
  console.log('  看板 people:', JSON.stringify(kanbanPeople));
  assert(kanbanPeople.length > 0, 'B1 看板卡片显示人员');
  assert(!kanbanPeople.some(isUuid), 'B2 看板人员为真实姓名（非 UUID）');
  assert(kanbanPeople.some((n) => [...userNames].some((u) => n === u)), 'B3 看板人员姓名与用户表一致');

  // ===== C. 甘特视图 =====
  await switchView('甘特');
  const ganttPeople = await page.evaluate(() =>
    [...document.querySelectorAll('[data-gantt-people]')].map((n) => n.getAttribute('data-gantt-people')));
  console.log('  甘特 people:', JSON.stringify(ganttPeople));
  assert(ganttPeople.length > 0, 'C1 甘特行显示人员');
  assert(!ganttPeople.some(isUuid), 'C2 甘特人员为真实姓名（非 UUID）');

  // ===== D. Workload 视图 =====
  await switchView('Workload');
  const wlPeople = await page.evaluate(() =>
    [...document.querySelectorAll('[data-workload-heat]')].map((n) => n.getAttribute('data-workload-heat')));
  console.log('  Workload people:', JSON.stringify(wlPeople));
  assert(wlPeople.length > 0, 'D1 Workload 按人员聚合');
  assert(!wlPeople.some(isUuid), 'D2 Workload 人员为真实姓名（非 UUID）');
  assert(wlPeople.some((n) => [...userNames].some((u) => n === u)), 'D3 Workload 人员姓名与用户表一致');

  // ===== E. 分析视图 =====
  await switchView('分析');
  const insPeople = await page.evaluate(() =>
    [...document.querySelectorAll('[data-insights-member]')].map((n) => n.getAttribute('data-insights-member')));
  console.log('  分析 people:', JSON.stringify(insPeople));
  assert(insPeople.length > 0, 'E1 分析视图按人员聚合');
  assert(!insPeople.some(isUuid), 'E2 分析视图人员为真实姓名（非 UUID）');

  console.log('\n=== RESULT ===');
  console.log(errors.length ? 'FAIL:\n' + errors.join('\n') : 'ALL PASS');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
