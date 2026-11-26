/**
 * 第六十一批 e2e：全局搜索「包含」匹配修复
 * S1  造 board + 条目「开发登录模块」/「修复通知bug」
 * S2  API 搜短词「登录」（2 字子串）→ 命中「开发登录模块」
 * S3  API 搜「通知」→ 命中「修复通知bug」
 * S4  API 搜不存在词 → 空
 * S5  UI：打开 Cmd+K 面板输入「登录」→ 结果列表出现命中条目
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
const searchNames = async (auth, q) => {
  const r = await req(auth, 'GET', '/search?q=' + encodeURIComponent(q));
  return Array.isArray(r.body) ? r.body.map((x) => x.name) : [];
};

(async () => {
  require('./e2e-profile-cleanup')('manday-batch61');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch61-' + Date.now(),
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
  const NAME = 'B61-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  await req(auth, 'POST', `/boards/${bid}/items`, { name: '开发登录模块' });
  await req(auth, 'POST', `/boards/${bid}/items`, { name: '修复通知bug' });

  // S2/S3/S4 API 子串匹配
  const s2 = await searchNames(auth, '登录');
  assert(s2.includes('开发登录模块'), `S2 搜「登录」命中「开发登录模块」（${s2.join(',')}）`);
  const s3 = await searchNames(auth, '通知');
  assert(s3.includes('修复通知bug'), `S3 搜「通知」命中「修复通知bug」（${s3.join(',')}）`);
  const s4 = await searchNames(auth, '绝对不存在的词xyz');
  assert(s4.length === 0, `S4 搜不存在词返回空（${s4.length} 条）`);

  // S5 UI：Cmd+K 面板输入「登录」
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate(() => document.querySelector('[data-search-btn]')?.click());
  await sleep(600);
  await page.evaluate(() => {
    const el = document.querySelector('input[placeholder*="搜索"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '登录');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(1200);
  const uiText = await page.evaluate(() => {
    const palette = document.querySelector('input[placeholder*="搜索"]')?.closest('div');
    return palette?.textContent ?? '';
  });
  assert(uiText.includes('开发登录模块'), `S5 UI 面板搜「登录」出现命中条目（${uiText.slice(0, 60)}）`);

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第六十一批 全局搜索「包含」匹配：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
