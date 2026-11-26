/**
 * 第六十三批 e2e：AI 助手深化（写操作触发 automation + WS 增量 + 周报工具）
 * S1  automation：batchUpdate 改 status → 触发 status_changed 规则（move_group 到「已完成」组）
 * S2  WS 增量：socket 连 board 房间，batch 改值收到 item.update；新建条目收到 item.create
 * S3  AI 周报：真实调用 AI「生成本周进展周报」→ 返回非空周报文本
 */
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');

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
  require('./e2e-profile-cleanup')('manday-batch63');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch63-' + Date.now(),
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
  const userId = await page.evaluate(() => localStorage.getItem('userId'));

  // 造数据：board 默认自带 status 列 + 三组（待办/进行中/已完成）
  const NAME = 'B63-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  const detail = await req(auth, 'GET', `/boards/${bid}`);
  let statusCol = detail.body.columns.find((c) => c.type === 'status');
  if (!statusCol) statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' })).body;
  const doneGroup = detail.body.groups.find((g) => g.name === '已完成');
  const labels = (statusCol.settings?.labels ?? []).map((l) => l.label ?? l);
  const doneLabel = labels.includes('已完成') ? '已完成' : (labels[labels.length - 1] ?? '已完成');
  const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '自动化触发任务' })).body;

  // ===== S1 automation 触发 =====
  const rule = await req(auth, 'POST', `/boards/${bid}/automations`, {
    trigger: { type: 'status_changed', to: doneLabel }, action: { type: 'move_group', groupId: doneGroup.id }, source: 'ui' });
  assert(rule.status === 200 || rule.status === 201, `S1a 创建 status_changed→move_group 规则（${rule.status}）`);
  const beforeGroup = (await req(auth, 'GET', `/boards/${bid}`)).body.items.find((i) => i.id === it.id)?.group_id;
  assert(beforeGroup !== doneGroup.id, 'S1b 触发前条目不在「已完成」组');
  // 走 batchUpdate（AI update_fields 确认后同路径）
  const batch = await req(auth, 'POST', '/items/batch', { changes: [{ itemId: it.id, columnId: statusCol.id, value: doneLabel }] });
  assert(batch.status === 200 || batch.status === 201, `S1c batchUpdate 改 status 成功（${batch.status}）`);
  await sleep(900);   // 等 fire-and-forget 的 automation 内联执行完
  const afterItem = (await req(auth, 'GET', `/boards/${bid}`)).body.items.find((i) => i.id === it.id);
  assert(afterItem?.group_id === doneGroup.id, `S1d automation 触发 move_group：条目移到「已完成」组（=${afterItem?.group_id}）`);

  // ===== S2 WS 增量广播 =====
  const events = [];
  const sock = io(BASE, { auth: { userId }, transports: ['websocket'], forceNew: true });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('socket 连接超时')), 5000);
    sock.on('connect', () => { clearTimeout(t); resolve(); });
    sock.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
  sock.on('item:changed', (p) => events.push(p));
  sock.emit('board:join', bid);
  await sleep(400);

  // S2a 改值 → item.update
  await req(auth, 'POST', '/items/batch', { changes: [{ itemId: it.id, columnId: statusCol.id, value: '进行中' }] });
  await sleep(600);
  const upd = events.find((e) => e.type === 'item.update' && e.itemId === it.id);
  assert(!!upd && upd.field === statusCol.id, `S2a 收到 item.update 广播（field=status 列, value=${upd?.value}）`);

  // S2b 新建条目 → item.create
  const it2 = (await req(auth, 'POST', `/boards/${bid}/items`, { name: '广播新建条目' })).body;
  await sleep(600);
  const cre = events.find((e) => e.type === 'item.create' && e.itemId === it2.id);
  assert(!!cre && cre.item?.name === '广播新建条目', `S2b 收到 item.create 广播（name=${cre?.item?.name}）`);
  sock.close();

  // ===== S3 AI 周报（真实 LLM，宽松冒烟）=====
  const ctrl = new AbortController();
  const tt = setTimeout(() => ctrl.abort(), 90000);
  let s3text = '';
  try {
    const res = await fetch(API + '/ai/chat/stream', {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: bid, message: '请生成本周进展周报' }), signal: ctrl.signal });
    const raw = await res.text();
    // 提取所有 data: 文本帧拼接
    for (const line of raw.split('\n')) {
      if (line.startsWith('data: ')) {
        const d = line.slice(6);
        if (!d.startsWith('[TOOL_CALL]')) s3text += d;
      }
    }
  } catch (e) { errors.push('S3 AI 周报调用失败：' + e.message); }
  finally { clearTimeout(tt); }
  assert(s3text.trim().length > 0, `S3 AI 周报返回非空文本（${s3text.trim().slice(0, 60)}…）`);
  assert(/完成|逾期|负载|进度|周报|项目/.test(s3text), 'S3 周报内容含进度关键词');

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第六十三批 AI 助手深化：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
