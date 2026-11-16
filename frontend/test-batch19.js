/**
 * 第十九批 Dashboard 增强 e2e（跨板逾期 / 成员负载排行 / 近期动态）
 * N1 后端 overdue：逾期条目出现在列表（board/due 正确），完成后消失
 * N2 后端 workload-rank：人员未完成条目计数
 * N3 后端 activity：item.update 落动态流（actor/target）
 * N4 UI：三张卡片渲染（data-dash-overdue/rank/activity）+ 逾期行可见
 * N5 UI：点击逾期行打开详情
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
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch19-' + Date.now(),
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

  // prep：两块板，各含 date/status/people 列；A 板逾期条目 + 张伟条目 + cell 写入产生 audit
  const bA = await req(auth, 'POST', '/boards', { name: 'P19-Dash A', visibility: 'private' });
  const bB = await req(auth, 'POST', '/boards', { name: 'P19-Dash B', visibility: 'private' });
  const bidA = bA.body.id, bidB = bB.body.id;
  // people 列存用户 id → 取真实用户 id
  const users = (await req(auth, 'GET', '/users')).body;
  const uidZhang = (Array.isArray(users) ? users : users.users ?? []).find((u) => u.name === '张伟')?.id;
  const uidLi = (Array.isArray(users) ? users : users.users ?? []).find((u) => u.name === '李娜')?.id;
  assert(uidZhang && uidLi, 'P0 取到张伟/李娜用户 id');
  // 基线：创建条目前的李娜负载（seed 板本来就有她的条目）
  const liBefore = ((await req(auth, 'GET', '/dashboards/workload-rank')).body || []).find((x) => x.name === '李娜')?.cnt ?? 0;
  const setupBoard = async (bid) => {
    const g = (await req(auth, 'GET', `/boards/${bid}`)).body.groups[0];
    const dateCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '截止', type: 'date' })).body;
    const statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status',
      settings: { labels: [{ label: '进行中', color: '#fdab3d' }, { label: '已完成', color: '#00c875' }], doneLabels: ['已完成'] } })).body;
    const peopleCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people' })).body;
    return { g, dateCol, statusCol, peopleCol };
  };
  const A = await setupBoard(bidA);
  const B = await setupBoard(bidB);
  const mk = async (bid, grp, name) => (await req(auth, 'POST', `/boards/${bid}/items`, { name, groupId: grp.id })).body;
  const setCell = async (itemId, colId, value) => {
    const cur = (await req(auth, 'GET', `/items/${itemId}`)).body;
    await req(auth, 'PATCH', `/items/${itemId}/cell`, { columnId: colId, value, version: cur.version });
  };
  const itOver = await mk(bidA, A.g, '逾期条目甲');   // A 板昨日截止，未完成
  await setCell(itOver.id, A.dateCol.id, dayStr(-2));
  await setCell(itOver.id, A.statusCol.id, '进行中');
  const itZhang = await mk(bidA, A.g, '张伟任务一');
  await setCell(itZhang.id, A.peopleCol.id, uidZhang);
  await setCell(itZhang.id, A.statusCol.id, '进行中');
  const itDone = await mk(bidB, B.g, '李娜已完成项');
  await setCell(itDone.id, B.peopleCol.id, uidLi);
  await setCell(itDone.id, B.statusCol.id, '已完成');   // 完成不计负载
  const itOk = await mk(bidB, B.g, '未来条目乙');       // B 板未来截止，不应出现在逾期
  await setCell(itOk.id, B.dateCol.id, dayStr(10));

  // N1 overdue
  const od = await req(auth, 'GET', '/dashboards/overdue');
  assert(od.status === 200 && od.body.some((x) => x.name === '逾期条目甲' && x.board === 'P19-Dash A'),
    `N1 逾期列表含「逾期条目甲」（${JSON.stringify((od.body || []).slice(0, 3).map((x) => x.name))}）`);
  assert(!od.body.some((x) => x.name === '未来条目乙'), 'N1b 未来条目不在逾期列表');

  // N2 workload-rank
  const rk = await req(auth, 'GET', '/dashboards/workload-rank');
  const z = (rk.body || []).find((x) => x.name === '张伟');
  const l = (rk.body || []).find((x) => x.name === '李娜');
  assert(z && z.cnt >= 1, `N2 张伟负载 count=${z?.cnt}`);
  assert((l?.cnt ?? 0) === liBefore, `N2b 已完成条目不计入负载（李娜 before=${liBefore} after=${l?.cnt ?? 0}）`);

  // N3 activity（cell 写入会产生 item.update audit）
  const ac = await req(auth, 'GET', '/dashboards/activity');
  assert(ac.status === 200 && (ac.body || []).some((x) => x.action.startsWith('item.') && x.board === 'P19-Dash A'),
    `N3 动态流含 item.* + 板名（${JSON.stringify((ac.body || []).slice(0, 2).map((x) => x.action))}）`);

  // N4 UI：进入 Dashboard 视图
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Dashboard'));
    b?.click();
  });
  let ui = { overdue: false, rank: false, activity: false, row: null };
  for (let i = 0; i < 8; i++) {
    ui = await page.evaluate((name) => ({
      overdue: !!document.querySelector('[data-dash-overdue]'),
      rank: !!document.querySelector('[data-dash-rank]'),
      activity: !!document.querySelector('[data-dash-activity]'),
      row: document.querySelector(`[data-overdue-row="${name}"]`)?.textContent ?? null,
    }), '逾期条目甲');
    if (ui.overdue && ui.rank && ui.activity && ui.row) break;
    await sleep(1000);
  }
  assert(ui.overdue && ui.rank && ui.activity, 'N4 三张卡片渲染');
  assert(ui.row && ui.row.includes('逾期条目甲') && ui.row.includes('P19-Dash A'), `N4b 逾期行可见（${ui.row}）`);

  // N5 点击逾期行 → 详情
  await page.evaluate((name) => document.querySelector(`[data-overdue-row="${name}"]`)?.click(), '逾期条目甲');
  await sleep(800);
  const detail = await page.evaluate(() => !!document.querySelector('aside, [data-comment-input]'));
  assert(detail, 'N5 点击逾期行打开详情');

  await browser.close();

  // cleanup
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl = await c.query("DELETE FROM boards WHERE name LIKE 'P19-Dash %'");
    const da = await c.query("DELETE FROM audit_logs WHERE target LIKE 'item:%' AND created_at > now() - interval '2 hours'");
    console.log('  [cleanup] deleted boards:', dl.rowCount, 'audit rows:', da.rowCount);
    await c.end();
  }

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
