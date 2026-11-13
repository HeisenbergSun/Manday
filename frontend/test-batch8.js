/**
 * 第八批 e2e：P1-1 编辑内容 vs 结构权限拆分 + P1-2 列权限互斥
 * M1 非 owner 加列 → 403（结构仅 owner）
 * M2 非 owner 加组 → 403
 * M3 非 owner 建条目 + 改 cell → 200（内容可编辑）
 * M4 viewPermission=owner：非 owner 列表 restricted:true 且值被剔除；owner 正常
 * M5 互斥生效：view=owner 的列编辑仍 200（edit 未受限）
 * M6 editPermission=owner：非 owner updateCell → 403
 * M7 同时限制查看+编辑 → 403（互斥拒绝）
 * M8 batchUpdate 含受限列 → 403（补批量绕过漏洞）
 * M9 UI：owner 列面板出现编辑/查看两个权限下拉
 * M10 UI：editor 身份进页面 → 结构操作隐藏 + 受限列渲染模糊占位
 */
const puppeteer = require('puppeteer-core');
const jwt = require('../backend/node_modules/jsonwebtoken');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const API = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LINA = { id: '12a830ad-4b64-4f93-9b75-e336581cd93a', email: 'lina@internal' };
const linaToken = jwt.sign({ sub: LINA.id, email: LINA.email }, 'manday-dev-secret', { expiresIn: '12h' });

let errors = [];
const assert = (c, m) => { if (!c) { errors.push(m); console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const req = async (h, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + h, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch8-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => { d.accept().catch(() => {}); });

  // ---- 准备：dev 登录，建测试 board ----
  const NAME = 'P1 权限验证 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录'));
    if (b) b.click();
  });
  await sleep(2000);
  const devToken = await page.evaluate(() => localStorage.getItem('manday_token'));
  const created = await req(devToken, 'POST', '/boards', { name: NAME, visibility: 'company' });
  assert(created.status === 201 || created.status === 200 || created.body?.id, 'M-prep 建测试 board');
  const bid = created.body.id;
  // 加李娜为 editor
  const addM = await req(devToken, 'POST', `/boards/${bid}/members`, { userId: LINA.id, role: 'editor' });
  assert(addM.status === 200 || addM.status === 201, 'M-prep 加李娜为 editor（' + addM.status + '）');
  // 建一个日期列供权限测试
  const cols0 = await req(devToken, 'GET', `/boards/${bid}/items`);
  let colDate = (cols0.body.columns ?? []).find((c) => c.type === 'date');
  if (!colDate) {
    const nd = await req(devToken, 'POST', `/boards/${bid}/columns`, { name: '截止日期', type: 'date' });
    colDate = nd.body;
  }
  let colStatus = (cols0.body.columns ?? []).find((c) => c.type === 'status');
  if (!colStatus) {
    const ns = await req(devToken, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
    colStatus = ns.body;
  }
  // 建一条条目
  const itemR = await req(devToken, 'POST', `/boards/${bid}/items`, { name: 'P1目标条目' });
  const itemId = itemR.body.id;
  assert(!!itemId, 'M-prep 建条目');

  // ---- M9 UI：owner 列面板出现编辑/查看两个权限下拉 ----
  // 进入 board：侧边栏点该 board
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  const entered = await page.evaluate((name) => {
    const el = [...document.querySelectorAll('div')].find((d) => d.textContent === name && getComputedStyle(d).cursor === 'pointer');
    if (el) { el.click(); return true; }
    return false;
  }, NAME);
  await sleep(1500);
  assert(entered, 'M-prep 进入 board');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('列与分组'));
    if (b) b.click();
  });
  await sleep(600);
  // 轮询等待面板渲染（columns 数据可能仍在加载）
  let m9 = { edit: 0, view: 0, addCol: false };
  for (let i = 0; i < 10; i++) {
    m9 = await page.evaluate(() => ({
      edit: document.querySelectorAll('[data-col-editperm]').length,
      view: document.querySelectorAll('[data-col-viewperm]').length,
      addCol: [...document.querySelectorAll('b')].some((b) => b.textContent.includes('新增列')),
    }));
    if (m9.edit > 0 && m9.view > 0) break;
    await sleep(500);
  }
  assert(m9.edit > 0 && m9.view > 0 && m9.addCol, `M9 owner 列面板双权限下拉（edit=${m9.edit}, view=${m9.view}, addCol=${m9.addCol}）`);
  // 关面板
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('列与分组'));
    if (b) b.click();
  });
  await sleep(400);

  // ---- M1/M2/M3：非 owner 结构 403、内容 200 ----
  const m1 = await req(linaToken, 'POST', `/boards/${bid}/columns`, { name: '越权列', type: 'text' });
  assert(m1.status === 403, `M1 非 owner 加列 → 403（实际 ${m1.status}）`);
  const gid0 = (await req(linaToken, 'GET', `/boards/${bid}/items`)).body.groups?.[0]?.id;
  const m2 = await req(linaToken, 'POST', `/boards/${bid}/groups`, { name: '越权组' });
  assert(m2.status === 403, `M2 非 owner 加组 → 403（实际 ${m2.status}）`);
  const m3a = await req(linaToken, 'POST', `/boards/${bid}/items`, { name: '李娜的条目', groupId: gid0 });
  assert(m3a.status === 201 || m3a.status === 200, `M3a 非 owner 建条目 → 200（实际 ${m3a.status}）`);
  const m3b = await req(linaToken, 'PATCH', `/items/${itemId}/cell`, { columnId: colStatus.id, value: '待办', version: 1 });
  assert(m3b.status === 200 || m3b.status === 201, `M3b 非 owner 改 cell → 200（实际 ${m3b.status}）`);

  // ---- M4：view=owner 后非 owner 列表 restricted + 值剔除 ----
  // 先给该列写个值（owner 写，version 用最新）
  const cur = await req(devToken, 'GET', `/boards/${bid}/items`);
  const it0 = cur.body.items.find((x) => x.id === itemId);
  await req(devToken, 'PATCH', `/items/${itemId}/cell`, { columnId: colDate.id, value: '2026-12-01', version: it0.version });
  const setView = await req(devToken, 'PATCH', `/boards/${bid}/columns/${colDate.id}`, { settings: { ...colDate.settings, viewPermission: 'owner' } });
  assert(setView.status === 200, `M4-prep owner 设 view=owner（实际 ${setView.status}）`);
  const linaView = await req(linaToken, 'GET', `/boards/${bid}/items`);
  const linaCol = linaView.body.columns.find((c) => c.id === colDate.id);
  const linaItem = linaView.body.items.find((x) => x.id === itemId);
  assert(linaCol?.restricted === true, 'M4a 非 owner 列表该列 restricted:true');
  assert(!(linaItem?.values ?? {})[colDate.id], 'M4b 非 owner 列表该列值被剔除');
  const devView = await req(devToken, 'GET', `/boards/${bid}/items`);
  const devCol = devView.body.columns.find((c) => c.id === colDate.id);
  assert(devCol?.restricted !== true && !!devView.body.items.find((x) => x.id === itemId)?.values[colDate.id], 'M4c owner 正常看到值且无 restricted 标记');

  // ---- M5：互斥生效——view=owner 不影响编辑 ----
  const lv = await req(linaToken, 'GET', `/boards/${bid}/items`);
  const itv = lv.body.items.find((x) => x.id === itemId);
  const m5 = await req(linaToken, 'PATCH', `/items/${itemId}/cell`, { columnId: colStatus.id, value: '进行中', version: itv.version });
  assert(m5.status === 200 || m5.status === 201, `M5 view=owner 的 board 上编辑其他列仍 200（实际 ${m5.status}）`);

  // ---- M6：editPermission=owner → 403 ----
  const setEdit = await req(devToken, 'PATCH', `/boards/${bid}/columns/${colStatus.id}`, { settings: { ...colStatus.settings, editPermission: 'owner' } });
  assert(setEdit.status === 200, `M6-prep owner 设 edit=owner（实际 ${setEdit.status}）`);
  const le = await req(linaToken, 'GET', `/boards/${bid}/items`);
  const ite = le.body.items.find((x) => x.id === itemId);
  const m6 = await req(linaToken, 'PATCH', `/items/${itemId}/cell`, { columnId: colStatus.id, value: '已完成', version: ite.version });
  assert(m6.status === 403, `M6 非 owner 编辑 owner-only 列 → 403（实际 ${m6.status}）`);
  const m6b = await req(linaToken, 'POST', '/items/batch', { changes: [{ itemId, columnId: colStatus.id, value: '已完成' }] });
  assert(m6b.status === 403, `M8 批量含受限列 → 403（实际 ${m6b.status}）`);
  // 恢复 all，避免污染
  await req(devToken, 'PATCH', `/boards/${bid}/columns/${colStatus.id}`, { settings: { ...colStatus.settings, editPermission: 'all' } });

  // ---- M7：互斥拒绝 ----
  const m7 = await req(devToken, 'PATCH', `/boards/${bid}/columns/${colDate.id}`, { settings: { ...colDate.settings, viewPermission: 'owner', editPermission: 'owner' } });
  assert(m7.status === 403, `M7 同时限制查看+编辑 → 403（实际 ${m7.status}）`);
  // 恢复 date 列 view=all
  await req(devToken, 'PATCH', `/boards/${bid}/columns/${colDate.id}`, { settings: { ...colDate.settings, viewPermission: 'all' } });

  // ---- M10 UI：editor 身份进页面 → 结构隐藏 + 受限列模糊占位 ----
  // 重新设 view=owner 供 UI 验证
  await req(devToken, 'PATCH', `/boards/${bid}/columns/${colDate.id}`, { settings: { ...colDate.settings, viewPermission: 'owner' } });
  await page.evaluate((t, uid) => {
    localStorage.setItem('manday_token', t);
    localStorage.setItem('userId', uid);
  }, linaToken, LINA.id);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1500);
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll('div')].find((d) => d.textContent === name && getComputedStyle(d).cursor === 'pointer');
    if (el) el.click();
  }, NAME);
  await sleep(1500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('列与分组'));
    if (b) b.click();
  });
  await sleep(600);
  const m10a = await page.evaluate(() => ({
    notice: document.body.innerText.includes('仅看板负责人可修改结构'),
    addCol: [...document.querySelectorAll('b')].some((b) => b.textContent.includes('新增列')),
    editperm: document.querySelectorAll('[data-col-editperm]').length,
  }));
  assert(m10a.notice && !m10a.addCol && m10a.editperm === 0, `M10a editor 面板：结构操作隐藏（notice=${m10a.notice}, addCol=${m10a.addCol}, perm下拉=${m10a.editperm}）`);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('列与分组'));
    if (b) b.click();
  });
  await sleep(400);
  const m10b = await page.evaluate(() => document.querySelectorAll('[data-grid-restricted]').length);
  assert(m10b > 0, `M10b editor 表格受限列模糊占位（n=${m10b}）`);

  // ---- 清理 ----
  await req(devToken, 'GET', '/boards'); // keepalive
  await browser.close();

  console.log('\n===== 第八批 P1 权限：' + (errors.length ? errors.length + ' 个失败' : '全部通过') + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
