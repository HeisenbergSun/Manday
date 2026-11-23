/**
 * 第四十四批 e2e：board 内条目搜索（关键字过滤）
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
  require('./e2e-profile-cleanup')('manday-batch44');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch44-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B44-搜索 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  for (const n of ['需求评审', '前端开发', '后端开发']) await req(auth, 'POST', `/boards/${bid}/items`, { name: n });

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME);
  await sleep(2500);

  // 点击搜索按钮
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('搜索'));
    if (b) b.click();
  });
  await sleep(400);
  assert(await page.$('[data-board-search]'), 'S1 搜索输入框展开');
  // 输入关键字「前端」
  await page.evaluate(() => {
    const input = document.querySelector('[data-board-search]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '前端');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(800);
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-grid-row]')].map((r) => r.textContent));
  const onlyFrontend = rows.length === 1 && rows[0].includes('前端开发');
  assert(onlyFrontend, `S2 搜索「前端」只显示匹配条目（实际 ${rows.length} 行：${rows.join(' / ')}）`);

  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第四十四批 board内搜索：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
