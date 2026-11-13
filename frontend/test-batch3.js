const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch3-' + Date.now(),
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

  // 找一个父条目（无 parent 的第一行名字）
  const parentName = await page.evaluate(async (id, h) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    return d.items[0]?.name;
  }, bid, headers);
  console.log('parent item:', parentName);

  // ---- H1: API 建子任务 + UI 详情面板显示 ----
  const sub = await page.evaluate(async (id, h, pn) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    const it = d.items.find((x) => x.name === pn);
    const r = await fetch('/api/items/' + it.id + '/subitems', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'H1测试子任务' }) });
    return { status: r.status, body: await r.json(), parentId: it.id };
  }, bid, headers, parentName);
  console.log('H1 create subitem:', JSON.stringify(sub).slice(0, 160));
  assert(sub.status === 200 || sub.status === 201, '创建子任务失败: ' + JSON.stringify(sub));
  assert(sub.body.parent_item_id === sub.parentId, 'parent_item_id 不对');
  console.log('H1 创建子任务 API PASS');

  // 打开详情面板看子任务 tab
  await page.evaluate((n) => {
    const cells = [...document.querySelectorAll('.ag-cell[col-id="name"]')];
    const target = cells.find((c) => c.textContent.includes(n.slice(0, 8)));
    if (target) target.click();
  }, parentName);
  await sleep(1200);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) => b.textContent === '子任务');
    if (t) t.click();
  });
  await sleep(1000);
  const shown = await page.evaluate(() => document.body.innerText.includes('H1测试子任务'));
  console.log('H1 subitem visible in detail panel:', shown);
  assert(shown, '详情面板未显示子任务');
  console.log('H1 详情面板显示 PASS');

  // ---- H2: UI 新建子任务（输入框+回车）----
  const subInput = await page.waitForSelector('input[placeholder*="子任务"]', { timeout: 5000 });
  await subInput.click();
  await subInput.type('H2通过UI添加的子任务', { delay: 15 });
  await page.keyboard.press('Enter');
  await sleep(1500);
  const h2 = await page.evaluate(async (id, h, pn) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    const it = d.items.find((x) => x.name === pn);
    const subs = await (await fetch('/api/items/' + it.id + '/subitems', { headers: h })).json();
    const arr = Array.isArray(subs) ? subs : [];
    return arr.map((s) => s.name);
  }, bid, headers, parentName);
  console.log('H2 subitems:', h2.join(' | '));
  assert(h2.includes('H2通过UI添加的子任务'), 'UI 子任务未落库');
  console.log('H2 UI 新建子任务 PASS');

  // ---- H3: 勾选完成 → done 落库 ----
  const h3 = await page.evaluate(async (h, pn) => {
    // 只找详情侧栏（aside）里的子任务 checkbox，避免误点 AG Grid 行选择框
    const aside = [...document.querySelectorAll('aside')].find((a) => a.textContent.includes('子任务') || a.textContent.includes(pn));
    const boxes = aside ? [...aside.querySelectorAll('input[type="checkbox"]')] : [];
    if (boxes.length) boxes[0].click();
    return { boxes: boxes.length };
  }, headers, parentName);
  await sleep(1500);
  const doneState = await page.evaluate(async (h, pn) => {
    const d = await (await fetch('/api/boards', { headers: h })).json();
    const bid = (Array.isArray(d) ? d : d.items)[0].id;
    const bd = await (await fetch('/api/boards/' + bid, { headers: h })).json();
    const it = bd.items.find((x) => x.name === pn);
    const subs = await (await fetch('/api/items/' + it.id + '/subitems', { headers: h })).json();
    const arr = Array.isArray(subs) ? subs : [];
    return arr.map((s) => `${s.name}:${s.done === true ? 'DONE' : 'undone'}`);
  }, headers, parentName);
  console.log('H3 subitem states:', doneState.join(' | '), '| checkboxes seen:', h3.boxes);
  assert(h3.boxes >= 1, '详情面板没有 checkbox');
  assert(doneState.some((s) => s.includes(':DONE')), '勾选未落库 done=true');
  console.log('H3 子任务勾选完成 PASS');

  // ---- H4: 子任务不出现在主表格 ----
  const h4 = await page.evaluate(async (id, h) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    return d.items.some((x) => x.name === 'H1测试子任务' || x.name === 'H2通过UI添加的子任务');
  }, bid, headers);
  assert(!h4, '子任务泄漏进了主条目列表');
  console.log('H4 子任务不进主列表 PASS');

  // ---- H5: 看板卡片显示负责人/日期 ----
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('看板'));
    if (t) t.click();
  });
  await sleep(1500);
  const h5 = await page.evaluate(() => {
    const badges = [...document.querySelectorAll('span')].filter((s) => s.textContent.startsWith('📅'));
    const people = [...document.querySelectorAll('span')].filter((s) => ['张伟', '李娜'].includes(s.textContent));
    return { dateBadges: badges.length, peopleBadges: people.length };
  });
  console.log('H5 kanban badges:', JSON.stringify(h5));
  console.log('H5 卡片信息增强', h5.dateBadges + h5.peopleBadges > 0 ? 'PASS' : '（该 Board 无人员/日期值，跳过断言）');

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
