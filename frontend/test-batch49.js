/**
 * 第四十九批 e2e：看板点开 item 编辑 + 表格筛选弹窗 + widget 颜色主题/聚合
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
  require('./e2e-profile-cleanup')('manday-batch49');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch49-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B49-编辑 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  const stCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' })).body;
  const txtCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '备注', type: 'text' })).body;
  const numCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '金额', type: 'number' })).body;
  const dateCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '日期', type: 'date' })).body;

  const mk = async (name, status, amount, date) => {
    const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name })).body;
    let ver = it.version;
    if (status) { const r = await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: stCol.id, value: status, version: ver }); ver = r.body?.version ?? ver + 1; }
    if (amount != null) { const r = await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: numCol.id, value: String(amount), version: ver }); ver = r.body?.version ?? ver + 1; }
    if (date) { await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: dateCol.id, value: date, version: ver }); }
    return it;
  };
  const itA = await mk('任务A', '待办', 100, '2026-11-10');
  const itB = await mk('任务B', '进行中', 200, '2026-11-12');

  // S3 preview：line 按日期 sum 金额 + widget theme 保存
  const line = await req(auth, 'POST', '/dashboards/preview', { type: 'line', config: { boardIds: [bid], dateColumn: '日期', metric: 'sum', metricColumn: '金额' } });
  const lineSum = (line.body ?? []).reduce((s, x) => s + (Number(x.value) || 0), 0);
  assert(lineSum === 300, `S3 line sum 聚合 = 300（实际 ${lineSum}）`);

  const dash = await req(auth, 'POST', '/dashboards', { name: 'B49 盘' });
  const did = dash.body.id;
  const w = await req(auth, 'POST', `/dashboards/${did}/widgets`, { type: 'bar', title: '主题测试', config: { boardIds: [bid], groupBy: '状态', metric: 'count', theme: 'ocean' } });
  assert(w.body?.config?.theme === 'ocean', 'S4 widget 颜色主题 theme=ocean 已保存');

  // UI：打开 board，切看板视图，点卡片
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME);
  await sleep(2500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('看板'));
    if (b) b.click();
  });
  await sleep(2500);

  // S1 看板点开 item 详情（信息 tab 编辑）
  await page.evaluate((id) => document.querySelector(`[data-kanban-card="${id}"]`)?.click(), itA.id);
  await sleep(2000);
  const detailOpen = await page.$('[data-item-detail]');
  assert(!!detailOpen, 'S1a 看板点卡片打开条目详情');
  const infoTab = await page.$('[data-item-info]');
  assert(!!infoTab, 'S1b 详情默认信息 tab（可编辑字段）');

  // 改名
  await page.evaluate(() => document.querySelector('[data-item-name]')?.click());
  await sleep(400);
  await page.evaluate(() => { const i = document.querySelector('[data-item-name-input]'); if (i) { i.value = ''; i.focus(); } });
  await page.keyboard.type('任务A-已改名');
  await page.keyboard.press('Enter');
  await sleep(1200);
  const renamedItem = (await req(auth, 'GET', `/items/${itA.id}`)).body;
  assert(renamedItem?.name === '任务A-已改名', `S1c 详情内改名成功（${renamedItem?.name}）`);

  // 改状态字段
  const fieldSel = await page.$(`[data-item-field="${stCol.id}"] select`);
  assert(!!fieldSel, 'S1d 状态字段可编辑控件存在');
  if (fieldSel) {
    await page.select(`[data-item-field="${stCol.id}"] select`, '已完成');
    await sleep(1200);
    const updated = (await req(auth, 'GET', `/items/${itA.id}`)).body;
    assert(String(updated?.values?.[stCol.id]) === '已完成', `S1e 详情内改状态成功（${updated?.values?.[stCol.id]}）`);
  }

  // 关闭详情，切回表格，测筛选弹窗
  await page.evaluate(() => document.querySelector('[data-item-detail] button')?.click());
  await sleep(600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('表格'));
    if (b) b.click();
  });
  await sleep(2000);

  // S2 表格筛选弹窗
  await page.evaluate(() => document.querySelector('[data-filter-toolbar]')?.click());
  await sleep(600);
  const popover = await page.$('[data-filter-popover]');
  assert(!!popover, 'S2a 筛选按钮在成员后，点击弹出筛选弹窗');
  await page.evaluate(() => document.querySelector('[data-filter-pop-add]')?.click());
  await sleep(400);
  // 默认列 name，输入值「任务B」（只匹配一个）
  await page.evaluate(() => { const i = document.querySelector('[data-filter-pop-val]'); if (i) { i.focus(); } });
  await page.keyboard.type('任务B');
  await sleep(800);
  const rowCount = await page.evaluate(() => document.querySelectorAll('[data-grid-row]').length);
  assert(rowCount === 1, `S2b 筛选弹窗输入条件过滤到 1 行（实际 ${rowCount}）`);

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);
  await req(auth, 'DELETE', `/dashboards/${did}`);

  console.log('\n===== 第四十九批 看板编辑/筛选弹窗/主题聚合：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
