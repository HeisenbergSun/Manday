/**
 * 第二十八批 Excel 导入 e2e
 * E1 导入按钮存在
 * E2 上传 xlsx 后条目按行创建
 * E3 状态/日期/数字/勾选/人员 列值正确落库
 * E4 未匹配表头自动建列（owner）
 * E5 toast 汇总提示
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
const purge = async () => { try { const { Client } = require('pg'); require('dotenv').config({ path: '../backend/.env' }); const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect(); const r = await c.query("DELETE FROM boards WHERE name LIKE 'B28-%' RETURNING name"); await c.end(); return r.rowCount; } catch { return 0; } };

(async () => {
  await purge();
    require('./e2e-profile-cleanup')('manday-batch28');
const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch28-' + Date.now(),
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

  // 建板 + 现有列：状态 / 负责人 / 截止日期 / 预算（数字）
  const bid = (await req(auth, 'POST', '/boards', { name: 'B28-ExcelImport', visibility: 'private' })).body.id;
  const statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' })).body;
  const peopleCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people' })).body;
  const dateCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '截止', type: 'date' })).body;
  const numCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '预算', type: 'number' })).body;
  const users = (await req(auth, 'GET', '/users')).body;
  const uZhang = users.find((u) => u.name === '张伟');

  // 生成测试 xlsx：3 行数据 + 1 个未匹配表头「风险等级」+ checkbox「是否紧急」
  const rows = [
    ['条目', '状态', '负责人', '截止', '预算', '风险等级', '是否紧急'],
    ['导入任务A', '进行中', '张伟', '2026-12-01', 5000, '高', '是'],
    ['导入任务B', '待办', '李娜', '2026-12-15', 12000.5, '中', '否'],
    ['导入任务C', '已完成', '', '', 0, '低', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const xlsxPath = path.join('C:/Users/RSU06X/AppData/Local/Temp', 'manday-import-test.xlsx');
  XLSX.writeFile(wb, xlsxPath);

  // 打开板（导航）
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  const nav = async () => page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) { t.click(); return true; } return false;
  }, 'B28-ExcelImport');
  if (!await nav()) { await sleep(1500); await nav(); }
  await sleep(2500);
  assert(await page.evaluate(() => document.body.innerText.includes('B28-ExcelImport')), '导航到导入测试板');

  // E1 按钮存在
  const importBtn = await page.$('[data-import-excel]');
  assert(!!importBtn, 'E1 导入 Excel 按钮存在（data-import-excel）');

  // E2 上传文件
  const fileInput = await page.$('input[type=file][accept=".xlsx,.xls,.csv"]');
  assert(!!fileInput, 'E2 文件选择输入存在');
  await fileInput.uploadFile(xlsxPath);
  // 等待导入完成（toast 提示）
  let toast = '';
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    toast = await page.evaluate(() => document.body.innerText.match(/导入完成[^\n]*/)?.[0] ?? '');
    if (toast) break;
  }
  assert(toast.includes('成功 3'), `E5 汇总提示成功 3 条（实际 ${toast || '无'}）`);

  // E3 验证条目与值
  const det = (await req(auth, 'GET', `/boards/${bid}`)).body;
  const items = det.items ?? [];
  assert(items.length === 3, `E2 条目数 = 3（实际 ${items.length}）`);
  const byName = Object.fromEntries(items.map((it) => [it.name, it]));
  const a = byName['导入任务A'];
  assert(!!a, 'E2 条目「导入任务A」已创建');
  if (a) {
    const v = a.values ?? {};
    assert(v[statusCol.id] === '进行中', `E3 状态=进行中（实际 ${v[statusCol.id]}）`);
    assert(v[dateCol.id] === '2026-12-01', `E3 日期=2026-12-01（实际 ${v[dateCol.id]}）`);
    assert(Number(v[numCol.id]) === 5000, `E3 数字=5000（实际 ${v[numCol.id]}）`);
    assert((v[peopleCol.id] ?? '').includes(uZhang?.id ?? ''), `E3 人员=张伟 UUID（实际 ${JSON.stringify(v[peopleCol.id])}）`);
    const b = byName['导入任务B'];
    assert(b && Number(b.values?.[numCol.id]) === 12000.5, `E3 数字小数=12000.5（实际 ${b?.values?.[numCol.id]}）`);
  }

  // E4 未匹配表头自动建列
  const colsAfter = (await req(auth, 'GET', `/boards/${bid}`)).body.columns;
  const riskCol = colsAfter.find((c) => c.name === '风险等级');
  const urgentCol = colsAfter.find((c) => c.name === '是否紧急');
  assert(!!riskCol, `E4 「风险等级」自动建列（现有列: ${colsAfter.map((c) => c.name).join('/')}）`);
  assert(riskCol?.type === 'text', `E4 风险等级类型推断 text（实际 ${riskCol?.type}）`);
  assert(!!urgentCol && urgentCol.type === 'checkbox', `E4 「是否紧急」推断 checkbox（实际 ${urgentCol?.type ?? '未建'}）`);
  if (a) {
    const vv = (await req(auth, 'GET', `/boards/${bid}`)).body.items.find((x) => x.name === '导入任务A')?.values ?? {};
    assert(vv[riskCol?.id] === '高', `E3 风险等级=高（实际 ${vv[riskCol?.id]}）`);
    const urg = vv[urgentCol?.id];
    assert(urg === true || urg === 1 || urg === 'true' || urg === '是', `E3 是否紧急=true（实际 ${JSON.stringify(urg)}）`);
  }

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);
  try { fs.unlinkSync(xlsxPath); } catch {}
  await purge();

  console.log('\n===== 第二十八批 Excel 导入：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
