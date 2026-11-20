/**
 * 第三十六批 e2e：多选批量编辑任意列 + 清除选择
 * S1 勾选 3 行 → 批量工具条出现
 * S2 批量编辑 number 列 → 3 行值统一更新
 * S3 清除选择 → 勾选清空 + 工具条消失
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
  require('./e2e-profile-cleanup')('manday-batch36');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch36-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B36-批量 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // 建 board + number 列 + 3 条目
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  const numCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '工时', type: 'number' })).body;
  for (const n of ['任务A', '任务B', '任务C']) await req(auth, 'POST', `/boards/${bid}/items`, { name: n });

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME);
  await sleep(2500);

  // S1 勾选 3 行
  const checked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-grid-row]')];
    let n = 0;
    for (const r of rows.slice(0, 3)) {
      const cb = r.querySelector('[data-grid-check]');
      if (cb) { cb.click(); n++; }
    }
    return n;
  });
  await sleep(600);
  const barShown = await page.$('[data-batch-bar]');
  assert(checked >= 3 && !!barShown, `S1 勾选 ${checked} 行 + 批量工具条出现`);

  // S2 批量编辑 number 列
  await page.click('[data-batch-edit]');
  await sleep(400);
  assert(await page.$('[data-batch-edit-modal]'), 'S2 批量编辑弹窗出现');
  await page.evaluate((cid) => {
    const sel = document.querySelector('[data-batch-edit-col]');
    if (sel) { sel.value = cid; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, numCol.id);
  await sleep(300);
  await page.evaluate(() => {
    const input = document.querySelector('[data-batch-edit-value]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(300);
  await page.click('[data-batch-edit-apply]');
  // 轮询等待 3 行串行写入完成
  let all8 = false, lastVals = [];
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const det = (await req(auth, 'GET', `/boards/${bid}`)).body;
    lastVals = (det.items ?? []).map((it) => Number(it.values?.[numCol.id]));
    if (lastVals.length === 3 && lastVals.every((v) => v === 8)) { all8 = true; break; }
  }
  assert(all8, `S2 批量编辑 number 列 → 3 行都=8（实际 ${JSON.stringify(lastVals)}）`);

  // S3 清除选择（批量编辑后选中保持，直接清除）
  assert(await page.$('[data-batch-bar]'), 'S3 批量编辑后工具条仍在');
  await page.click('[data-batch-clear]');
  await sleep(600);
  const barGone = !(await page.$('[data-batch-bar]'));
  const unchecked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-grid-row]')];
    return rows.every((r) => !r.querySelector('[data-grid-check]')?.checked);
  });
  assert(barGone && unchecked, 'S3 清除选择后勾选清空 + 工具条消失');

  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第三十六批 批量编辑/清除选择：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
