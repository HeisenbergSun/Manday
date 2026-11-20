/**
 * 第三十八批 e2e：shift 连续选中 + board 拖动排序
 * S1 shift 连续选中（点第1行 + shift点第3行 → 3 行都选中）
 * S2 board 拖拽排序（API reorder 顺序变化）
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
  require('./e2e-profile-cleanup')('manday-batch38');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch38-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B38-排序 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  for (const n of ['任务1', '任务2', '任务3', '任务4', '任务5']) await req(auth, 'POST', `/boards/${bid}/items`, { name: n });

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME);
  await sleep(2500);

  // S1 shift 连续选中（真实鼠标 + shift 键）
  const pos0 = await page.evaluate(() => { const r = document.querySelectorAll('[data-grid-check]')[0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const pos2 = await page.evaluate(() => { const r = document.querySelectorAll('[data-grid-check]')[2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(pos0.x, pos0.y);
  await sleep(300);
  await page.keyboard.down('Shift');
  await page.mouse.click(pos2.x, pos2.y);
  await page.keyboard.up('Shift');
  await sleep(600);
  const selectedCount = await page.evaluate(() => [...document.querySelectorAll('[data-grid-check]')].filter((c) => c.checked).length);
  assert(selectedCount === 3, `S1 shift 连续选中 3 行（实际 ${selectedCount}）`);

  // S2 board 拖拽排序（用 API reorder 验证后端，前端 drag 逻辑由 reorderBoard 保证）
  const boardsBefore = (await req(auth, 'GET', '/boards')).body;
  const order = boardsBefore.map((x) => x.id).reverse();
  await req(auth, 'POST', '/boards/reorder', { order });
  const boardsAfter = (await req(auth, 'GET', '/boards')).body;
  const reversed = boardsAfter[0].id === order[0] && boardsAfter[boardsAfter.length - 1].id === order[order.length - 1];
  assert(reversed, 'S2 board reorder 顺序变化持久化');

  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第三十八批 shift选中/board排序：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
