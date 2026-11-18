/**
 * 统一「人员列值 → 真实姓名」解析（App 2.0 数据修复配套）
 *
 * 背景：people 列的值历史上存在三种形态：
 *   1. 真实用户 UUID（当前 UI 写入，如 43c4d6a3-...）—— 需经用户表解析为姓名
 *   2. 列 settings.members 里的演示假 id（u1/u2）—— 需经 members 解析为姓名
 *   3. 直接的姓名字符串（老测试 / 手工写入，如「张伟」「dev」）—— 原样使用
 *
 * 旧实现只查 settings.members，导致真实 UUID 直接显示为 UUID（看板/工作量/分析视图人员异常）。
 * 本模块把「优先真实用户、回退 members、再回退原值」的解析集中起来，供所有视图复用。
 */
import { useEffect, useState } from 'react';
import { api } from './api';

export type CompanyUser = { id: string; name: string; email?: string; avatar?: string };

type MemberLike = { id: string; name: string; color?: string };

let cachedUsers: CompanyUser[] | null = null;
let pending: Promise<CompanyUser[]> | null = null;

/** 全局只加载一次用户表（Promise 级去重） */
export function loadCompanyUsers(): Promise<CompanyUser[]> {
  if (cachedUsers) return Promise.resolve(cachedUsers);
  if (!pending) {
    pending = Promise.resolve(api.listUsers())
      .then((u: any) => {
        cachedUsers = Array.isArray(u) ? u : [];
        return cachedUsers;
      })
      .catch(() => {
        cachedUsers = [];
        return cachedUsers;
      });
  }
  return pending;
}

/** 供 e2e / 其它代码强制刷新缓存 */
export function clearCompanyUsersCache() {
  cachedUsers = null;
  pending = null;
}

/** 组件内订阅的公司用户列表（懒加载一次） */
export function useCompanyUsers(): CompanyUser[] {
  const [users, setUsers] = useState<CompanyUser[]>(cachedUsers ?? []);
  useEffect(() => {
    let alive = true;
    loadCompanyUsers().then((u) => { if (alive) setUsers(u); });
    return () => { alive = false; };
  }, []);
  return users;
}

/** 把单个 people 值（string / {id,name,label} / 数字）归一成原始标识字符串 */
function scalar(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as any;
    return String(o.id ?? o.name ?? o.label ?? '');
  }
  return String(v);
}

/**
 * 单个 people 值 → 真实姓名。
 * @param value      单元格原始值（可能 UUID / 假 id / 姓名 / 对象）
 * @param users      公司用户列表（useCompanyUsers）
 * @param members    人员列的 settings.members（演示假成员，可空）
 */
export function personName(
  value: unknown,
  users: CompanyUser[],
  members: MemberLike[] = [],
): string {
  const key = scalar(value);
  if (!key) return '';
  // ① 真实用户按 id 匹配（UUID）
  let u = users.find((x) => x.id === key);
  // ② 真实用户按姓名匹配（值本身就是姓名字符串）
  if (!u) u = users.find((x) => x.name === key);
  if (u) return u.name;
  // ③ 回退：演示假成员按 id 匹配
  const m = members.find((x) => x.id === key);
  if (m) return m.name;
  // ④ 回退：演示假成员按姓名匹配
  const m2 = members.find((x) => x.name === key);
  if (m2) return m2.name;
  // ⑤ 都匹配不到：原样返回（保证未知 UUID 至少可读，不吞数据）
  return key;
}

/** people 单元格值（单值或数组）→ 真实姓名数组（去重、过滤空值） */
export function personNames(
  raw: unknown,
  users: CompanyUser[],
  members: MemberLike[] = [],
): string[] {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: string[] = [];
  for (const v of arr) {
    const n = personName(v, users, members);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** 取人员列 settings.members（兼容各视图的写法） */
export function membersOf(col: any): MemberLike[] {
  if (!col) return [];
  const m = col.settings?.members;
  return Array.isArray(m) ? m : [];
}
