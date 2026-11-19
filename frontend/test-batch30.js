/**
 * 第三十批 e2e：工作区增强
 * W1 工作台入口（workspace 级 Dashboard）
 * W2 Board 自定义分组：新建分组 / 移入 / 删除
 * W3 列选项自定义：dropdown 列添加预置选项
 * W4 CSV 已移除（data-export-csv 不存在，data-export-xlsx 保留）
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
  require('./e2e-profile-cleanup')('manday-batch30');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch30-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => { d.accept().catch(() => {}); });

  const NAME = 'B30-工作区 ' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const token = await page.evaluate(() => localStorage.getItem('manday_token'));

  // W1 工作台入口
  const dashBtn = await page.$('[data-workspace-dashboard]');
  assert(!!dashBtn, 'W1 工作台入口存在（data-workspace-dashboard）');
  await page.click('[data-workspace-dashboard]');
  await sleep(2000);
  const dashVisible = await page.evaluate(() => document.body.innerText.includes('工作台'));
  assert(dashVisible, 'W1 点击后显示工作台视图');

  // W2 分组
  const created = await req(token, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = created.body.id;
  assert(!!bid, 'W2-prep 建测试 board');
  const f1 = await req(token, 'POST', '/board-folders', { name: 'B30-分组A' });
  assert(f1.status === 201 || f1.status === 200, 'W2-prep 新建分组（API）');
  const fid = f1.body.id;
  await req(token, 'POST', `/board-folders/${fid}/boards`, { boardId: bid });
  const list = await req(token, 'GET', '/board-folders');
  const hasBoard = (list.body ?? []).some((f) => f.id === fid && (f.boardIds ?? []).includes(bid));
  assert(hasBoard, 'W2 Board 已归入分组');
  // 前端：刷新后分组出现且含该 board
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  const folderInNav = await page.evaluate((n) => document.body.innerText.includes(n), 'B30-分组A');
  assert(folderInNav, 'W2 左侧导航显示分组');
  // 删除分组（board 回到未分组）
  const del = await req(token, 'DELETE', `/board-folders/${fid}`);
  assert(del.status === 200, 'W2 删除分组（API）');

  // W3 列选项：进入 board，打开列面板，给 dropdown 列加选项
  await page.evaluate((n) => { document.querySelector(`[data-board-item="${n}"]`)?.click(); }, NAME);
  await sleep(2000);
  // 建一个 dropdown 列
  const col = await req(token, 'POST', `/boards/${bid}/columns`, { name: 'B30-多选', type: 'dropdown' });
  const colId = col.body.id;
  assert(!!colId, 'W3-prep 建 dropdown 列');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.evaluate((n) => { document.querySelector(`[data-board-item="${n}"]`)?.click(); }, NAME);
  await sleep(2000);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('列与分组')); if (b) b.click(); });
  await sleep(800);
  // 在 dropdown 列的选项输入框里输入新选项
  const typed = await page.evaluate((cid) => {
    const input = document.querySelector(`[data-option-input="${cid}"]`);
    if (!input) return false;
    input.value = '选项甲';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  }, colId);
  assert(typed, 'W3 定位到 dropdown 选项输入框');
  await sleep(1500);
  const chip = await page.evaluate((cid) => document.querySelector(`[data-option-editor="${cid}"] [data-option-chip="选项甲"]`) ? true : false, colId);
  assert(chip, 'W3 添加的选项 chip 出现');

  // W4 CSV 已移除
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.evaluate((n) => { document.querySelector(`[data-board-item="${n}"]`)?.click(); }, NAME);
  await sleep(2000);
  const csvBtn = await page.$('[data-export-csv]');
  const xlsxBtn = await page.$('[data-export-xlsx]');
  assert(!csvBtn, 'W4 data-export-csv 已移除');
  assert(!!xlsxBtn, 'W4 data-export-xlsx 保留');

  // 清理
  await req(token, 'DELETE', `/boards/${bid}`);
  await req(token, 'DELETE', `/board-folders/${fid}`);

  console.log('\n===== 第三十批 工作区增强：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
