/**
 * 第三十五批 e2e：Board / Dashboard 级操作（复制/重命名/删除）
 * S1 board ⋯ 菜单含复制/重命名/删除
 * S2 UI 复制 board
 * S3 dashboard ⋯ 菜单含复制/重命名/删除
 * S4 UI 复制 dashboard
 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const API = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let errors = [];
const assert = (c, m) => { if (!c) { errors.push(m); console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const req = async (auth, method, path_, body) => {
  const r = await fetch(API + path_, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

(async () => {
  require('./e2e-profile-cleanup')('manday-batch35');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch35-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => { d.accept().catch(() => {}); });

  const NAME = 'B35-操作 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // 准备 board + dashboard
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  const d = await req(auth, 'POST', '/dashboards', { name: NAME + '-Dash', scope: 'personal' });
  await req(auth, 'POST', `/dashboards/${d.body.id}/widgets`, { type: 'rank', title: '排行', config: {} });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);

  // S1 board ⋯ 菜单
  const trig = await page.evaluate((n) => {
    const row = document.querySelector(`[data-board-item="${n}"]`);
    const t = row?.querySelector('[data-board-menu-trigger]');
    if (!t) return false; t.click(); return true;
  }, NAME);
  assert(trig, 'S1 定位 board ⋯ 按钮');
  await sleep(400);
  const menuText = await page.evaluate(() => document.querySelector('[data-board-menu]')?.innerText ?? '');
  assert(menuText.includes('复制 Board') && menuText.includes('重命名 Board') && menuText.includes('删除 Board'), 'S1 board 菜单含复制/重命名/删除');

  // S2 UI 复制 board
  await page.evaluate(() => document.querySelector('[data-board-dup]')?.click());
  await sleep(1500);
  const dupBoard = await page.evaluate((n) => document.body.innerText.includes(n + '（副本）'), NAME);
  assert(dupBoard, 'S2 UI 复制 board 生成「（副本）」');

  // S3 dashboard ⋯ 菜单
  await page.evaluate((n) => {
    const row = document.querySelector(`[data-dashboard-item="${n}"]`);
    row?.querySelector('[data-dashboard-menu-trigger]')?.click();
  }, NAME + '-Dash');
  await sleep(400);
  const dashMenuText = await page.evaluate(() => document.querySelector('[data-dash-menu]')?.innerText ?? '');
  assert(dashMenuText.includes('复制 Dashboard') && dashMenuText.includes('删除 Dashboard'), 'S3 dashboard 菜单含复制/删除');

  // S4 UI 复制 dashboard
  await page.evaluate(() => document.querySelector('[data-dash-dup]')?.click());
  await sleep(1500);
  const dupDash = await page.evaluate((n) => document.body.innerText.includes(n + '（副本）'), NAME + '-Dash');
  assert(dupDash, 'S4 UI 复制 dashboard 生成「（副本）」');

  // 清理（删除原始 + 副本 board/dashboard）
  const boards = (await req(auth, 'GET', '/boards')).body;
  for (const x of boards) if (x.name.startsWith(NAME)) await req(auth, 'DELETE', `/boards/${x.id}`);
  const dashes = (await req(auth, 'GET', '/dashboards')).body;
  for (const x of dashes) if (x.name.startsWith(NAME)) await req(auth, 'DELETE', `/dashboards/${x.id}`);

  console.log('\n===== 第三十五批 Board/Dashboard 操作：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
