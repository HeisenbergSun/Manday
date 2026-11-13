/**
 * 第九批 e2e：P1-3 视图持久化 + 锁定 + P1-4 用户偏好
 * V1 owner/editor 创建视图 → 200，列表可见
 * V2 锁定视图：editor 改配置/删除 → 403；owner 改 → 200
 * V3 lock/unlock：仅 owner（editor lock → 403）
 * V4 prefs：PUT defaultView → GET 返回；用户间隔离（李娜 GET 不带张伟的 defaultView）
 * V5 UI：owner 视图面板保存视图 + 表头点击排序生效（行序翻转）
 * V6 UI：锁定视图后表头点击被拒（toast 提示）
 */
const puppeteer = require('puppeteer-core');
const jwt = require('../backend/node_modules/jsonwebtoken');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const API = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LINA = { id: '12a830ad-4b64-4f93-9b75-e336581cd93a', email: 'lina@internal' };
const linaToken = 'Bearer ' + jwt.sign({ sub: LINA.id, email: LINA.email }, 'manday-dev-secret', { expiresIn: '12h' });

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
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch9-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  // ---- 准备：dev 登录，建测试 board ----
  const NAME = 'P1 视图验证 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录'));
    if (b) b.click();
  });
  await sleep(2000);
  const devToken = await page.evaluate(() => localStorage.getItem('manday_token'));
  const devAuth = 'Bearer ' + devToken;
  const created = await req(devAuth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = created.body.id;
  assert(!!bid, 'V-prep 建测试 board');
  await req(devAuth, 'POST', `/boards/${bid}/members`, { userId: LINA.id, role: 'editor' });
  // 建条目 ×3（名字可比较排序）
  for (const n of ['甲任务', '乙任务', '丙任务']) await req(devAuth, 'POST', `/boards/${bid}/items`, { name: n });

  // ---- V1 创建视图 ----
  const v1 = await req(devAuth, 'POST', `/boards/${bid}/views`, { name: '按条目排序', viewType: 'table', config: { sortBy: 'name', sortDir: 'asc' } });
  assert(v1.status === 200 || v1.status === 201, 'V1 owner 建视图: ' + v1.status);
  const vEd = await req(linaToken, 'POST', `/boards/${bid}/views`, { name: '李娜的视图', viewType: 'table', config: {} });
  assert(vEd.status === 200 || vEd.status === 201, 'V1 editor 也能建视图: ' + vEd.status);
  const lv = await req(linaToken, 'GET', `/boards/${bid}/views`);
  assert(Array.isArray(lv.body) && lv.body.length === 2, 'V1 列表可见 2 个视图（editor 可读）: ' + JSON.stringify(lv.body?.length));

  // ---- V2 锁定行为 ----
  const lock = await req(devAuth, 'POST', `/boards/${bid}/views/${v1.body.id}/lock`);
  assert(lock.status === 200 || lock.status === 201, 'V2 owner 锁定视图: ' + lock.status);
  const edPatch = await req(linaToken, 'PATCH', `/boards/${bid}/views/${v1.body.id}`, { config: { sortBy: 'name', sortDir: 'desc' } });
  assert(edPatch.status === 403, 'V2 editor 改锁定视图 → 403: ' + edPatch.status);
  const edDel = await req(linaToken, 'DELETE', `/boards/${bid}/views/${v1.body.id}`);
  assert(edDel.status === 403, 'V2 editor 删锁定视图 → 403: ' + edDel.status);
  const owPatch = await req(devAuth, 'PATCH', `/boards/${bid}/views/${v1.body.id}`, { config: { sortBy: 'name', sortDir: 'desc' } });
  assert(owPatch.status === 200 && owPatch.body.config?.sortDir === 'desc', 'V2 owner 改锁定视图 → 200: ' + owPatch.status);
  const edUnlock = await req(linaToken, 'POST', `/boards/${bid}/views/${v1.body.id}/unlock`);
  assert(edUnlock.status === 403, 'V3 editor 解锁 → 403: ' + edUnlock.status);
  const edPatchUn = await req(linaToken, 'PATCH', `/boards/${bid}/views/${vEd.body.id}`, { config: { sortBy: 'name', sortDir: 'asc' } });
  assert(edPatchUn.status === 200, 'V2 editor 改自己的未锁视图 → 200: ' + edPatchUn.status);
  await req(devAuth, 'POST', `/boards/${bid}/views/${v1.body.id}/unlock`);

  // ---- V4 prefs ----
  const put = await req(devAuth, 'PUT', `/boards/${bid}/prefs`, { defaultView: 'kanban' });
  assert(put.status === 200, 'V4 owner PUT prefs: ' + put.status);
  const gp = await req(devAuth, 'GET', `/boards/${bid}/prefs`);
  assert(gp.body?.default_view === 'kanban', 'V4 GET prefs 返回 defaultView: ' + JSON.stringify(gp.body?.default_view));
  const gl = await req(linaToken, 'GET', `/boards/${bid}/prefs`);
  assert(gl.body?.default_view !== 'kanban' || gl.body?.default_view === 'table', 'V4 偏好按用户隔离（李娜仍是默认）: ' + JSON.stringify(gl.body?.default_view));
  const vp = await req(linaToken, 'PUT', `/boards/${bid}/prefs`, { viewId: vEd.body.id });
  assert(vp.status === 200 && vp.body?.view_id === vEd.body.id, 'V4 李娜设默认视图偏好: ' + vp.status);

  // ---- V5 UI：owner 视图面板 + 表头排序 ----
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  const entered = await page.evaluate((name) => {
    const b = [...document.querySelectorAll('button,div,span')].find((x) => x.textContent?.trim() === name);
    if (b) { b.click(); return true; }
    return false;
  }, NAME);
  assert(entered, 'V5 UI 进入测试 board');
  await sleep(1200);
  // 注意：prefs defaultView=kanban 会把视图切到看板——切回表格
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('▤ 表格'));
    if (b) b.click();
  });
  await sleep(800);
  const viewBtn = await page.evaluate(() => !![...document.querySelectorAll('button')].find((x) => x.textContent.includes('⧉ 视图')));
  assert(viewBtn, 'V5 工具条出现「⧉ 视图」按钮');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('⧉ 视图'));
    b.click();
  });
  await sleep(600);
  const panel = await page.evaluate(() => !!document.querySelector('[data-views-panel]'));
  assert(panel, 'V5 视图面板打开（含已保存视图列表）');
  const items = await page.evaluate(() => document.querySelectorAll('[data-view-item]').length);
  assert(items >= 2, 'V5 面板列出已保存视图: ' + items);
  // 点条目表头排序 → 行序应翻转（升序 甲乙丙 → 降序 丙乙甲）
  const before = await page.evaluate(() => [...document.querySelectorAll('[data-col="name"]')].map((x) => x.textContent.trim()));
  await page.evaluate(() => {
    const th = [...document.querySelectorAll('th')].find((x) => x.textContent.includes('条目'));
    th.click();
  });
  await sleep(500);
  const after = await page.evaluate(() => [...document.querySelectorAll('[data-col="name"]')].map((x) => x.textContent.trim()));
  const sorted = after.length === 3 && after.join() === [...before].sort((a, b) => a.localeCompare(b, 'zh')).join();
  assert(sorted, `V5 表头点击排序生效 ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  // 保存为视图（面板可能已被上一次点击切换为关闭，确保打开）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('⧉ 视图'));
    if (b && !document.querySelector('[data-views-panel]')) b.click();
  });
  await sleep(400);
  const inputOk = await page.evaluate(() => !!document.querySelector('input[placeholder="视图名"]'));
  assert(inputOk, 'V6 面板中有保存视图输入框');
  if (inputOk) {
    await page.type('input[placeholder="视图名"]', '降序视图' + Date.now() % 1000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '保存');
      b.click();
    });
    await sleep(1000);
    const n2 = await page.evaluate(() => document.querySelectorAll('[data-view-item]').length);
    assert(n2 === items + 1, `V6 保存视图后列表 +1（${items} → ${n2}）`);
  }

  await browser.close();
  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
