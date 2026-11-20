/**
 * 第四十二批 e2e：dashboard 菜单「移动到分组 / 新建分组」
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
  require('./e2e-profile-cleanup')('manday-batch42');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch42-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  const d = (await req(auth, 'POST', '/dashboards', { name: '菜单盘', scope: 'personal' })).body.id;
  const f = (await req(auth, 'POST', '/board-folders', { name: '菜单组' })).body;

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  // 打开 dashboard ⋯ 菜单
  await page.evaluate((name) => {
    const row = document.querySelector(`[data-dashboard-item="${name}"]`);
    row?.querySelector('[data-dashboard-menu-trigger]')?.click();
  }, '菜单盘');
  await sleep(400);
  const menuText = await page.evaluate(() => document.querySelector('[data-dash-menu]')?.innerText ?? '');
  assert(menuText.includes('移动到分组'), 'S1 dashboard 菜单含「移动到分组」');
  assert(menuText.includes('新建分组'), 'S1 dashboard 菜单含「新建分组」');

  // 通过菜单把 dashboard 移到分组
  await page.evaluate((fn) => {
    const item = [...document.querySelectorAll('[data-dash-menu-folder]')].find((x) => x.getAttribute('data-dash-menu-folder') === fn);
    item?.click();
  }, '菜单组');
  await sleep(1500);
  const folders = (await req(auth, 'GET', '/board-folders')).body;
  const myF = folders.find((x) => x.id === f.id);
  assert(myF && (myF.dashboardIds ?? []).includes(d), 'S2 通过菜单移动 dashboard 到分组');

  // 清理
  await req(auth, 'DELETE', `/board-folders/${f.id}`);
  await req(auth, 'DELETE', `/dashboards/${d}`);

  console.log('\n===== 第四十二批 dashboard菜单移动分组：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
