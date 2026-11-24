/**
 * 第五十六批 e2e：AI 助手接入 + 分析视图图标
 * S1  打开 AI 助手发消息 → 收到非空 AI 回复（走 Scania WorkBuddy 网关，网络相关）
 * S2  分析视图按钮图标 = dashboard（柱状图，3 根 line）
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
  require('./e2e-profile-cleanup')('manday-batch56');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch56-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B56-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // 准备一个 board 用于打开表格视图（看分析图标）
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
  await req(auth, 'POST', `/boards/${bid}/items`, { name: '条目一' });

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.evaluate((n) => document.querySelector(`[data-board-item="${n}"]`)?.click(), NAME);
  await sleep(2500);

  // ── S2 分析视图图标 = dashboard（柱状图） ──
  const insLineCount = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const ins = btns.find((x) => x.textContent.trim() === '分析');
    if (!ins) return -1;
    const svg = ins.querySelector('svg');
    return svg ? svg.querySelectorAll('line').length : 0;
  });
  assert(insLineCount >= 3, `S2 分析视图按钮图标为 dashboard 柱状图（line 数量=${insLineCount}）`);

  // ── S1 AI 助手发消息 ──
  await page.evaluate(() => { const btn = document.querySelector('[data-ai-btn]'); if (btn) btn.click(); });
  await sleep(1000);
  const ta = await page.$('aside textarea');
  assert(!!ta, 'S1a 打开 AI 助手侧边栏（textarea 存在）');
  if (ta) {
    await page.evaluate(() => {
      const el = document.querySelector('aside textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, '用一句话回答：你好');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);
    await page.evaluate(() => { const b = [...document.querySelectorAll('aside button')].find((x) => x.title === '发送'); if (b) b.click(); });
    // 轮询等待 AI 回复（网络相关，最长 60s）
    let reply = '';
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      reply = await page.evaluate(() => {
        const els = [...document.querySelectorAll('aside [data-role="ai"]')];
        const last = els[els.length - 1];
        return last ? last.textContent.trim() : '';
      });
      if (reply.length > 0) break;
    }
    assert(reply.length > 0, `S1b AI 收到非空回复（${reply.slice(0, 60) ?? '空'}${reply.length > 60 ? '…' : ''}）`);
  }

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第五十六批 AI 助手接入 + 分析图标：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
