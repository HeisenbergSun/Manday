/**
 * ACL 单元测试 — 权限唯一入口的回归保护（防权限模型返工的关键测试）
 * 运行: cd backend && npx jest acl.spec.ts
 */
import { can, BoardRole } from './acl';

describe('ACL 统一权限入口', () => {
  it('无角色一律拒绝（包括 AI 通道）', () => {
    expect(can(null, 'read')).toBe(false);
    expect(can(null, 'edit')).toBe(false);
    expect(can(null, 'manage')).toBe(false);
  });

  it('guest 只能读', () => {
    expect(can('guest', 'read')).toBe(true);
    expect(can('guest', 'edit')).toBe(false);
    expect(can('guest', 'manage')).toBe(false);
  });

  it('viewer 可读不可编辑', () => {
    expect(can('viewer', 'read')).toBe(true);
    expect(can('viewer', 'edit')).toBe(false);
    expect(can('viewer', 'delete')).toBe(false);
  });

  it('editor 可读写不可管理', () => {
    expect(can('editor', 'edit')).toBe(true);
    expect(can('editor', 'delete')).toBe(true);
    expect(can('editor', 'manage')).toBe(false);
  });

  it('owner 全通过', () => {
    (['read', 'edit', 'delete', 'manage'] as const).forEach((a) =>
      expect(can('owner', a)).toBe(true));
  });

  it('敏感列：非 owner 一律不可见（P1 列级权限钩子已生效）', () => {
    expect(can('editor', 'read', true)).toBe(false);
    expect(can('viewer', 'read', true)).toBe(false);
    expect(can('owner', 'read', true)).toBe(true);
  });
});
