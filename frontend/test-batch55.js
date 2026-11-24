/**
 * 第五十五批 e2e：workspace 图标替换 + 工具条颜色统一
 * S1  workspace 侧边栏 board 项渲染 board 图标（svg），dashboard 项渲染 dashboard 图标（svg）
 * S2  工具条按钮（成员/列与分组/自动化/导出/导入/视图）文字与图标统一为搜索按钮同色 #7a7f8c
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

const GRAY = 'rgb(122, 127, 140)'; // #7a7f8c

(async () => {
  require('./e2e-profile-cleanup')('manday-batch55');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch55-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B55-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // 准备 board + dashboard
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
  await req(auth, 'POST', `/boards/${bid}/items`, { name: '条目一' });
  const dash = await req(auth, 'POST', '/dashboards', { name: NAME + '-Dash', scope: 'personal' });
  const dashId = dash.body.id;

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1800);

  // ── S1 workspace 图标 ──
  const boardSvg = await page.$(`[data-board-item="${NAME}"] svg`);
  assert(!!boardSvg, 'S1a board 项渲染 board 图标（svg）');
  const dashSvg = await page.$(`[data-dashboard-item="${NAME + '-Dash'}"] svg`);
  assert(!!dashSvg, 'S1b dashboard 项渲染 dashboard 图标（svg）');

  // ── S2 工具条颜色统一 ──
  await page.evaluate((n) => document.querySelector(`[data-board-item="${n}"]`)?.click(), NAME);
  await sleep(2500);
  const colors = await page.evaluate(() => {
    const bySel = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).color : null; };
    const byText = (t) => {
      const el = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(t));
      return el ? getComputedStyle(el).color : null;
    };
    return {
      search: byText('搜索'),
      member: byText('成员'),
      filter: byText('筛选'),
      mgr: bySel('[data-mgr-trigger="1"]'),
      auto: bySel('[data-auto-trigger="1"]'),
      export: bySel('[data-export-xlsx]'),
      import: bySel('[data-import-excel]'),
      views: bySel('[data-views-trigger="1"]'),
    };
  });
  const check = (label, v) => assert(v === GRAY, `S2 ${label} 颜色 = #7a7f8c（${v}）`);
  check('搜索', colors.search);
  check('成员', colors.member);
  check('筛选', colors.filter);
  check('列与分组', colors.mgr);
  check('自动化', colors.auto);
  check('导出 Excel', colors.export);
  check('导入 Excel', colors.import);
  check('⧉ 视图', colors.views);

  // 清理
  await req(auth, 'DELETE', `/dashboards/${dashId}`);
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第五十五批 workspace 图标 + 工具条颜色统一：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
