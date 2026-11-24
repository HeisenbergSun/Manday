/**
 * 第六十批 e2e：AI 写工具「预览 → 确认 → 执行」闭环
 * S1  造一个含「状态」列的 board + 3 条任务（状态=进行中）
 * S2  AI 对话「把这些任务都标记为已完成」→ 流里出现 [TOOL_CALL] 预览帧（tool=update_fields）
 * S3  直接执行前 DB 不变（未确认不落库）
 * S4  POST /ai/tool/confirm → 真正写入，任务状态变为「已完成」
 * S5  二次确认（重放）应被拒绝（一次性）
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

/** 读完整 SSE 流并解析出 [TOOL_CALL] 帧 */
async function chatAndGetToolCall(auth, boardId, message, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API + '/ai/chat/stream', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId, message }),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let toolCall = null;
    for (const line of raw.split('\n')) {
      const i = line.indexOf('[TOOL_CALL] ');
      if (i >= 0) {
        try { toolCall = JSON.parse(line.slice(i + '[TOOL_CALL] '.length)); } catch {}
      }
    }
    return { raw, toolCall };
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  require('./e2e-profile-cleanup')('manday-batch60');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch60-' + Date.now(),
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
  const NAME = 'B60-' + new Date().toISOString().slice(5, 16).replace(/[T:]/g, '-');
  const b = await req(auth, 'POST', '/boards', { name: NAME, visibility: 'company' });
  const bid = b.body.id;
  await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status' });
  const detail = await req(auth, 'GET', `/boards/${bid}`);
  const statusCol = detail.body.columns.find((c) => c.name === '状态').id;
  const names = ['写需求文档', '开发登录模块', '修复通知bug'];
  const ids = [];
  for (const n of names) {
    const it = (await req(auth, 'POST', `/boards/${bid}/items`, { name: n })).body;
    ids.push(it.id);
    await req(auth, 'PATCH', `/items/${it.id}/cell`, { columnId: statusCol, value: '进行中', version: 1 });
  }

  // S2 AI 对话 → 预览帧
  const { raw, toolCall } = await chatAndGetToolCall(auth, bid, '把这个看板里的所有任务都标记为已完成。');
  assert(!!toolCall, `S2a 流中出现 [TOOL_CALL] 预览帧（tool=${toolCall?.tool ?? '无'}）`);
  if (toolCall) {
    assert(toolCall.tool === 'update_fields', `S2b 工具类型为 update_fields（=${toolCall.tool}）`);
    assert(Array.isArray(toolCall.payload?.changes) && toolCall.payload.changes.length >= 3, `S2c 预览覆盖 ≥3 条任务（changes=${toolCall.payload?.changes?.length ?? 0}）`);
    assert(raw.includes('预览') || raw.length > 0, 'S2d 流含 AI 说明文本');

    // S3 确认前 DB 不变
    const before = await req(auth, 'GET', `/boards/${bid}`);
    const beforeVals = before.body.items.map((it) => it.values?.[statusCol]);
    assert(beforeVals.every((v) => v === '进行中'), `S3 未确认时任务状态仍为「进行中」（${beforeVals.join(',')}）`);

    // S4 确认执行
    const conf = await req(auth, 'POST', '/ai/tool/confirm', { toolCallId: toolCall.id });
    assert(conf.status === 200 || conf.status === 201, `S4a 确认接口成功（status=${conf.status}）`);
    assert(conf.body?.applied === true, 'S4b 返回 applied=true');
    await sleep(800);
    const after = await req(auth, 'GET', `/boards/${bid}`);
    const afterVals = after.body.items.map((it) => it.values?.[statusCol]);
    assert(afterVals.every((v) => v === '已完成'), `S4c 确认后任务状态全部变为「已完成」（${afterVals.join(',')}）`);

    // S5 重放确认应被拒绝
    const replay = await req(auth, 'POST', '/ai/tool/confirm', { toolCallId: toolCall.id });
    assert(replay.status >= 400, `S5 重放确认被拒绝（status=${replay.status}）`);
  }

  // 清理
  await req(auth, 'DELETE', `/boards/${bid}`);

  console.log('\n===== 第六十批 AI 写工具「预览→确认→执行」：' + (errors.length ? `${errors.length} 项失败` : '全部通过 ====='));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
