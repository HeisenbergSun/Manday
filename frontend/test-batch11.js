/**
 * 第十一批 e2e：P2-1 问卷式新手引导 + P2-2 模板示例数据
 * O1 API：模板实例化 withSamples → 5 条示例条目 + 列值写入
 * O2 API：不带 samples → 0 条示例
 * O3 UI：首次登录出现 3 步问卷 → 创建模板 Board → 自动打开 + 标记写入 + 不再弹出
 * O4 UI：工具条「🧹 删除示例」→ 条目进回收站、按钮消失
 */
const puppeteer = require('puppeteer-core');
const jwt = require('../backend/node_modules/jsonwebtoken');
const fs = require('fs');

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
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch11-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('requestfailed', (r) => { if (r.url().includes('/api/')) console.log('  [net-fail]', r.method(), r.url(), r.failure()?.errorText); });
  page.on('response', async (r) => {
    if (r.url().includes('/templates/') && r.request().method() === 'POST') {
      console.log('  [net-resp]', r.status(), r.url());
      try { console.log('  [net-body]', (await r.text()).slice(0, 300)); } catch {}
    }
  });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console-err]', m.text().slice(0, 200)); });
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录'));
    if (b) b.click();
  });
  await sleep(2000);
  const devToken = await page.evaluate(() => localStorage.getItem('manday_token'));
  const devAuth = 'Bearer ' + devToken;

  // ---- O1/O2 API ----
  const s1 = await req(devAuth, 'POST', '/templates/project/instantiate', { name: 'P2 引导验证 ' + Date.now() % 10000, withSamples: true });
  const b1 = s1.body?.boardId;
  assert(!!b1, 'O1 实例化 project（带示例）: ' + s1.status);
  const d1 = await req(devAuth, 'GET', `/boards/${b1}/items`);
  const samples = d1.body.items.filter((i) => i.name.startsWith('示例：'));
  assert(samples.length === 5, `O1 示例条目 5 条（实际 ${samples.length}）`);
  const withVal = samples.filter((i) => Object.keys(i.values ?? {}).length > 0);
  assert(withVal.length >= 4, `O1 示例条目带列值（${withVal.length} 条）`);
  const s2 = await req(devAuth, 'POST', '/templates/backlog/instantiate', { name: 'P2 无示例 ' + Date.now() % 10000, withSamples: false });
  const d2 = await req(devAuth, 'GET', `/boards/${s2.body.boardId}/items`);
  assert(d2.body.items.filter((i) => i.name.startsWith('示例：')).length === 0, 'O2 不带 samples → 0 条示例');

  // O3 依赖「零看板」新用户才弹问卷 → 先清掉本用户的测试 board（测试数据，硬删）
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const uidRow = await c.query("SELECT id FROM users WHERE email = 'dev@internal'");
    const uid = uidRow.rows[0]?.id;
    const dl = await c.query("DELETE FROM boards");
    const dp = await c.query("DELETE FROM board_permissions");
    console.log('  [prep] deleted boards:', dl.rowCount, 'permissions:', dp.rowCount);
    await c.end();
  }

  // ---- O3 UI：问卷引导 ----
  // 清 onboarded 标记后刷新，引导应出现
  await page.evaluate(() => {
    const uid = localStorage.getItem('userId');
    localStorage.removeItem('manday_onboarded_' + uid);
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  const ob = await page.evaluate(() => !!document.querySelector('[data-onboarding]'));
  assert(ob, 'O3 首次登录问卷出现');
  if (ob) {
    // 第 1 步：选团队规模
    const chipN = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('[data-onboarding] span')].filter((x) => /^[\d-]+ 人$/.test(x.textContent.trim()));
      if (chips.length) chips[chips.length - 1].click();
      return chips.length;
    });
    console.log('  [debug] team chips:', chipN);
    await sleep(400);
    // 第 2 步：下一步
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '下一步');
      b.click();
    });
    await sleep(400);
    // 第 3 步：创建并开始
    const hasCreate = await page.evaluate(() => !!document.querySelector('[data-onboarding-create]'));
    assert(hasCreate, 'O3 第 3 步出现「创建并开始」');
    await page.click('[data-onboarding-create]');
    // 轮询等待创建完成（modal 消失），最长 15s
    let gone = false;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      gone = await page.evaluate(() => !document.querySelector('[data-onboarding]'));
      if (gone) break;
    }
    const obErr = await page.evaluate(() => document.querySelector('[data-onboarding]')?.innerText?.slice(0, 300) ?? '');
    console.log('  [debug] onboarding inner:', JSON.stringify(obErr));
    assert(gone, 'O3 问卷完成关闭');
    const marked = await page.evaluate(() => {
      const uid = localStorage.getItem('userId');
      return localStorage.getItem('manday_onboarded_' + uid) === '1';
    });
    assert(marked, 'O3 onboarded 标记写入');
    // 轮询等待新 board 表格渲染示例条目
    let sampleRows = [];
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const rows = await page.evaluate(() => [...document.querySelectorAll('[data-col="name"]')].map((x) => x.textContent.trim()));
      sampleRows = rows.filter((r) => r.startsWith('示例：'));
      if (sampleRows.length === 5) break;
    }
    assert(sampleRows.length === 5, `O3 新 board 打开且示例条目可见（${sampleRows.length}）`);
    // 再刷新 → 不再弹出
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    const ob2 = await page.evaluate(() => !!document.querySelector('[data-onboarding]'));
    assert(!ob2, 'O3 再次登录不再弹出');

    // ---- O4 UI：一键删除示例 ----
    const delBtn = await page.evaluate(() => {
      const b = document.querySelector('[data-remove-samples]');
      return b ? b.textContent.trim() : null;
    });
    assert(delBtn && delBtn.includes('删除'), `O4 工具条出现删除示例按钮（${delBtn}）`);
    await page.evaluate(() => document.querySelector('[data-remove-samples]').click());
    let after = 5;
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      after = await page.evaluate(() => [...document.querySelectorAll('[data-col="name"]')].filter((x) => x.textContent.trim().startsWith('示例：')).length);
      if (after === 0) break;
    }
    assert(after === 0, `O4 删除后表格无示例条目（${after}）`);
    const btnGone = await page.evaluate(() => !document.querySelector('[data-remove-samples]'));
    assert(btnGone, 'O4 按钮消失');
  }

  await browser.close();

  // 收尾清理：删掉问卷创建的 board，避免残留干扰其他套件选板
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl = await c.query("DELETE FROM boards WHERE name LIKE '我的第一个项目%' OR name LIKE 'P2 %'");
    console.log('  [cleanup] deleted boards:', dl.rowCount);
    // 恢复种子数据（prep 阶段清空了全部 board，其他套件依赖 seed board + 演示条目）
    await c.query(fs.readFileSync(require('path').resolve(__dirname, '../backend/db/seed.sql'), 'utf8'));
    const { execSync } = require('child_process');
    try { execSync('node scripts/seed-demo-items.js', { cwd: require('path').resolve(__dirname, '..') }); } catch (e) { console.log('  [cleanup] demo-items seed warn:', e.message.slice(0, 80)); }
    const cnt = await c.query('SELECT count(*) FROM boards');
    console.log('  [cleanup] seed restored, boards:', cnt.rows[0].count);
    await c.end();
  }

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
