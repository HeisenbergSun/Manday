/**
 * Manday 压测脚本（200 人规模）— 零依赖，原生 http.Agent 连接池
 * 场景：
 *   S1 读：GET /api/boards/:id（detail，jsonb 聚合主路径）
 *   S2 读列表：GET /api/boards + /api/boards/:id/items
 *   S3 写：PATCH /api/items/:id/cell（不同 item 避开 LWW 冲突）
 *   S4 混合：70% 读 + 30% 写（模拟真实编辑高峰）
 * 输出：QPS、P50/P95/P99、错误率
 * 用法：node loadtest.js [--users 200] [--duration 20]
 */
const http = require('http');

const BASE = process.env.BASE || 'http://localhost:3003';
const USERS = Number(process.argv.includes('--users') ? process.argv[process.argv.indexOf('--users') + 1] : 200);
const DURATION = Number(process.argv.includes('--duration') ? process.argv[process.argv.indexOf('--duration') + 1] : 20);

const agent = new http.Agent({ keepAlive: true, maxSockets: USERS, maxFreeSockets: USERS });

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method, agent,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.status || res.statusCode, body: data }));
    });
    r.on('error', reject);
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    if (payload) r.write(payload);
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 统计：延迟数组 → QPS/P50/P95/P99/错误率 */
function stats(latencies, errors, durationSec, label) {
  const sorted = latencies.slice().sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const total = latencies.length + errors;
  console.log(`\n[${label}]`);
  console.log(`  请求总数: ${total}（成功 ${latencies.length} / 失败 ${errors}）`);
  console.log(`  QPS: ${(latencies.length / durationSec).toFixed(1)}`);
  console.log(`  P50: ${q(0.5).toFixed(0)}ms | P95: ${q(0.95).toFixed(0)}ms | P99: ${q(0.99).toFixed(0)}ms | max: ${(sorted[sorted.length - 1] ?? 0).toFixed(0)}ms`);
  console.log(`  错误率: ${((errors / Math.max(total, 1)) * 100).toFixed(2)}%`);
}

async function main() {
  console.log(`=== Manday 压测：${USERS} 并发用户 × ${DURATION}s ===`);
  // 1. 登录
  const login = await req('POST', '/api/auth/dev-login');
  if (login.status >= 400) throw new Error('dev-login 失败: ' + login.status);
  const token = JSON.parse(login.body).token || JSON.parse(login.body).access_token;
  const h = token;

  // 2. 准备压测数据：专用 board + 500 条目（只建一次，名字标记复用）
  const boards = JSON.parse((await req('GET', '/api/boards', null, h)).body);
  const list = Array.isArray(boards) ? boards : boards.items;
  let board = list.find((b) => b.name === '__LOADTEST__');
  if (!board) {
    const created = await req('POST', '/api/boards', { name: '__LOADTEST__' }, h);
    board = JSON.parse(created.body);
    const col = await req('POST', `/api/boards/${board.id}/columns`, { name: '备注', type: 'text' }, h);
    const colId = JSON.parse(col.body).id;
    const BATCH = 50;
    for (let i = 0; i < 500; i += BATCH) {
      const changes = [];
      for (let j = 0; j < BATCH; j++) changes.push({ name: `lt-${i + j}` });
      // createItem 一次一条太慢 → 用 batch 接口只支持 cell；退化为逐条创建（仅初始化阶段）
      await Promise.all(changes.map((c) => req('POST', `/api/boards/${board.id}/items`, { name: c.name }, h)));
      process.stdout.write(`  数据准备 ${Math.min(i + BATCH, 500)}/500\r`);
    }
    console.log('\n  数据准备完成: 500 条目');
  }
  const bid = board.id;
  const detail = JSON.parse((await req('GET', `/api/boards/${bid}`, null, h)).body);
  const items = detail.items;
  const dateCol = detail.columns.find((c) => c.type === 'text');
  console.log(`  压测 board: ${bid}（${items.length} 条目，写场景打 text 列 ${dateCol?.id?.slice(0, 8)}…）`);
  if (items.length < 100) throw new Error('压测数据不足');

  const runScenario = async (label, worker) => {
    const latencies = [];
    let errors = 0;
    const deadline = Date.now() + DURATION * 1000;
    const oneUser = async (uid) => {
      while (Date.now() < deadline) {
        const t0 = Date.now();
        try { await worker(uid); latencies.push(Date.now() - t0); }
        catch { errors++; }
      }
    };
    const t0 = Date.now();
    await Promise.all(Array.from({ length: USERS }, (_, i) => oneUser(i)));
    const dur = (Date.now() - t0) / 1000;
    stats(latencies, errors, dur, label);
    await sleep(1500); // 场景间冷却
  };

  // S1 读 detail
  await runScenario('S1 读 board detail（jsonb 聚合）', async () => {
    const r = await req('GET', `/api/boards/${bid}`, null, h);
    if (r.status >= 400) throw new Error(r.status);
  });

  // S2 读 items 列表
  await runScenario('S2 读 items 列表', async () => {
    const r = await req('GET', `/api/boards/${bid}/items`, null, h);
    if (r.status >= 400) throw new Error(r.status);
  });

  // S3 写：每个用户按 uid 取模固定自己的 item，避免 LWW 冲突
  const itemsSnapshot = items;
  await runScenario('S3 写 cell（500 条目分片）', async (uid) => {
    const it = itemsSnapshot[uid % itemsSnapshot.length];
    const d = await req('GET', `/api/boards/${bid}`, null, h).catch(() => null);
    // version 直接取 detail 慢 → 改用乐观：先读一次 items 接口太重。
    // 简化：用 /api/boards/:id/items 拿不到单条 version……直接 detail。
    const dd = JSON.parse(d.body);
    const target = dd.items.find((x) => x.id === it.id) ?? dd.items[uid % dd.items.length];
    const r = await req('PATCH', `/api/items/${target.id}/cell`,
      { columnId: dateCol.id, value: 'v-' + Date.now(), version: target.version }, h);
    if (r.status >= 400) throw new Error(r.status + ' ' + r.body.slice(0, 80));
  });

  // S4 混合 70/30
  let mixedN = 0;
  await runScenario('S4 混合（70% 读 + 30% 写）', async (uid) => {
    mixedN++;
    if (mixedN % 10 < 7) {
      const r = await req('GET', `/api/boards/${bid}`, null, h);
      if (r.status >= 400) throw new Error(r.status);
    } else {
      const dd = JSON.parse((await req('GET', `/api/boards/${bid}`, null, h)).body);
      const target = dd.items[uid % dd.items.length];
      const r = await req('PATCH', `/api/items/${target.id}/cell`,
        { columnId: dateCol.id, value: 'm-' + Date.now(), version: target.version }, h);
      if (r.status >= 400) throw new Error(r.status + ' ' + r.body.slice(0, 80));
    }
  });

  console.log('\n=== 压测完成 ===');
  console.log('说明：S3/S4 每次写先读一次 detail 获取 version，写路径实际负载≈读+写，QPS 偏保守。');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
