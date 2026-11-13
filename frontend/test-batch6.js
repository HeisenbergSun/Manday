/**
 * 第六批 e2e：自研表格替换 AG Grid + 列级权限
 * L1 自研表格渲染（行数=条目数、无 ag-grid 残留 DOM）
 * L2 双击单元格编辑落库
 * L3 行选择 + 批量删除（新建→勾选→删除→回收站）
 * L4 拖拽手柄存在
 * L5 列级权限：owner-only 后非 owner 编辑 403；改回 all 恢复
 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch6-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  let expectDenied = false;
  page.on('response', (res) => { if (res.status() >= 400 && !(expectDenied && res.status() === 403)) errors.push('[http ' + res.status() + '] ' + res.request().method() + ' ' + res.url().replace(BASE, '')); });
  page.on('dialog', (d) => { d.accept().catch(() => {}); });
  const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1000);
  for (const b of await page.$$('button')) {
    const t = await b.evaluate((el) => el.textContent || '');
    if (t.includes('一键登录')) { await b.click(); break; }
  }
  await sleep(2000);
  const headers = await page.evaluate(() => ({ Authorization: 'Bearer ' + localStorage.getItem('manday_token') }));

  // ---- L1: 自研表格渲染 ----
  const l1 = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-grid-row]').length,
    agLeftovers: document.querySelectorAll('.ag-row,.ag-cell').length,
  }));
  console.log('L1 grid rows:', JSON.stringify(l1));
  assert(l1.rows > 0, '自研表格没有渲染行');
  assert(l1.agLeftovers === 0, '仍有 AG Grid 残留 DOM');
  console.log('L1 自研表格渲染 PASS');

  // ---- L2: 双击编辑落库 ----
  const myId = await page.evaluate(() => localStorage.getItem('userId'));
  const bid = await page.evaluate(async (h) => {
    const j = await (await fetch('/api/boards', { headers: h })).json();
    return (Array.isArray(j) ? j : j.items)[0].id;
  }, headers);
  const NAME = 'L2编辑' + Date.now();
  await page.evaluate(() => {
    const cell = document.querySelector('[data-grid-cell][data-col="name"]');
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await sleep(400);
  const editor = await page.$('[data-grid-editor]');
  assert(editor, '双击后没有出现编辑输入框');
  await page.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, editor, NAME);
  await page.keyboard.press('Enter');
  await sleep(1500);
  const renamed = await page.evaluate(async (id, h, n) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    return d.items.some((x) => x.name === n);
  }, bid, headers, NAME);
  console.log('L2 rename persisted:', renamed);
  assert(renamed, '改名未落库');
  console.log('L2 双击编辑落库 PASS');

  // ---- L3: 勾选 + 批量删除（新建一条专属条目）----
  const created = await page.evaluate(async (id, h) => {
    const r = await fetch('/api/boards/' + id + '/items', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'L3删除目标' }) });
    return { status: r.status, body: await r.json() };
  }, bid, headers);
  assert(created.status === 200 || created.status === 201, 'L3 建条目失败: ' + created.status);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  const checked = await page.evaluate((n) => {
    const rows = [...document.querySelectorAll('[data-grid-row]')];
    const target = rows.find((r) => r.textContent.includes(n));
    if (!target) return false;
    const cb = target.querySelector('[data-grid-check]');
    if (!cb) return false;
    cb.click();
    return true;
  }, 'L3删除目标');
  await sleep(400);
  assert(checked, 'L3 没勾上目标行');
  const delBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('删除选中')));
  await delBtn.asElement().click();
  await sleep(1500);
  const inTrash = await page.evaluate(async (id, h) => {
    const r = await (await fetch('/api/boards/' + id + '/recycle-bin', { headers: h })).json();
    return (Array.isArray(r) ? r : r.items || []).some((x) => x.name === 'L3删除目标');
  }, bid, headers);
  console.log('L3 inTrash:', inTrash);
  assert(inTrash, '删除后回收站没有该条目');
  // 恢复，避免污染
  await page.evaluate(async (id, h) => {
    const r = await (await fetch('/api/boards/' + id + '/recycle-bin', { headers: h })).json();
    const arr = Array.isArray(r) ? r : r.items || [];
    const t = arr.find((x) => x.name === 'L3删除目标');
    if (t) await fetch('/api/boards/' + id + '/restore', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: [t.id] }) });
  }, bid, headers);
  console.log('L3 勾选批量删除 PASS（已恢复）');

  // ---- L4: 拖拽手柄 ----
  const l4 = await page.evaluate(() => document.querySelectorAll('[data-grid-drag]').length);
  console.log('L4 drag handles:', l4);
  assert(l4 > 0, '没有拖拽手柄');
  console.log('L4 拖拽手柄 PASS');

  // ---- L5: 列级权限 ----
  const dateCol = await page.evaluate(async (id, h) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    const c = d.columns.find((x) => x.type === 'date');
    return { id: c.id, name: c.name, settings: c.settings ?? {} };
  }, bid, headers);
  // 设为 owner-only
  await page.evaluate(async (id, h, col) => {
    await fetch('/api/boards/' + id + '/columns/' + col.id, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { ...col.settings, editable: 'owner' } }) });
  }, bid, headers, dateCol);
  const item = await page.evaluate(async (id, h) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    return { id: d.items[0].id, version: d.items[0].version };
  }, bid, headers);
  expectDenied = true;
  const denied = await page.evaluate(async (h, it, col) => {
    const r = await fetch('/api/items/' + it.id + '/cell', { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId: col.id, value: '2026-12-01', version: it.version }) });
    return r.status;
  }, headers, item, dateCol);
  console.log('L5 owner-only edit status:', denied);
  assert(denied === 403, 'owner-only 列未拦截非 owner 编辑（期望403）: ' + denied);
  // 改回 all → 恢复可编辑
  await page.evaluate(async (id, h, col) => {
    await fetch('/api/boards/' + id + '/columns/' + col.id, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { ...col.settings, editable: 'all' } }) });
  }, bid, headers, dateCol);
  const allowed = await page.evaluate(async (h, it, col) => {
    const r = await fetch('/api/items/' + it.id + '/cell', { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId: col.id, value: null, version: it.version }) });
    return r.status;
  }, headers, item, dateCol);
  expectDenied = false;
  console.log('L5 after unlock status:', allowed);
  assert(allowed === 200 || allowed === 201, '解锁后编辑失败: ' + allowed);
  console.log('L5 列级权限 PASS');

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
