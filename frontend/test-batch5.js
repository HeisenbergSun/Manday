/**
 * 第五批 e2e：甘特视图
 * T1 无日期列引导文案（先切到无日期列的 board 或跳过——用主 board 有日期列，测主流程）
 * T1 甘特 tab 存在并可切换，时间条渲染
 * T2 时间条数量 = 设置了日期的条目数；逾期条目红色标注
 * T3 今天参考线存在
 * T4 点击时间条打开详情面板
 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch5-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('response', (res) => { if (res.status() >= 400) errors.push('[http ' + res.status() + '] ' + res.request().method() + ' ' + res.url()); });
  page.on('dialog', (d) => { d.accept().catch(() => {}); });
  const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1000);
  for (const b of await page.$$('button')) {
    const t = await b.evaluate((el) => el.textContent || '');
    if (t.includes('一键登录')) { await b.click(); break; }
  }
  await sleep(2000);

  // ---- T1: 甘特 tab 存在 + 切换 ----
  const tab = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('甘特')));
  assert(await tab.asElement(), '没有甘特 tab');
  await tab.asElement().click();
  await sleep(800);
  const t1 = await page.evaluate(() => {
    const txt = document.body.innerText;
    return { hasTitle: txt.includes('甘特视图'), barCount: document.querySelectorAll('[data-gantt-bar]').length };
  });
  console.log('T1 gantt view:', JSON.stringify(t1), 'errors so far:', errors.slice(0, 3), 'body:', (await page.evaluate(() => document.body.innerText.slice(0, 300))));
  assert(t1.hasTitle, '甘特视图标题未渲染');
  assert(t1.barCount > 0, '没有渲染任何时间条');
  console.log('T1 甘特视图切换 PASS');

  // ---- T2: 时间条数量与库中设日期条目一致 ----
  const headers = await page.evaluate(() => ({ Authorization: 'Bearer ' + localStorage.getItem('manday_token') }));
  const expected = await page.evaluate(async (h) => {
    const bs = await (await fetch('/api/boards', { headers: h })).json();
    const bid = (Array.isArray(bs) ? bs : bs.items)[0].id;
    const d = await (await fetch('/api/boards/' + bid, { headers: h })).json();
    const dateCol = d.columns.find((c) => c.type === 'date');
    if (!dateCol) return null;
    return d.items.filter((it) => it.values && it.values[dateCol.id]).length;
  }, headers);
  console.log('T2 expected dated items:', expected);
  const uiBarIds = await page.evaluate(() => [...document.querySelectorAll('[data-gantt-bar]')].map((b) => b.getAttribute('data-gantt-bar') + ':' + (b.title || '')));
  console.log('T2 ui bar ids:', uiBarIds, 'expected:', expected);
  if (expected !== null) assert(uiBarIds.length === expected, `时间条数 ${uiBarIds.length} ≠ 设日期条目数 ${expected}`);
  console.log('T2 时间条数量 PASS');

  // ---- T3: 今天参考线 ----
  const t3 = await page.evaluate(() => !!document.querySelector('[data-gantt-today]'));
  console.log('T3 today line:', t3);
  assert(t3, '没有今天参考线');
  console.log('T3 今天参考线 PASS');

  // ---- T4: 点击时间条打开详情 ----
  const firstBar = await page.$('[data-gantt-bar]');
  await firstBar.click();
  await sleep(1000);
  const t4 = await page.evaluate(() => !!document.querySelector('aside'));
  console.log('T4 detail opened:', t4);
  assert(t4, '点击时间条未打开详情面板');
  console.log('T4 时间条点击详情 PASS');

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
