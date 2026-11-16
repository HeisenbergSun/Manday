/**
 * 第十七批 P3-3 @提及增强 e2e
 * T1 打开条目详情面板
 * T2 评论框输入 @ → data-mention-menu 弹出 + data-mention-option 列表
 * T3 输入过滤 → 点选补全 → textarea 值含 "@名字 "
 * T4 发布 → 评论正文 data-mention-chip 高亮
 * T5 API：@提及后 notifications 落库（mention 通知给被提及者）
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

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch17-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录'));
    if (b) b.click();
  });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));
  const devName = (await req(auth, 'GET', '/auth/me')).body?.name ?? '';

  // prep：自建板 + 条目（页面默认打开最新板）
  const b = await req(auth, 'POST', '/boards', { name: 'P3-3 提及增强', visibility: 'private' });
  const bid = b.body.id;
  const g = (await req(auth, 'GET', `/boards/${bid}`)).body.groups[0];
  const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '提及目标条目', groupId: g.id })).body;
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);

  // T1 打开详情
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((x) => x.textContent.includes('提及目标条目'));
    row?.scrollIntoView();
  });
  await sleep(400);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')];
    const row = rows.find((x) => x.textContent.includes('提及目标条目'));
    const open = row?.querySelector('[data-open-detail], button');
    open?.click();
  });
  await sleep(800);
  // 详情面板兜底：hover 第一行 Open（batch7 方式），若已在动态 tab 即可
  let detailOpen = await page.evaluate(() => !!document.querySelector('textarea[data-comment-input], aside'));
  if (!detailOpen) {
    const rowBox = await page.evaluate(() => {
      const row = [...document.querySelectorAll('tr')].find((x) => x.textContent.includes('提及目标条目'));
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return { x: r.left + 300, y: r.top + r.height / 2 };
    });
    if (rowBox) {
      await page.mouse.move(rowBox.x, rowBox.y); await sleep(500);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Open');
        btn?.click();
      });
      await sleep(800);
    }
  }
  detailOpen = await page.evaluate(() => !!document.querySelector('textarea[data-comment-input]'));
  assert(detailOpen, 'T1 条目详情面板打开（评论框可见）');

  // T2 输入 @ 弹补全
  await page.click('textarea[data-comment-input]');
  await page.type('textarea[data-comment-input]', '@');
  await sleep(800);
  let menu = { open: 0, opts: [] };
  for (let i = 0; i < 6; i++) {
    menu = await page.evaluate(() => ({
      open: document.querySelectorAll('[data-mention-menu]').length,
      opts: [...document.querySelectorAll('[data-mention-option]')].map((x) => x.getAttribute('data-mention-option')),
    }));
    if (menu.open) break;
    await sleep(1000);
  }
  assert(menu.open === 1 && menu.opts.length > 0, `T2 @弹出补全菜单（opts=${menu.opts.slice(0, 3).join('|')}）`);

  // T3 过滤 + 点选补全
  await page.type('textarea[data-comment-input]', menu.opts[0]?.slice(0, 1) ?? '');
  await sleep(500);
  const filtered = await page.evaluate(() => [...document.querySelectorAll('[data-mention-option]')].map((x) => x.getAttribute('data-mention-option')));
  assert(filtered.length >= 1 && filtered.every((n) => n.startsWith(menu.opts[0]?.slice(0, 1) ?? '')), `T3 按首字过滤（${filtered.join('|')}）`);
  await page.evaluate(() => document.querySelector('[data-mention-option]').click());
  await sleep(500);
  const draftVal = await page.evaluate(() => document.querySelector('textarea[data-comment-input]').value);
  assert(draftVal === `@${menu.opts[0]} ` && mentionQueryClosed(), `T3b 补全替换 + 菜单关闭（draft="${draftVal}"）`);
  function mentionQueryClosed() { return true; } // 菜单关闭由 DOM 验证
  const menuGone = await page.evaluate(() => document.querySelectorAll('[data-mention-menu]').length === 0);
  assert(menuGone, 'T3c 补全菜单已关闭');

  // 追加文本并发布
  await page.type('textarea[data-comment-input]', '请关注这条任务进度');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.includes('发布'))?.click());
  await sleep(1200);

  // T4 评论正文 mention chip
  let chip = null;
  for (let i = 0; i < 6; i++) {
    chip = await page.evaluate(() => {
      const c = document.querySelector('[data-mention-chip]');
      return c ? c.textContent : null;
    });
    if (chip) break;
    await sleep(1000);
  }
  assert(chip && chip.includes(`@${menu.opts[0]}`), `T4 评论正文 mention 高亮 chip（${chip}）`);

  // T5 API：@提及 → 通知落库（@张伟，dev 之外的 seeded 用户）
  await req(auth, 'POST', `/items/${it.id}/updates`, { body: 'hello @张伟 请查收' });
  await sleep(500);
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const n = await c.query(`SELECT count(*) FROM notifications nt JOIN users us ON us.id = nt.user_id WHERE us.name = '张伟' AND nt.type = 'mention' AND nt.read_at IS NULL`);
    assert(Number(n.rows[0].count) >= 1, `T5 @张伟 通知落库（count=${n.rows[0].count}）`);
    await c.end();
  }

  await browser.close();

  // cleanup
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl = await c.query("DELETE FROM boards WHERE name LIKE 'P3-3 %'");
    const dn = await c.query(`DELETE FROM notifications WHERE type='mention' AND payload->>'itemId' IS NULL OR payload IS NULL`);
    console.log('  [cleanup] deleted boards:', dl.rowCount);
    await c.end();
  }

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
