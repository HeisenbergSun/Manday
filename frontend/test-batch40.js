/**
 * 第四十批 e2e：列拖拽换序持久化 + board 移进分组
 * S1 列 reorder（API 顺序变化，position 更新）
 * S2 board 移进分组（addBoardToFolder → listFolders boardIds 包含）
 * S3 前端列头/分组头可拖拽
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

(async () => {
  require('./e2e-profile-cleanup')('manday-batch40');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch40-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B40-列序 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // 建 board + 2 列 + 1 条目
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  const c1 = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '列A', type: 'text' })).body;
  const c2 = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '列B', type: 'number' })).body;

  // S1 列 reorder（A/B 互换）
  await req(auth, 'POST', `/boards/${bid}/columns/reorder`, { order: [c2.id, c1.id] });
  const det = (await req(auth, 'GET', `/boards/${bid}`)).body;
  const cols = det.columns ?? [];
  const idxA = cols.findIndex((x) => x.id === c1.id);
  const idxB = cols.findIndex((x) => x.id === c2.id);
  assert(idxB < idxA, `S1 列 reorder 后 B 在 A 前（A=${idxA}, B=${idxB}）`);

  // S2 board 移进分组
  const f = (await req(auth, 'POST', '/board-folders', { name: 'F' })).body;
  await req(auth, 'POST', `/board-folders/${f.id}/boards`, { boardId: bid });
  const folders = (await req(auth, 'GET', '/board-folders')).body;
  const myF = folders.find((x) => x.id === f.id);
  assert(myF && myF.boardIds.includes(bid), 'S2 board 移进分组（boardIds 包含）');

  // S3 前端列头/分组头可拖拽
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME);
  await sleep(2500);
  const draggable = await page.evaluate(() => ({
    colTh: [...document.querySelectorAll('th[draggable]')].length,
    folder: !!document.querySelector('[data-board-list] div[draggable="true"]'),
  }));
  assert(draggable.colTh > 0, 'S3 列头可拖拽');
  assert(draggable.folder, 'S3 分组头可拖拽');

  // 清理
  await req(auth, 'DELETE', `/board-folders/${f.id}`);
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第四十批 列排序/board进分组：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
