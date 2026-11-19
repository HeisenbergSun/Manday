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

  // 准备：2 个 board，各带「预算」number 列 + 条目
  const mk = async (name, vals) => {
    const b = await req(token, 'POST', '/boards', { name, visibility: 'company' });
    const bid = b.body.id;
    const col = await req(token, 'POST', `/boards/${bid}/columns`, { name: '预算', type: 'number' });
    const statusCol = await req(token, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
    for (const v of vals) {
      const it = await req(token, 'POST', `/boards/${bid}/items`, { name: v.name });
      const fresh = await req(token, 'GET', `/items/${it.body.id}`);
      await req(token, 'PATCH', `/items/${it.body.id}/cell`, { columnId: col.body.id, value: v.val, version: fresh.body.version });
    }
    return bid;
  };
  const bidA = await mk(NAME, [{ name: 'A1', val: 100 }, { name: 'A2', val: 50 }]);
  const bidB = await mk(NAME2, [{ name: 'B1', val: 200 }]);
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
  const dash = await req(token, 'POST', '/dashboards', { name: 'B31-Dashboard' });
  assert(!!dash.body.id, 'S2 建 dashboard');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  assert(await page.evaluate((n) => !!document.querySelector(`[data-dashboard-item="${n}"]`), 'B31-Dashboard'), 'S2 Dashboard 显示在导航');

  // ---- S3 number widget 关联 2 board ----
  await page.evaluate((n) => document.querySelector(`[data-dashboard-item="${n}"]`)?.click(), 'B31-Dashboard');
  await sleep(2000);
  await page.click('[data-add-widget]');
  await sleep(400);
  await page.evaluate(() => document.querySelector('[data-widget-type="number"]')?.click());
  await sleep(300);
  // 勾选 2 个 board（按 data-board-option 精确匹配）
  await page.evaluate((names) => {
    for (const n of names) {
      const lb = document.querySelector(`[data-board-option="${n}"]`);
      const cb = lb?.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) cb.click();
    }
  }, [NAME, NAME2]);
  await sleep(1200); // 等跨板列名加载
  // 选「预算」数值列（number 类型第一个 select）
  await page.evaluate(() => {
    const sels = [...document.querySelectorAll('[data-widget-modal] select')];
    const sel = sels[0];
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

  // 清理
  await req(token, 'DELETE', `/dashboards/${dash.body.id}`);
  await req(token, 'DELETE', `/boards/${bidA}`);
  await req(token, 'DELETE', `/boards/${bidB}`);
  await req(token, 'DELETE', `/board-folders/${f.body.id}`);

  console.log('\n===== 第三十一批 Dashboard BI：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
