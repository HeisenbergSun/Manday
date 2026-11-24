/**
 * 第五十二批 e2e：P1-9 语句自动化（mention 触发接通）+ 柱状图修复验证
 * S1  mention 触发器：评论 @人 → 触发自动化 update_field
 * S2  柱状图：柱子高度按百分比动态伸缩 + 数字标签 nowrap 不截断
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
  require('./e2e-profile-cleanup')('manday-batch52');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch52-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B52-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  const setCell = async (itemId, colId, value) => {
    const cur = (await req(auth, 'GET', `/items/${itemId}`)).body;
    await req(auth, 'PATCH', `/items/${itemId}/cell`, { columnId: colId, value, version: cur.version });
  };

  // ── S1 mention 触发器 ──
  const users = (await req(auth, 'GET', '/users')).body;
  const userList = Array.isArray(users) ? users : users.users ?? [];
  const zhang = userList.find((u) => u.name === '张伟') || userList.find((u) => /张/.test(u.name)) || userList[0];
  assert(!!zhang, `S1a 找到被 @ 的真实用户（${zhang?.name ?? '无'}）`);

  const b1 = await req(auth, 'POST', '/boards', { name: NAME + '-自动化', visibility: 'company' });
  const bid1 = b1.body.id;
  const textCol = (await req(auth, 'POST', `/boards/${bid1}/columns`, { name: '备注', type: 'text' })).body;
  const item1 = (await req(auth, 'POST', `/boards/${bid1}/items`, { name: '提及条目' })).body;
  await req(auth, 'POST', `/boards/${bid1}/automations`, {
    trigger: { type: 'mention', to: '@self' },
    action: { type: 'update_field', columnId: textCol.id, value: '已提及' },
  });
  const upd = await req(auth, 'POST', `/items/${item1.id}/updates`, { body: `@${zhang.name} 请处理这条` });
  assert(upd.status < 300, `S1b 评论 @提及 提交成功（${upd.status}）`);
  await sleep(1800);
  const v1 = (await req(auth, 'GET', `/items/${item1.id}`)).body;
  assert(String(v1?.values?.[textCol.id] ?? '') === '已提及', `S1c mention 触发自动化 update_field（备注=${v1?.values?.[textCol.id] ?? '空'}）`);

  // ── S2 柱状图 ──
  const b2 = await req(auth, 'POST', '/boards', { name: NAME + '-图表', visibility: 'company' });
  const bid2 = b2.body.id;
  const statusCol = (await req(auth, 'POST', `/boards/${bid2}/columns`, { name: '状态', type: 'status' })).body;
  for (const [n, s] of [['图A', '待办'], ['图B', '进行中'], ['图C', '已完成'], ['图D', '待办']]) {
    const it = (await req(auth, 'POST', `/boards/${bid2}/items`, { name: n })).body;
    await setCell(it.id, statusCol.id, s);
  }
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((name) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === name && el.offsetParent !== null);
    if (t) t.click();
  }, NAME + '-图表');
  await sleep(2500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('分析'));
    if (b) b.click();
  });
  // 轮询等待 bar widget 渲染（多个 widget 依次异步加载）
  let bars = [];
  for (let i = 0; i < 10; i++) {
    bars = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[data-bar-bar]')];
      return els.map((e) => ({ h: e.style.height, txt: e.parentElement?.parentElement?.querySelector('[data-bar-value]')?.textContent ?? '' }));
    });
    if (bars.length >= 2) break;
    await sleep(1000);
  }
  assert(bars.length >= 2, `S2a 柱状图渲染柱子（${bars.length} 根）`);
  assert(bars.every((b) => b.h && b.h.includes('%')), `S2b 柱子高度为百分比动态伸缩（${bars.map((b) => b.h).join('/')}）`);
  const valEl = await page.$('[data-bar-value]');
  const valNowrap = valEl ? await page.evaluate((e) => getComputedStyle(e).whiteSpace, valEl) : '';
  assert(valNowrap === 'nowrap', `S2c 数字标签 whiteSpace=nowrap 不换行截断（${valNowrap}）`);

  // 清理
  await req(auth, 'DELETE', `/boards/${bid1}`);
  await req(auth, 'DELETE', `/boards/${bid2}`);

  console.log('\n===== 第五十二批 P1-9 mention 自动化 + 柱状图修复：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
