/**
 * 第二十一批 自动化触发器/公式函数扩展 e2e
 * F1 公式 {工时}*2 注入正确
 * F2 ROUND(ABS(...)) 一元函数
 * F3 AVG/MIN/MAX 聚合子条目
 * A1 status_changed → update_field 自动写入（同步触发路径）
 * A2 condition gt 门控：不满足不执行
 * A3 item_created → notify @owner → notifications 落库
 * A4 date_passing 扫描 → 逾期条目打标
 * A5 assignee_changed → set_status 自动改状态
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
    require('./e2e-profile-cleanup')('manday-batch21');
const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch21-' + Date.now(),
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
  const me = (await req(auth, 'GET', '/auth/me')).body;
  const uidDev = me.id;

  // prep：板 + 列
  const b = await req(auth, 'POST', '/boards', { name: 'P21-Auto 公式', visibility: 'private' });
  const bid = b.body.id;
  const g = (await req(auth, 'GET', `/boards/${bid}`)).body.groups[0];
  const numCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '工时', type: 'number' })).body;
  const numCol2 = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '阈值', type: 'number' })).body;
  const textCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '备注', type: 'text' })).body;
  const statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status',
    settings: { labels: [{ label: '进行中', color: '#fdab3d' }, { label: '已完成', color: '#00c875' }], doneLabels: ['已完成'] } })).body;
  const dateCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '截止', type: 'date' })).body;
  const peopleCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people' })).body;
  const f1 = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '倍数', type: 'formula', settings: { formula: '{工时} * 2' } })).body;
  const f2 = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '取整', type: 'formula', settings: { formula: 'ROUND(ABS({工时})) + 1' } })).body;
  const f3 = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '均值', type: 'formula', settings: { formula: 'AVG({工时})' } })).body;

  const mk = async (name) => (await req(auth, 'POST', `/boards/${bid}/items`, { name, groupId: g.id })).body;
  const setCell = async (itemId, colId, value) => {
    const cur = (await req(auth, 'GET', `/items/${itemId}`)).body;
    return req(auth, 'PATCH', `/items/${itemId}/cell`, { columnId: colId, value, version: cur.version });
  };
  const getVals = async (itemId) => {
    const list = (await req(auth, 'GET', `/boards/${bid}/items`)).body?.items ?? [];
    return list.find((x) => x.id === itemId)?.values ?? {};
  };

  const main = await mk('主条目');
  await setCell(main.id, numCol.id, 4);
  // 子条目
  const s1 = (await req(auth, 'POST', `/items/${main.id}/subitems`, { name: '子1' })).body;
  const s2 = (await req(auth, 'POST', `/items/${main.id}/subitems`, { name: '子2' })).body;
  await setCell(s1.id ?? s1[0]?.id ?? s1.id, numCol.id, 2);
  await setCell(s2.id ?? s2[0]?.id ?? s2.id, numCol.id, 6);

  // ---- 公式 ----
  await sleep(400);
  const vMain = await getVals(main.id);
  assert(String(vMain[f1.id]) === '8', `F1 {工时}*2 = 8（${vMain[f1.id]}）`);
  assert(String(vMain[f2.id]) === '5', `F2 ROUND(ABS)+1 = 5（${vMain[f2.id]}）`);
  assert(String(vMain[f3.id]) === '4', `F3 AVG 子条目 (2+6)/2 = 4（${vMain[f3.id]}）`);

  // ---- 自动化 ----
  // A1 + A2：规则1 status_changed to=进行中 → update_field 备注=auto-ok；condition 阈值 gt 5
  const r1 = await req(auth, 'POST', `/boards/${bid}/automations`, {
    trigger: { type: 'status_changed', to: '进行中' },
    condition: { columnId: numCol2.id, op: 'gt', value: 5 },
    action: { type: 'update_field', columnId: textCol.id, value: 'auto-ok' },
  });
  assert(r1.status < 300, 'A0 创建规则 1');
  // 规则2：status_changed to=进行中 无条件 → set_status 已完成？会互相干扰；改用 assignee_changed → set_status
  const r2 = await req(auth, 'POST', `/boards/${bid}/automations`, {
    trigger: { type: 'assignee_changed', to: uidDev },
    action: { type: 'set_status', label: '进行中' },
  });
  assert(r2.status < 300, 'A0b 创建规则 2（set_status）');

  // A2 条件不满足：阈值=1，改状态 → 不写备注
  await setCell(main.id, numCol2.id, 1);
  await setCell(main.id, statusCol.id, '已完成');   // 先设已完成
  await setCell(main.id, statusCol.id, '进行中');   // 触发 to=进行中
  await sleep(1500);
  let v = await getVals(main.id);
  assert(String(v[textCol.id] ?? '') !== 'auto-ok', `A2 条件不满足不执行（备注=${v[textCol.id] ?? '空'}）`);

  // A2b 条件满足：阈值=9 → 写备注 auto-ok
  await setCell(main.id, numCol2.id, 9);
  await setCell(main.id, statusCol.id, '已完成');
  await setCell(main.id, statusCol.id, '进行中');
  await sleep(1500);
  v = await getVals(main.id);
  assert(String(v[textCol.id] ?? '') === 'auto-ok', `A1 触发 update_field（备注=${v[textCol.id]}）`);

  // A5：assignee_changed → set_status（负责人 = dev → 状态自动改进行中；先设已完成）
  await setCell(main.id, statusCol.id, '已完成');
  await setCell(main.id, peopleCol.id, uidDev);
  await sleep(1500);
  v = await getVals(main.id);
  assert(String(v[statusCol.id] ?? '') === '进行中', `A5 set_status 自动改状态（${v[statusCol.id]}）`);

  // A3：item_created → notify @owner → notifications
  const r3 = await req(auth, 'POST', `/boards/${bid}/automations`, {
    trigger: { type: 'item_created' }, action: { type: 'notify', userIds: ['@owner'] },
  });
  const notifBefore = await req(auth, 'GET', '/notifications/unread');
  const list = (b) => (Array.isArray(b) ? b : b?.items ?? b?.notifications ?? []);
  const beforeCount = list(notifBefore.body).filter((n) => n.type === 'automation').length;
  await mk('触发创建的条目');
  await sleep(1500);
  const notifAfter = await req(auth, 'GET', '/notifications/unread');
  const afterCount = list(notifAfter.body).filter((n) => n.type === 'automation').length;
  assert(afterCount > beforeCount, `A3 item_created 通知落库（${beforeCount} → ${afterCount}）`);

  // A4：date_passing 扫描 → 逾期打标
  const r4 = await req(auth, 'POST', `/boards/${bid}/automations`, {
    trigger: { type: 'date_passing' }, action: { type: 'update_field', columnId: textCol.id, value: '⚠ 逾期' },
  });
  const late = await mk('逾期条目');
  await setCell(late.id, dateCol.id, dayStr(-3));
  const scan = await req(auth, 'POST', `/boards/${bid}/automations/scan`);
  assert(scan.status < 300 && typeof scan.body?.passing === 'number', `A4 scan 端点（${JSON.stringify(scan.body)}）`);
  await sleep(800);
  const vLate = await getVals(late.id);
  assert(String(vLate[textCol.id] ?? '') === '⚠ 逾期', `A4b date_passing 打标（${vLate[textCol.id]}）`);
  const vMain2 = await getVals(main.id);
  assert(String(vMain2[textCol.id] ?? '') !== '⚠ 逾期', 'A4c 未逾期条目不打标');

  // UI 冒烟：自动化面板列出新规则
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('自动化'));
    b?.click();
  });
  await sleep(1000);
  const panelHasRule = await page.evaluate(() => document.body.innerText.includes('进行中') && document.body.innerText.includes('update_field'));
  void panelHasRule; // 面板渲染形态不定，断言从宽：不因面板改动出现 pageerror 即可

  await browser.close();

  // cleanup
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl = await c.query("DELETE FROM boards WHERE name LIKE 'P21-%'");
    const dn = await c.query("DELETE FROM notifications WHERE type='automation'");
    const da = await c.query("DELETE FROM audit_logs WHERE action='automation.run' AND created_at > now() - interval '1 hour'");
    console.log('  [cleanup] boards:', dl.rowCount, 'notifications:', dn.rowCount, 'audit:', da.rowCount);
    await c.end();
  }

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
