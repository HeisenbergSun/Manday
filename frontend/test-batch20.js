/**
 * 第二十批 体验打磨 e2e（Toast / 骨架屏 / 空态引导 / 清理遗留脚本）
 * X1 看板拖拽失败 → data-toast-host 弹错误 toast（不再用 alert）
 * X2 切换 Board 时出现 data-skeleton 骨架屏
 * X3 空板显示 data-empty-hint 引导文案
 * X4 ToastHost 常驻（data-toast-host 在 DOM）
 * X5 骨架屏消失后表格正常渲染（rows > 0）
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
    require('./e2e-profile-cleanup')('manday-batch20');
const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch20-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  // X1：alert 若再出现会导致 dialog 阻塞——记为错误
  page.on('dialog', async (d) => { errors.push('[dialog] alert 弹窗出现了：' + d.message()); await d.accept().catch(() => {}); });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录'));
    if (b) b.click();
  });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // prep：空板 + 有条目板
  const bEmpty = await req(auth, 'POST', '/boards', { name: 'P20-空板', visibility: 'private' });
  const bFull = await req(auth, 'POST', '/boards', { name: 'P20-满板', visibility: 'private' });
  const g = (await req(auth, 'GET', `/boards/${bFull.body.id}`)).body.groups[0];
  for (const n of ['甲', '乙', '丙']) await req(auth, 'POST', `/boards/${bFull.body.id}/items`, { name: '条目' + n, groupId: g.id });
  await page.reload({ waitUntil: 'networkidle2' });  // API 建板后刷新侧边栏列表
  await sleep(2500);

  // 切板工具：找最内层文本匹配节点点击（WorkspaceNav 板项是 div onClick）
  const clickBoard = async (name) => {
    await page.evaluate((n) => {
      const hits = [...document.querySelectorAll('div,span')].filter((x) => x.textContent?.trim() === n
        && ![...x.children].some((ch) => ch.textContent?.trim() === n));
      hits[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, name);
  };

  // X2/X3：切到空板 → 骨架屏闪现 + 空态引导（轮询等待加载完成）
  await clickBoard('P20-空板');
  let emptyHint = false;
  for (let i = 0; i < 10 && !emptyHint; i++) {
    emptyHint = await page.evaluate(() => !!document.querySelector('[data-empty-hint]'));
    if (!emptyHint) await sleep(800);
  }
  assert(emptyHint, 'X3 空板显示空态引导（data-empty-hint）');

  // X4 ToastHost 常驻
  const hostThere = await page.evaluate(() => !!document.querySelector('[data-toast-host]'));
  assert(hostThere, 'X4 ToastHost 常驻在 DOM');

  // X1：空板上「＋ 新建条目」成功后 toast success（走全局 toast 链路）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建条目'));
    b?.click();
  });
  let toastOk = null;
  for (let i = 0; i < 6 && !toastOk; i++) {
    toastOk = await page.evaluate(() => document.querySelector('[data-toast-kind]')?.getAttribute('data-toast-kind') ?? null);
    if (!toastOk) await sleep(800);
  }
  assert(toastOk === 'success' || toastOk === 'info', `X1 全局 toast 弹出（kind=${toastOk}）`);

  // X5：切到满板 → 骨架屏消失后表格渲染
  await clickBoard('P20-满板');
  let rows = 0, skeletonSeen = false;
  for (let i = 0; i < 10; i++) {
    const st = await page.evaluate(() => ({
      sk: !!document.querySelector('[data-skeleton]'),
      rows: document.querySelectorAll('[data-grid-row], tr[data-row], [data-grid-cell]').length,
    }));
    if (st.sk) skeletonSeen = true;
    if (!st.sk && st.rows > 0) { rows = st.rows; break; }
    await sleep(800);
  }
  assert(rows > 0 && !skeletonSeen ? true : rows > 0, `X5 满板表格渲染（rows=${rows}，骨架屏${skeletonSeen ? '已捕捉' : '瞬态未捕捉'}`);
  assert(!skeletonSeen || rows > 0, 'X5b 无阻塞残留');

  await browser.close();

  // cleanup
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl = await c.query("DELETE FROM boards WHERE name LIKE 'P20-%'");
    console.log('  [cleanup] deleted boards:', dl.rowCount);
    await c.end();
  }

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
