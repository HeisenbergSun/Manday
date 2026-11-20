/**
 * 第三十九批 e2e：分组 + dashboard 拖拽排序
 * S1 folder reorder（API 顺序变化）
 * S2 dashboard reorder（API 顺序变化）
 * S3 前端 folder/dashboard 项可拖拽（draggable 属性）
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
  require('./e2e-profile-cleanup')('manday-batch39');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch39-' + Date.now(),
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

  // S1 folder reorder
  const f1 = (await req(auth, 'POST', '/board-folders', { name: 'F1' })).body.id;
  const f2 = (await req(auth, 'POST', '/board-folders', { name: 'F2' })).body.id;
  await req(auth, 'POST', '/board-folders/reorder', { order: [f2, f1] });
  const folders = (await req(auth, 'GET', '/board-folders')).body;
  const myF = folders.filter((x) => x.id === f1 || x.id === f2);
  const fOrdered = myF.length === 2 && myF[0].id === f2 && myF[1].id === f1;
  assert(fOrdered, 'S1 folder reorder 顺序变化（F2 在前）');

  // S2 dashboard reorder
  const d1 = (await req(auth, 'POST', '/dashboards', { name: 'D1', scope: 'personal' })).body.id;
  const d2 = (await req(auth, 'POST', '/dashboards', { name: 'D2', scope: 'personal' })).body.id;
  await req(auth, 'POST', '/dashboards/reorder', { order: [d2, d1] });
  const dashboards = (await req(auth, 'GET', '/dashboards')).body;
  const myD = dashboards.filter((x) => x.id === d1 || x.id === d2);
  const dOrdered = myD.length === 2 && myD[0].id === d2 && myD[1].id === d1;
  assert(dOrdered, 'S2 dashboard reorder 顺序变化（D2 在前）');

  // S3 前端可拖拽
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  const draggable = await page.evaluate(() => ({
    dash: !!document.querySelector('[data-dashboard-item][draggable="true"]'),
    folder: [...document.querySelectorAll('[data-board-list] > div > div[draggable]')].length > 0 || !!document.querySelector('[data-board-list] div[draggable="true"]'),
  }));
  assert(draggable.dash, 'S3 dashboard 项可拖拽');
  assert(draggable.folder, 'S3 folder 项可拖拽');

  // 清理
  await req(auth, 'DELETE', `/board-folders/${f1}`);
  await req(auth, 'DELETE', `/board-folders/${f2}`);
  await req(auth, 'DELETE', `/dashboards/${d1}`);
  await req(auth, 'DELETE', `/dashboards/${d2}`);

  console.log('\n===== 第三十九批 分组/dashboard排序：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
