/**
 * 第四十五批 e2e：甘特视图今天参考线动态高度
 * 验证今天线高度随条目数增长（不再是固定可视高度）
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
  require('./e2e-profile-cleanup')('manday-batch45');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch45-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B45-甘特 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // 建 board + 日期列 + 20 个条目（让内容超过可视高度）
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  const dcol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '截止日期', type: 'date' })).body;
  for (let i = 0; i < 20; i++) {
    const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '任务' + i })).body;
    const fresh = (await req(auth, 'GET', `/items/${it.id}`)).body;
    await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: dcol.id, value: '2026-12-' + String(10 + (i % 15)).padStart(2, '0'), version: fresh.version });
  }

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME);
  await sleep(2500);
  // 切到甘特视图
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('甘特'));
    if (b) b.click();
  });
  await sleep(1500);
  const info = await page.evaluate(() => {
    const t = document.querySelector('[data-gantt-today]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { height: Math.round(r.height), containerHeight: Math.round(t.parentElement.getBoundingClientRect().height) };
  });
  assert(info && info.height >= 600, `S1 今天线高度随内容增长（实际 ${info?.height}px，容器 ${info?.containerHeight}px）`);

  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第四十五批 甘特今天线：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
