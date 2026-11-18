/**
 * 第二十二批 预设可视化与视图 e2e
 * C1 打开分析视图
 * C2 状态分布环形图（legend 含状态标签）
 * C3 成员负载条形
 * C4 月度截止柱状
 * C5 分组完成率
 * V1 一键套用预设视图集 → 6 个命名视图
 * V2 点击「⚡ 看板」命名视图 → 顶部切到看板
 * V3 default_view=insights 生效
 * T1 模板建板预置 6 个预设视图
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
// 板没有 DELETE 端点（回收站是条目级）——测试板清理直接走 DB（CASCADE 连带 views/items/values）
const { Pool } = require('C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/manday/backend/node_modules/pg');
const pg = new Pool({ connectionString: 'postgresql://neondb_owner:npg_7BnQ5ysHkARh@ep-rough-tree-a1ee1err-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' });
const purgeP22 = async () => {
  const r = await pg.query("DELETE FROM boards WHERE name LIKE 'P22-%' RETURNING name");
  return r.rowCount;
};

(async () => {
    require('./e2e-profile-cleanup')('manday-batch22');
const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch22-' + Date.now(),
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
  // /auth/me 不存在（404）——uid 取 localStorage.userId（一键登录时写入）
  const uidDev = await page.evaluate(() => localStorage.getItem('userId'));
  // 清残留（此前失败运行遗留的同名板会导致侧边栏点错）
  const removed = await purgeP22();
  if (removed) { await page.reload({ waitUntil: 'networkidle2' }); await sleep(1500); console.log(`[cleanup-pre] removed ${removed} leftover boards`); }

  // 自建 dev-owned 板 + 列 + 条目
  const bid = (await req(auth, 'POST', '/boards', { name: 'P22-Insights', visibility: 'private' })).body.id;
  const statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status',
    settings: { labels: [{ label: '待办', color: '#8a90a3' }, { label: '进行中', color: '#579bfc' }, { label: '已完成', color: '#00c875' }] } })).body;
  const dateCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '截止', type: 'date' })).body;
  const peopleCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people',
    settings: { members: [{ id: uidDev, name: 'dev' }] } })).body;
  const g = (await req(auth, 'GET', `/boards/${bid}`)).body.groups[0].id;
  const mk = async (n) => (await req(auth, 'POST', `/boards/${bid}/items`, { name: n, groupId: g })).body;
  const setCell = async (itemId, colId, value) => {
    const cur = (await req(auth, 'GET', `/items/${itemId}`)).body;
    const r = await req(auth, 'PATCH', `/items/${itemId}/cell`, { columnId: colId, value, version: cur.version });
    if (r.status >= 300) console.log(`  [setCell ${r.status}]`, JSON.stringify(r.body).slice(0, 120));
    return r;
  };
  const i1 = await mk('条目一'); await setCell(i1.id, statusCol.id, '进行中');
  const i2 = await mk('条目二'); await setCell(i2.id, statusCol.id, '已完成');
  const i3 = await mk('条目三'); await setCell(i3.id, statusCol.id, '待办');
  await setCell(i2.id, peopleCol.id, uidDev);
  await setCell(i3.id, peopleCol.id, uidDev); // i3 未完成 → 成员负载图能看到 dev
  await setCell(i3.id, dateCol.id, dayStr(20));
  await setCell(i1.id, dateCol.id, dayStr(-5));

  // C1~C5：打开分析视图
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1200);
  // 打开 seed 板之外的这块板：侧边栏点击（可能 stale，先 reload）
  const clicked = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.trim() === 'P22-Insights');
    if (!nodes.length) return false;
    nodes[nodes.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  await sleep(1500);
  if (!clicked) await page.reload({ waitUntil: 'networkidle2' }), await sleep(1000);
  console.log('uidDev:', uidDev);
  const openInsights = async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('分析'));
      if (b) b.click();
    });
    await sleep(900);
  };
  await openInsights();
  // 探针：API 侧 i2 的值 + 侧边栏当前活动板
  const apiVals = (await req(auth, 'GET', `/boards/${bid}/items`)).body?.items?.find((x) => x.id === i2.id)?.values ?? {};
  const sidebarActive = await page.evaluate(() => {
    const navs = [...document.querySelectorAll('nav')];
    const ws = navs.find((n) => n.textContent.includes('工作区'));
    if (!ws) return '(no ws nav)';
    const act = [...ws.querySelectorAll('div')].filter((c) => c.style?.background);
    return act.map((c) => `${c.textContent.trim()}[bg=${c.style.background}]`).join(' / ');
  });
  console.log('api i2 values keys:', Object.keys(apiVals).length, 'people col:', peopleCol.id, 'i2.people:', JSON.stringify(apiVals[peopleCol.id]));
  console.log('sidebar:', sidebarActive);
  assert(await page.$('[data-insights-view]'), 'C1 分析视图打开（data-insights-view）');
  const legend = await page.evaluate(() => [...document.querySelectorAll('[data-insights-legend]')].map((n) => n.getAttribute('data-insights-legend')));
  assert(legend.includes('进行中') && legend.includes('已完成'), `C2 状态环形图（legend=${legend.join(',')}）`);
  const members = await page.$$eval('[data-insights-member]', (ns) => ns.map((n) => n.getAttribute('data-insights-member')));
  // 人员显示统一改为「真实姓名优先」：uidDev 在用户表里的真实姓名是「开发账号」，
  // 不再显示 members 里造的别名 'dev'，也不显示 UUID。
  assert(members.length >= 1 && (members.includes('dev') || members.some((m) => !/[0-9a-f]{8}-/.test(m))), `C3 成员负载条形（${members.join(',')}）`);
  assert(await page.$('[data-insights-month]'), 'C4 月度截止柱状');
  const groupsChk = await page.$$eval('[data-insights-group]', (ns) => ns.map((n) => n.getAttribute('data-insights-group')));
  assert(groupsChk.length >= 1, `C5 分组完成率（${groupsChk.join(',')}）`);

  // V1：回到表格视图 → 打开视图面板 → 一键套用预设视图集
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('▤ 表格'));
    if (b) b.click();
  });
  await sleep(900);
  const openedPanel = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('视图'));
    if (!b) return false;
    b.click(); return true;
  });
  await sleep(600);
  await page.click('[data-preset-views]');
  await sleep(2500);
  const toast = await page.evaluate(() => document.querySelector('[data-toast-host]')?.textContent ?? '(no toast)');
  console.log('toast:', toast);
  const vlist = (await req(auth, 'GET', `/boards/${bid}/views`)).body;
  const arr = Array.isArray(vlist) ? vlist : vlist?.views ?? [];
  const types = arr.map((v) => v.view_type).sort();
  // 探针：6 个视图落到了哪个板？
  const allBoards = (await req(auth, 'GET', '/boards')).body ?? [];
  for (const b of (Array.isArray(allBoards) ? allBoards : [])) {
    const vs = (await req(auth, 'GET', `/boards/${b.id}/views`)).body;
    const n = (Array.isArray(vs) ? vs : vs?.views ?? []).length;
    if (n) console.log(`  [probe] board ${b.name} (${b.id === bid ? 'NEW' : 'other'}) views=${n}`);
  }
  assert(['gantt', 'insights', 'kanban', 'table', 'workload'].every((t) => types.includes(t)) && arr.length >= 5,
    `V1 预设视图集落库（${types.join(',')}）`);

  // V2：点击「⚡ 看板」命名视图 → 顶部切到看板
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1200);
  const activeName = await page.evaluate(() => {
    const navs = [...document.querySelectorAll('nav')];
    const ws = navs.find((n) => n.textContent.includes('工作区'));
    const act = ws && [...ws.querySelectorAll('div')].find((c) => c.style?.background?.includes('rgb(238'));
    return act?.textContent?.trim() ?? '(none)';
  });
  console.log('V2 active board:', activeName);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('视图'));
    if (b) b.click();
  });
  await sleep(600);
  const found = await page.evaluate(() => {
    const n = [...document.querySelectorAll('[data-view-item] span')].find((x) => x.textContent.includes('⚡ 看板'));
    if (!n) return false;
    n.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  console.log('V2 view item found:', found);
  await sleep(1200);
  const kanbanActive = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('header button, nav button')];
    const kb = btns.find((x) => x.textContent.includes('看板'));
    return { active: !!kb && kb.style.background.includes('238, 241, 254'), bg: kb?.style.background, all: btns.slice(0, 8).map((b) => `${b.textContent.trim()}=${b.style.background}`).join(' | ') };
  });
  console.log('V2 kanban btn:', JSON.stringify(kanbanActive));
  assert(kanbanActive.active && (await page.$('[data-kanban-mode]') || await page.$('[data-kanban-col]')), 'V2 命名视图跳转看板');

  // V3：default_view = insights → reload 后自动进分析视图
  await req(auth, 'PUT', `/boards/${bid}/prefs`, { defaultView: 'insights' });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  assert(await page.$('[data-insights-view]'), 'V3 default_view=insights 生效');

  // T1：模板建板 → 预置 6 视图
  const tb = (await req(auth, 'POST', '/templates/project/instantiate', { name: 'P22-模板板', withSamples: false })).body;
  const tviews = (await req(auth, 'GET', `/boards/${tb.boardId}/views`)).body;
  const tarr = Array.isArray(tviews) ? tviews : tviews?.views ?? [];
  const ttypes = tarr.map((v) => v.view_type).sort().join(',');
  assert(tarr.length >= 6 && ttypes.includes('insights') && ttypes.includes('kanban'), `T1 模板预置视图（${tarr.length} 个：${ttypes}）`);

  // cleanup
  const n = await purgeP22();
  console.log(`[cleanup] boards: ${n}`);
  await pg.end();
  await browser.close();

  console.log(`\n===== 第二十二批：${errors.length ? errors.length + ' 错误' : '全部通过'} =====`);
  errors.forEach((e) => console.log('  - ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
