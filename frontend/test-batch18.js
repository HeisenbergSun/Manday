/**
 * 第十八批 Workload 按日负载热力条 e2e
 * W1 打开 Workload 视图
 * W2 张伟 未来某天热力格 count 聚合正确（同日 2 条）
 * W3 逾期桶（昨日未完成）count=1
 * W4 李娜 单日 count=1
 * W5 点击热力格 → data-workload-day-panel 展开并列出条目名
 * W6 点击面板条目 → 打开详情面板
 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const API = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let errors = [];
const assert = (c, m) => { if (!c) { errors.push(m); console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const req = async (auth, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const dayStr = (offset) => { const d = new Date(new Date().toDateString()); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

(async () => {
    require('./e2e-profile-cleanup')('manday-batch18');
const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch18-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录'));
    if (b) b.click();
  });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // prep：自建板 + people/date/status 列 + 4 条目
  const b = await req(auth, 'POST', '/boards', { name: 'P3-8 Workload 热力', visibility: 'private' });
  const bid = b.body.id;
  const g = (await req(auth, 'GET', `/boards/${bid}`)).body.groups[0];
  const peopleCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people' })).body;
  const dateCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '截止', type: 'date' })).body;
  const statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status',
    settings: { labels: [{ label: '进行中', color: '#fdab3d' }, { label: '已完成', color: '#00c875' }], doneLabels: ['已完成'] } })).body;
  const mkItem = async (name) => (await req(auth, 'POST', `/boards/${bid}/items`, { name, groupId: g.id })).body;
  const setCell = async (itemId, colId, value) => {
    const cur = (await req(auth, 'GET', `/items/${itemId}`)).body;
    const r = await req(auth, 'PATCH', `/items/${itemId}/cell`, { columnId: colId, value, version: cur.version });
    if (r.status >= 300) errors.push(`setCell ${colId} 失败 ${r.status} ${JSON.stringify(r.body)}`);
  };
  const i1 = await mkItem('写接口文档');
  const i2 = await mkItem('评审 PR');
  const i3 = await mkItem('修历史 bug');
  const i4 = await mkItem('准备周报');
  await setCell(i1.id, peopleCol.id, '张伟');
  await setCell(i1.id, dateCol.id, dayStr(2));
  await setCell(i1.id, statusCol.id, '进行中');
  await setCell(i2.id, peopleCol.id, '张伟');
  await setCell(i2.id, dateCol.id, dayStr(2));
  await setCell(i3.id, peopleCol.id, '张伟');
  await setCell(i3.id, dateCol.id, dayStr(-1));
  await setCell(i3.id, statusCol.id, '进行中');
  await setCell(i4.id, peopleCol.id, '李娜');
  await setCell(i4.id, dateCol.id, dayStr(5));

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);

  // W1 打开 Workload 视图
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Workload'));
    b?.click();
  });
  let wl = false;
  for (let i = 0; i < 6 && !wl; i++) { wl = await page.evaluate(() => !!document.querySelector('[data-workload-root]')); if (!wl) await sleep(1000); }
  assert(wl, 'W1 Workload 视图打开');

  // W2 张伟 day+2 热力格 count=2
  const zhang = await page.evaluate((d) => {
    const strip = document.querySelector('[data-workload-heat]');
    const cell = strip?.querySelector(`[data-heat-cell="${d}"]`);
    return cell ? { count: cell.getAttribute('data-heat-count') } : null;
  }, dayStr(2));
  assert(zhang && zhang.count === '2', `W2 张伟 ${dayStr(2)} 热力格 count=2（${JSON.stringify(zhang)}）`);

  // W3 张伟 逾期桶 count=1
  const ov = await page.evaluate(() => {
    const strip = document.querySelector('[data-workload-heat]');
    const cell = strip?.querySelector('[data-heat-cell="overdue"]');
    return cell ? cell.getAttribute('data-heat-count') : null;
  });
  assert(ov === '1', `W3 张伟 逾期桶 count=1（${ov}）`);

  // W4 李娜 day+5 count=1（第 2 行 heat strip）
  const li = await page.evaluate((d) => {
    const strips = [...document.querySelectorAll('[data-workload-heat]')];
    const strip = strips.find((x) => x.getAttribute('data-workload-heat') === '李娜');
    const cell = strip?.querySelector(`[data-heat-cell="${d}"]`);
    return cell ? cell.getAttribute('data-heat-count') : null;
  }, dayStr(5));
  assert(li === '1', `W4 李娜 ${dayStr(5)} 热力格 count=1（${li}）`);

  // W5 点击张伟 day+2 格 → 日面板展开列出条目
  await page.evaluate((d) => {
    const strip = document.querySelector('[data-workload-heat]');
    strip.querySelector(`[data-heat-cell="${d}"]`).click();
  }, dayStr(2));
  await sleep(600);
  const panel = await page.evaluate(() => {
    const p = document.querySelector('[data-workload-day-panel]');
    return p ? { text: p.innerText, items: p.querySelectorAll('div[style*="cursor: pointer"]').length } : null;
  });
  assert(panel && panel.text.includes(dayStr(2)) && panel.text.includes('张伟') && panel.text.includes('2 条'),
    `W5 日面板展开（${panel ? panel.text.split('\n')[0] : 'null'}）`);
  assert(panel && panel.text.includes('写接口文档') && panel.text.includes('评审 PR'), 'W5b 面板列出当日条目名');

  // W6 点击面板条目 → 详情面板打开
  await page.evaluate(() => {
    const p = document.querySelector('[data-workload-day-panel]');
    const row = [...p.querySelectorAll('div')].find((x) => x.textContent === '写接口文档');
    row?.click();
  });
  await sleep(800);
  const detail = await page.evaluate(() => !!document.querySelector('aside, [data-comment-input]'));
  assert(detail, 'W6 点击面板条目打开详情');

  await browser.close();

  // cleanup
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl = await c.query("DELETE FROM boards WHERE name LIKE 'P3-8 %'");
    console.log('  [cleanup] deleted boards:', dl.rowCount);
    await c.end();
  }

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
