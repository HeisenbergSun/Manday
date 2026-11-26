/**
 * 第六十二批 e2e：全局搜索「定位到结果」
 * S1  造 board A + 唯一条目「定位目标条目-<rand>」；另造 board B（当前处于工作台）
 * S2  打开 Cmd+K 面板输入关键词 → 结果列表出现命中条目（data-search-result）
 * S3  按 Enter → 详情面板打开（[data-item-detail]）+ header 看板名切换为 board A
 * S4  关闭详情，重新搜索 → 鼠标点击结果 → 再次定位成功（详情 + 看板名）
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

/** 打开搜索面板并输入关键词 */
async function typeSearch(page, q) {
  await page.evaluate(() => document.querySelector('[data-search-btn]')?.click());
  await sleep(500);
  await page.evaluate((val) => {
    const el = document.querySelector('input[placeholder*="搜索"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, q);
  await sleep(1200);   // 200ms debounce + 请求
}

/** 读 header 看板名 span（定位后 activeBoard 名会显示在这里）——内联进 evaluate 使用 */
const HEADER_NAME_SNIPPET = `(() => { const span = document.querySelector('header nav span'); return span ? span.textContent.trim() : ''; })()`;

(async () => {
  require('./e2e-profile-cleanup')('manday-batch62');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch62-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // S1 造数据
  const rand = new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  const NAME_A = 'B62A-' + rand;
  const NAME_B = 'B62B-' + rand;
  const ITEM = '定位目标条目-' + rand;
  const KW = '定位目标';
  const bA = await req(auth, 'POST', '/boards', { name: NAME_A, visibility: 'company' });
  const bidA = bA.body.id;
  await req(auth, 'POST', `/boards/${bidA}/items`, { name: ITEM });
  const bB = await req(auth, 'POST', '/boards', { name: NAME_B, visibility: 'company' });
  const bidB = bB.body.id;
  await req(auth, 'POST', `/boards/${bidB}/items`, { name: '无关条目-' + rand });

  // S2 搜索 → 结果出现
  await typeSearch(page, KW);
  const s2 = await page.evaluate(() => {
    const list = [...document.querySelectorAll('[data-search-result]')];
    return { count: list.length, text: list.map((x) => x.textContent).join('|') };
  });
  assert(s2.count > 0 && s2.text.includes(ITEM), `S2 搜索结果出现命中条目（${s2.count} 条：${s2.text.slice(0, 50)}）`);

  // S3 按 Enter 定位
  await page.evaluate(() => {
    const el = document.querySelector('input[placeholder*="搜索"]');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await sleep(1200);
  const s3 = await page.evaluate((snippet) => ({
    detail: !!document.querySelector('[data-item-detail]'),
    detailText: document.querySelector('[data-item-detail]')?.textContent ?? '',
    boardName: eval(snippet),
  }), HEADER_NAME_SNIPPET);
  assert(s3.detail, 'S3a 详情面板已打开（[data-item-detail] 存在）');
  assert(s3.detailText.includes(ITEM), `S3b 详情面板显示目标条目（${s3.detailText.slice(0, 40)}）`);
  assert(s3.boardName === NAME_A, `S3c header 看板名切换为 board A（=${s3.boardName}）`);

  // S4 关闭详情 → 点击结果定位
  await page.evaluate(() => { document.querySelector('[data-item-detail] header button[title="关闭"]')?.click(); });
  await sleep(500);
  await typeSearch(page, KW);
  await page.evaluate(() => { document.querySelector('[data-search-result]')?.click(); });
  await sleep(1200);
  const s4 = await page.evaluate((snippet) => ({
    detail: !!document.querySelector('[data-item-detail]'),
    boardName: eval(snippet),
  }), HEADER_NAME_SNIPPET);
  assert(s4.detail, 'S4a 点击结果后详情面板打开');
  assert(s4.boardName === NAME_A, `S4b 点击结果后 header 看板名为 board A（=${s4.boardName}）`);

  // 清理
  await req(auth, 'DELETE', `/boards/${bidA}`);
  await req(auth, 'DELETE', `/boards/${bidB}`);

  console.log('\n===== 第六十二批 全局搜索「定位到结果」：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
