/**
 * 第四十八批 e2e：自定义 dashboard 编辑优化
 * - preview 端点（type+config 直接取数）
 * - 分组图 Top N 条数限制
 * - 数字卡小数位
 * - 编辑弹窗实时预览
 * - dashboard 标题内联重命名
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
  require('./e2e-profile-cleanup')('manday-batch48');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch48-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B48-编辑 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  const stCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' })).body;
  const numCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '金额', type: 'number' })).body;

  const mk = async (name, status, amount) => {
    const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name })).body;
    await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: stCol.id, value: status, version: it.version });
    await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: numCol.id, value: String(amount), version: it.version + 1 });
  };
  await mk('任务A', '待办', 100);
  await mk('任务B', '进行中', 200);
  await mk('任务C', '已完成', 300);

  // S1 preview 端点 + Top N 限制
  const bar = await req(auth, 'POST', '/dashboards/preview', { type: 'bar', config: { boardIds: [bid], groupBy: '状态', metric: 'count', limit: 2 } });
  assert((bar.status === 200 || bar.status === 201) && Array.isArray(bar.body), 'S1a preview bar 返回数组: ' + bar.status);
  assert(bar.body.length <= 2, `S1b Top N=2 生效（返回 ${bar.body.length} 条）`);

  // S2 preview number 多指标 + 小数位由前端格式化（后端返回原始数值）
  const num = await req(auth, 'POST', '/dashboards/preview', { type: 'number', config: { boardIds: [bid], column: '金额', aggs: ['sum', 'avg', 'count'] } });
  const sumItem = (num.body?.items ?? []).find((x) => x.agg === 'sum');
  assert((num.status === 200 || num.status === 201) && Array.isArray(num.body?.items) && num.body.items.length === 3, 'S2a preview number 3 指标: ' + JSON.stringify(num.body?.items?.map((x) => x.agg)));
  assert(sumItem && sumItem.value === 600, 'S2b sum 金额 = 600（实际 ' + sumItem?.value + '）');

  // UI：打开分析视图
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME);
  await sleep(2500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('分析'));
    if (b) b.click();
  });
  await sleep(2500);

  // S3 标题内联重命名
  await page.evaluate(() => document.querySelector('[data-dash-rename]')?.click());
  await sleep(500);
  await page.evaluate(() => { const i = document.querySelector('[data-dash-rename-input]'); if (i) { i.value = ''; i.focus(); } });
  await page.keyboard.type('B48 重命名分析');
  await page.keyboard.press('Enter');
  await sleep(1500);
  const renamed = await page.evaluate(() => document.querySelector('[data-dash-rename]')?.textContent?.trim() ?? '');
  assert(renamed.includes('B48 重命名分析'), `S3 标题重命名成功（${renamed}）`);

  // S4 编辑弹窗实时预览 + Top N 字段
  await page.evaluate(() => document.querySelector('[data-add-widget]')?.click());
  await sleep(800);
  await page.evaluate(() => document.querySelector('[data-widget-type="bar"]')?.click());
  await sleep(600);
  const previewPane = await page.$('[data-widget-preview]');
  assert(!!previewPane, 'S4a 编辑弹窗出现实时预览区');
  const topN = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.textContent.trim() === '显示条数（Top N）'));
  assert(topN, 'S4b bar 类型出现 Top N 条数字段');

  // S5 数字卡小数位字段
  await page.evaluate(() => document.querySelector('[data-widget-type="number"]')?.click());
  await sleep(400);
  const decimals = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.textContent.trim() === '小数位'));
  assert(decimals, 'S5 数字卡出现小数位字段');

  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第四十八批 编辑优化：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
