/**
 * 第四十七批 e2e：分析视图 = 自定义 dashboard + widget 复制
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
  require('./e2e-profile-cleanup')('manday-batch47');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch47-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B47-分析 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
  await req(auth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people' });
  await req(auth, 'POST', `/boards/${bid}/items`, { name: '任务1' });

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME);
  await sleep(2500);
  // 切到分析视图
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('分析'));
    if (b) b.click();
  });
  await sleep(2500);

  // S1 分析视图是自定义 dashboard（有添加图表按钮 + 默认 widget）
  const addBtn = await page.$('[data-add-widget]');
  const widgetCount = await page.evaluate(() => document.querySelectorAll('[data-widget]').length);
  assert(!!addBtn && widgetCount >= 1, `S1 分析视图可自定义编辑（widget=${widgetCount}）`);

  // S2 widget 复制
  const before = widgetCount;
  await page.evaluate(() => document.querySelector('[data-widget-dup]')?.click());
  await sleep(1500);
  const after = await page.evaluate(() => document.querySelectorAll('[data-widget]').length);
  assert(after === before + 1, `S2 widget 复制（${before} → ${after}）`);

  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第四十七批 分析视图/widget复制：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
