/**
 * 第五十一批 e2e：P1-5 可编辑甘特 / P1-7 看板 Status 绑定 / P1-8 Workload 热力
 * S1  甘特单日期列拖右缘 +2 天 → 日期正确（本地时区无偏移 + 单日期右缘拖修复）
 * S2  看板多状态列绑定：切换绑定的状态列 → 分桶列随之变化
 * S3  Workload 热力条：今天日期的格子命中 1 条（本地时区无偏移）
 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const API = BASE + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let errors = [];
const assert = (c, m) => { if (!c) { errors.push(m); console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const req = async (auth, method, path_, body) => {
  const r = await fetch(API + path_, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = fmtLocal(new Date());

(async () => {
  require('./e2e-profile-cleanup')('manday-batch51');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch51-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B51-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  const setCell = async (itemId, colId, value) => {
    const cur = (await req(auth, 'GET', `/items/${itemId}`)).body;
    await req(auth, 'PATCH', `/items/${itemId}/cell`, { columnId: colId, value, version: cur.version });
  };
  const openBoard = async (name) => {
    // reload 让 API 新建的 board 进入左侧列表，再点击打开
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    await page.evaluate((name) => {
      const els = [...document.querySelectorAll('span,div,a,button')];
      const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
      if (t) t.click();
    }, name);
    await sleep(2500);
  };
  const switchView = async (label) => {
    await page.evaluate((label) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(label));
      if (b) b.click();
    }, label);
    await sleep(2500);
  };

  // ── S1 甘特：单日期列拖右缘 +2 天 ──
  const gBoard = await req(auth, 'POST', '/boards', { name: NAME + '-甘特', visibility: 'company' });
  const gbid = gBoard.body.id;
  const gDateCol = (await req(auth, 'POST', `/boards/${gbid}/columns`, { name: '日期', type: 'date' })).body;
  const gItem = (await req(auth, 'POST', `/boards/${gbid}/items`, { name: '甘特条目' })).body;
  await setCell(gItem.id, gDateCol.id, '2026-11-20'); // 固定日期，避免今天边界

  await openBoard(NAME + '-甘特');
  await switchView('甘特');
  const bar = await page.$('[data-gantt-bar]');
  assert(!!bar, 'S1a 甘特视图渲染时间条');
  const box = await bar?.boundingBox();
  if (box) {
    const sx = box.x + box.width - 3; // 右缘手柄
    const sy = box.y + box.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 28, sy, { steps: 10 }); // 28px = 2 天
    await page.mouse.up();
    await sleep(1800);
    const updated = (await req(auth, 'GET', `/items/${gItem.id}`)).body;
    const newDate = String(updated?.values?.[gDateCol.id] ?? '');
    assert(newDate === '2026-11-22', `S1b 拖右缘 +2 天日期正确（${newDate}，期望 2026-11-22）`);
  } else {
    assert(false, 'S1b 甘特条无坐标');
  }

  // ── S2 看板多状态列绑定 ──
  const kBoard = await req(auth, 'POST', '/boards', { name: NAME + '-看板', visibility: 'company' });
  const kbid = kBoard.body.id;
  const kStatus1 = (await req(auth, 'POST', `/boards/${kbid}/columns`, { name: '阶段', type: 'status' })).body;
  const kStatus2 = (await req(auth, 'POST', `/boards/${kbid}/columns`, {
    name: '优先级', type: 'status',
    settings: { labels: [{ label: '高', color: '#e2445c' }, { label: '中', color: '#fdab3d' }, { label: '低', color: '#579bfc' }], doneLabels: [] },
  })).body;
  const kItem = (await req(auth, 'POST', `/boards/${kbid}/items`, { name: '看板条目' })).body;
  await setCell(kItem.id, kStatus1.id, '待办');
  await setCell(kItem.id, kStatus2.id, '高');

  await openBoard(NAME + '-看板');
  await switchView('看板');
  await page.evaluate(() => document.querySelector('[data-kanban-mode="status"]')?.click());
  await sleep(1500);
  const colIds1 = await page.evaluate(() => [...document.querySelectorAll('[data-kanban-col]')].map((n) => n.getAttribute('data-kanban-col')));
  assert(colIds1.includes('待办'), `S2a 默认绑定第一个状态列（列含「待办」，实际 ${JSON.stringify(colIds1)}）`);
  const statusColSel = await page.$('select[data-kanban-status-col]');
  assert(!!statusColSel, 'S2b 多状态列时出现绑定选择器');
  if (statusColSel) {
    await page.select('select[data-kanban-status-col]', kStatus2.id);
    await sleep(1500);
    const colIds2 = await page.evaluate(() => [...document.querySelectorAll('[data-kanban-col]')].map((n) => n.getAttribute('data-kanban-col')));
    assert(colIds2.includes('高') && !colIds2.includes('待办'), `S2c 切换绑定到第二状态列（列含「高」，实际 ${JSON.stringify(colIds2)}）`);
  }

  // ── S3 Workload 热力条今天日期 ──
  const users = (await req(auth, 'GET', '/users')).body;
  const uid = (Array.isArray(users) ? users : users.users ?? []).find((u) => u.name === '张伟')?.id;
  const wBoard = await req(auth, 'POST', '/boards', { name: NAME + '-负载', visibility: 'company' });
  const wbid = wBoard.body.id;
  const wPeopleCol = (await req(auth, 'POST', `/boards/${wbid}/columns`, { name: '负责人', type: 'people' })).body;
  const wDateCol = (await req(auth, 'POST', `/boards/${wbid}/columns`, { name: '截止', type: 'date' })).body;
  const wStatusCol = (await req(auth, 'POST', `/boards/${wbid}/columns`, { name: '状态', type: 'status' })).body;
  const wItem = (await req(auth, 'POST', `/boards/${wbid}/items`, { name: '今日任务' })).body;
  if (uid) await setCell(wItem.id, wPeopleCol.id, uid);
  await setCell(wItem.id, wDateCol.id, todayStr);
  await setCell(wItem.id, wStatusCol.id, '进行中');

  await openBoard(NAME + '-负载');
  await switchView('Workload');
  const heatCount = await page.evaluate((today) => {
    const c = document.querySelector(`[data-heat-cell="${today}"]`);
    return c ? Number(c.getAttribute('data-heat-count')) : null;
  }, todayStr);
  assert(heatCount === 1, `S3 Workload 热力条今天格子命中 1 条（实际 ${heatCount}）`);

  // 清理
  await req(auth, 'DELETE', `/boards/${gbid}`);
  await req(auth, 'DELETE', `/boards/${kbid}`);
  await req(auth, 'DELETE', `/boards/${wbid}`);

  console.log('\n===== 第五十一批 P1-5/P1-7/P1-8：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
