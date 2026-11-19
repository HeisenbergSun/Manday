/**
 * 第三十二批 e2e：团队共享 dashboard + 图表下钻 + 仪表盘模板
 * S1 团队共享 dashboard（API 创建 team，list 返回 is_team）
 * S2 模板创建：空 dashboard 从模板批量生成 widget
 * S3 图表下钻：table widget 点击行打开条目详情
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
  require('./e2e-profile-cleanup')('manday-batch32');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch32-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => { d.accept().catch(() => {}); });

  const NAME = 'B32-Tmpl ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const token = await page.evaluate(() => localStorage.getItem('manday_token'));

  // 清理残留
  try {
    const pg = require('pg'); require('dotenv').config({ path: '../backend/.env' });
    const pc = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pc.connect(); await pc.query(`DELETE FROM dashboards WHERE name LIKE 'B32-%'`); await pc.end();
  } catch {}

  // ---- S1 团队共享 ----
  const teamD = await req(token, 'POST', '/dashboards', { name: NAME + '-Team', scope: 'team' });
  assert(!!teamD.body.id && teamD.body.is_team, 'S1 创建团队共享 dashboard');
  const list = await req(token, 'GET', '/dashboards');
  const inList = (list.body ?? []).some((d) => d.name === NAME + '-Team' && d.is_team);
  assert(inList, 'S1 listDashboards 返回 is_team 标记');

  // 准备 board + 条目（供模板/下钻）
  const b = await req(token, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  await req(token, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
  await req(token, 'POST', `/boards/${bid}/columns`, { name: '预算', type: 'number' });
  await req(token, 'POST', `/boards/${bid}/columns`, { name: '截止日期', type: 'date' });
  const it = await req(token, 'POST', `/boards/${bid}/items`, { name: 'B32-条目A' });
  const itemId = it.body.id;

  // ---- S2 模板创建 ----
  const dash = await req(token, 'POST', '/dashboards', { name: NAME + '-Dash', scope: 'personal' });
  const dashId = dash.body.id;
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.evaluate((n) => document.querySelector(`[data-dashboard-item="${n}"]`)?.click(), NAME + '-Dash');
  await sleep(2000);
  // 空状态 → 模板触发
  const tplBtn = await page.$('[data-template-trigger]');
  assert(!!tplBtn, 'S2 空 dashboard 显示「从模板创建」');
  await page.click('[data-template-trigger]');
  await sleep(400);
  // 选 board
  await page.evaluate((bid) => {
    const sel = document.querySelector('[data-template-modal] select');
    if (sel) { sel.value = bid; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, bid);
  await sleep(300);
  // 选「项目总览」模板
  await page.evaluate(() => document.querySelector('[data-template="项目总览"]')?.click());
  await sleep(2500);
  const widgetCount = await page.evaluate(() => document.querySelectorAll('[data-widget]').length);
  assert(widgetCount >= 4, 'S2 模板批量生成 widget（实际 ' + widgetCount + ' 个）');

  // ---- S3 图表下钻（table widget 点击行）----
  // 模板「项目总览」含 table widget；点击其行打开详情
  const drill = await page.evaluate(() => {
    const table = document.querySelector('[data-widget="table"]');
    const row = table?.querySelector('div[title="点击打开条目详情"]');
    if (row) { row.click(); return true; }
    return false;
  });
  await sleep(1200);
  const detailOpen = await page.$('[data-item-detail]');
  assert(drill && !!detailOpen, 'S3 图表下钻打开条目详情');

  // 清理
  await req(token, 'DELETE', `/dashboards/${dashId}`);
  await req(token, 'DELETE', `/dashboards/${teamD.body.id}`);
  await req(token, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第三十二批 共享/下钻/模板：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
