/**
 * 第五十四批 e2e：条目列拖宽 + 通知铃铛点击外部关闭
 * S1  表格「条目」列右边缘拖拽 → 列宽增加
 * S2  通知铃铛弹窗：点击外部区域后自动关闭
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
  require('./e2e-profile-cleanup')('manday-batch54');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch54-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B54-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // ── S1 条目列拖宽 ──
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
  await req(auth, 'POST', `/boards/${bid}/items`, { name: '条目一' });

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((n) => document.querySelector(`[data-board-item="${n}"]`)?.click(), NAME);
  await sleep(2500);

  const nameTh = await page.$('thead th[data-col="name"]');
  assert(!!nameTh, 'S1 定位到「条目」列表头');
  const wBefore = await page.evaluate((el) => el.offsetWidth, nameTh);
  const handle = await page.$('thead th[data-col="name"] [data-col-resize]');
  assert(!!handle, 'S1 定位到条目列 resize 手柄');
  const box = await handle.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 10 });
  await page.mouse.up();
  await sleep(800);
  const wAfter = await page.evaluate((el) => el.offsetWidth, nameTh);
  assert(wAfter > wBefore + 50, `S1 拖右边缘后条目列宽增加（${wBefore} → ${wAfter}px）`);

  // ── S2 通知铃铛点击外部关闭 ──
  await page.click('[data-bell]');
  await sleep(400);
  const openBefore = await page.$('[data-notif-popover]');
  assert(!!openBefore, 'S2a 点击铃铛打开通知弹窗');
  // 点击外部区域（header 标题 Manday logo 处，位于铃铛弹窗之外）
  await page.evaluate(() => {
    const t = document.querySelector('header');
    t?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await sleep(400);
  const openAfter = await page.$('[data-notif-popover]');
  assert(!openAfter, 'S2b 点击外部区域后通知弹窗自动关闭');

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第五十四批 条目列拖宽 + 铃铛点击外部关闭：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
