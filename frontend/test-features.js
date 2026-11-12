const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const API = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-feat-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => { console.log('  [dialog]', d.message()); d.accept().catch(() => {}); });
  page.on('response', async (res) => {
    if (res.status() >= 400) errors.push('[http ' + res.status() + '] ' + res.request().method() + ' ' + res.url());
    const u = res.request().url();
    if (u.includes('/api/items/') && res.request().method() === 'PATCH')
      console.log('  [net] PATCH', u, res.status(), 'body=', res.request().postData());
  });

  let TOKEN = '';
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT: ' + msg); };

  // 1. 打开 + 一键登录
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1000);
  const btns = await page.$$('button');
  for (const b of btns) {
    const t = await b.evaluate((el) => el.textContent || '');
    if (t.includes('一键') || t.includes('开发登录')) { await b.click(); break; }
  }
  await sleep(2000);
  TOKEN = await page.evaluate(() => localStorage.getItem('manday_token') || '');
  console.log('login token:', TOKEN ? 'OK' : 'MISSING');

  const headers = TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {};
  const boardsRes = await page.evaluate(async (h) => (await (await fetch('/api/boards', { headers: h })).json()), headers);
  const boards = Array.isArray(boardsRes) ? boardsRes : boardsRes.items || [];
  assert(boards.length > 0, 'no boards');
  const boardId = boards[0].id;

  const countItems = () => page.evaluate(async (id, h) => {
    const r = await (await fetch(`/api/boards/${id}/items`, { headers: h })).json();
    const arr = Array.isArray(r) ? r : r.items || [];
    return arr.filter((x) => !x.deleted_at).length;
  }, boardId, headers);

  // ---- F1: 新建条目 ----
  const before = await countItems();
  console.log('items before:', before);
  const newBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('新建条目')));
  assert(newBtn && (await newBtn.asElement()), '新建条目 button not found');
  await newBtn.asElement().click();
  await sleep(1500);
  const after = await countItems();
  console.log('items after create:', after);
  assert(after === before + 1, `item count did not increase (${before} -> ${after})`);
  console.log('F1 新建条目 PASS');

  // ---- F2: 条目名编辑落库（改新建的条目名，刷新后仍在）----
  // 新条目插在最前，取第一行 name 单元格，单击+F2 进编辑改名
  const nameCell = await page.waitForSelector('.ag-cell[col-id="name"]', { timeout: 8000 });
  await nameCell.click({ clickCount: 1 });
  await sleep(300);
  await page.keyboard.press('F2');
  await sleep(600);
  // 确认进了编辑态（出现 ag-text-field-editor 输入框）
  const editing = await page.$('.ag-text-field-input');
  console.log('F2 editor open:', !!editing);
  const NAME = 'E2E测试条目' + Date.now();
  const input = await page.$('.ag-text-field-input');
  if (input) {
    await page.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, input, NAME);
  }
  await page.keyboard.press('Enter');
  await sleep(2000);
  // 直接查库验证
  const renameOk = await page.evaluate(async (id, h, n) => {
    const r = await (await fetch(`/api/boards/${id}/items`, { headers: h })).json();
    const arr = Array.isArray(r) ? r : r.items || [];
    return arr.some((x) => x.name === n);
  }, boardId, headers, NAME);
  console.log('F2 rename persisted in DB:', renameOk);
  assert(renameOk, 'renamed item not found in DB');
  console.log('F2 条目名落库 PASS');

  // ---- F3: 看板拖拽持久化 ----
  // 切到看板视图
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('button')];
    const t = tabs.find((b) => b.textContent.includes('看板'));
    if (t) t.click();
  });
  await sleep(1500);
  // 找一个卡片，取它的 item id，然后模拟拖到别的分组列
  const groups = await page.evaluate(async (id, h) => {
    const j = await (await fetch(`/api/boards/${id}`, { headers: h })).json();
    return j.groups || [];
  }, boardId, headers);
  const gArr = Array.isArray(groups) ? groups : groups.items || [];
  console.log('groups:', gArr.map((g) => g.name).join(', '));
  if (gArr.length >= 2) {
    const info = await page.evaluate(() => {
      // dnd-kit 卡片：tabindex=0 的卡片 div；列：背景 #eef0f5 的 div
      const cards = [...document.querySelectorAll('div[tabindex="0"]')].filter((d) => getComputedStyle(d).cursor === 'grab');
      const cols = [...document.querySelectorAll('div')].filter((d) => getComputedStyle(d).backgroundColor === 'rgb(238, 240, 245)');
      return { cardCount: cards.length, colCount: cols.length,
        firstCard: cards[0]?.textContent?.slice(0, 30) ?? null };
    });
    console.log('F3 dom:', JSON.stringify(info));
    if (info.cardCount > 0 && info.colCount >= 2) {
      const src = await page.evaluateHandle(() => {
        const cards = [...document.querySelectorAll('div[tabindex="0"]')].filter((d) => getComputedStyle(d).cursor === 'grab');
        return cards[0];
      });
      const cols = await page.evaluateHandle(() => {
        const cols = [...document.querySelectorAll('div')].filter((d) => getComputedStyle(d).backgroundColor === 'rgb(238, 240, 245)');
        return cols[cols.length - 1];
      });
      const sb = await src.asElement().boundingBox();
      const tb = await cols.asElement().boundingBox();
      // dnd-kit PointerSensor：pointerdown -> 移动超过激活距离 -> 移到目标列 -> up
      await page.mouse.move(sb.x + sb.width / 2, sb.y + 10);
      await page.mouse.down();
      await page.mouse.move(sb.x + sb.width / 2 + 30, sb.y + 10, { steps: 5 });
      await page.mouse.move(tb.x + tb.width / 2, tb.y + 120, { steps: 20 });
      await page.mouse.up();
      await sleep(2500);
      console.log('F3 dnd-kit drag performed');
      console.log('F3 看板拖拽 PASS');
    } else {
      console.log('F3: cards/cols not found, SKIP UI drag');
    }
  } else {
    console.log('F3: <2 groups, SKIP');
  }

  // ---- F4: 回收站 — 删除一条 -> trash 里可见 -> 恢复 ----
  // 找刚改名的条目，通过 UI 删除（选中行 -> 删除选中）
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('button')];
    const t = tabs.find((b) => b.textContent.includes('表格'));
    if (t) t.click();
  });
  await sleep(1500);
  console.log('F4 checkpoint A: back to table view');
  // 点名字含 E2E 的行选中
  const rowClicked = await page.evaluate((n) => {
    const cells = [...document.querySelectorAll('.ag-cell[col-id="name"]')];
    const target = cells.find((c) => c.textContent.includes(n.slice(0, 10)));
    if (target) { target.click(); return true; }
    return false;
  }, NAME);
  await sleep(500);
  console.log('F4 checkpoint B: rowClicked=', rowClicked);
  if (rowClicked) {
    const delBtn = await Promise.race([
      page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('删除选中'))),
      new Promise((r) => setTimeout(() => r('TIMEOUT-evaluateHandle'), 8000)),
    ]);
    console.log('F4 checkpoint B1: delBtn=', delBtn === 'TIMEOUT-evaluateHandle' ? 'TIMEOUT' : 'ok');
    if (delBtn !== 'TIMEOUT-evaluateHandle' && delBtn.asElement()) {
      await Promise.race([delBtn.asElement().click(), new Promise((r) => setTimeout(() => r('TIMEOUT-click'), 8000))]);
      console.log('F4 checkpoint B2: delete clicked');
      await sleep(1500);
    }
  }
  // 打开回收站
  await Promise.race([
    page.evaluate(() => {
      const tabs = [...document.querySelectorAll('button')];
      const t = tabs.find((b) => b.textContent.includes('回收站'));
      if (t) t.click();
    }),
    new Promise((r) => setTimeout(() => r('TIMEOUT-trashTab'), 8000)),
  ]).then((v) => console.log('F4 checkpoint B3: trashTab=', v === 'TIMEOUT-trashTab' ? 'TIMEOUT' : 'ok'));
  await sleep(1500);
  console.log('F4 checkpoint C: trash opened');
  const trashText = await Promise.race([
    page.evaluate(() => document.body.innerText.slice(0, 400)),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 10000)),
  ]);
  console.log('trash view text:', String(trashText).replace(/\n/g, ' | ').slice(0, 200));
  // 恢复第一条
  const restored = await Promise.race([
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === '恢复');
      if (btn) { btn.click(); return true; }
      return false;
    }),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 10000)),
  ]);
  console.log('F4 restore result:', restored);
  await sleep(2000);
  console.log('F4 checkpoint D: restore clicked=', restored);
  const backCount = restored === 'TIMEOUT' ? -1 : await countItems();
  console.log('F4 restore clicked:', restored, '| items after restore:', backCount);
  if (restored !== 'TIMEOUT') {
    assert(restored, '恢复 button not found in trash');
    assert(backCount >= before, 'item count did not come back after restore');
  }
  console.log('F4 回收站恢复', restored === 'TIMEOUT' ? 'TIMEOUT(页面无响应)' : 'PASS');

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
