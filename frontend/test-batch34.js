/**
 * 第三十四批 e2e：Excel 导入增强
 * S1 非标准条目名列「任务名称」能识别（不整行失败）
 * S2 tags 列导入值格式正确（数组）
 * S3 常规导入回归（名称/状态/数字）
 */
const puppeteer = require('puppeteer-core');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

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
const purge = async () => { try { const { Client } = require('pg'); require('dotenv').config({ path: '../backend/.env' }); const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect(); const r = await c.query("DELETE FROM boards WHERE name LIKE 'B34-%' RETURNING name"); await c.end(); return r.rowCount; } catch { return 0; } };

(async () => {
  await purge();
  require('./e2e-profile-cleanup')('manday-batch34');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch34-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // 建板 + tags 列 + status 列
  const bid = (await req(auth, 'POST', '/boards', { name: 'B34-Import2', visibility: 'private' })).body.id;
  const statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' })).body;
  const tagsCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '标签', type: 'tags' })).body;

  // 非标准表头：任务名称 + 状态 + 标签
  const rows = [
    ['任务名称', '状态', '标签'],
    ['任务X', '进行中', '紧急,前端'],
    ['任务Y', '待办', '后端；设计'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const xlsxPath = path.join('C:/Users/RSU06X/AppData/Local/Temp', 'manday-import2-test.xlsx');
  XLSX.writeFile(wb, xlsxPath);

  // 打开板 + 导入
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, 'B34-Import2');
  await sleep(2500);
  const fileInput = await page.$('input[type=file][accept=".xlsx,.xls,.csv"]');
  await fileInput.uploadFile(xlsxPath);
  await sleep(1500);
  assert(await page.$('[data-import-preview]'), 'S1 预览弹窗出现');
  // 预览应含「→ 条目名」（任务名称被识别）
  const previewText = await page.evaluate(() => document.querySelector('[data-import-preview]')?.innerText ?? '');
  assert(previewText.includes('任务名称 → 条目名'), 'S1 非标准列「任务名称」识别为条目名');
  await page.click('[data-import-confirm]');
  let toast = '';
  for (let i = 0; i < 30; i++) { await sleep(1000); toast = await page.evaluate(() => document.body.innerText.match(/导入完成[^\n]*/)?.[0] ?? ''); if (toast) break; }
  assert(toast.includes('成功 2'), `S1 成功 2 条（实际 ${toast || '无'}）`);

  // 验证
  const det = (await req(auth, 'GET', `/boards/${bid}`)).body;
  const items = det.items ?? [];
  const x = items.find((it) => it.name === '任务X');
  assert(!!x, 'S1 条目「任务X」已创建（条目名识别成功）');
  if (x) {
    assert(x.values?.[statusCol.id] === '进行中', `S3 状态=进行中（实际 ${x.values?.[statusCol.id]}）`);
    const tagsVal = x.values?.[tagsCol.id];
    let parsed = null; try { parsed = JSON.parse(tagsVal); } catch {}
    assert(Array.isArray(parsed) && parsed.includes('紧急') && parsed.includes('前端'), `S2 tags 值为数组（实际 ${JSON.stringify(tagsVal)}）`);
  }

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);
  try { fs.unlinkSync(xlsxPath); } catch {}
  await purge();

  console.log('\n===== 第三十四批 Excel 导入增强：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
