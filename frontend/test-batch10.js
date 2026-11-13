/**
 * 第十批 e2e：P1 剩余——P1-7 看板绑 Status / P1-5 可编辑甘特 / P1-8 Workload / P1-9 句子式自动化
 * W1 API 自动化句子创建 → 201，列表可见，可删除
 * W2 API 非法 action → 400/500（白名单）
 * W3 UI 自动化面板：句子下拉 + 创建 + 规则列表
 * W4 UI 看板按状态模式：泳道数 = status 标签数；拖卡到另一泳道 → 状态单元格更新
 * W5 UI Workload 视图：tab 存在、进入后按人员列统计条数
 * W6 UI 可编辑甘特：拖时间条 → 日期单元格变化
 */
const puppeteer = require('puppeteer-core');
const jwt = require('../backend/node_modules/jsonwebtoken');

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

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch10-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  // ---- 准备：dev 登录，建测试 board（status 列 + people 列 + date 列 + 2 条目）----
  const NAME = 'P1 收尾验证 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录'));
    if (b) b.click();
  });
  await sleep(2000);
  const devToken = await page.evaluate(() => localStorage.getItem('manday_token'));
  const devAuth = 'Bearer ' + devToken;
  const bid = (await req(devAuth, 'POST', '/boards', { name: NAME, visibility: 'company' })).body.id;
  assert(!!bid, 'prep 建测试 board');
  await req(devAuth, 'POST', `/boards/${bid}/items`, { name: '任务A' });
  await req(devAuth, 'POST', `/boards/${bid}/items`, { name: '任务B' });
  const cols = (await req(devAuth, 'GET', `/boards/${bid}/items`)).body;
  let statusCol = cols.columns.find((c) => c.type === 'status');
  if (!statusCol) statusCol = (await req(devAuth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' })).body;
  const peopleCol = (await req(devAuth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people' })).body;
  const dateCol = (await req(devAuth, 'POST', `/boards/${bid}/columns`, { name: '开始日期', type: 'date' })).body;
  const labels = (statusCol.settings?.labels ?? []).map((l) => l.label);
  // 给条目赋值：人员 + 日期
  const items2 = (await req(devAuth, 'GET', `/boards/${bid}/items`)).body.items;
  const uid = await page.evaluate(() => localStorage.getItem('userId'));
  await req(devAuth, 'PATCH', `/items/${items2[0].id}/cell`, { columnId: peopleCol.id, value: uid, version: items2[0].version });
  await req(devAuth, 'PATCH', `/items/${items2[0].id}/cell`, { columnId: dateCol.id, value: '2026-11-13', version: items2[0].version });
  await req(devAuth, 'PATCH', `/items/${items2[1].id}/cell`, { columnId: dateCol.id, value: '2026-11-14', version: items2[1].version });
  if (labels.length) {
    const r0 = await req(devAuth, 'PATCH', `/items/${items2[0].id}/cell`, { columnId: statusCol.id, value: labels[0], version: items2[0].version });
    if (r0.status >= 400) {
      const fresh = (await req(devAuth, 'GET', `/boards/${bid}/items`)).body.items;
      await req(devAuth, 'PATCH', `/items/${fresh[0].id}/cell`, { columnId: statusCol.id, value: labels[0], version: fresh[0].version });
    }
  }

  // ---- W1/W2 自动化 API ----
  const a1 = await req(devAuth, 'POST', `/boards/${bid}/automations`, {
    trigger: { type: 'status_changed', to: labels[0] ?? '已完成' }, action: { type: 'move_group' }, name: '句子测试', source: 'ui-sentence' });
  assert(a1.status === 200 || a1.status === 201, `W1 句子式创建自动化: ${a1.status}`);
  const list1 = await req(devAuth, 'GET', `/boards/${bid}/automations`);
  assert(Array.isArray(list1.body) && list1.body.length >= 1, `W1 规则列表可见（${JSON.stringify(list1.body?.length ?? list1.body)}）`);
  const bad = await req(devAuth, 'POST', `/boards/${bid}/automations`, { trigger: { type: 'x' }, action: { type: 'rm_rf' } });
  assert(bad.status >= 400, `W2 非法 action 被拒: ${bad.status}`);

  // ---- W3 UI 自动化面板 ----
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((n) => {
    const b = [...document.querySelectorAll('button,div,span')].find((x) => x.textContent?.trim() === n);
    if (b) b.click();
  }, NAME);
  await sleep(1200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('⚡ 自动化'));
    if (b) b.click();
  });
  await sleep(600);
  const panelOpen = await page.evaluate(() => !!document.querySelector('[data-automation-panel]'));
  assert(panelOpen, 'W3 自动化面板打开');
  const sentenceSelects = await page.evaluate(() => document.querySelectorAll('[data-sentence-select]').length);
  assert(sentenceSelects >= 3, `W3 句子式下拉就位（${sentenceSelects} 个）`);
  const ruleCount = await page.evaluate(() => document.querySelectorAll('[data-auto-rule]').length);
  assert(ruleCount >= 1, `W3 规则列表显示已建规则（${ruleCount}）`);
  // 改 then 下拉 → 创建一条「移动到分组」句子
  await page.evaluate(() => {
    const sel = document.querySelector('[data-sentence-select="when"]');
    sel.value = 'item_created'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(200);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === '创建自动化');
    btns[btns.length - 1].click();
  });
  await sleep(1200);
  const ruleCount2 = await page.evaluate(() => document.querySelectorAll('[data-auto-rule]').length);
  assert(ruleCount2 === ruleCount + 1, `W3 句子创建成功（${ruleCount} → ${ruleCount2}）`);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('⚡ 自动化'));
    if (b) b.click(); // 关闭面板
  });
  await sleep(300);

  // ---- W4 看板按状态模式 ----
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('▦ 看板'));
    if (b) b.click();
  });
  await sleep(800);
  const hasStatusBtn = await page.evaluate(() => {
    const b = document.querySelector('[data-kanban-mode="status"]');
    return b && b.textContent.includes('按状态');
  });
  assert(hasStatusBtn, 'W4 看板出现「按状态」切换按钮');
  await page.evaluate(() => document.querySelector('[data-kanban-mode="status"]').click());
  await sleep(800);
  const lanes = await page.evaluate(() => [...document.querySelectorAll('[data-kanban-col]')].map((x) => x.getAttribute('data-kanban-col')));
  const laneCount = lanes.length;
  assert(laneCount === (statusCol.settings?.labels ?? []).filter((l) => !(statusCol.settings?.inactiveLabels ?? []).includes(l.label)).length,
    `W4 状态泳道数 = 活动标签数（${laneCount}）`);
  // 拖任务A到第二个泳道（HTML5 dnd 不适用于 dnd-kit pointer events——用模拟 pointer 拖拽）
  if (lanes.length >= 2) {
    const target = lanes[1];
    const pos = await page.evaluate((t) => {
      const card = [...document.querySelectorAll('[data-kanban-col] [data-dnd-draggable], [data-kanban-col] div')].find(() => false);
      return null;
    }, target);
    // dnd-kit 需要 pointer 事件：用 page.mouse 从第一张卡拖到目标泳道
    const cardBox = await page.evaluate(() => {
      const col = document.querySelector('[data-kanban-col]');
      if (!col) return null;
      const card = [...col.children].find((c) => c.querySelector && c.querySelector('b') && c.querySelector('b').textContent);
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: card.querySelector('b')?.textContent };
    });
    if (!cardBox) { assert(false, 'W4 第一泳道内有卡片'); }
    else {
      const laneBox = await page.evaluate((t) => {
        const col = [...document.querySelectorAll('[data-kanban-col]')].find((x) => x.getAttribute('data-kanban-col') === t);
        const r = col.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: Math.min(r.y + 100, r.y + r.height / 2) };
      }, target);
      await page.mouse.move(cardBox.x, cardBox.y);
      await page.mouse.down();
      await page.mouse.move(cardBox.x + 15, cardBox.y + 5, { steps: 5 });
      await page.mouse.move(laneBox.x, laneBox.y, { steps: 12 });
      await sleep(150);
      await page.mouse.up();
      await sleep(1200);
      // 直接从 API 验证状态单元格
      const after = await req(devAuth, 'GET', `/boards/${bid}/items`);
      const targetLabel = lanes[1];
      const moved = after.body.items.some((i) => String(i.values?.[statusCol.id] ?? '') === targetLabel);
      assert(moved, `W4 拖卡改状态生效（任务A →「${targetLabel}」）`);
    }
  }

  // ---- W5 Workload 视图 ----
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Workload'));
    if (b) b.click();
  });
  await sleep(800);
  const wl = await page.evaluate(() => !!document.querySelector('[data-workload-root]'));
  assert(wl, 'W5 Workload 视图打开');
  const wlText = await page.evaluate(() => document.querySelector('[data-workload-root]')?.innerText ?? '');
  assert(wlText.includes('1 条') || wlText.includes('条 ·'), 'W5 按人员列统计条数（含 1 条）');

  // ---- W6 可编辑甘特（先 reload 拿最新 item version，避免 LWW 冲突）----
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('📈 甘特'));
    if (b) b.click();
  });
  await sleep(800);
  const bar = await page.evaluate(() => {
    const b = document.querySelector('[data-gantt-bar]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  assert(!!bar, 'W6 甘特时间条渲染');
  if (bar) {
    // 事件派发模拟：mousedown（条上）→ mousemove +42px（3 天）→ mouseup
    await page.evaluate(() => {
      const b = document.querySelector('[data-gantt-bar]');
      const r = b.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 21, clientY: y }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 42, clientY: y }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 42, clientY: y }));
    });
    await sleep(400);
    const gtoast = await page.evaluate(() => document.querySelector('[data-gantt-toast]')?.textContent ?? '');
    console.log('  [debug] gantt toast:', JSON.stringify(gtoast));
    await sleep(1200);
    const after2 = await req(devAuth, 'GET', `/boards/${bid}/items`);
    const dates = after2.body.items.map((i) => i.values?.[dateCol.id]).filter(Boolean).map((s) => String(s).slice(0, 10)).sort();
    const changed = dates.some((d) => d === '2026-11-16' || d === '2026-11-17');
    assert(changed, `W6 拖拽时间条更新日期（期望 11-13 → 11-16/17，实际 ${JSON.stringify(dates)}）`);
  }

  await browser.close();
  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
