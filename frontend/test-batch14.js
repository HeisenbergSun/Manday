/**
 * 第十四批 P2-4 Mirror 列 e2e
 * M1 建镜像列（connectBoardId）→ 201 + board_connects 关系落库
 * M2 缺 connectBoardId 拒绝
 * M3 写入源条目 id → detail 注入 {name,label,color} JSON
 * M4 源条目状态变更 → 镜像实时跟随
 * M5 UI：data-mirror-cell 渲染「源条目名 + 状态 chip」
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

(async () => {
    require('./e2e-profile-cleanup')('manday-batch14');
const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch14-' + Date.now(),
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

  // prep：源板 B（带状态标签）+ 主板 A
  const sb = await req(auth, 'POST', '/boards', { name: 'P2-4 源板', visibility: 'private' });
  const sid = sb.body.id;
  const stB = (await req(auth, 'POST', `/boards/${sid}/columns`, { name: '状态', type: 'status', settings: { labels: [{ label: '待办', color: '#8a90a3' }, { label: '进行中', color: '#579bfc' }], doneLabels: [] } })).body;
  const si = (await req(auth, 'POST', `/boards/${sid}/items`, { name: '源任务X' })).body;
  await req(auth, 'PATCH', `/items/${si.id}/cell`, { columnId: stB.id, value: '进行中', version: si.version });

  const mb = await req(auth, 'POST', '/boards', { name: 'P2-4 主板', visibility: 'private' });
  const mid = mb.body.id;
  assert(!!sid && !!mid, 'prep 建双板');

  // M2 缺 connectBoardId 拒绝
  const bad = await req(auth, 'POST', `/boards/${mid}/columns`, { name: '坏镜像', type: 'mirror' });
  assert(bad.status === 400 || bad.status === 500 || bad.status === 403, 'M2 缺 connectBoardId 拒绝（status=' + bad.status + '）');

  // M1 建镜像列
  const mc = await req(auth, 'POST', `/boards/${mid}/columns`, { name: '镜像状态', type: 'mirror', settings: { connectBoardId: sid } });
  assert(mc.status === 200 || mc.status === 201, 'M1 镜像列创建（status=' + mc.status + '）');

  // board_connects 落库
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const cn = await c.query('SELECT count(*) FROM board_connects WHERE column_id = $1', [mc.body.id]);
    assert(cn.rows[0].count === '1', 'M1b board_connects 关系落库');
    await c.end();
  }

  // M3 主板条目写镜像 cell（源条目 id）
  const g = (await req(auth, 'GET', `/boards/${mid}`)).body.groups[0];
  const mi = (await req(auth, 'POST', `/boards/${mid}/items`, { name: '主任务1', groupId: g.id })).body;
  const setRes = await req(auth, 'PATCH', `/items/${mi.id}/cell`, { columnId: mc.body.id, value: si.id, version: mi.version });
  assert(setRes.status === 200, 'M3a 镜像 cell 写入源条目 id（status=' + setRes.status + '）');
  const det = (await req(auth, 'GET', `/boards/${mid}`)).body;
  let mv = det.items.find((i) => i.name === '主任务1')?.values?.[mc.body.id];
  let parsed = null; try { parsed = JSON.parse(String(mv)); } catch {}
  assert(parsed && parsed.name === '源任务X' && parsed.label === '进行中' && parsed.color === '#579bfc',
    `M3b detail 注入镜像 JSON（${mv}）`);

  // M4 源状态变更 → 镜像跟随
  const cur = (await req(auth, 'GET', `/items/${si.id}`)).body;
  await req(auth, 'PATCH', `/items/${si.id}/cell`, { columnId: stB.id, value: '待办', version: cur.version });
  const det2 = (await req(auth, 'GET', `/boards/${mid}`)).body;
  const mv2 = det2.items.find((i) => i.name === '主任务1')?.values?.[mc.body.id];
  const p2 = mv2 ? JSON.parse(String(mv2)) : null;
  assert(p2 && p2.label === '待办', `M4 源状态变更镜像跟随（${mv2}）`);

  // 恢复源状态供 UI 断言
  const cur2 = (await req(auth, 'GET', `/items/${si.id}`)).body;
  await req(auth, 'PATCH', `/items/${si.id}/cell`, { columnId: stB.id, value: '进行中', version: cur2.version });

  // M5 UI
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);
  let cells = [];
  for (let i = 0; i < 8; i++) {
    cells = await page.evaluate(() => [...document.querySelectorAll('[data-mirror-cell]')].map((x) => x.textContent.trim()));
    if (cells.length) break;
    await sleep(1000);
  }
  assert(cells.some((t) => t.includes('源任务X') && t.includes('进行中')), `M5 镜像单元格渲染（${cells.slice(0, 4).join('|')}）`);
  // 镜像列可点击选择（编辑器下拉出现）
  await page.evaluate(() => document.querySelector('[data-mirror-cell]').closest('td').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(600);
  // MirrorEditor 需先拉源板（Neon 延迟），轮询等待自定义下拉出现
  let editorOk = false;
  for (let i = 0; i < 10 && !editorOk; i++) {
    editorOk = await page.evaluate(() => !!document.querySelector('[data-chip-dropdown]'));
    if (!editorOk) await sleep(1000);
  }
  assert(editorOk, 'M5b 单击镜像格出现选择编辑器');
  // 点击外部关闭自定义下拉
  await page.mouse.click(400, 850);
  await sleep(300);

  await browser.close();

  // cleanup
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl = await c.query("DELETE FROM boards WHERE name LIKE 'P2-4 %'");
    console.log('  [cleanup] deleted boards:', dl.rowCount);
    await c.end();
  }

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
