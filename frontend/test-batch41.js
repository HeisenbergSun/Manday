/**
 * 第四十一批 e2e：dashboard 进分组 + 排序
 * S1 dashboard 移进分组（API dashboardIds 包含）
 * S2 dashboard 移出分组
 * S3 dashboard reorder（顺序变化）
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
  require('./e2e-profile-cleanup')('manday-batch41');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch41-' + Date.now(),
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

  const d1 = (await req(auth, 'POST', '/dashboards', { name: '盘1', scope: 'personal' })).body.id;
  const d2 = (await req(auth, 'POST', '/dashboards', { name: '盘2', scope: 'personal' })).body.id;
  const f = (await req(auth, 'POST', '/board-folders', { name: '组1' })).body;

  // S1 dashboard 移进分组
  await req(auth, 'POST', `/board-folders/${f.id}/dashboards`, { dashboardId: d1 });
  let folders = (await req(auth, 'GET', '/board-folders')).body;
  const myF = folders.find((x) => x.id === f.id);
  assert(myF && (myF.dashboardIds ?? []).includes(d1), 'S1 dashboard 移进分组');

  // S2 dashboard 移出分组
  await req(auth, 'DELETE', `/board-folders/${f.id}/dashboards/${d1}`);
  folders = (await req(auth, 'GET', '/board-folders')).body;
  const myF2 = folders.find((x) => x.id === f.id);
  assert(myF2 && !(myF2.dashboardIds ?? []).includes(d1), 'S2 dashboard 移出分组');

  // S3 dashboard reorder
  await req(auth, 'POST', '/dashboards/reorder', { order: [d2, d1] });
  const dashes = (await req(auth, 'GET', '/dashboards')).body;
  const myD = dashes.filter((x) => x.id === d1 || x.id === d2);
  assert(myD.length === 2 && myD[0].id === d2, 'S3 dashboard reorder（盘2 在前）');

  // 清理
  await req(auth, 'DELETE', `/board-folders/${f.id}`);
  await req(auth, 'DELETE', `/dashboards/${d1}`);
  await req(auth, 'DELETE', `/dashboards/${d2}`);

  console.log('\n===== 第四十一批 dashboard进分组/排序：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
