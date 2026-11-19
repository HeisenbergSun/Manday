/**
 * 第三十一批 e2e：Dashboard BI（多 Board 关联 + 图表编辑）+ 移动到分组修复
 * S1 移动到分组：board ⋯ 菜单（fixed）→ 分组出现
 * S2 加号菜单 → 新建 Dashboard
 * S3 number widget 关联 2 个 Board，跨板按列名聚合（100+200=300）
 * S4 编辑已有图表（改标题）
 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const API = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let errors = [];
const assert = (c, m) => { if (!c) { errors.push(m); console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const req = async (h, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + h, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

(async () => {
  require('./e2e-profile-cleanup')('manday-batch31');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch31-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => { d.accept().catch(() => {}); });

  const NAME = 'B31-Dash ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  const NAME2 = NAME + '-B';
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const token = await page.evaluate(() => localStorage.getItem('manday_token'));

  // 清理残留 dashboard（同名累加会导致点击进入旧 dashboard）
  try {
    const pg = require('pg'); require('dotenv').config({ path: '../backend/.env' });
    const pc = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pc.connect();
    await pc.query(`DELETE FROM dashboards WHERE name LIKE 'B31-Dash %'`);
    await pc.end();
  } catch {}

  // 准备：2 个 board，各带「预算」number 列 + 条目
  const mk = async (name, vals) => {
    const b = await req(token, 'POST', '/boards', { name, visibility: 'company' });
    const bid = b.body.id;
    const col = await req(token, 'POST', `/boards/${bid}/columns`, { name: '预算', type: 'number' });
    await req(token, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
    const dcol = await req(token, 'POST', `/boards/${bid}/columns`, { name: '截止日期', type: 'date' });
    for (const v of vals) {
      const it = await req(token, 'POST', `/boards/${bid}/items`, { name: v.name });
      const fresh = await req(token, 'GET', `/items/${it.body.id}`);
      await req(token, 'PATCH', `/items/${it.body.id}/cell`, { columnId: col.body.id, value: v.val, version: fresh.body.version });
      await req(token, 'PATCH', `/items/${it.body.id}/cell`, { columnId: dcol.body.id, value: v.date, version: fresh.body.version });
    }
    return bid;
  };
  const bidA = await mk(NAME, [{ name: 'A1', val: 100, date: '2026-11-20' }, { name: 'A2', val: 50, date: '2026-11-22' }]);
  const bidB = await mk(NAME2, [{ name: 'B1', val: 200, date: '2026-11-25' }]);
  assert(!!bidA && !!bidB, 'S-prep 建 2 个 board（各带预算列）');

  // ---- S1 移动到分组 ----
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  const trig = await page.evaluate((n) => {
    const row = document.querySelector(`[data-board-item="${n}"]`);
    const t = row?.querySelector('[data-board-menu-trigger]');
    if (!t) return false; t.click(); return true;
  }, NAME);
  assert(trig, 'S1 定位 board ⋯ 按钮');
  await sleep(400);
  assert(await page.$('[data-board-menu]'), 'S1 分组菜单出现');
  const f = await req(token, 'POST', '/board-folders', { name: 'B31-分组' });
  await req(token, 'POST', `/board-folders/${f.body.id}/boards`, { boardId: bidA });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  assert(await page.evaluate(() => document.body.innerText.includes('B31-分组')), 'S1 分组显示');

  // ---- S2 加号菜单建 Dashboard ----
  await page.click('[data-workspace-plus]');
  await sleep(400);
  assert(await page.$('[data-workspace-plus-menu]'), 'S2 加号菜单出现');
  const DASH_NAME = NAME + '-Dash';
  const dash = await req(token, 'POST', '/dashboards', { name: DASH_NAME });
  assert(!!dash.body.id, 'S2 建 dashboard');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  assert(await page.evaluate((n) => !!document.querySelector(`[data-dashboard-item="${n}"]`), DASH_NAME), 'S2 Dashboard 显示在导航');

  // ---- S3 number widget 关联 2 board ----
  await page.evaluate((n) => document.querySelector(`[data-dashboard-item="${n}"]`)?.click(), DASH_NAME);
  await sleep(2000);
  await page.click('[data-add-widget]');
  await sleep(400);
  await page.evaluate(() => document.querySelector('[data-widget-type="number"]')?.click());
  await sleep(300);
  // 勾选 2 个 board（轮询等待选项渲染，board 列表较大时加载慢）
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate((ns) => ns.every((n) => !!document.querySelector(`[data-board-option="${n}"]`)), [NAME, NAME2]);
    if (ok) break;
    await sleep(500);
  }
  await page.evaluate((names) => {
    for (const n of names) {
      const lb = document.querySelector(`[data-board-option="${n}"]`);
      const cb = lb?.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) cb.click();
    }
  }, [NAME, NAME2]);
  await sleep(500);
  // 等待数值列选项「预算」出现（首个 widget 冷启动 getBoard 较慢）
  for (let i = 0; i < 20; i++) {
    const has = await page.evaluate(() => {
      const sel = document.querySelector('[data-widget-modal] select');
      return sel ? [...sel.options].some((o) => o.value === '预算') : false;
    });
    if (has) break;
    await sleep(500);
  }
  // 选「预算」数值列
  await page.evaluate(() => {
    const sel = document.querySelector('[data-widget-modal] select');
    const opt = [...sel.options].find((o) => o.value === '预算');
    if (opt) { sel.value = '预算'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await sleep(300);
  const canSave = await page.evaluate(() => { const b = document.querySelector('[data-widget-save]'); return b ? !b.disabled : false; });
  assert(canSave, 'S3 number widget 配置可提交（已选 2 board + 预算列）');
  await page.click('[data-widget-save]');
  await sleep(2500);
  const numText = await page.evaluate(() => document.querySelector('[data-widget="number"]')?.textContent ?? '');
  assert(numText.includes('350'), 'S3 跨板聚合 100+50+200=350（实际 ' + (numText.match(/[\d,]+/)?.[0] ?? '') + '）');

  // ---- S4 编辑已有图表 ----
  await page.evaluate(() => document.querySelector('[data-widget="number"] [data-widget-edit]')?.click());
  await sleep(400);
  const modal = await page.$('[data-widget-modal]');
  assert(!!modal, 'S4 编辑弹窗打开');
  // 改标题（React 受控 input 需原生 setter）
  await page.evaluate(() => {
    const input = document.querySelector('[data-widget-modal] input[placeholder="可选"]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '总预算');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(200);
  await page.click('[data-widget-save]');
  await sleep(1500);
  const titleShown = await page.evaluate(() => document.querySelector('[data-widget="number"]')?.textContent?.includes('总预算') ?? false);
  assert(titleShown, 'S4 编辑后标题更新为「总预算」');

  // ---- S5 类型切换：编辑 number → 改为柱状图 ----
  await page.evaluate(() => document.querySelector('[data-widget="number"] [data-widget-edit]')?.click());
  await sleep(400);
  await page.evaluate(() => document.querySelector('[data-widget-type="bar"]')?.click());
  await sleep(600);
  // 选分组列「状态」
  await page.evaluate(() => {
    const sels = [...document.querySelectorAll('[data-widget-modal] select')];
    const sel = sels.find((s) => [...s.options].some((o) => o.value === '状态'));
    if (sel) { sel.value = '状态'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await sleep(300);
  await page.click('[data-widget-save]');
  await sleep(2500);
  const barWidget = await page.$('[data-widget="bar"]');
  assert(!!barWidget, 'S5 类型切换：number → bar 生效');

  // ---- S6 gantt 图表 ----
  await page.click('[data-add-widget]');
  await sleep(400);
  await page.evaluate(() => document.querySelector('[data-widget-type="gantt"]')?.click());
  await sleep(300);
  // 勾选 2 个 board
  await page.evaluate((names) => {
    for (const n of names) {
      const lb = document.querySelector(`[data-board-option="${n}"]`);
      const cb = lb?.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) cb.click();
    }
  }, [NAME, NAME2]);
  await sleep(1200);
  await page.evaluate(() => {
    const sels = [...document.querySelectorAll('[data-widget-modal] select')];
    const sel = sels.find((s) => [...s.options].some((o) => o.value === '截止日期'));
    if (sel) { sel.value = '截止日期'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await sleep(300);
  await page.click('[data-widget-save]');
  await sleep(2000);
  const ganttWidget = await page.$('[data-widget="gantt"]');
  assert(!!ganttWidget, 'S6 gantt 图表渲染');

  // ---- S7 多指标数字卡 ----
  await page.click('[data-add-widget]');
  await sleep(400);
  await page.evaluate(() => document.querySelector('[data-widget-type="number"]')?.click());
  await sleep(300);
  await page.evaluate((names) => {
    for (const n of names) {
      const lb = document.querySelector(`[data-board-option="${n}"]`);
      const cb = lb?.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) cb.click();
    }
  }, [NAME, NAME2]);
  await sleep(1200);
  await page.evaluate(() => {
    const sels = [...document.querySelectorAll('[data-widget-modal] select')];
    const sel = sels.find((s) => [...s.options].some((o) => o.value === '预算'));
    if (sel) { sel.value = '预算'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await sleep(300);
  // 勾选「平均」多指标
  await page.evaluate(() => {
    const lb = [...document.querySelectorAll('[data-widget-modal] label')].find((x) => x.textContent.includes('平均'));
    const cb = lb?.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) cb.click();
  });
  await sleep(300);
  await page.click('[data-widget-save]');
  await sleep(2000);
  const multiNum = await page.evaluate(() => [...document.querySelectorAll('[data-widget="number"]')].some((w) => w.textContent.includes('平均')));
  assert(multiNum, 'S7 多指标数字卡（含平均）');

  // 清理
  await req(token, 'DELETE', `/dashboards/${dash.body.id}`);
  await req(token, 'DELETE', `/boards/${bidA}`);
  await req(token, 'DELETE', `/boards/${bidB}`);
  await req(token, 'DELETE', `/board-folders/${f.body.id}`);

  console.log('\n===== 第三十一批 Dashboard BI：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
