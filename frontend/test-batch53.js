/**
 * 第五十三批 e2e：dashboard widget 拖拽调整大小预览虚线框
 * S1  拖动 resize 手柄时，出现预览虚线框 [data-resize-preview]
 * S2  预览框为 dashed 虚线边框，且显示目标尺寸标签
 * S3  松手后预览框消失，config.w/h 更新到新尺寸
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
  require('./e2e-profile-cleanup')('manday-batch53');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch53-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B53-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  const setCell = async (itemId, colId, value) => {
    const cur = (await req(auth, 'GET', `/items/${itemId}`)).body;
    await req(auth, 'PATCH', `/items/${itemId}/cell`, { columnId: colId, value, version: cur.version });
  };

  // 准备 board + 数据 + dashboard + 柱状图 widget
  const b = await req(auth, 'POST', '/boards', { name: NAME + '-图表', visibility: 'company' });
  const bid = b.body.id;
  const statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' })).body;
  for (const [n, s] of [['图A', '待办'], ['图B', '进行中'], ['图C', '已完成']]) {
    const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name: n })).body;
    await setCell(it.id, statusCol.id, s);
  }
  const dash = await req(auth, 'POST', '/dashboards', { name: NAME + '-Dash', scope: 'personal' });
  const dashId = dash.body.id;
  await req(auth, 'POST', `/dashboards/${dashId}/widgets`, {
    type: 'bar', title: '状态分布', config: { boardIds: [bid], groupBy: '状态', metric: 'count', w: 2, h: 2 },
  });

  // 打开 dashboard
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.evaluate((n) => document.querySelector(`[data-dashboard-item="${n}"]`)?.click(), NAME + '-Dash');
  await sleep(2500);

  const handle = await page.$('[data-widget-resize]');
  assert(!!handle, 'S1 定位到 resize 手柄');
  const box = await handle.boundingBox();

  // 按下并拖动（不松手），检查预览虚线框
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 160, cy + 60, { steps: 10 }); // +2 列 +1 行
  await sleep(300);

  const preview = await page.$('[data-resize-preview]');
  assert(!!preview, 'S1a 拖动过程中出现预览虚线框');
  const pStyle = preview ? await page.evaluate((e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return { borderTopStyle: s.borderTopStyle, borderTopWidth: s.borderTopWidth, w: Math.round(r.width), h: Math.round(r.height), txt: e.textContent.trim() };
  }, preview) : null;
  assert(pStyle && pStyle.borderTopStyle === 'dashed' && pStyle.borderTopWidth !== '0px', `S1b 预览框为 dashed 虚线边框（${pStyle?.borderTopStyle}/${pStyle?.borderTopWidth}）`);
  assert(pStyle && pStyle.txt.includes('×'), `S1c 预览框显示目标尺寸标签（${pStyle?.txt}）`);
  assert(pStyle && pStyle.w > 0 && pStyle.h > 0, `S1d 预览框尺寸有效（${pStyle?.w}×${pStyle?.h}px）`);

  // 松手 → 预览消失 + config 更新
  await page.mouse.up();
  await sleep(2000);
  const previewAfter = await page.$('[data-resize-preview]');
  assert(!previewAfter, 'S2 松手后预览虚线框消失');
  const d = await req(auth, 'GET', `/dashboards/${dashId}`);
  const wgt = d.body.widgets[0];
  const nw = wgt.config?.w ?? 2, nh = wgt.config?.h ?? 2;
  assert(nw > 2 || nh > 2, `S3 调整大小后 config 更新（w=${nw}, h=${nh}）`);

  // 清理
  await req(auth, 'DELETE', `/dashboards/${dashId}`);
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第五十三批 调整大小预览虚线框：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
