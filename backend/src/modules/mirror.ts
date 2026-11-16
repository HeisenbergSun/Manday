// P2-4 Mirror 列：跨看板镜像条目状态
// board_connects 关系表（column_id -> connected_board_id）；
// 读取时把存储的源条目 id 换算为「源条目名 · 状态标签」JSON 文本注入（含标签色），无权限则剔除
import { Pool } from 'pg';
import { can, BoardRole } from './boards/acl';

export interface MirrorColumn {
  id: string;
  type: string;
  name: string;
  settings?: any;
}

/** 解析某用户在某 board 的角色（与 boards.module.resolveRole 同规则） */
export async function resolveBoardRole(pg: Pool, boardId: string, userId: string): Promise<BoardRole | null> {
  const { rows: br } = await pg.query(
    `SELECT b.owner_id, b.visibility, bp.role,
            EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = $2
                    AND ud.department_id = b.department_id) AS in_dept
     FROM boards b
     LEFT JOIN board_permissions bp ON bp.board_id = b.id AND bp.subject_type = 'user' AND bp.subject_id = $2
     WHERE b.id = $1 AND b.is_archived = false`, [boardId, userId]);
  if (!br.length) return null;
  const r = br[0];
  return r.role ?? (r.owner_id === userId ? 'owner'
    : (r.visibility === 'company' || (r.visibility === 'department' && r.in_dept)) ? 'editor' : 'viewer');
}

/**
 * Mirror 列读取时注入：values[columnId] = JSON 文本 { itemId, label, color, name }
 * - 权限：用户对 connected board 无读权 → 该列值被剔除
 * - 存储值：cell 写入源条目 id（纯文本）
 */
export async function injectMirrorValues(
  pg: Pool,
  columns: MirrorColumn[],
  itemRows: any[],
  userId: string,
): Promise<void> {
  const mirrorColIds = columns.filter((c) => c.type === 'mirror').map((c) => String(c.id));
  if (mirrorColIds.length === 0) return;
  // connect 关系
  const { rows: connects } = await pg.query(
    `SELECT column_id, connected_board_id FROM board_connects WHERE column_id = ANY($1::uuid[])`,
    [mirrorColIds],
  );
  if (!connects.length) return;
  const connByCol = new Map<string, string>(); // columnId -> connected board id
  for (const cn of connects) connByCol.set(String(cn.column_id), String(cn.connected_board_id));

  for (const [colId, srcBoardId] of connByCol) {
    // 读权限检查
    const role = await resolveBoardRole(pg, srcBoardId, userId);
    if (!can(role, 'read')) {
      for (const it of itemRows) delete it.values[colId];
      continue;
    }
    // 源板状态列
    const { rows: srcCols } = await pg.query(
      `SELECT id, settings FROM board_columns WHERE board_id = $1 AND type = 'status' ORDER BY position LIMIT 1`,
      [srcBoardId],
    );
    const statusCol = srcCols[0];
    const labels: any[] = statusCol?.settings?.labels ?? [];
    // 源条目 + 状态值
    const { rows: srcItems } = await pg.query(
      `SELECT i.id, i.name, iv.value #>> '{}' AS status
       FROM items i
       LEFT JOIN item_values iv ON iv.item_id = i.id AND iv.column_id = $2
       WHERE i.board_id = $1 AND i.deleted_at IS NULL AND i.parent_item_id IS NULL`,
      [srcBoardId, statusCol?.id ?? '00000000-0000-0000-0000-000000000000'],
    );
    const byId = new Map<string, { name: string; label: string | null; color: string | null }>();
    for (const s of srcItems) {
      const lb = labels.find((l) => l.label === s.status);
      byId.set(String(s.id), { name: s.name, label: s.status ?? null, color: lb?.color ?? null });
    }
    for (const it of itemRows) {
      const raw = it.values[colId];
      if (!raw) continue;
      let itemId = String(raw);
      try { itemId = String(JSON.parse(String(raw)).itemId ?? raw); } catch { /* 纯文本 id */ }
      const src = byId.get(itemId);
      it.values[colId] = JSON.stringify({
        itemId,
        name: src?.name ?? null,
        label: src?.label ?? null,
        color: src?.color ?? null,
      });
    }
  }
}
