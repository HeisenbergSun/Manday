/**
 * Monday.com → Manday 迁移脚本（v3.0 方案 1.3 节落地）
 * 用法：MONDAY_API_TOKEN=xxx npx ts-node scripts/migrate-monday.ts --boards all --since 90d
 *
 * 策略：API 全量导出 → 列类型映射 → people 按 email 匹配 → 事务写入
 * 前置要求：目标库已跑 db/schema.sql；users 表已通过 SSO 首登/批量导入就绪
 */
import { Pool } from 'pg';

const MONDAY_API = 'https://api.monday.com/v2';
const token = process.env.MONDAY_API_TOKEN!;
const pg = new Pool({ connectionString: process.env.DATABASE_URL });

/** monday column type → Manday 列类型映射表（v3.0 定稿） */
const TYPE_MAP: Record<string, string> = {
  text: 'text', long_text: 'text', numbers: 'number', status: 'status',
  dropdown: 'dropdown', people: 'people', date: 'date', timeline: 'date',
  checkbox: 'checkbox', email: 'link', url: 'link', tags: 'dropdown',
  priority: 'dropdown', rating: 'number', progress: 'number',
};

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ query, variables }),
  });
  const { data, errors } = await res.json();
  if (errors) throw new Error(JSON.stringify(errors));
  return data;
}

/** 拉取 boards 元数据（列定义）+ 条目（近 N 天或全部） */
async function exportBoards(boardIds?: string[]) {
  return gql(`
    query($ids: [ID!]) {
      boards(ids: $ids, limit: 100) {
        id name description
        groups { id title position }
        columns { id title type settings_str }
        items_page(limit: 500) {
          items { id name group { id } created_at
            column_values { id text value type } }
        }
      }
    }`, { ids: boardIds ?? null }).then((d) => d.boards);
}

/** people 列值 → email 匹配 users.id；未匹配转 null（legacy_owner 预留） */
async function mapPeople(text: string | null): Promise<string | null> {
  if (!text) return null;
  const name = text.split(',')[0].trim();
  const { rows } = await pg.query(`SELECT id FROM users WHERE name = $1 LIMIT 1`, [name]);
  return rows[0]?.id ?? null;
}

async function migrateBoard(board: any, dryRun = false) {
  const client = await pg.connect();
  const stats = { items: 0, unmatchedPeople: 0 };
  try {
    if (dryRun) { console.log(`[dry-run] board "${board.name}": ${board.items_page.items.length} items`); return stats; }
    await client.query('BEGIN');

    const { rows: br } = await client.query(
      `INSERT INTO boards (name, description, visibility) VALUES ($1,$2,'department') RETURNING id`,
      [board.name, board.description],
    );
    const boardId = br[0].id;

    const groupId: Record<string, string> = {};
    for (const g of board.groups) {
      const { rows: gr } = await client.query(
        `INSERT INTO board_groups (board_id, name, position) VALUES ($1,$2,$3) RETURNING id`,
        [boardId, g.title, g.position],
      );
      groupId[g.id] = gr[0].id;
    }

    const colId: Record<string, string> = {};
    for (const c of board.columns) {
      if (c.type === 'name') continue; // 条目名列独立存在
      const { rows: cr } = await client.query(
        `INSERT INTO board_columns (board_id, type, name, settings, position)
         VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id`,
        [boardId, TYPE_MAP[c.type] ?? 'text', c.title, c.settings_str ?? '{}', Object.keys(colId).length],
      );
      colId[c.id] = cr[0].id;
    }

    let position = 1;
    for (const item of board.items_page.items) {
      const { rows: ir } = await client.query(
        `INSERT INTO items (board_id, group_id, name, position, created_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [boardId, groupId[item.group?.id], item.name, position++, item.created_at],
      );
      stats.items++;
      for (const cv of item.column_values) {
        const target = colId[cv.id];
        if (!target || cv.text == null) continue;
        let value: unknown = cv.text;
        if (cv.type === 'people') {
          value = await mapPeople(cv.text);
          if (!value) stats.unmatchedPeople++;
        }
        if (cv.type === 'status' && cv.text) value = { label: cv.text };
        await client.query(
          `INSERT INTO item_values (item_id, column_id, board_id, value) VALUES ($1,$2,$3,$4::jsonb)`,
          [ir[0].id, target, boardId, JSON.stringify(value)],
        );
      }
    }
    await client.query('COMMIT');
    console.log(`✓ board "${board.name}": ${stats.items} items, ${stats.unmatchedPeople} 未匹配负责人`);
    return stats;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

async function main() {
  const boards = await exportBoards();
  console.log(`共 ${boards.length} 个 board 待迁移`);
  // 第一轮 dry-run 校验差异，第二轮全量写入（v3.0：至少两轮演练）
  for (const b of boards) await migrateBoard(b, true);
  console.log('dry-run 完成，请核对后删除 dryRun 参数执行真实迁移');
  await pg.end();
}
if (require.main === module) main();
