/**
 * 性能验证：PERFBIG-5000 板 — 首屏渲染时间 + 分块滚动加载
 * 用法: node test-perf.js   （不进 test-batch*.js 回归循环）
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const TMP = 'C:/Users/RSU06X/AppData/Local/Temp';
const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: path.join(TMP, 'manday-perf-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);

  // 打开 PERFBIG-5000 板（在侧边栏里找）
  let clicked = false;
  for (let i = 0; i < 5 && !clicked; i++) {
    clicked = await page.evaluate(() => {
      const els = [...document.querySelectorAll('div,span,li,a')]
        .filter((x) => x.children.length === 0 && x.textContent.trim() === 'PERFBIG-5000');
      if (!els.length) return false;
      els[0].click();
      return true;
    });
    if (!clicked) { await page.reload({ waitUntil: 'networkidle2' }); await sleep(2000); }
  }
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const st = await page.evaluate(() => ({
      n: document.querySelectorAll('[data-grid-row]').length,
      sent: !!document.querySelector('[data-grid-sentinel]'),
      title: document.body.innerText.includes('PERFBIG-5000'),
    }));
    if (st.n >= 100 || st.sent) { console.log(`首屏 [data-grid-row]=${st.n} 耗时 ~${Date.now() - t0}ms（自点击起）`); break; }
  }
  await sleep(1500);
  const first = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-grid-row]').length,
    sentinel: !!document.querySelector('[data-grid-sentinel]'),
    text: document.querySelector('[data-grid-sentinel]')?.textContent.trim().slice(0, 30) ?? '',
  }));
  console.log('首屏状态', JSON.stringify(first));
  if (!first.sentinel) console.log('❌ 未出现分块加载 sentinel');

  // 滚到底部触发增量加载，直到 5000 行全部渲染
  const t1 = Date.now();
  let last = 0, stalls = 0;
  while (Date.now() - t1 < 120000) {
    await page.evaluate(() => { const r = document.querySelector('[data-grid-root]'); if (r) r.scrollTop = r.scrollHeight; });
    await sleep(700);
    const n = await page.evaluate(() => document.querySelectorAll('[data-grid-row]').length);
    if (n === last) { if (++stalls >= 3) break; } else stalls = 0;
    last = n;
  }
  const final = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-grid-row]').length,
    sentinel: !!document.querySelector('[data-grid-sentinel]'),
  }));
  console.log(`滚动加载完成: ${final.rows} 行，耗时 ~${Date.now() - t1}ms，sentinel=${final.sentinel}`);
  console.log(final.rows === 5000 && !final.sentinel ? '===== 性能验证全部通过 =====' : '===== 性能验证异常 =====');
  await browser.close();
  process.exit(final.rows === 5000 && !final.sentinel ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
