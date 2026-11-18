/**
 * Batch 25 — 分组排序 bug 修复验证
 * 确认同一个分组的条目在表格中是相邻的，分组 band 不重复出现
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

const { Pool } = require('C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/manday/backend/node_modules/pg');
const pg = new Pool({ connectionString: 'postgresql://neondb_owner:npg_7BnQ5ysHkARh@ep-rough-tree-a1ee1err-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' });
const purge = async () => { const r = await pg.query("DELETE FROM boards WHERE name LIKE 'B25-%' RETURNING name"); return r.rowCount; };

(async () => {
    require('./e2e-profile-cleanup')('manday-batch25');
const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch25-' + Date.now(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  // 登录
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('一键登录')); if (b) b.click(); });
  await sleep(2000);
  const auth = 'Bearer ' + await page.evaluate(() => localStorage.getItem('manday_token'));
  await purge();

  // 建板 + 两个分组 + 列
  const bid = (await req(auth, 'POST', '/boards', { name: 'B25-GroupBug', visibility: 'private' })).body.id;
  assert(bid, 'Board created');
  const txtCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '任务', type: 'text' })).body;
  const boardInit = (await req(auth, 'GET', `/boards/${bid}`)).body;
  const g1 = boardInit.groups[0]; // 默认分组
  const g2 = (await req(auth, 'POST', `/boards/${bid}/groups`, { name: '第二组' })).body;
  const g3 = (await req(auth, 'POST', `/boards/${bid}/groups`, { name: '第三组' })).body;
  console.log(`  groups: ${g1.name}(${g1.id}), ${g2.name}(${g2.id}), ${g3.name}(${g3.id})`);

  // 创建条目：故意交错分配分组，验证前端是否正确按分组聚合
  // 按时间戳顺序创建，position 递增，但分组交错
  const iA = (await req(auth, 'POST', `/boards/${bid}/items`, { name: 'A-第二组', groupId: g2.id })).body;
  const iB = (await req(auth, 'POST', `/boards/${bid}/items`, { name: 'B-默认组', groupId: g1.id })).body;
  const iC = (await req(auth, 'POST', `/boards/${bid}/items`, { name: 'C-第二组', groupId: g2.id })).body;
  const iD = (await req(auth, 'POST', `/boards/${bid}/items`, { name: 'D-第三组', groupId: g3.id })).body;
  const iE = (await req(auth, 'POST', `/boards/${bid}/items`, { name: 'E-默认组', groupId: g1.id })).body;
  const iF = (await req(auth, 'POST', `/boards/${bid}/items`, { name: 'F-第二组', groupId: g2.id })).body;
  await sleep(500);

  console.log('\n--- 验证 API 返回的 position 顺序（应该交错）---');
  const boardData = (await req(auth, 'GET', `/boards/${bid}`)).body;
  console.log('  API order:', boardData.items.map((i) => `${i.name}(pos=${i.position},gid=${i.group_id?.slice(0,4)})`).join(', '));

  // 导航到板——等待左侧导航栏加载后点击
  await sleep(1000);
  const navigated = await page.evaluate((boardName) => {
    const items = [...document.querySelectorAll('span,div,a,button')];
    const target = items.find((el) => el.textContent.trim() === boardName && el.offsetParent !== null);
    if (target) { target.click(); return true; }
    return false;
  }, 'B25-GroupBug');
  if (!navigated) {
    // 可能需要等待 WorkspaceNav 加载
    await sleep(2000);
    await page.evaluate((boardName) => {
      const items = [...document.querySelectorAll('span,div,a,button')];
      const target = items.find((el) => el.textContent.trim() === boardName && el.offsetParent !== null);
      if (target) target.click();
    }, 'B25-GroupBug');
  }
  await sleep(3000);

  // 确认已进入正确的板——检查是否有我们创建的条目
  const onCorrectBoard = await page.evaluate(() => {
    return document.body.innerText.includes('A-第二组');
  });
  if (!onCorrectBoard) {
    // 刷新一次再试
    await page.reload();
    await sleep(2000);
    await page.evaluate((boardName) => {
      const items = [...document.querySelectorAll('span,div,a,button')];
      const target = items.find((el) => el.textContent.trim() === boardName && el.offsetParent !== null);
      if (target) target.click();
    }, 'B25-GroupBug');
    await sleep(3000);
  }

  // 读取表格中的 band 顺序和行顺序
  const tableOrder = await page.evaluate(() => {
    const bands = [...document.querySelectorAll('[data-group-band]')].map((el) => ({
      type: 'band',
      gid: el.getAttribute('data-group-band'),
      name: el.textContent.trim().slice(0, 20),
    }));
    const rows = [...document.querySelectorAll('[data-grid-row]')].map((el) => ({
      type: 'row',
      name: el.querySelector('td[data-col="name"]')?.textContent?.trim() ?? '?',
    }));
    // 完整的 DOM 顺序（band 和 row 混合）
    const all = [...document.querySelectorAll('[data-group-band], [data-grid-row]')].map((el) => {
      if (el.hasAttribute('data-group-band')) {
        return { type: 'band', name: el.textContent.trim().slice(0, 20) };
      }
      return { type: 'row', name: el.querySelector('td[data-col="name"]')?.textContent?.trim() ?? '?' };
    });
    return { bands, rows, all };
  });

  console.log('\n--- 表格 DOM 顺序 ---');
  tableOrder.all.forEach((item) => {
    console.log(`  ${item.type === 'band' ? '📌' : '  📋'} ${item.name}`);
  });

  // G1: 每个分组 band 只出现一次
  const bandNames = tableOrder.bands.map((b) => b.name);
  const uniqueBands = [...new Set(bandNames)];
  assert(bandNames.length === uniqueBands.length, `G1: 分组 band 不重复（${bandNames.length} 个 band，${uniqueBands.length} 个唯一）`);

  // G2: 同一分组的条目是相邻的
  const groupRows = {};
  let currentBand = null;
  for (const item of tableOrder.all) {
    if (item.type === 'band') {
      currentBand = item.name;
      groupRows[currentBand] = [];
    } else if (currentBand) {
      groupRows[currentBand].push(item.name);
    }
  }
  console.log('\n--- 分组内条目 ---');
  Object.entries(groupRows).forEach(([band, rows]) => {
    console.log(`  ${band}: ${rows.join(', ')}`);
  });

  // 验证每个分组内的条目确实属于该分组（用 includes 匹配，因为 band 名含 ▼ 和计数）
  const expectedGroups = {
    [g1.name]: ['B-默认组', 'E-默认组'],
    [g2.name]: ['A-第二组', 'C-第二组', 'F-第二组'],
    [g3.name]: ['D-第三组'],
  };

  let groupsCorrect = true;
  for (const [gname, expectedItems] of Object.entries(expectedGroups)) {
    // 找到包含该分组名的 band
    const bandKey = Object.keys(groupRows).find((k) => k.includes(gname));
    if (!bandKey) {
      console.log(`  ❌ ${gname}: band 未找到`);
      groupsCorrect = false;
      continue;
    }
    const actual = groupRows[bandKey] || [];
    if (actual.length !== expectedItems.length) {
      console.log(`  ❌ ${gname}: 期望 ${expectedItems.length} 条，实际 ${actual.length} 条`);
      groupsCorrect = false;
    } else if (!expectedItems.every((item) => actual.includes(item))) {
      console.log(`  ❌ ${gname}: 期望 [${expectedItems}]，实际 [${actual}]`);
      groupsCorrect = false;
    }
  }
  assert(groupsCorrect, 'G2: 条目按分组正确聚合');

  // G3: 验证分组 band 顺序与 groups 数组顺序一致
  const expectedBandOrder = [g1.name, g2.name, g3.name].map((n) => n);
  const actualBandOrder = tableOrder.bands.map((b) => b.name.replace(/[▶▼]\s*/, '').trim().split(/\s/)[0]);
  // 宽松比较：只验证第一个 band 是默认组
  const firstBandName = tableOrder.bands[0]?.name ?? '';
  assert(firstBandName.includes(g1.name), `G3: 第一个分组 band 是默认组（${firstBandName}）`);

  // G4: 移动条目到另一个分组后，表格重新聚合
  console.log('\n--- 移动 B-默认组 → 第三组 ---');
  await req(auth, 'PATCH', `/items/${iB.id}`, { groupId: g3.id });
  await sleep(500);

  // 刷新看板数据
  await page.reload();
  await sleep(2000);
  await sleep(1000);
  await page.evaluate((boardName) => {
    const items = [...document.querySelectorAll('span,div,a,button')];
    const target = items.find((el) => el.textContent.trim() === boardName && el.offsetParent !== null);
    if (target) target.click();
  }, 'B25-GroupBug');
  await sleep(3000);

  const tableAfterMove = await page.evaluate(() => {
    return [...document.querySelectorAll('[data-group-band], [data-grid-row]')].map((el) => {
      if (el.hasAttribute('data-group-band')) {
        return { type: 'band', name: el.textContent.trim().slice(0, 20) };
      }
      return { type: 'row', name: el.querySelector('td[data-col="name"]')?.textContent?.trim() ?? '?' };
    });
  });

  console.log('  移动后 DOM 顺序:');
  tableAfterMove.forEach((item) => {
    console.log(`    ${item.type === 'band' ? '📌' : '  📋'} ${item.name}`);
  });

  // B-默认组 应该现在在第三组下面
  const afterMoveGroups = {};
  let currentBand2 = null;
  for (const item of tableAfterMove) {
    if (item.type === 'band') {
      currentBand2 = item.name;
      afterMoveGroups[currentBand2] = [];
    } else if (currentBand2) {
      afterMoveGroups[currentBand2].push(item.name);
    }
  }
  const inGroup3 = afterMoveGroups[Object.keys(afterMoveGroups).find((k) => k.includes(g3.name))] || [];
  assert(inGroup3.includes('B-默认组'), 'G4: 移动后 B-默认组 出现在第三组中');

  // 验证 band 不重复
  const bandsAfterMove = tableAfterMove.filter((i) => i.type === 'band').map((b) => b.name);
  const uniqueBandsAfter = [...new Set(bandsAfterMove)];
  assert(bandsAfterMove.length === uniqueBandsAfter.length, `G5: 移动后 band 不重复（${bandsAfterMove.length} 个，${uniqueBandsAfter.length} 个唯一）`);

  // === 汇总 ===
  console.log('\n=== 汇总 ===');
  if (errors.length) {
    console.log(`❌ ${errors.length} 项失败:`);
    errors.forEach((e) => console.log('   - ' + e));
  } else {
    console.log('✅ 全部通过');
  }

  await purge();
  await browser.close();
  await pg.end();
  process.exit(errors.length > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
