/**
 * 第十六批 P3-2 文件附件列 e2e
 * A1 attachment 列创建（API）
 * A2 上传文件 → 200 + attachments 表落库 + cell value JSON 含文件名
 * A3 列表端点返回附件
 * A4 下载端点内容一致
 * A5 updateCell 直接写附件列被拒绝（400）
 * A6 UI：Grid chip 渲染 📎 文件名（data-attach-cell）+ 双击出现 file input
 * A7 删除 → cell value 移除
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
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch16-' + Date.now(),
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

  // prep：自建板 + attachment 列 + 1 条目
  const b = await req(auth, 'POST', '/boards', { name: 'P3-2 附件列', visibility: 'private' });
  const bid = b.body.id;
  const cA = await req(auth, 'POST', `/boards/${bid}/columns`, { name: '附件', type: 'attachment' });
  assert(cA.status === 200 || cA.status === 201, `A1 attachment 列创建（status=${cA.status}）`);
  const colId = cA.body.id;
  const g = (await req(auth, 'GET', `/boards/${bid}`)).body.groups[0];
  const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '带附件条目', groupId: g.id })).body;

  // A2 上传（multipart）
  const fd = new FormData();
  fd.append('file', new Blob(['hello manday attachment'], { type: 'text/plain' }), '需求说明.txt');
  fd.append('columnId', colId);
  const up = await fetch(API + `/items/${it.id}/attachments`, { method: 'POST', headers: { Authorization: auth }, body: fd });
  const upBody = await up.json().catch(() => null);
  assert(up.status === 200 || up.status === 201, `A2a 上传成功（status=${up.status}）`);
  assert(upBody?.attachment?.name === '需求说明.txt' && upBody?.attachment?.size === 23, `A2b 返回元数据（${JSON.stringify(upBody?.attachment)}）`);

  // attachments 表落库 + cell value JSON
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const cn = await c.query('SELECT count(*) FROM item_attachments WHERE item_id = $1', [it.id]);
    assert(cn.rows[0].count === '1', 'A2c attachments 表落库');
    const cv = await c.query(`SELECT value FROM item_values WHERE item_id = $1 AND column_id = $2`, [it.id, colId]);
    let arr = []; try { arr = JSON.parse(JSON.stringify(cv.rows[0]?.value ?? '[]')); } catch {}
    assert(Array.isArray(cv.rows[0]?.value) && cv.rows[0].value[0]?.name === '需求说明.txt', `A2d cell value 元数据 JSON（${JSON.stringify(cv.rows[0]?.value)}）`);
    await c.end();
  }
  const attId = upBody?.attachment?.id;

  // A3 列表端点
  const ls = await req(auth, 'GET', `/boards/${bid}/items/${it.id}/attachments`);
  assert(ls.status === 200 && Array.isArray(ls.body) && ls.body.length === 1, `A3 附件列表（status=${ls.status}）`);

  // A4 下载内容一致
  const dl = await fetch(API + `/attachments/${attId}/file`, { headers: { Authorization: auth } });
  const text = await dl.text();
  assert(dl.status === 200 && text === 'hello manday attachment', `A4 下载内容一致（status=${dl.status} len=${text.length}）`);

  // A5 updateCell 直写附件列被拒
  const bad = await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: colId, value: 'x', version: upBody.version });
  assert(bad.status === 400, `A5 updateCell 直写附件列拒绝（status=${bad.status}）`);

  // A6 UI：chip 渲染 + 双击 file input
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);
  let chips = [];
  for (let i = 0; i < 8; i++) {
    chips = await page.evaluate(() => [...document.querySelectorAll('[data-attach-chip]')].map((x) => x.textContent.trim()));
    if (chips.length) break;
    await sleep(1000);
  }
  assert(chips.some((t) => t.includes('需求说明.txt')), `A6a 附件 chip 渲染（${chips.join('|')}）`);
  await page.evaluate(() => document.querySelector('[data-attach-cell]').closest('td').dispatchEvent(new Event('dblclick', { bubbles: true })));
  await sleep(600);
  const editorOk = await page.evaluate(() => !!document.querySelector('input[data-attach-input][type="file"]'));
  assert(editorOk, 'A6b 双击附件格出现文件选择器');
  await page.keyboard.press('Escape');
  await sleep(300);

  // A7 删除 → cell value 移除
  const del = await req(auth, 'DELETE', `/attachments/${attId}`);
  assert(del.status === 200 && Array.isArray(del.body?.attachments) && del.body.attachments.length === 0,
    `A7 删除后 cell value 移除（status=${del.status}）`);

  await browser.close();

  // cleanup
  {
    require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
    const { Client } = require('../backend/node_modules/pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const dl2 = await c.query("DELETE FROM boards WHERE name LIKE 'P3-2 %'");
    console.log('  [cleanup] deleted boards:', dl2.rowCount);
    await c.end();
  }
  // 清空 uploads 残留（测试文件）
  try { const fs = require('fs'); for (const f of fs.readdirSync('../backend/uploads')) if (f.endsWith('.txt')) fs.unlinkSync('../backend/uploads/' + f); } catch {}

  console.log('\n===== TOTAL ERRORS: ' + errors.length + ' =====');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
