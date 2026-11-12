/**
 * 统一权限入口 — 全项目 ACL 只经这一个函数（对抗评审结论：避免权限模型返工）
 * P0: Board 级 RBAC；P1 升级列级/行级时只改这里
 */
export type BoardRole = 'owner' | 'editor' | 'viewer' | 'guest';
export type Action = 'read' | 'edit' | 'manage' | 'delete';

const LEVEL: Record<BoardRole, number> = { guest: 1, viewer: 2, editor: 3, owner: 4 };
const NEED: Record<Action, number> = { read: 1, edit: 3, delete: 3, manage: 4 };

/**
 * @param userRole 用户在该 Board 的角色（null = 无权限，AI/接口层均直接拒绝）
 * @param action   期望动作
 * @param isSensitiveColumn 敏感列（列级权限 P1 启用，P0 返回 false）
 */
export function can(userRole: BoardRole | null, action: Action, isSensitiveColumn = false): boolean {
  if (!userRole) return false;                    // 无权限即拒绝，不给 AI 幻觉空间
  if (isSensitiveColumn && userRole !== 'owner') return false; // P1 列级权限钩子：敏感列仅 owner 可见
  return LEVEL[userRole] >= NEED[action];
}
