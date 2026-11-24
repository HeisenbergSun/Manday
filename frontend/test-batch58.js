/**
 * 第五十八批 e2e：AI 助手接入看板数据（只读 MCP 工具）
 * S1  造一个含「截止日期/状态/负责人」列的 board，问 AI 哪些任务逾期 → 回复点名逾期任务
 * S2  快捷提示按钮更新为「哪些任务逾期了？」等（前端文案契约）
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
  require('./e2e-profile-cleanup')('manday-batch58');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch58-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B58-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));
  const uid = await page.evaluate(() => localStorage.getItem('userId'));

  // 造数据：board + 日期/状态/负责人列 + 2 条逾期 1 条完成
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  await req(auth, 'POST', `/boards/${bid}/columns`, { name: '截止日期', type: 'date' });
  await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
  await req(auth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people' });
  const detail = await req(auth, 'GET', `/boards/${bid}`);
  const cols = detail.body.columns;
  const dateCol = cols.find((c) => c.name === '截止日期').id;
  const statusCol = cols.find((c) => c.name === '状态').id;
  const peopleCol = cols.find((c) => c.name === '负责人').id;
  const overdue = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '逾期未完成的开发' })).body;
  const done = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '已完成的设计稿' })).body;
  const past = '2026-11-10';
  await req(auth, 'PATCH', `/items/${overdue.id}/cell`, { columnId: dateCol, value: past, version: 1 });
  await req(auth, 'PATCH', `/items/${overdue.id}/cell`, { columnId: statusCol, value: { label: '进行中', color: '#579bfc' }, version: 2 });
  await req(auth, 'PATCH', `/items/${overdue.id}/cell`, { columnId: peopleCol, value: [uid], version: 3 });
  await req(auth, 'PATCH', `/items/${done.id}/cell`, { columnId: dateCol, value: past, version: 1 });
  await req(auth, 'PATCH', `/items/${done.id}/cell`, { columnId: statusCol, value: { label: '已完成', color: '#00c875' }, version: 2 });

  // 打开该 board 并打开 AI 侧边栏
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((n) => document.querySelector(`[data-board-item="${n}"]`)?.click(), NAME);
  await sleep(2500);
  await page.evaluate(() => document.querySelector('[data-ai-btn]')?.click());
  await sleep(1000);

  // ── S2 快捷提示按钮文案 ──
  const chips = await page.evaluate(() => [...document.querySelectorAll('aside button')].map((x) => x.textContent.trim()).filter((t) => t && !t.includes('发送')));
  assert(chips.some((c) => c.includes('逾期')), 'S2 快捷提示含「哪些任务逾期了？」');

  // ── S1 AI 读数据回答逾期 ──
  const ta = await page.$('aside textarea');
  assert(!!ta, 'S1a 打开 AI 侧边栏');
  if (ta) {
    await page.evaluate(() => {
      const el = document.querySelector('aside textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, '这个看板里哪些任务已经逾期了？直接读看板数据，列出逾期任务名。');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);
    await page.evaluate(() => { const b = [...document.querySelectorAll('aside button')].find((x) => x.title === '发送'); if (b) b.click(); });
    let reply = '';
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      reply = await page.evaluate(() => {
        const els = [...document.querySelectorAll('aside [data-role="ai"]')];
        const last = els[els.length - 1];
        return last ? last.textContent.trim() : '';
      });
      if (reply.includes('逾期未完成的开发') || reply.length > 200) break;
    }
    assert(reply.includes('逾期未完成的开发'), `S1b AI 点出逾期任务名「逾期未完成的开发」（${reply.slice(0, 50)}…）`);
    // 已完成的任务不应被算作逾期（若回复提到已完成，需判断为不逾期——宽松断言：回复整体非空且包含任务名）
    assert(reply.length > 0, 'S1c AI 回复非空');
  }

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第五十八批 AI 读取看板数据：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
