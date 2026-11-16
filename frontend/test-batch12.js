/**
 * 第十二批 P2-3 Formula 列 e2e
 * F1 formula 列创建 + detail 注入计算值（缺引用 → 空）
 * F2 SUM({列}) 聚合子条目 / 无子条目回退本行值；getBoardItems 同样注入
 * F3 COUNT({列}) 返回子条目数
 * F4 updateCell 拒写 formula 列（400）
 * F5 坏公式 addColumn 拒绝
 * F6 UI：ƒx 徽标 + data-formula-cell 只读渲染 + 点击不进入编辑
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

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

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch12-' + Date.now(),
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
  const devToken = await page.evaluate(() => localStorage.getItem('manday_token'));
  const auth = 'Bearer ' + devToken;
  assert(!!devToken, 'F0 一键登录拿到 token');

  // ---- prep：自建 dev-owned 板 ----
  const br = await req(auth, 'POST', '/boards', { name: 'P2-3 公式验证', visibility: 'private' });
  const bid = br.body.id;
  assert(!!bid, 'prep 建板: ' + br.status);
  const numCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '数量', type: 'number' })).body;
  const priceCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '单价', type: 'number' })).body;

  // F5 坏公式拒绝
  const bad = await req(auth, 'POST', `/boards/${bid}/columns`, { name: '坏公式', type: 'formula', settings: { formula: '{数量} + (' } });
  assert(bad.status === 400 || bad.status === 500, 'F5 坏公式建列被拒（status=' + bad.status + '）');

  // F1 好公式建列
  const f1 = await req(auth, 'POST', `/boards/${bid}/columns`, { name: '总价', type: 'formula', settings: { formula: '{数量} * {单价} * 1.1' } });
  assert(f1.status === 200 || f1.status === 201, 'F1 formula 列创建（status=' + f1.status + '）');

  // 数据：3 父条目，第一个带 2 个子条目
  const g = (await req(auth, 'GET', `/boards/${bid}`)).body.groups[0];
  const setCell = async (it, colId, value) => {
    const cur = (await req(auth, 'GET', `/items/${it.id}`)).body;
    await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: colId, value, version: cur.version ?? it.version });
  };
  const mk = async (name, q, p) => {
    const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name, groupId: g.id })).body;
    if (q !== null) await setCell(it, numCol.id, q);
    await setCell(it, priceCol.id, p);
    return it;
  };
  const parent1 = await mk('F任务1', 10, 2);
  await mk('F任务2', null, 5);
  await mk('F任务3', 4, 3);
  const s1 = (await req(auth, 'POST', `/items/${parent1.id}/subitems`, { name: '子1' })).body;
  const s2 = (await req(auth, 'POST', `/items/${parent1.id}/subitems`, { name: '子2' })).body;
  await setCell(s1, numCol.id, 1);
  await setCell(s2, numCol.id, 2);

  // F1 detail 注入
  const det = (await req(auth, 'GET', `/boards/${bid}`)).body;
  const findVal = (name) => det.items.find((i) => i.name === name)?.values?.[f1.body.id];
  assert(findVal('F任务1') === '22' && findVal('F任务3') === '13.2',
    `F1a 公式值注入（任务1=${findVal('F任务1')} 任务3=${findVal('F任务3')}）`);
  assert(findVal('F任务2') === undefined || findVal('F任务2') === null, 'F1b 缺引用值 → 空');

  // F4 拒写
  const w = await req(auth, 'PATCH', `/items/${parent1.id}/cell`, { columnId: f1.body.id, value: 999, version: 1 });
  assert(w.status === 400, 'F4 公式列拒写 400（status=' + w.status + '）');

  // F2/F3 SUM/COUNT
  const f2 = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '数量合计', type: 'formula', settings: { formula: 'SUM({数量})' } })).body;
  const f3 = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '子任务数', type: 'formula', settings: { formula: 'COUNT({数量})' } })).body;
  const det2 = (await req(auth, 'GET', `/boards/${bid}`)).body;
  const it1 = det2.items.find((i) => i.name === 'F任务1');
  const it2r = det2.items.find((i) => i.name === 'F任务2');
  const it3r = det2.items.find((i) => i.name === 'F任务3');
  assert(it1?.values?.[f2.id] === '3', `F2a SUM 聚合子条目=3（实际 ${it1?.values?.[f2.id]}）`);
  assert(it3r?.values?.[f2.id] === '4', `F2b SUM 无子条目回退本行=4（实际 ${it3r?.values?.[f2.id]}）`);
  assert(it2r?.values?.[f2.id] === undefined || it2r?.values?.[f2.id] === null, `F2d 引用缺失 SUM → 空（实际 ${it2r?.values?.[f2.id]}）`);
  assert(it1?.values?.[f3.id] === '2', `F3a COUNT 子条目=2（实际 ${it1?.values?.[f3.id]}）`);
  assert(it2r?.values?.[f3.id] === '0', `F3b COUNT 无子条目=0（实际 ${it2r?.values?.[f3.id]}）`);
  const gi1 = (await req(auth, 'GET', `/boards/${bid}/items`)).body.items.find((i) => i.name === 'F任务1');
  assert(gi1?.values?.[f2.id] === '3', `F2c getBoardItems 注入（实际 ${gi1?.values?.[f2.id]}）`);

  // ---- F6 UI：reload 打开最新板 ----
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);
  const fxCount = await page.evaluate(() => [...document.querySelectorAll('th span')].filter((x) => x.textContent.trim() === 'ƒx').length);
  assert(fxCount >= 3, `F6a 表头 ƒx 徽标（count=${fxCount}）`);
  let cells = [];
  for (let i = 0; i < 8; i++) {
    cells = await page.evaluate(() => [...document.querySelectorAll('[data-formula-cell]')].map((x) => x.textContent.trim()));
    if (cells.length) break;
    await sleep(1000);
  }
  assert(cells.some((t) => t.includes('22')), `F6b 公式单元格只读渲染（${cells.slice(0, 6).join('|')}）`);
  await page.evaluate(() => document.querySelector('[data-formula-cell]').click());
  await sleep(400);
  const editors = await page.evaluate(() => document.querySelectorAll('[data-grid-editor]').length);
  assert(editors === 0, `F6c 点击公式格不进入编辑（editors=${editors}）`);

  await browser.close();

  // ---- cleanup：PG 级联删测试板 ----
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl = await c.query("DELETE FROM boards WHERE name LIKE 'P2-3 %'");
    console.log('  [cleanup] deleted boards:', dl.rowCount);
    await c.end();
  }

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
