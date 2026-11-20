/**
 * 第四十三批 e2e：board + dashboard 混排排序
 * S1 workspace-reorder 混排（dashboard 排 board 前）
 * S2 前端未分组区按 position 混排渲染（dashboard 在 board 前）
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
  require('./e2e-profile-cleanup')('manday-batch43');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch43-' + Date.now(),
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

  const b = (await req(auth, 'POST', '/boards', { name: '混排板', visibility: 'private' })).body.id;
  const d = (await req(auth, 'POST', '/dashboards', { name: '混排盘', scope: 'personal' })).body.id;

  // S1 workspace-reorder：dashboard 排 board 前
  await req(auth, 'POST', '/boards/workspace-reorder', { items: [{ type: 'dashboard', id: d }, { type: 'board', id: b }] });
  const dash = (await req(auth, 'GET', '/dashboards')).body.find((x) => x.id === d);
  const board = (await req(auth, 'GET', '/boards')).body.find((x) => x.id === b);
  assert((dash?.position ?? 0) < (board?.position ?? 0), `S1 混排 position（dash=${dash?.position}, board=${board?.position}）`);

  // S2 前端未分组区混排渲染
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  const order = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-ungrouped-drop] > div')].filter((el) => el.getAttribute('data-board-item') || el.getAttribute('data-dashboard-item'));
    return items.map((el) => el.getAttribute('data-board-item') || el.getAttribute('data-dashboard-item'));
  });
  const dashIdx = order.indexOf('混排盘');
  const boardIdx = order.indexOf('混排板');
  assert(dashIdx >= 0 && boardIdx >= 0 && dashIdx < boardIdx, `S2 前端混排渲染（dash 在 board 前，实际 ${JSON.stringify(order.slice(0, 6))}）`);

  // 清理
  await req(auth, 'DELETE', `/boards/${b}`);
  await req(auth, 'DELETE', `/dashboards/${d}`);

  console.log('\n===== 第四十三批 混排排序：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
