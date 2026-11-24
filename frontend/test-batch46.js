/**
 * 第四十六批 e2e：日历视图滚轮切换 + 持续时间跨度显示
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
  require('./e2e-profile-cleanup')('manday-batch46');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch46-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B46-日历 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // 建 board + 开始日期 + 截止日期 + 条目（跨度 12-01 ~ 12-05）
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  const startCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '开始日期', type: 'date' })).body;
  const endCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '截止日期', type: 'date' })).body;
  const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '跨周任务' })).body;
  const fresh = (await req(auth, 'GET', `/items/${it.id}`)).body;
  await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: startCol.id, value: '2026-11-20', version: fresh.version });
  await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: endCol.id, value: '2026-11-24', version: fresh.version + 1 });

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME);
  await sleep(2500);
  // 切到日历视图
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('日历'));
    if (b) b.click();
  });
  await sleep(1500);

  // S1 跨度显示：12-01 ~ 12-05 每一天都有该条目
  const spanDays = await page.evaluate(() => {
    const keys = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'];
    return keys.map((k) => {
      const cell = document.querySelector(`[data-cal-day="${k}"]`);
      return !!cell && cell.textContent.includes('跨周任务');
    });
  });
  assert(spanDays.every(Boolean), `S1 跨度显示（11-20~11-24 各天：${spanDays.join(',')}）`);

  // S2 滚轮切换月份
  const before = await page.evaluate(() => {
    const b = [...document.querySelectorAll('b')].find((x) => x.textContent.includes('年') && x.textContent.includes('月'));
    return b?.textContent ?? '';
  });
  await page.evaluate(() => {
    const grid = document.querySelector('[data-cal-day]')?.parentElement;
    grid?.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
  });
  await sleep(600);
  const after = await page.evaluate(() => {
    const b = [...document.querySelectorAll('b')].find((x) => x.textContent.includes('年') && x.textContent.includes('月'));
    return b?.textContent ?? '';
  });
  assert(before !== after, `S2 滚轮切换月份（${before} → ${after}）`);

  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第四十六批 日历滚轮/跨度：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
