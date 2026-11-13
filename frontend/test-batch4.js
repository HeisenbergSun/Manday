const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch4-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('response', (res) => { if (res.status() >= 400) errors.push('[http ' + res.status() + '] ' + res.request().method() + ' ' + res.url()); });
  page.on('dialog', (d) => { console.log('  [dialog]', d.message()); d.accept().catch(() => {}); });
  const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1000);
  for (const b of await page.$$('button')) {
    const t = await b.evaluate((el) => el.textContent || '');
    if (t.includes('一键') || t.includes('开发登录')) { await b.click(); break; }
  }
  await sleep(2000);
  const headers = await page.evaluate(() => ({ Authorization: 'Bearer ' + localStorage.getItem('manday_token') }));
  const bid = await page.evaluate(async (h) => {
    const j = await (await fetch('/api/boards', { headers: h })).json();
    return (Array.isArray(j) ? j : j.items)[0].id;
  }, headers);

  // 记录排序前顺序
  const orderBefore = await page.evaluate(async (id, h) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    return d.items.slice(0, 3).map((x) => x.id);
  }, bid, headers);
  console.log('order before:', orderBefore.length, 'items');

  // ---- K1: 成员列表 API ----
  const k1 = await page.evaluate(async (id, h) => {
    const r = await fetch('/api/boards/' + id + '/members', { headers: h });
    return { status: r.status, body: await r.json() };
  }, bid, headers);
  console.log('K1 members:', JSON.stringify(k1).slice(0, 200));
  assert(k1.status === 200, 'members API 失败: ' + k1.status);
  assert(Array.isArray(k1.body) && k1.body.length >= 1, '成员列表为空');
  assert(k1.body.some((m) => m.role === 'owner'), '没有 owner');
  console.log('K1 成员列表 PASS');

  // ---- K2: 添加成员 + 改角色 + 移除 ----
  const users = await page.evaluate(async (h) => {
    const r = await fetch('/api/users', { headers: h });
    return await r.json();
  }, headers);
  assert(Array.isArray(users) && users.length > 0, 'users 列表为空');
  const myId = await page.evaluate(() => localStorage.getItem('userId'));
  const existing = k1.body.map((m) => m.id).concat(myId);
  const candidate = users.find((u) => !existing.includes(u.id));
  assert(candidate, '没有可添加的新用户（排除自己后）');
  const k2add = await page.evaluate(async (id, h, uid) => {
    const r = await fetch('/api/boards/' + id + '/members', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: uid, role: 'viewer' }) });
    return { status: r.status };
  }, bid, headers, candidate.id);
  console.log('K2 add member:', JSON.stringify(k2add));
  assert(k2add.status === 200 || k2add.status === 201, '添加成员失败');
  // 改角色
  const k2role = await page.evaluate(async (id, h, uid) => {
    const r = await fetch('/api/boards/' + id + '/members', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: uid, role: 'editor' }) });
    return { status: r.status, body: await r.text() };
  }, bid, headers, candidate.id);
  console.log('K2 change role:', JSON.stringify(k2role));
  assert(k2role.status === 200 || k2role.status === 201, '改角色失败: ' + k2role.status);
  // members 里能看到新角色
  const k2list = await page.evaluate(async (id, h) => {
    const r = await (await fetch('/api/boards/' + id + '/members', { headers: h })).json();
    return r;
  }, bid, headers);
  const added = k2list.find((m) => m.id === candidate.id);
  assert(added && added.role === 'editor', '角色未更新');
  // 移除
  const k2rm = await page.evaluate(async (id, h, uid) => {
    const r = await fetch('/api/boards/' + id + '/members/' + uid, { method: 'DELETE', headers: h });
    return r.status;
  }, bid, headers, candidate.id);
  assert(k2rm === 200, '移除成员失败: ' + k2rm);
  console.log('K2 添加/改角色/移除成员 PASS');

  // ---- K3: 成员 UI 弹窗 ----
  const memBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('成员')));
  await memBtn.asElement().click();
  await sleep(1000);
  const k3 = await page.evaluate(() => {
    const txt = document.body.innerText;
    return { hasTitle: txt.includes('成员与权限'), hasOwner: txt.includes('负责人'), hasAdd: txt.includes('添加成员'), candidates: (txt.match(/internal/g) || []).length };
  });
  console.log('K3 members modal:', JSON.stringify(k3));
  assert(k3.hasTitle && k3.hasOwner && k3.hasAdd, '成员弹窗未正常渲染');
  console.log('K3 成员 UI PASS');

  // ---- K4: reorder API ----
  const itemsNow = await page.evaluate(async (id, h) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    return d.items.slice(0, 2).map((x) => ({ id: x.id }));
  }, bid, headers);
  const k4 = await page.evaluate(async (h, orders) => {
    const r = await fetch('/api/items/reorder', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ orders }) });
    return { status: r.status, body: await r.json() };
  }, headers, itemsNow.map((x, i) => ({ id: x.id, position: (i + 1) * 5000 })));
  console.log('K4 reorder:', JSON.stringify(k4));
  assert((k4.status === 200 || k4.status === 201) && k4.body.updated === itemsNow.length, 'reorder 失败');
  // 验证 position 真的变了
  const posAfter = await page.evaluate(async (id, h, itemId) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    return d.items.find((x) => x.id === itemId).position;
  }, bid, headers, itemsNow[0].id);
  assert(posAfter === 5000, 'position 未落库: ' + posAfter);
  console.log('K4 排序落库 PASS');

  // ---- K5: 表格行拖拽（rowDrag handle 存在）----
  const k5 = await page.evaluate(() => {
    return { dragHandles: document.querySelectorAll('[data-grid-drag]').length };
  });
  console.log('K5 row-drag handles:', JSON.stringify(k5));
  assert(k5.dragHandles > 0, '没有 rowDrag 手柄');
  console.log('K5 行拖拽手柄 PASS');

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
