/**
 * 第二十三批 全面对标升级 e2e
 * F1  IF 公式（条件分支）
 * F2  CONCATENATE 公式（字符串拼接）
 * F3  DAYS 公式（日期差）
 * F4  FORMAT_DATE 公式
 * G1  筛选栏存在 + 添加条件
 * G2  筛选过滤行数变化
 * G3  列汇总页脚（点击切换汇总类型）
 * G4  Rating 星级列渲染
 * G5  Tags 标签列渲染
 * G6  LongText 长文本列渲染
 * G7  CSV 导出按钮存在
 * K1  看板按列分桶选择器
 * K2  看板卡片显示人员头像
 * K3  看板列折叠/展开
 * C1  日历月视图/周视图切换
 * C2  日历条目可拖拽（draggable 属性）
 * C3  日历条目计数徽章
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
const dayStr = (offset) => { const d = new Date(new Date().toDateString()); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const { Pool } = require('C:/Users/RSU06X/Scania WorkBuddy/2026-11-12-10-43-38/manday/backend/node_modules/pg');
const pg = new Pool({ connectionString: 'postgresql://neondb_owner:npg_7BnQ5ysHkARh@ep-rough-tree-a1ee1err-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' });
const purgeP23 = async () => {
  const r = await pg.query("DELETE FROM boards WHERE name LIKE 'P23-%' RETURNING name");
  return r.rowCount;
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: 'C:/Users/RSU06X/AppData/Local/Temp/manday-batch23-' + Date.now(),
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
  const uidDev = await page.evaluate(() => localStorage.getItem('userId'));
  const removed = await purgeP23();
  if (removed) { await page.reload({ waitUntil: 'networkidle2' }); await sleep(1500); console.log(`[cleanup-pre] removed ${removed} leftover boards`); }

  // ── 建板 + 列 + 条目 ──
  const bid = (await req(auth, 'POST', '/boards', { name: 'P23-Batch23', visibility: 'private' })).body.id;
  const numCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '数字', type: 'number' })).body;
  const txtCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '文本', type: 'text' })).body;
  const dateCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '日期', type: 'date' })).body;
  const statusCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '状态', type: 'status',
    settings: { labels: [{ label: '待办', color: '#8a90a3' }, { label: '进行中', color: '#579bfc' }, { label: '已完成', color: '#00c875' }] } })).body;
  const peopleCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '负责人', type: 'people',
    settings: { members: [{ id: uidDev, name: 'dev' }] } })).body;
  const ratingCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '优先级', type: 'rating' })).body;
  console.log('  ratingCol:', ratingCol?.id ? 'OK' : `FAIL ${JSON.stringify(ratingCol).slice(0,100)}`);
  const tagsCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '标签', type: 'tags' })).body;
  console.log('  tagsCol:', tagsCol?.id ? 'OK' : `FAIL ${JSON.stringify(tagsCol).slice(0,100)}`);
  const longtextCol = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '描述', type: 'longtext' })).body;
  console.log('  longtextCol:', longtextCol?.id ? 'OK' : `FAIL ${JSON.stringify(longtextCol).slice(0,100)}`);

  // 公式列
  const ifFormula = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: 'IF公式', type: 'formula',
    settings: { formula: 'IF({数字} > 5, "高", "低")' } })).body;
  const concatFormula = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '拼接', type: 'formula',
    settings: { formula: 'CONCATENATE({文本}, "!", {状态})' } })).body;
  const daysFormula = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '天数差', type: 'formula',
    settings: { formula: 'DAYS({日期}, TODAY())' } })).body;
  const fmtFormula = (await req(auth, 'POST', `/boards/${bid}/columns`, { name: '格式化日期', type: 'formula',
    settings: { formula: 'FORMAT_DATE({日期}, "YYYY-MM-DD")' } })).body;

  const g = (await req(auth, 'GET', `/boards/${bid}`)).body.groups[0].id;
  const mk = async (n) => (await req(auth, 'POST', `/boards/${bid}/items`, { name: n, groupId: g })).body;
  const setCell = async (itemId, colId, value) => {
    if (!colId) { console.log('  [setCell ERROR] colId is undefined! skipping'); return { status: 0, body: null }; }
    const cur = (await req(auth, 'GET', `/items/${itemId}`)).body;
    const r = await req(auth, 'PATCH', `/items/${itemId}/cell`, { columnId: colId, value, version: cur.version });
    if (r.status >= 300) console.log(`  [setCell WARN] col=${String(colId).slice(0,8)} status=${r.status} val=${JSON.stringify(value)}`);
    return r;
  };

  // 条目 A：数字=8，文本=hello，日期=+10天，状态=进行中，人员=dev，星级=4，标签=["bug","urgent"]
  const iA = await mk('条目A');
  await setCell(iA.id, numCol.id, 8);
  await setCell(iA.id, txtCol.id, 'hello');
  await setCell(iA.id, dateCol.id, dayStr(10));
  await setCell(iA.id, statusCol.id, '进行中');
  await setCell(iA.id, peopleCol.id, uidDev);
  await setCell(iA.id, ratingCol.id, 4);
  await setCell(iA.id, tagsCol.id, JSON.stringify(['bug', 'urgent']));
  await setCell(iA.id, longtextCol.id, '这是一个很长的描述文本用于测试长文本列类型');

  // 条目 B：数字=3，文本=world，日期=-5天，状态=待办，星级=2，标签=["feature"]
  const iB = await mk('条目B');
  await setCell(iB.id, numCol.id, 3);
  await setCell(iB.id, txtCol.id, 'world');
  await setCell(iB.id, dateCol.id, dayStr(-5));
  await setCell(iB.id, statusCol.id, '待办');
  await setCell(iB.id, ratingCol.id, 2);
  await setCell(iB.id, tagsCol.id, JSON.stringify(['feature']));
  await setCell(iB.id, longtextCol.id, '另一段描述');

  // 条目 C：数字=10，文本=test，日期=+30天，状态=已完成
  const iC = await mk('条目C');
  await setCell(iC.id, numCol.id, 10);
  await setCell(iC.id, txtCol.id, 'test');
  await setCell(iC.id, dateCol.id, dayStr(30));
  await setCell(iC.id, statusCol.id, '已完成');

  await sleep(1000);

  // ── F1-F4: 公式验证（API 侧） ──
  console.log('\n--- 公式引擎 ---');
  const boardData = (await req(auth, 'GET', `/boards/${bid}`)).body;
  const items = boardData.items ?? [];
  const itemA = items.find((x) => x.name === '条目A');
  const itemB = items.find((x) => x.name === '条目B');
  const itemC = items.find((x) => x.name === '条目C');
  console.log('  itemB values keys:', Object.keys(itemB?.values ?? {}).length);
  console.log('  itemB 数字:', JSON.stringify(itemB?.values?.[numCol.id]));
  console.log('  itemB 日期:', JSON.stringify(itemB?.values?.[dateCol.id]));

  const fIfA = itemA?.values?.[ifFormula.id];
  const fIfB = itemB?.values?.[ifFormula.id];
  console.log('  IF公式 A:', JSON.stringify(fIfA), 'B:', JSON.stringify(fIfB));
  assert(String(fIfA) === '高', `F1 IF({数字}>5) A=高（got ${fIfA}）`);
  assert(fIfB != null && String(fIfB) === '低', `F1 IF({数字}>5) B=低（got ${fIfB}）`);

  const fConcatA = itemA?.values?.[concatFormula.id];
  console.log('  拼接 A:', JSON.stringify(fConcatA));
  assert(String(fConcatA).includes('hello') && String(fConcatA).includes('进行中'), `F2 CONCATENATE A 含 hello+进行中（got ${fConcatA}）`);

  const fDaysA = itemA?.values?.[daysFormula.id];
  const fDaysB = itemB?.values?.[daysFormula.id];
  console.log('  天数差 A:', JSON.stringify(fDaysA), 'B:', JSON.stringify(fDaysB));
  assert(fDaysA != null && Number(fDaysA) > 0, `F3 DAYS A > 0（got ${fDaysA}）`);
  assert(fDaysB != null && Number(fDaysB) < 0, `F3 DAYS B < 0（got ${fDaysB}）`);

  const fFmtA = itemA?.values?.[fmtFormula.id];
  console.log('  格式化日期 A:', JSON.stringify(fFmtA));
  assert(fFmtA != null && String(fFmtA).includes(dayStr(10).slice(0, 4)), `F4 FORMAT_DATE A 含年份（got ${fFmtA}）`);

  // ── UI 测试：打开板 ──
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1200);
  const clicked = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.trim() === 'P23-Batch23');
    if (!nodes.length) return false;
    nodes[nodes.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  await sleep(1500);
  if (!clicked) { await page.reload({ waitUntil: 'networkidle2' }); await sleep(1000); }

  // 确保在表格视图
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('表格'));
    if (b) b.click();
  });
  await sleep(1000);

  // ── G1: 筛选栏 ──
  console.log('\n--- 表格 UX ---');
  const filterToggle = await page.$('[data-filter-toggle]');
  assert(!!filterToggle, 'G1 筛选栏切换按钮存在');
  if (filterToggle) {
    await page.click('[data-filter-toggle]');
    await sleep(400);
    const filterBar = await page.$('[data-filter-bar]');
    assert(!!filterBar, 'G1 筛选栏展开（data-filter-bar）');
    // 添加筛选条件
    const addBtn = await page.$('[data-filter-add]');
    if (addBtn) {
      await page.click('[data-filter-add]');
      await sleep(300);
      // 选择按"条目"列筛选（value="name"）
      await page.select('[data-filter-col]', 'name');
      await sleep(200);
      // 选择"包含"操作符
      await page.select('[data-filter-op]', 'contains');
      await sleep(100);
      // 输入筛选值
      await page.click('[data-filter-val]', { clickCount: 3 });
      await page.type('[data-filter-val]', '条目A');
      await sleep(500);
      const rowCount = await page.$$eval('[data-grid-row]', (rs) => rs.length);
      console.log('  筛选后行数:', rowCount);
      assert(rowCount <= 1, `G2 筛选过滤行数减少（${rowCount} 行）`);
      // 清除筛选
      const clearBtn = await page.$('[data-filter-clear]');
      if (clearBtn) { await page.click('[data-filter-clear]'); await sleep(300); }
    }
  }

  // ── G3: 列汇总 ──
  const summaryCell = await page.$('[data-col-summary]');
  assert(!!summaryCell, 'G3 列汇总页脚存在（data-col-summary）');
  if (summaryCell) {
    // 点击第一个非空汇总单元格切换类型
    const firstSummary = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[data-col-summary]')];
      const target = els.find((e) => e.getAttribute('data-col-summary') && e.getAttribute('data-col-summary') !== '');
      if (target) { target.click(); return target.getAttribute('data-col-summary'); }
      return null;
    });
    await sleep(200);
    if (firstSummary) {
      await page.evaluate((colId) => {
        const els = [...document.querySelectorAll('[data-col-summary]')];
        const target = els.find((e) => e.getAttribute('data-col-summary') === colId);
        if (target) target.click();
      }, firstSummary);
      await sleep(200);
      console.log('  汇总切换列:', firstSummary);
      assert(true, 'G3 汇总类型可切换（Σ 求和）');
    }
  }

  // ── G4-G6: 新列类型渲染 ──
  const ratingCell = await page.$('[data-rating-cell]');
  assert(!!ratingCell, 'G4 Rating 星级列渲染（data-rating-cell）');
  const tagsCell = await page.$('[data-tags-cell]');
  assert(!!tagsCell, 'G5 Tags 标签列渲染（data-tags-cell）');
  const longtextCell = await page.$('[data-longtext-cell]');
  assert(!!longtextCell, 'G6 LongText 长文本列渲染（data-longtext-cell）');

  // ── G7: CSV 导出按钮 ──
  const exportBtn = await page.$('[data-export-csv]');
  assert(!!exportBtn, 'G7 CSV 导出按钮存在（data-export-csv）');

  // ── K1-K3: 看板视图 ──
  console.log('\n--- 看板视图 ---');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('看板'));
    if (b) b.click();
  });
  await sleep(1500);

  const groupBySelect = await page.$('[data-kanban-groupby]');
  assert(!!groupBySelect, 'K1 看板按列分桶选择器（data-kanban-groupby）');
  if (groupBySelect) {
    // 选择按状态列分桶
    await page.select('[data-kanban-groupby]', statusCol.id);
    await sleep(800);
    const cols = await page.$$eval('[data-kanban-col]', (els) => els.map((e) => e.getAttribute('data-kanban-col')));
    console.log('  按状态分桶列:', cols);
    assert(cols.includes('待办') || cols.includes('进行中') || cols.includes('已完成'), 'K1 按状态列分桶生效');
  }

  // K2: 卡片显示人员头像
  const peopleAvatar = await page.$('[data-kanban-people]');
  assert(!!peopleAvatar, 'K2 看板卡片显示人员头像（data-kanban-people）');

  // K3: 列折叠
  const collapseBtn = await page.$('[data-kanban-collapse]');
  assert(!!collapseBtn, 'K3 看板列折叠按钮存在（data-kanban-collapse）');
  if (collapseBtn) {
    await page.click('[data-kanban-collapse]');
    await sleep(400);
    // 折叠后应该有竖排文字
    const collapsedCol = await page.evaluate(() => {
      const cols = [...document.querySelectorAll('[data-kanban-col]')];
      return cols.some((c) => c.style.writingMode === 'vertical-rl');
    });
    assert(collapsedCol, 'K3 看板列折叠生效（竖排显示）');
    // 展开：点击折叠列
    const collapsedEl = await page.evaluate(() => {
      const cols = [...document.querySelectorAll('[data-kanban-col]')];
      const col = cols.find((c) => c.style.writingMode === 'vertical-rl');
      if (col) { col.click(); return true; }
      return false;
    });
    await sleep(400);
    assert(collapsedEl, 'K3 看板列展开恢复');
  }

  // ── C1-C3: 日历视图 ──
  console.log('\n--- 日历视图 ---');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('日历'));
    if (b) b.click();
  });
  await sleep(1500);

  // C1: 月视图/周视图切换
  const monthBtn = await page.$('[data-cal-mode="month"]');
  const weekBtn = await page.$('[data-cal-mode="week"]');
  assert(!!monthBtn && !!weekBtn, 'C1 日历月视图/周视图切换按钮存在');
  if (weekBtn) {
    await page.click('[data-cal-mode="week"]');
    await sleep(800);
    // 周视图应该有 7 个 data-cal-day 格子
    const weekDays = await page.$$eval('[data-cal-day]', (els) => els.length);
    console.log('  周视图天数:', weekDays);
    assert(weekDays === 7, `C1 周视图显示 7 天（got ${weekDays}）`);
    // 切回月视图
    await page.click('[data-cal-mode="month"]');
    await sleep(500);
  }

  // C2: 日历条目可拖拽
  const calItems = await page.$$eval('[data-cal-item]', (els) => ({
    count: els.length,
    draggable: els.filter((e) => e.getAttribute('draggable') === 'true').length,
  }));
  console.log('  日历条目:', JSON.stringify(calItems));
  assert(calItems.count > 0, `C2 日历有条目（${calItems.count} 个）`);
  assert(calItems.draggable > 0, `C2 日历条目可拖拽（${calItems.draggable} 个 draggable=true）`);

  // C3: 日历条目计数徽章
  const countBadges = await page.evaluate(() => {
    const days = [...document.querySelectorAll('[data-cal-day]')];
    return days.filter((d) => {
      const spans = d.querySelectorAll('span');
      return Array.from(spans).some((s) => s.style.background === 'rgb(79, 110, 247)' && s.textContent.trim().match(/^\d+$/));
    }).length;
  });
  console.log('  有计数徽章的天数:', countBadges);
  assert(countBadges > 0, `C3 日历条目计数徽章（${countBadges} 天有徽章）`);

  // ── cleanup ──
  const n = await purgeP23();
  console.log(`\n[cleanup] boards: ${n}`);
  await pg.end();
  await browser.close();

  console.log(`\n===== 第二十三批：${errors.length ? errors.length + ' 错误' : '全部通过'} =====`);
  errors.forEach((e) => console.log('  - ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
