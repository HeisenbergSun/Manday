const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch2-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('response', (res) => { if (res.status() >= 400) errors.push('[http ' + res.status() + '] ' + res.request().method() + ' ' + res.url()); });
  page.on('dialog', (d) => { console.log('  [dialog]', d.message()); d.accept().catch(() => {}); });
  const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

  // 登录
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1000);
  for (const b of await page.$$('button')) {
    const t = await b.evaluate((el) => el.textContent || '');
    if (t.includes('一键') || t.includes('开发登录')) { await b.click(); break; }
  }
  await sleep(2000);
  const headers = await page.evaluate(() => {
    const t = localStorage.getItem('manday_token');
    return { Authorization: 'Bearer ' + t };
  });

  const boardInfo = await page.evaluate(async (h) => {
    const j = await (await fetch('/api/boards', { headers: h })).json();
    const arr = Array.isArray(j) ? j : j.items || [];
    const bid = arr[0].id;
    const d = await (await fetch('/api/boards/' + bid, { headers: h })).json();
    return { bid, colCount: (d.columns || []).length, groupCount: (d.groups || []).length };
  }, headers);
  console.log('board:', JSON.stringify(boardInfo));

  // 预清理：删掉历史残留的「优先级」列 /「已上线」分组
  await page.evaluate(async (id, h) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    for (const c of (d.columns || []).filter((c) => c.name === '优先级'))
      await fetch('/api/boards/' + id + '/columns/' + c.id, { method: 'DELETE', headers: h });
    for (const g of (d.groups || []).filter((g) => g.name === '已上线'))
      await fetch('/api/boards/' + id + '/groups/' + g.id, { method: 'DELETE', headers: h });
  }, boardInfo.bid, headers);
  console.log('pre-clean done, board:', JSON.stringify(boardInfo));

  // ---- G1: 新增列（文本「优先级」）----
  const mgrBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('列与分组')));
  await mgrBtn.asElement().click();
  await sleep(500);
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[placeholder="列名"]')];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], '优先级');
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === '添加');
    btn.click();
  });
  await sleep(2000);
  const g1 = await page.evaluate(async (id, h) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    return d.columns.map((c) => c.name);
  }, boardInfo.bid, headers);
  console.log('columns after G1:', g1.join(', '));
  assert(g1.includes('优先级'), '新增列未落库');
  console.log('G1 新增列 PASS');

  // ---- G2: 新增分组「已上线」----
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[placeholder*="分组名"]')];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], '已上线');
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  });
  const addBtns = await page.evaluateHandle(() => [...document.querySelectorAll('button')].filter((b) => b.textContent === '添加'));
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent === '添加' && !b.disabled);
    // 第二个添加按钮 = 分组
    (btns[1] || btns[0]).click();
  });
  await sleep(2000);
  const g2 = await page.evaluate(async (id, h) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    return d.groups.map((g) => g.name);
  }, boardInfo.bid, headers);
  console.log('groups after G2:', g2.join(', '));
  assert(g2.includes('已上线'), '新增分组未落库');
  console.log('G2 新增分组 PASS');

  // ---- G3: 删除刚加的「优先级」列 ----
  await page.evaluate(() => {
    // 列管理面板里列名 span → 其所在行的 ✕ 按钮
    const span = [...document.querySelectorAll('span')].find((s) => s.textContent === '优先级');
    const x = span?.parentElement?.querySelector('button');
    if (x) x.click(); else throw new Error('优先级行未找到');
  });
  await sleep(2000);
  const g3 = await page.evaluate(async (id, h) => {
    const d = await (await fetch('/api/boards/' + id, { headers: h })).json();
    return d.columns.map((c) => c.name);
  }, boardInfo.bid, headers);
  console.log('columns after G3:', g3.join(', '));
  assert(!g3.includes('优先级'), '删除列未生效');
  console.log('G3 删除列 PASS');

  // ---- G4: 日历视图渲染 ----
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('日历'));
    if (t) t.click();
  });
  await sleep(1500);
  const g4 = await page.evaluate(() => {
    const body = document.body.innerText;
    return { hasMonth: /\d{4} 年 \d+ 月/.test(body), hasToday: body.includes('今天'), gridCells: document.querySelectorAll('div').length };
  });
  console.log('G4 calendar:', JSON.stringify(g4));
  assert(g4.hasMonth && g4.hasToday, '日历未渲染');
  // 点击今天格子 → 侧栏出现
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === '今天');
    if (btn) btn.click();
  });
  await sleep(1000);
  console.log('G4 日历视图 PASS');

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
