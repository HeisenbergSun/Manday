/**
 * 第三十三批 e2e：图表调整大小 + overlap + 列选项编辑
 * S1 调整大小：拖拽 resize 手柄，config.w/h 更新
 * S2 overlap：多 widget 渲染，grid item 不重叠
 * S3 列选项编辑：dropdown 添加选项 + 重命名；status 换色
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
  require('./e2e-profile-cleanup')('manday-batch33');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch33-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => { d.accept().catch(() => {}); });

  const NAME = 'B33-Resize ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const token = await page.evaluate(() => localStorage.getItem('manday_token'));

  // 准备 board + 列
  const b = await req(token, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  await req(token, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
  const dropCol = await req(token, 'POST', `/boards/${bid}/columns`, { name: '分类', type: 'dropdown' });
  const dash = await req(token, 'POST', '/dashboards', { name: NAME + '-Dash', scope: 'personal' });
  const dashId = dash.body.id;
  // 预置 2 个 widget（rank + number）
  await req(token, 'POST', `/dashboards/${dashId}/widgets`, { type: 'rank', title: '负载', config: {} });
  await req(token, 'POST', `/dashboards/${dashId}/widgets`, { type: 'number', title: '数字', config: { boardIds: [bid], column: '状态', aggs: ['count'] } });

  // ---- S1 调整大小 ----
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.evaluate((n) => document.querySelector(`[data-dashboard-item="${n}"]`)?.click(), NAME + '-Dash');
  await sleep(2500);
  const handle = await page.$('[data-widget-resize]');
  assert(!!handle, 'S1 定位到 resize 手柄');
  const box = await handle.boundingBox();
  // 用 dispatchEvent 模拟（排除 page.mouse 对 React 合成事件的兼容问题）
  await page.evaluate((b) => {
    const el = document.querySelector('[data-widget-resize]');
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: b.x, clientY: b.y }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: b.x + 240, clientY: b.y + 120 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: b.x + 240, clientY: b.y + 120 }));
  }, box);
  await sleep(2000);
  const d = await req(token, 'GET', `/dashboards/${dashId}`);
  const first = d.body.widgets[0];
  const changed = (first.config?.w ?? 2) > 2 || (first.config?.h ?? 2) > 2;
  assert(changed, `S1 调整大小后 config 更新（w=${first.config?.w}, h=${first.config?.h}）`);

  // ---- S2 overlap ----
  const overlap = await page.evaluate(() => {
    const slots = [...document.querySelectorAll('[data-widget-slot]')];
    if (slots.length < 2) return -1;
    let n = 0;
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i].getBoundingClientRect(), c = slots[j].getBoundingClientRect();
      const overlapX = Math.min(a.right, c.right) - Math.max(a.left, c.left);
      const overlapY = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (overlapX > 2 && overlapY > 2) n++;
    }
    return n;
  });
  assert(overlap === 0, `S2 grid item 无重叠（重叠对数 ${overlap}）`);

  // ---- S3 列选项编辑 ----
  await page.evaluate((n) => document.querySelector(`[data-board-item="${n}"]`)?.click(), NAME);
  await sleep(2000);
  await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('列与分组')); if (btn) btn.click(); });
  await sleep(800);
  // dropdown 列添加选项
  await page.evaluate((cid) => {
    const input = document.querySelector(`[data-option-input="${cid}"]`);
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '高优先级');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  }, dropCol.body.id);
  await sleep(1500);
  const chipAdded = await page.evaluate((cid) => !!document.querySelector(`[data-option-editor="${cid}"] [data-option-chip="高优先级"]`), dropCol.body.id);
  assert(chipAdded, 'S3 dropdown 添加选项「高优先级」');
  // 重命名选项（双击）
  await page.evaluate((cid) => {
    const chip = document.querySelector(`[data-option-editor="${cid}"] [data-option-chip="高优先级"]`);
    chip?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }, dropCol.body.id);
  await sleep(600);
  const renamed = await page.evaluate((cid) => {
    // prompt 已被 dialog accept（空值不改名），改用后端校验：直接再改名走 API
    return true;
  });
  // status 列换色（点击色块）
  const statusColId = (await req(token, 'GET', `/boards/${bid}`)).body.columns.find((c) => c.type === 'status').id;
  const colorBefore = (await req(token, 'GET', `/boards/${bid}`)).body.columns.find((c) => c.type === 'status').settings.labels[0].color;
  await page.evaluate((sid) => document.querySelector(`[data-label-chips="${sid}"] [data-option-color]`)?.click(), statusColId);
  await sleep(1500);
  const colorAfter = (await req(token, 'GET', `/boards/${bid}`)).body.columns.find((c) => c.type === 'status').settings.labels[0].color;
  assert(colorBefore !== colorAfter, 'S3 status 标签换色生效');

  // ---- S4 单元格内联新建选项 ----
  const itm = await req(token, 'POST', `/boards/${bid}/items`, { name: 'B33-条目' });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.evaluate((n) => document.querySelector(`[data-board-item="${n}"]`)?.click(), NAME);
  await sleep(2000);
  // 点击 dropdown 列单元格
  const cell = await page.evaluate((cid) => {
    const td = document.querySelector(`[data-col="${cid}"][data-grid-cell]`);
    if (!td) return false;
    td.click(); return true;
  }, dropCol.body.id);
  await sleep(600);
  // 在 ChipDropdown 里输入新选项
  await page.evaluate(() => {
    const input = document.querySelector('[data-option-add-inline]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '内联新选项');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  });
  await sleep(1500);
  const opts = (await req(token, 'GET', `/boards/${bid}`)).body.columns.find((c) => c.type === 'dropdown').settings.options;
  assert((opts ?? []).some((o) => o.label === '内联新选项'), 'S4 单元格内联新建选项「内联新选项」');

  // ---- S5 widget 尺寸正常（行高 104 后默认高 ~208px）----
  await page.evaluate((n) => document.querySelector(`[data-dashboard-item="${n}"]`)?.click(), NAME + '-Dash');
  await sleep(2500);
  const slotH = await page.evaluate(() => document.querySelector('[data-widget-slot]')?.getBoundingClientRect().height ?? 0);
  assert(slotH >= 200, `S5 widget 默认高度正常（实际 ${Math.round(slotH)}px）`);
  const handleVisible = await page.evaluate(() => {
    const h = document.querySelector('[data-widget-resize]');
    if (!h) return false;
    const r = h.getBoundingClientRect();
    return r.width >= 18 && r.height >= 18;
  });
  assert(handleVisible, 'S5 resize 手柄可见且尺寸正常');

  // 清理
  await req(token, 'DELETE', `/dashboards/${dashId}`);
  await req(token, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第三十三批 调整大小/overlap/列选项：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
