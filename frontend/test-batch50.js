/**
 * 第五十批 e2e：筛选条件细化 — 预选项（状态/多选/人员下拉）+ 日期快捷筛选 + 时间段/范围
 * S1  状态列筛选：值控件为预选下拉（含标签选项），选「待办」过滤到 2 行
 * S2  日期列「是今天」快捷筛选：命中 1 行
 * S3  日期列「时间段内」：起始/结束双日期，命中 3 行
 * S4  数值列「范围内」：min/max 双输入，命中 2 行
 * S5  日期列「未到期」快捷筛选：命中 1 行
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

// 本地时区日期格式化（与前端 localToday 保持一致）
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return fmt(d); };

(async () => {
  require('./e2e-profile-cleanup')('manday-batch50');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch50-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B50-筛选细化 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  const stCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' })).body;
  const numCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '金额', type: 'number' })).body;
  const dateCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '日期', type: 'date' })).body;

  // 日期：今天 / 昨天 / 明天 / 约上月（明确超出本周/本月/7天/30天）
  const today = new Date();
  const todayStr = fmt(today);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const lastMonth = addDays(today, -35);

  const mk = async (name, status, amount, date) => {
    const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name })).body;
    let ver = it.version;
    if (status) { const r = await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: stCol.id, value: status, version: ver }); ver = r.body?.version ?? ver + 1; }
    if (amount != null) { const r = await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: numCol.id, value: String(amount), version: ver }); ver = r.body?.version ?? ver + 1; }
    if (date) { await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: dateCol.id, value: date, version: ver }); }
    return it;
  };
  const itA = await mk('任务A', '待办', 100, todayStr);   // 今天
  const itB = await mk('任务B', '进行中', 200, yesterday); // 昨天
  const itC = await mk('任务C', '已完成', 300, lastMonth); // 上月
  const itD = await mk('任务D', '待办', 400, tomorrow);    // 明天

  // 回读确认日期值格式为 YYYY-MM-DD
  const chkA = (await req(auth, 'GET', `/items/${itA.id}`)).body;
  assert(String(chkA?.values?.[dateCol.id]) === todayStr, `S0 日期值格式 YYYY-MM-DD（${chkA?.values?.[dateCol.id]}）`);

  // 打开 board 表格视图
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME);
  await sleep(2500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('表格'));
    if (b) b.click();
  });
  await sleep(2000);

  // 打开筛选弹窗
  await page.evaluate(() => document.querySelector('[data-filter-toolbar]')?.click());
  await sleep(600);
  assert(!!(await page.$('[data-filter-popover]')), 'S0 筛选弹窗打开');

  // 辅助：重置为单条件
  const resetFilter = async () => {
    await page.evaluate(() => document.querySelector('[data-filter-pop-clear]')?.click());
    await sleep(250);
    await page.evaluate(() => document.querySelector('[data-filter-pop-add]')?.click());
    await sleep(350);
  };
  const setCol = async (colId) => {
    await page.select('select[data-filter-pop-col]', colId);
    await sleep(400);
  };
  const rowCount = () => page.evaluate(() => document.querySelectorAll('[data-grid-row]').length);
  // 用原生 setter 设置受控 input 值（绕过 React value tracker）
  const setInput = (selector, value) => page.evaluate(({ sel, val }) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const el = document.querySelector(sel);
    if (el) { setter.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, { sel: selector, val: value });

  // ── S1 状态列：预选下拉 ──
  await resetFilter();
  await setCol(stCol.id);
  const stValSel = await page.$('select[data-filter-pop-val]');
  assert(!!stValSel, 'S1a 状态列值控件为预选下拉（select）');
  const stOpts = await page.evaluate(() => [...document.querySelectorAll('select[data-filter-pop-val] option')].map((o) => o.textContent));
  assert(stOpts.includes('待办') && stOpts.includes('进行中') && stOpts.includes('已完成'), `S1b 下拉含标签预选项（${stOpts.join('/')}）`);
  await page.select('select[data-filter-pop-val]', '待办');
  await sleep(600);
  const s1 = await rowCount();
  assert(s1 === 2, `S1c 状态=待办 过滤到 2 行（实际 ${s1}）`);

  // ── S2 日期列「是今天」快捷筛选 ──
  await resetFilter();
  await setCol(dateCol.id);
  const opToday = await page.evaluate(() => document.querySelector('select[data-filter-pop-op]')?.value);
  assert(opToday === 'is_today', `S2a 日期列默认操作符=是今天（${opToday}）`);
  await sleep(600);
  const s2 = await rowCount();
  assert(s2 === 1, `S2b 日期=是今天 命中 1 行（实际 ${s2}）`);

  // ── S3 日期列「时间段内」双日期 ──
  await resetFilter();
  await setCol(dateCol.id);
  await page.select('select[data-filter-pop-op]', 'between');
  await sleep(400);
  const hasStart = await page.$('input[data-filter-pop-val]');
  const hasEnd = await page.$('input[data-filter-pop-val2]');
  assert(!!hasStart && !!hasEnd, 'S3a 时间段内出现起始/结束两个日期输入');
  await setInput('input[data-filter-pop-val]', yesterday);
  await setInput('input[data-filter-pop-val2]', tomorrow);
  await sleep(600);
  const s3 = await rowCount();
  assert(s3 === 3, `S3b 日期区间[昨天,明天] 命中 3 行（实际 ${s3}）`);

  // ── S4 数值列「范围内」双输入 ──
  await resetFilter();
  await setCol(numCol.id);
  const numOps = await page.evaluate(() => [...document.querySelectorAll('select[data-filter-pop-op] option')].map((o) => o.value));
  assert(numOps.includes('between'), `S4a 数值列操作符含「范围内」（${numOps.includes('between') ? '有' : '无'}）`);
  await page.select('select[data-filter-pop-op]', 'between');
  await sleep(400);
  await setInput('input[data-filter-pop-val]', '150');
  await setInput('input[data-filter-pop-val2]', '350');
  await sleep(600);
  const s4 = await rowCount();
  assert(s4 === 2, `S4b 金额区间[150,350] 命中 2 行（实际 ${s4}）`);

  // ── S5 日期列「未到期」快捷筛选 ──
  await resetFilter();
  await setCol(dateCol.id);
  await page.select('select[data-filter-pop-op]', 'is_future');
  await sleep(600);
  const s5 = await rowCount();
  assert(s5 === 1, `S5 日期=未到期（未来）命中 1 行（实际 ${s5}）`);

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第五十批 筛选条件细化（预选项/日期快捷/时间段/范围）：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
