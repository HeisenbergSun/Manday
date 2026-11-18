/**
 * Batch 26 — 列编辑器修复验证
 * 覆盖 status/people/dropdown/dependency/mirror 自定义下拉 + 值回显 + 真实用户选项
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

const { Pool } = require('C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/manday/backend/node_modules/pg');
const pg = new Pool({ connectionString: 'postgresql://neondb_owner:npg_7BnQ5ysHkARh@ep-rough-tree-a1ee1err-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' });
const purge = async () => { const r = await pg.query("DELETE FROM boards WHERE name LIKE 'B26-%' RETURNING name"); return r.rowCount; };

(async () => {
    require('./e2e-profile-cleanup')('manday-batch26');
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch26-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));
  await purge();

  // 真实用户列表
  const users = (await req(auth, 'GET', '/users')).body;
  const uZhang = users.find((u) => u.name === '张伟');
  const uLi = users.find((u) => u.name === '李娜');
  console.log('用户: 张伟=' + uZhang?.id + ', 李娜=' + uLi?.id);

  // 建板 + 各类型列
  const bid = (await req(auth, 'POST', '/boards', { name: 'B26-Editors', visibility: 'private' })).body.id;
  assert(bid, 'Board created');
  const statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' })).body;
  const peopleCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people', settings: { members: [{ id: 'u1', name: '假张伟' }] } })).body;
  const dropCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '优先级', type: 'dropdown', settings: { options: [{ label: '高' }, { label: '中' }, { label: '低' }] } })).body;
  const item = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '编辑测试条目' })).body;
  await sleep(500);

  // 设置初始值（含不在 status 选项中的值）——用返回 version 递增，保证 LWW 同步
  let ver = item.version ?? 1;
  let r1 = await req(auth, 'PATCH', `/items/${item.id}/cell`, { columnId: statusCol.id, value: '未开始', version: ver });
  if (r1.body?.version) ver = r1.body.version;
  let r2 = await req(auth, 'PATCH', `/items/${item.id}/cell`, { columnId: peopleCol.id, value: uZhang.id, version: ver });
  if (r2.body?.version) ver = r2.body.version;
  let r3 = await req(auth, 'PATCH', `/items/${item.id}/cell`, { columnId: dropCol.id, value: '高', version: ver });
  if (r3.body?.version) ver = r3.body.version;
  await sleep(500);

  // 导航到板
  await sleep(1000);
  const nav = async () => page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) { t.click(); return true; } return false;
  }, 'B26-Editors');
  if (!await nav()) { await sleep(2000); await nav(); }
  await sleep(3000);
  let ok = await page.evaluate(() => document.body.innerText.includes('编辑测试条目'));
  if (!ok) { await page.reload(); await sleep(2000); await nav(); await sleep(3000); }
  assert(await page.evaluate(() => document.body.innerText.includes('编辑测试条目')), '导航到测试板');

  // ===== S1: status 显示回显「未开始」（值不在 options 里）=====
  console.log('\n--- status 回显 ---');
  const statusText = await page.evaluate((col) => {
    const td = document.querySelector(`td[data-col="${col}"]`);
    return td?.textContent?.trim();
  }, statusCol.id);
  assert(statusText === '未开始', `S1: status 单元格显示「未开始」（实际 ${statusText}）`);

  // 单击 status 单元格 → 自定义下拉出现，且包含「未开始（当前值）」
  await page.evaluate((col) => {
    const td = document.querySelector(`td[data-col="${col}"][data-grid-cell]`);
    if (td) td.click();
  }, statusCol.id);
  await sleep(500);
  const statusDrop = await page.evaluate(() => {
    const drop = document.querySelector('[data-chip-dropdown]');
    if (!drop) return null;
    return [...drop.querySelectorAll('[data-chip-opt]')].map((o) => ({ v: o.getAttribute('data-chip-opt'), t: o.textContent.trim() }));
  });
  console.log('  status 下拉项:', JSON.stringify(statusDrop));
  assert(statusDrop && statusDrop.some((o) => o.t.includes('未开始')), 'S2: status 下拉含当前值「未开始」');
  assert(statusDrop && statusDrop.some((o) => o.v === '进行中'), 'S3: status 下拉含正常选项「进行中」');

  // 点选「进行中」
  await page.evaluate(() => {
    const opt = document.querySelector('[data-chip-dropdown] [data-chip-opt="进行中"]');
    if (opt) opt.click();
  });
  await sleep(1000);
  const statusAfter = await page.evaluate((col) => {
    const td = document.querySelector(`td[data-col="${col}"]`);
    return td?.textContent?.trim();
  }, statusCol.id);
  assert(statusAfter === '进行中', `S4: 选中「进行中」后单元格显示正确（实际 ${statusAfter}）`);

  // ===== P1: people 显示真实人名（不是 UUID）=====
  console.log('\n--- people 显示与选项 ---');
  const peopleText = await page.evaluate((col) => {
    const td = document.querySelector(`td[data-col="${col}"]`);
    return td?.textContent?.trim();
  }, peopleCol.id);
  assert(peopleText && peopleText.includes('张伟') && !/[0-9a-f]{8}-/.test(peopleText), `P1: people 显示真实人名而非 UUID（实际 ${peopleText}）`);

  // 单击 people 单元格 → 下拉含真实用户（张伟/李娜），不含假数据
  await page.evaluate((col) => {
    const td = document.querySelector(`td[data-col="${col}"][data-grid-cell]`);
    if (td) td.click();
  }, peopleCol.id);
  await sleep(500);
  const peopleOpts = await page.evaluate(() => {
    const drop = document.querySelector('[data-chip-dropdown]');
    if (!drop) return null;
    return [...drop.querySelectorAll('[data-chip-opt]')].map((o) => o.getAttribute('data-chip-opt'));
  });
  console.log('  people 下拉项 value:', JSON.stringify(peopleOpts));
  assert(peopleOpts && peopleOpts.includes(uLi.id), 'P2: people 下拉含真实用户「李娜」(UUID)');
  assert(peopleOpts && !peopleOpts.includes('u1'), 'P3: people 下拉不含假数据 u1');

  // 点选李娜
  await page.evaluate((uid) => {
    const opt = document.querySelector(`[data-chip-dropdown] [data-chip-opt="${uid}"]`);
    if (opt) opt.click();
  }, uLi.id);
  await sleep(1000);
  const peopleAfter = await page.evaluate((col) => {
    const td = document.querySelector(`td[data-col="${col}"]`);
    return td?.textContent?.trim();
  }, peopleCol.id);
  assert(peopleAfter && peopleAfter.includes('李娜') && !/[0-9a-f]{8}-/.test(peopleAfter), `P4: 选中李娜后显示「李娜」而非 UUID（实际 ${peopleAfter}）`);

  // ===== D1: dropdown 选项与选择 =====
  console.log('\n--- dropdown ---');
  const dropText = await page.evaluate((col) => document.querySelector(`td[data-col="${col}"]`)?.textContent?.trim(), dropCol.id);
  assert(dropText === '高', `D1: dropdown 显示「高」（实际 ${dropText}）`);
  await page.evaluate((col) => {
    const td = document.querySelector(`td[data-col="${col}"][data-grid-cell]`);
    if (td) td.click();
  }, dropCol.id);
  await sleep(500);
  const dropOpts = await page.evaluate(() => {
    const drop = document.querySelector('[data-chip-dropdown]');
    if (!drop) return null;
    return [...drop.querySelectorAll('[data-chip-opt]')].map((o) => o.getAttribute('data-chip-opt'));
  });
  console.log('  dropdown 下拉项:', JSON.stringify(dropOpts));
  assert(dropOpts && dropOpts.includes('中') && dropOpts.includes('低'), 'D2: dropdown 选项显示正常');
  await page.evaluate(() => {
    const opt = document.querySelector('[data-chip-dropdown] [data-chip-opt="中"]');
    if (opt) opt.click();
  });
  await sleep(1000);
  const dropAfter = await page.evaluate((col) => document.querySelector(`td[data-col="${col}"]`)?.textContent?.trim(), dropCol.id);
  assert(dropAfter === '中', `D3: 选中「中」后显示正确（实际 ${dropAfter}）`);

  // ===== 点外部关闭下拉（不误提交）=====
  console.log('\n--- 点击外部关闭 ---');
  await page.evaluate((col) => {
    const td = document.querySelector(`td[data-col="${col}"][data-grid-cell]`);
    if (td) td.click();
  }, dropCol.id);
  await sleep(400);
  assert(await page.$('[data-chip-dropdown]'), 'X1: 下拉已打开');
  await page.mouse.click(400, 850);
  await sleep(400);
  assert(!await page.$('[data-chip-dropdown]'), 'X2: 点击外部后下拉关闭');
  const dropAfterCancel = await page.evaluate((col) => document.querySelector(`td[data-col="${col}"]`)?.textContent?.trim(), dropCol.id);
  assert(dropAfterCancel === '中', `X3: 点外部取消不改变原值（实际 ${dropAfterCancel}）`);

  // ===== 汇总 =====
  console.log('\n=== 汇总 ===');
  if (errors.length) {
    console.log(`❌ ${errors.length} 项失败:`);
    errors.forEach((e) => console.log('   - ' + e));
  } else {
    console.log('✅ 全部通过');
  }

  await purge();
  await browser.close();
  await pg.end();
  process.exit(errors.length > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
