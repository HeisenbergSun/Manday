/**
 * 第二十九批 细节优化 e2e（12 项优化的可自动化部分）
 * S1 #64 空板一键添加常用列
 * S2 #62 子任务进度徽章
 * S3 #59 键盘流：Enter 下行同列继续编辑
 * S4 #56 LWW 409 自动合并重试
 * S5 #58 导出 Excel（全量 + 筛选后）
 * S6 #61 筛选条件随视图保存/恢复
 * S7 #66 附件图片 lightbox 预览
 * S8 #63 人员指派写通知（API 级）
 * （#57 导入预览在 batch28、#60 重连 refetch 为网络模拟场景、#67 为性能项，不在本脚本覆盖）
 */
const puppeteer = require('puppeteer-core');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/frontend/.browsers/chromium/win64-1742554/chrome-win/chrome.exe';
const BASE = 'http://localhost:3003';
const API = BASE + '/api';
const TMP = 'C:/Users/RSU06X/AppData/Local/Temp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let errors = [];
const assert = (c, m) => { if (!c) { errors.push(m); console.log('  ❌ ' + m); } else console.log('  ✅ ' + m); };
const req = async (auth, method, path_, body) => {
  const r = await fetch(API + path_, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const purge = async () => { try { const { Client } = require('pg'); require('dotenv').config({ path: '../backend/.env' }); const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect(); await c.query("DELETE FROM notifications WHERE payload->>'boardId' IN (SELECT id FROM boards WHERE name LIKE 'B29-%')"); const r = await c.query("DELETE FROM boards WHERE name LIKE 'B29-%' RETURNING name"); await c.end(); return r.rowCount; } catch { return 0; } };

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  await purge();
  require('./e2e-profile-cleanup')('manday-batch29');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: TMP + '/manday-batch29-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));
  const users = (await req(auth, 'GET', '/users')).body;
  const uZhang = users.find((u) => u.name === '张伟');

  // ── S1 #64 空板一键添加常用列 ──
  const emptyBid = (await req(auth, 'POST', '/boards', { name: 'B29-EmptyQuickCols', visibility: 'private' })).body.id;
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  const nav = async (name) => page.evaluate((n) => {
    const els = [...document.querySelectorAll('span,div,a,button')];
    const t = els.find((el) => el.textContent.trim() === n && el.offsetParent !== null);
    if (t) { t.click(); return true; } return false;
  }, name);
  if (!await nav('B29-EmptyQuickCols')) { await sleep(1500); await nav('B29-EmptyQuickCols'); }
  await sleep(2500);
  const quickBtn = await page.$('[data-quick-columns]');
  assert(!!quickBtn, 'S1 空板（无列）出现一键添加常用列按钮');
  if (quickBtn) {
    await quickBtn.click();
    await sleep(3000);
    const cols = (await req(auth, 'GET', `/boards/${emptyBid}`)).body.columns;
    const names = cols.map((c) => c.name).join('/');
    assert(['负责人', '状态', '截止日期'].every((n) => cols.some((c) => c.name === n)), `S1 常用列已建（${names}）`);
    const types = Object.fromEntries(cols.map((c) => [c.name, c.type]));
    assert(types['负责人'] === 'people' && types['状态'] === 'status' && types['截止日期'] === 'date', `S1 类型正确（${JSON.stringify(types)}）`);
  }

  // ── 主测试板 ──
  const bid = (await req(auth, 'POST', '/boards', { name: 'B29-Optimize', visibility: 'private' })).body.id;
  const textCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '备注', type: 'text' })).body;
  const peopleCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people' })).body;
  const attachCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '附件', type: 'attachment' })).body;
  const p1 = (await req(auth, 'POST', `/boards/${bid}/items`, { name: 'B29-父任务' })).body;
  const p2 = (await req(auth, 'POST', `/boards/${bid}/items`, { name: 'B29-第二行' })).body;

  // ── S2 #62 子任务进度徽章 ──
  const s1 = (await req(auth, 'POST', `/items/${p1.id}/subitems`, { name: '子任务一' })).body;
  await req(auth, 'POST', `/items/${p1.id}/subitems`, { name: '子任务二' });
  await req(auth, 'PATCH', `/items/${s1.id}`, { done: true });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  await nav('B29-Optimize');
  await sleep(2500);
  const badge = await page.evaluate(() => document.querySelector('[data-subtask-badge]')?.textContent ?? '');
  assert(badge.includes('1/2'), `S2 子任务徽章 1/2（实际 ${badge || '无'}）`);

  // ── S3 #59 键盘流：Enter 下行同列 ──
  // 点第一行「备注」列 → 编辑器出现 → 输入 → Enter → 编辑器仍存在（移到下一行同列）
  await page.evaluate((col) => {
    const td = document.querySelector(`td[data-col="${col}"][data-grid-cell]`);
    td?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, textCol.id);
  await sleep(600);
  let editorOpen = await page.$('[data-grid-editor]');
  assert(!!editorOpen, 'S3 点击备注列出现编辑器');
  if (editorOpen) {
    await page.type('[data-grid-editor]', 'kb-行一');
    await page.keyboard.press('Enter');
    await sleep(1200);
    const stillOpen = await page.$('[data-grid-editor]');
    assert(!!stillOpen, 'S3 Enter 后编辑器仍在（下行同列继续编辑）');
    const pos = await page.evaluate(() => {
      const ed = document.querySelector('[data-grid-editor]');
      const row = ed?.closest('tr[data-grid-row]');
      return row?.getAttribute('data-grid-row') ?? '';
    });
    assert(pos === p2.id, `S3 焦点移到第二行（实际 ${pos === p2.id ? p2.id : pos || '无'}）`);
    await page.keyboard.press('Escape');
    await sleep(600);
    const v1 = ((await req(auth, 'GET', `/boards/${bid}`)).body.items.find((i) => i.id === p1.id)?.values ?? {})[textCol.id];
    assert(v1 === 'kb-行一', `S3 第一行备注已保存（实际 ${v1}）`);
  }

  // ── S4 #56 LWW 409 自动合并重试 ──
  // 先用 API 模拟他人修改（bump version），再在 UI 用旧 version 保存 → 应自动合并
  const cur = (await req(auth, 'GET', `/boards/${bid}`)).body.items.find((i) => i.id === p2.id);
  await req(auth, 'PATCH', `/items/${p2.id}/cell`, { columnId: textCol.id, value: '他人改动', version: cur.version });
  await sleep(500);
  // UI 端行数据仍是旧 version（不刷新）→ 定位 p2 那一行的备注单元格编辑
  const p2Edited = await page.evaluate((col, rowId) => {
    const td = document.querySelector(`tr[data-grid-row="${rowId}"] td[data-col="${col}"]`);
    if (!td) return false;
    td.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, textCol.id, p2.id);
  assert(p2Edited, 'S4 定位到第二行备注单元格');
  await sleep(800);
  if (p2Edited && await page.$('[data-grid-editor]')) {
    await page.type('[data-grid-editor]', 'ui-合并');
    await page.keyboard.press('Enter');
    let merged = '';
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      merged = await page.evaluate(() => document.body.innerText.match(/自动合并[^\n]*/)?.[0] ?? '');
      if (merged) break;
    }
    assert(!!merged, `S4 409 自动合并提示（实际 ${merged || '无'}）`);
    await sleep(1000);
    const v2 = ((await req(auth, 'GET', `/boards/${bid}`)).body.items.find((i) => i.id === p2.id)?.values ?? {})[textCol.id];
    assert(v2 === 'ui-合并', `S4 UI 保存已自动合并落库（实际 ${v2}）`);
  }

  // ── S5 #58 导出 Excel ──
  // headless 下载不落盘 → 页面内拦截 <a download> 点击，捕获 blob: URL 后回读字节
  const captureBlob = async () => {
    await page.evaluate(() => {
      window.__capB64 = null;
      if (window.__capHooked) return;
      window.__capHooked = true;
      const orig = document.createElement.bind(document);
      document.createElement = (tag, ...args) => {
        const el = orig(tag, ...args);
        if (String(tag).toLowerCase() === 'a') {
          const desc = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href');
          let href = '';
          Object.defineProperty(el, 'href', {
            get() { return href; },
            set(v) {
              href = v;
              if (String(v).startsWith('blob:')) {
                fetch(v).then((r) => r.arrayBuffer()).then((buf) => {
                  const bytes = new Uint8Array(buf); let s = '';
                  for (const b of bytes) s += String.fromCharCode(b);
                  window.__capB64 = btoa(s);
                });
              }
              return v;
            },
          });
        }
        return el;
      };
    });
    await page.click('[data-export-xlsx]');
    for (let i = 0; i < 10 && !(await page.evaluate(() => window.__capB64)); i++) await sleep(500);
    const b64 = await page.evaluate(() => window.__capB64);
    const f = path.join(TMP, `manday-export-${Date.now()}.xlsx`);
    if (b64) fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    return b64 ? f : '';
  };
  const xlsxFile = await captureBlob();
  assert(!!xlsxFile, 'S5 Excel 导出文件生成');
  if (xlsxFile) {
    const wb = XLSX.readFile(xlsxFile);
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    assert(aoa.length === 3, `S5 全量导出 2 条数据行+表头（实际 ${aoa.length} 行）`);
    assert(JSON.stringify(aoa[1]).includes('B29-父任务'), 'S5 内容含 B29-父任务');
  }

  // ── S6 #61 筛选 + 视图持久化（工具条小弹窗） ──
  await page.evaluate(() => document.querySelector('[data-filter-toolbar]')?.click());
  await sleep(600);
  await page.evaluate(() => document.querySelector('[data-filter-pop-add]')?.click());
  await sleep(600);
  // 选「备注」列（默认是「条目」）+ 输入值
  await page.evaluate((col) => {
    const sel = document.querySelector('select[data-filter-pop-col]');
    if (sel) { sel.value = col; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, textCol.id);
  await sleep(400);
  await page.type('[data-filter-pop-val]', 'kb-行一');
  await sleep(800);
  const rowCount1 = await page.evaluate(() => document.querySelectorAll('[data-grid-row]').length);
  assert(rowCount1 === 1, `S6 筛选命中 1 行（实际 ${rowCount1}）`);
  // 关闭筛选弹窗，打开视图面板保存
  await page.evaluate(() => document.querySelector('[data-filter-toolbar]')?.click());
  await sleep(300);
  await page.evaluate(() => document.querySelector('[data-views-trigger]')?.click());
  await sleep(600);
  await page.type('input[placeholder="视图名"]', 'B29-筛选视图');
  await sleep(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.find((b) => b.textContent.trim() === '保存')?.click();
  });
  await sleep(1500);
  const viewSaved = await page.evaluate(() => new Promise((res) => {
    // 保存后面板可能仍开着；若已关则重新打开再查
    const check = () => setTimeout(() => {
      res([...document.querySelectorAll('[data-view-item] span')].some((s) => s.textContent.includes('B29-筛选视图')));
    }, 600);
    if (document.querySelector('[data-views-panel]')) check();
    else { document.querySelector('[data-views-trigger]')?.click(); setTimeout(check, 800); }
  }));
  assert(viewSaved, 'S6 视图已保存到列表');
  const fFile = await captureBlob();
  if (fFile) {
    const wb2 = XLSX.readFile(fFile);
    const aoa2 = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1 });
    assert(aoa2.length === 2, `S5 筛选后导出 1 条数据行（实际 ${aoa2.length} 行）`);
    fs.unlinkSync(fFile);
  } else assert(false, 'S5 筛选后 Excel 导出文件生成');
  try { if (xlsxFile && fs.existsSync(xlsxFile)) fs.unlinkSync(xlsxFile); } catch {}
  // 刷新后恢复视图 → 筛选条件应还原
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  await nav('B29-Optimize');
  await sleep(2500);
  await page.evaluate(() => document.querySelector('[data-views-trigger]')?.click());
  await sleep(800);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-view-item] span')].find((s) => s.textContent.includes('B29-筛选视图'));
    el?.click();
  });
  await sleep(1500);
  // 打开筛选弹窗检查条件还原
  await page.evaluate(() => document.querySelector('[data-filter-toolbar]')?.click());
  await sleep(600);
  const restored = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-filter-pop-row]').length,
    val: document.querySelector('[data-filter-pop-val]')?.value ?? '',
  }));
  assert(restored.rows >= 1 && restored.val === 'kb-行一', `S6 视图恢复筛选条件（rows=${restored.rows}, val=${restored.val}）`);
  // 清除筛选，避免影响后续断言
  await page.evaluate(() => document.querySelector('[data-filter-pop-clear]')?.click());
  await page.evaluate(() => document.querySelector('[data-filter-toolbar]')?.click());
  await sleep(800);

  // ── S7 #66 图片 lightbox ──
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'shot.png');
  fd.append('columnId', attachCol.id);
  const up = await fetch(API + `/items/${p1.id}/attachments`, { method: 'POST', headers: { Authorization: auth }, body: fd });
  assert(up.ok, `S7 图片上传成功（${up.status}）`);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  await nav('B29-Optimize');
  await sleep(2500);
  await page.evaluate(() => document.querySelector('[data-attach-img]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(2000);
  assert(await page.$('[data-lightbox]'), 'S7 lightbox 预览打开');
  await page.evaluate(() => document.querySelector('[data-lightbox]')?.click());
  await sleep(600);
  assert(!(await page.$('[data-lightbox]')), 'S7 lightbox 点击关闭');

  // ── S8 #63 人员指派通知（API 级：DB 校验） ──
  await req(auth, 'PATCH', `/items/${p1.id}/cell`, { columnId: peopleCol.id, value: uZhang.id, version: 999999 }).catch(() => {});
  // 直接走服务层逻辑：用正确 version（先取最新）
  const cur2 = (await req(auth, 'GET', `/boards/${bid}`)).body.items.find((i) => i.id === p1.id);
  const cellRes = await req(auth, 'PATCH', `/items/${p1.id}/cell`, { columnId: peopleCol.id, value: uZhang.id, version: cur2.version });
  assert(cellRes.status === 200 || cellRes.body?.version, `S8 指派保存成功（${JSON.stringify(cellRes.body)}）`);
  await sleep(1500);
  let assignNotif = null;
  for (let i = 0; i < 12 && !assignNotif; i++) {
    await sleep(1000);
    try {
      const { Client } = require('pg');
      require('dotenv').config({ path: '../backend/.env' });
      const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      await c.connect();
      const r = await c.query(`SELECT type, payload FROM notifications WHERE user_id = $1 AND type = 'assign' ORDER BY created_at DESC LIMIT 1`, [uZhang.id]);
      assignNotif = r.rows[0] ?? null;
      await c.end();
    } catch {}
  }
  assert(!!assignNotif && assignNotif.payload?.itemId === p1.id, `S8 指派通知已写入（${assignNotif ? assignNotif.payload?.itemId : '无'}）`);

  // 清理
  await req(auth, 'DELETE', `/boards/${emptyBid}`);
  await req(auth, 'DELETE', `/boards/${bid}`);
  await purge();

  errors.forEach((e) => { if (!errors.includes(e) || true) console.log('  [err] ' + e); });
  console.log('\n===== 第二十九批 细节优化：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
