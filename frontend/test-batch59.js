/**
 * 第五十九批 e2e：右上角图标细节调整
 * S1  视图切换栏不再有「回收站」按钮（回收站已并入人员头像菜单）
 * S2  AI 助手图标已换成 WorkBuddy 品牌图标（filled 渲染，非 sparkle 描边）
 * S3  右上角 5 个按钮水平间距均匀（相邻 left 差值接近一致）
 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let errors = [];
const assert = (c, m) => { if (!c) { errors.push(m); console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };

(async () => {
  require('./e2e-profile-cleanup')('manday-batch59');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch59-' + Date.now(),
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

  // ── S1 视图切换栏无「回收站」按钮 ──
  const trashBtn = await page.evaluate(() => {
    // 弹出菜单未打开时，页面里不应有任何纯「回收站」按钮
    return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '回收站');
  });
  assert(!trashBtn, 'S1 视图切换栏已移除「回收站」按钮');

  // ── S2 AI 图标为 WorkBuddy（filled）──
  const aiIcon = await page.evaluate(() => {
    const btn = document.querySelector('[data-ai-btn]');
    if (!btn) return null;
    const svg = btn.querySelector('svg');
    if (!svg) return null;
    return { fill: svg.getAttribute('fill'), stroke: svg.getAttribute('stroke'), w: svg.getAttribute('width'), h: svg.getAttribute('height') };
  });
  assert(!!aiIcon, 'S2a AI 按钮内存在 svg 图标');
  if (aiIcon) {
    assert(aiIcon.fill && aiIcon.fill !== 'none', `S2b AI 图标为 filled 渲染（fill=${aiIcon.fill}）`);
    assert(aiIcon.stroke === 'none', `S2c AI 图标无描边（stroke=${aiIcon.stroke}）`);
    assert(Number(aiIcon.w) >= 22, `S2d AI 图标尺寸放大（width=${aiIcon.w}）`);
  }

  // ── S3 右上角 5 按钮间距均匀 ──
  const gaps = await page.evaluate(() => {
    const hdr = document.querySelector('header');
    if (!hdr) return null;
    const rects = ['[data-bell]', '[data-invite-btn]', '[data-search-btn]', '[data-ai-btn]', '[data-user-menu-btn]']
      .map((sel) => hdr.querySelector(sel))
      .filter(Boolean)
      .map((el) => el.getBoundingClientRect());
    const diffs = [];
    for (let i = 1; i < rects.length; i++) diffs.push(Math.round(rects[i].left - rects[i - 1].right));
    return { diffs, count: rects.length };
  });
  assert(gaps && gaps.count === 5, `S3a 右上角存在 5 个按钮（count=${gaps?.count}）`);
  if (gaps && gaps.count === 5) {
    const [min, max] = [Math.min(...gaps.diffs), Math.max(...gaps.diffs)];
    // 相邻按钮视觉间距应接近一致（考虑头像更宽，允许小幅波动）
    assert(max - min <= 6, `S3b 按钮间距均匀（gaps=${gaps.diffs.join(',')}，max-min=${max - min}）`);
  }

  console.log('\n===== 第五十九批 右上角图标细节：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
