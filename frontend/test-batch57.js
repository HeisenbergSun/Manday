/**
 * 第五十七批 e2e：右上角布局 + 人员菜单弹窗
 * S1  右上角依次存在：通知铃铛 / 邀请人员 / 全局搜索 / AI 助手 / 人员头像（5 个按钮）
 * S2  点击人员头像 → 弹窗含 个人档案 / 存档 / 回收站 / 功能设置 / 退出登录
 * S3  个人档案面板显示姓名 + 邮箱 + 部门
 * S4  邀请人员弹窗：有「复制邀请链接」按钮 + 成员列表
 * S5  全局搜索按钮 → 打开 Cmd+K 面板（input 存在）
 * S6  后端归档/恢复闭环（POST archive → archived 列表 → unarchive）
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
  require('./e2e-profile-cleanup')('manday-batch57');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch57-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const NAME = 'B57-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));

  // 准备一个 board（归档测试用）
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;

  // ── S1 右上角 5 个按钮存在 ──
  const hasBell = await page.$('[data-bell]');
  const hasInvite = await page.$('[data-invite-btn]');
  const hasSearch = await page.$('[data-search-btn]');
  const hasAi = await page.$('[data-ai-btn]');
  const hasUserMenu = await page.$('[data-user-menu-btn]');
  assert(!!hasBell, 'S1a 通知铃铛按钮存在');
  assert(!!hasInvite, 'S1b 邀请人员按钮存在');
  assert(!!hasSearch, 'S1c 全局搜索按钮存在');
  assert(!!hasAi, 'S1d AI 助手按钮存在');
  assert(!!hasUserMenu, 'S1e 人员头像按钮存在');

  // 校验顺序：铃铛 → 邀请 → 搜索 → AI → 头像（DOM 顺序）
  const order = await page.evaluate(() => {
    const hdr = document.querySelector('header');
    if (!hdr) return [];
    return ['[data-bell]', '[data-invite-btn]', '[data-search-btn]', '[data-ai-btn]', '[data-user-menu-btn]']
      .map((sel) => hdr.querySelector(sel))
      .map((el) => (el ? el.getBoundingClientRect().left : -1));
  });
  assert(order[0] >= 0 && order[0] < order[1] && order[1] < order[2] && order[2] < order[3] && order[3] < order[4],
    `S1f 按钮顺序为 通知→邀请→搜索→AI→头像（left=${order.map((x) => Math.round(x)).join(',')}）`);

  // ── S2 人员弹窗菜单 ──
  await page.click('[data-user-menu-btn]');
  await sleep(600);
  const menuLabels = await page.evaluate(() => [...document.querySelectorAll('[data-menu-item]')].map((x) => x.textContent.trim()));
  for (const lbl of ['个人档案', '存档', '回收站', '功能设置', '退出登录']) {
    assert(menuLabels.some((m) => m.includes(lbl)), `S2 菜单含「${lbl}」`);
  }

  // ── S3 个人档案 ──
  await page.evaluate(() => [...document.querySelectorAll('[data-menu-item="profile"]')][0]?.click());
  await sleep(600);
  const profileText = await page.evaluate(() => document.querySelector('[data-user-popover]')?.textContent ?? '');
  assert(profileText.includes('开发账号') && profileText.includes('dev@internal'), 'S3 个人档案显示姓名 + 邮箱');
  await page.evaluate(() => [...document.querySelectorAll('[data-menu-back]')][0]?.click());
  await sleep(400);

  // ── S4 邀请人员弹窗 ──
  await page.click('[data-invite-btn]');
  await sleep(600);
  const inviteHasCopy = await page.$('[data-copy-invite]');
  const inviteText = await page.evaluate(() => document.querySelector('[data-invite-popover]')?.textContent ?? '');
  assert(!!inviteHasCopy, 'S4a 邀请弹窗有「复制邀请链接」按钮');
  assert(inviteText.includes('工作区成员'), 'S4b 邀请弹窗展示成员列表');
  await page.evaluate(() => document.body.click());
  await sleep(300);

  // ── S5 全局搜索按钮 ──
  await page.click('[data-search-btn]');
  await sleep(500);
  const searchInput = await page.evaluate(() => {
    // Cmd+K 面板是 fixed 全屏遮罩里的 input
    const inputs = [...document.querySelectorAll('input')];
    return inputs.some((i) => i.placeholder?.includes('搜索'));
  });
  assert(searchInput, 'S5 全局搜索按钮打开搜索面板');
  await page.keyboard.press('Escape');
  await sleep(300);

  // ── S6 后端归档/恢复闭环 ──
  const arch1 = await req(auth, 'POST', `/boards/${bid}/archive`);
  assert(arch1.status === 201 || arch1.status === 200, `S6a 归档接口成功（status=${arch1.status}）`);
  const archList = await req(auth, 'GET', '/boards/archived');
  const inArch = (archList.body ?? []).some((x) => x.id === bid);
  assert(inArch, 'S6b 已归档 board 出现在 archived 列表');
  const unarch = await req(auth, 'POST', `/boards/${bid}/unarchive`);
  assert(unarch.status === 201 || unarch.status === 200, 'S6c 取消归档成功');
  const archList2 = await req(auth, 'GET', '/boards/archived');
  assert(!(archList2.body ?? []).some((x) => x.id === bid), 'S6d 取消归档后从 archived 列表移除');

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第五十七批 右上角布局 + 人员菜单：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
