/**
 * 第十三批 P2-5 视觉低饱和收敛 e2e
 * V1 状态 chip 文字色为柔和色（饱和度/亮度在收敛区间）
 * V2 表格分组色带 band 行出现（data-group-band），组行底色极浅（alpha 14/0D）
 * V3 标签管理面板 chip 同样降饱和（列管理器 data-label-chips）
 */
const puppeteer = require('puppeteer-core');
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

/** hex → HSL 的 s/l，校验收敛区间 */
function hslOf(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

(async () => {
    require('./e2e-profile-cleanup')('manday-batch13');
const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch13-' + Date.now(),
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

  // prep：自建板，高饱和状态标签（纯 #1890ff / #ff4d4f）+ 两个分组
  const br = await req(auth, 'POST', '/boards', { name: 'P2-5 视觉验证', visibility: 'private' });
  const bid = br.body.id;
  assert(!!bid, 'prep 建板: ' + br.status);
  const stCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status', settings: { labels: [{ label: '待办', color: '#1890ff' }, { label: '已完成', color: '#ff4d4f' }], doneLabels: ['已完成'] } })).body;
  const det = (await req(auth, 'GET', `/boards/${bid}`)).body;
  const gid1 = det.groups[0].id, gid2 = det.groups[1].id;
  const mk = async (name, gid, status) => {
    const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name, groupId: gid })).body;
    await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: stCol.id, value: status, version: it.version });
  };
  await mk('V任务1', gid1, '待办');
  await mk('V任务2', gid2, '已完成');

  // UI：reload 打开最新板
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);

  // V1 状态 chip 降饱和
  let chipColor = null;
  for (let i = 0; i < 8; i++) {
    chipColor = await page.evaluate(() => {
      const el = document.querySelector('[data-status-chip="待办"]');
      return el ? getComputedStyle(el).color : null;
    });
    if (chipColor) break;
    await sleep(1000);
  }
  assert(!!chipColor, 'V1a 状态 chip 渲染（' + chipColor + '）');
  if (chipColor) {
    const m = chipColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const hex = '#' + m.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, '0')).join('');
      const { s, l } = hslOf(hex);
      assert(s <= 0.46 && l >= 0.57, `V1b chip 降饱和（s=${s.toFixed(2)} l=${l.toFixed(2)}，原始 #1890ff s=1.00 l=0.53）`);
    } else assert(false, 'V1b 无法解析 chip 颜色: ' + chipColor);
  }

  // V2 分组色带
  let bands = [];
  for (let i = 0; i < 6; i++) {
    bands = await page.evaluate(() => [...document.querySelectorAll('[data-group-band]')].map((x) => x.textContent.trim()));
    if (bands.length) break;
    await sleep(1000);
  }
  assert(bands.length >= 2, `V2a 分组色带出现（${bands.join('|')}）`);
  const tinted = await page.evaluate(() => {
    const row = document.querySelector('[data-grid-row]');
    return row ? getComputedStyle(row).backgroundColor : null;
  });
  assert(!!tinted, 'V2b 行渲染（' + tinted + '）');
  // 行底色应为极浅（rgba alpha ≈ 0.05 或纯浅色）
  if (tinted) {
    const am = tinted.match(/rgba\(.+,\s*([\d.]+)\)/);
    assert(!am || Number(am[1]) <= 0.12 || tinted === 'rgb(255, 255, 255)', `V2c 组行底色极浅（${tinted}）`);
  }

  // V3 列管理器标签 chip 降饱和
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('列与分组'));
    if (b) b.click();
  });
  await sleep(800);
  const labelColor = await page.evaluate(() => {
    const el = document.querySelector('[data-label-chips] span');
    return el ? getComputedStyle(el).color : null;
  });
  if (labelColor) {
    const m = labelColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const hex = '#' + m.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, '0')).join('');
      const { s } = hslOf(hex);
      assert(s <= 0.46, `V3 标签 chip 降饱和（s=${s.toFixed(2)}）`);
    }
  } else assert(false, 'V3 标签 chip 未找到');

  await browser.close();

  // cleanup：PG 级联删测试板
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl = await c.query("DELETE FROM boards WHERE name LIKE 'P2-5 %'");
    console.log('  [cleanup] deleted boards:', dl.rowCount);
    await c.end();
  }

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
