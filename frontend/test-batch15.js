/**
 * 第十五批 P3-1 甘特依赖 e2e
 * D1 dependency 列创建（API）
 * D2 Grid 前置格渲染「⤴ 前置名」（data-dep-cell）
 * D3 双击出现选择编辑器（DependencyEditor）
 * D4 Gantt 渲染 SVG 连线（[data-dep-arrow] count >= 1）
 * D5 前置未完成时后置条目 data-gantt-blocked="1" + 文字含「阻塞中」
 * D6 前置标记完成后 blocked 消失
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

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch15-' + Date.now(),
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

  // prep：自建板 + 2 个日期列 + dependency 列 + 前置/后置两条目
  const b = await req(auth, 'POST', '/boards', { name: 'P3-1 甘特依赖', visibility: 'private' });
  const bid = b.body.id;
  const cS = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '开始', type: 'date' })).body;
  const cE = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '截止', type: 'date' })).body;
  const cD = await req(auth, 'POST', `/boards/${bid}/columns`, { name: '前置任务', type: 'dependency' });
  assert(cD.status === 200 || cD.status === 201, `D1 dependency 列创建（status=${cD.status}）`);
  const depId = cD.body.id;
  const st = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status', settings: { labels: [{ label: '待办', color: '#8a90a3' }, { label: '完成', color: '#6fbf9a' }], doneLabels: ['完成'] } })).body;

  const g = (await req(auth, 'GET', `/boards/${bid}`)).body.groups[0];
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const dS = new Date(today.getTime() - 5 * 86400000);
  const dE = new Date(today.getTime() + 2 * 86400000);
  const pre = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '前置任务A', groupId: g.id })).body;
  const post = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '后置任务B', groupId: g.id })).body;
  const ver = { pre: pre.version, post: post.version };
  await req(auth, 'PATCH', `/items/${pre.id}/cell`, { columnId: cS.id, value: fmt(dS), version: ver.pre });
  ver.pre = (await req(auth, 'GET', `/items/${pre.id}`)).body.version;
  await req(auth, 'PATCH', `/items/${pre.id}/cell`, { columnId: cE.id, value: fmt(dE), version: ver.pre });
  await req(auth, 'PATCH', `/items/${post.id}/cell`, { columnId: cS.id, value: fmt(new Date(today.getTime() + 2 * 86400000)), version: ver.post });
  ver.post = (await req(auth, 'GET', `/items/${post.id}`)).body.version;
  await req(auth, 'PATCH', `/items/${post.id}/cell`, { columnId: cE.id, value: fmt(new Date(today.getTime() + 8 * 86400000)), version: ver.post });
  ver.post = (await req(auth, 'GET', `/items/${post.id}`)).body.version;

  // D2 写入前置 cell（前置条目 id）
  const setDep = await req(auth, 'PATCH', `/items/${post.id}/cell`, { columnId: depId, value: pre.id, version: ver.post });
  assert(setDep.status === 200, `D2 前置 cell 写入条目 id（status=${setDep.status}）`);

  // 打开看板（App 默认打开最新建板）
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);

  // D3 Grid 前置格渲染「⤴ 前置名」
  let depCells = [];
  for (let i = 0; i < 8; i++) {
    depCells = await page.evaluate(() => [...document.querySelectorAll('[data-dep-cell]')].map((x) => x.textContent.trim()));
    if (depCells.length) break;
    await sleep(1000);
  }
  assert(depCells.some((t) => t.includes('⤴') && t.includes('前置任务A')), `D3 Grid 前置格渲染（${depCells.join('|')}）`);

  // D4 双击出现选择编辑器
  await page.evaluate(() => document.querySelector('[data-dep-cell]').closest('td').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(600);
  const editorOk = await page.evaluate(() => {
    const ed = document.querySelector('[data-grid-editor]');
    return ed ? ed.tagName === 'SELECT' : false;
  });
  assert(editorOk, 'D4 双击前置格出现选择编辑器');
  await page.keyboard.press('Escape');
  await sleep(300);

  // 切到甘特视图
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, [role="tab"], .view-tab, [class*="tab"]')].find((x) => x.textContent.includes('甘特'));
    if (btn) btn.click();
  });
  await sleep(1500);

  // D5 SVG 连线
  let arrowCount = 0;
  for (let i = 0; i < 8; i++) {
    arrowCount = await page.evaluate(() => document.querySelectorAll('[data-dep-arrow]').length);
    if (arrowCount >= 1) break;
    await sleep(1000);
  }
  assert(arrowCount >= 1, `D5 Gantt SVG 依赖连线 count=${arrowCount}`);

  // D5b 阻塞样式
  let blockedInfo = { blocked: 0, text: '' };
  for (let i = 0; i < 8; i++) {
    blockedInfo = await page.evaluate(() => {
      const el = document.querySelector('[data-gantt-blocked="1"]');
      return { blocked: el ? 1 : 0, text: el ? el.textContent : '' };
    });
    if (blockedInfo.blocked) break;
    await sleep(1000);
  }
  assert(blockedInfo.blocked === 1 && blockedInfo.text.includes('阻塞中'), `D5b 前置未完成 → 阻塞提示（text=${blockedInfo.text.slice(0, 50)}）`);

  // D6 前置标记完成后 blocked 消失
  const stCol = st;
  if (stCol) {
    const doneLabel = '完成';
    const v = (await req(auth, 'GET', `/items/${pre.id}`)).body.version;
    await req(auth, 'PATCH', `/items/${pre.id}/cell`, { columnId: stCol.id, value: doneLabel, version: v });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button, [role="tab"], .view-tab, [class*="tab"]')].find((x) => x.textContent.includes('甘特'));
      if (btn) btn.click();
    });
    await sleep(1500);
    const blockedAfter = await page.evaluate(() => document.querySelectorAll('[data-gantt-blocked="1"]').length);
    assert(blockedAfter === 0, `D6 前置完成后阻塞消失（blocked=${blockedAfter}）`);
  } else {
    assert(false, 'D6 板上无 status 列，跳过失败');
  }

  await browser.close();

  // cleanup
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl = await c.query("DELETE FROM boards WHERE name LIKE 'P3-1 %'");
    console.log('  [cleanup] deleted boards:', dl.rowCount);
    await c.end();
  }

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
