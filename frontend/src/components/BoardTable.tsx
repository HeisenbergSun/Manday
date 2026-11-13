/**
 * 表格视图 — 自研 React 表格（P1：替换 AG Grid）
 * 列类型渲染/编辑器统一在 Grid.tsx；LWW 保存与冲突刷新在本组件
 */
import { useMemo, useCallback, useState, useEffect } from 'react';
import { BoardGrid, type GridRow } from './Grid';
import { useItems } from '../store';
import { api } from '../api';

/** 列类型的中文展示名 */
const typeLabel = (t: string) => ({ text: '文本', status: '状态', people: '人员', date: '日期', number: '数字', checkbox: '勾选', dropdown: '多选' } as Record<string, string>)[t] ?? t;

/** 成员与权限管理弹窗：列表 + 改角色 + 移除 + 添加公司内用户 */
const ROLE_LABEL: Record<string, string> = { owner: '负责人', editor: '可编辑', viewer: '只读', guest: '访客' };
function MembersModal({ boardId, onClose, flash }: { boardId: string; onClose: () => void; flash: (s: string) => void }) {
  const [members, setMembers] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [pickUser, setPickUser] = useState('');
  const [pickRole, setPickRole] = useState('editor');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setMembers(await api.listMembers(boardId).catch(() => []));
  };
  useEffect(() => { load(); api.listUsers().then((u) => setUsers(Array.isArray(u) ? u : [])).catch(() => {}); }, [boardId]);

  const add = async () => {
    if (!pickUser || busy) return;
    setBusy(true);
    try {
      await api.addMember(boardId, pickUser, pickRole);
      setPickUser('');
      await load();
      flash('已添加成员');
    } catch (e) { flash(`添加失败：${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const changeRole = async (m: any, role: string) => {
    try {
      await api.addMember(boardId, m.id, role);
      await load();
      flash(`已改为「${ROLE_LABEL[role] ?? role}」`);
    } catch (e) { flash(`改角色失败：${(e as Error).message}`); }
  };

  const remove = async (m: any) => {
    if (!confirm(`移除成员「${m.name}」？`)) return;
    try {
      await api.removeMember(boardId, m.id);
      await load();
      flash('已移除成员');
    } catch (e) { flash(`移除成员失败：${(e as Error).message}`); }
  };

  const memberIds = new Set(members.map((m) => m.id));
  const candidates = users.filter((u) => !memberIds.has(u.id));

  return (
    <div style={{ position: 'absolute', top: 52, left: 12, zIndex: 60, background: '#fff', borderRadius: 12,
      boxShadow: '0 8px 30px rgba(20,30,70,.15)', padding: 16, width: 380 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <b style={{ fontSize: 14 }}>👥 成员与权限</b>
        <button onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>
      {members.map((m) => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid #f0f1f5', fontSize: 13 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#579bfc', color: '#fff', fontSize: 11,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{(m.name || '?')[0]}</div>
          <div style={{ flex: 1 }}>
            <div>{m.name} {m.is_owner && <span style={{ fontSize: 11, color: '#b8860b' }}>（负责人）</span>}</div>
            <div style={{ fontSize: 11, color: '#a0a4b1' }}>{m.email}</div>
          </div>
          {m.is_owner ? (
            <span style={{ fontSize: 12, color: '#7a7f8c' }}>owner</span>
          ) : (
            <>
              <select value={m.role} onChange={(e) => changeRole(m, e.target.value)}
                style={{ padding: '4px 6px', borderRadius: 7, border: '1px solid #e6e8ef', fontSize: 12 }}>
                {['editor', 'viewer', 'guest', 'owner'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <button onClick={() => remove(m)} title="移除"
                style={{ border: 'none', background: 'none', color: '#e2445c', cursor: 'pointer', fontSize: 13 }}>✕</button>
            </>
          )}
        </div>
      ))}
      <b style={{ fontSize: 13, display: 'block', marginTop: 12 }}>添加成员</b>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <select value={pickUser} onChange={(e) => setPickUser(e.target.value)}
          style={{ flex: 1, padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
          <option value="">选择公司内成员…</option>
          {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}（{u.email}）</option>)}
        </select>
        <select value={pickRole} onChange={(e) => setPickRole(e.target.value)}
          style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
          {['editor', 'viewer', 'guest'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <button onClick={add} disabled={busy || !pickUser}
          style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: pickUser ? '#4f6ef7' : '#c5c9d4', color: '#fff', cursor: 'pointer', fontSize: 13 }}>添加</button>
      </div>
    </div>
  );
}

export function BoardTable({ boardId, onOpenItem }: { boardId: string; onOpenItem?: (itemId: string) => void }) {
  const { items, columns, groups, bumpVersion, addItem, setBoard } = useItems();
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState('');
  const [mgrOpen, setMgrOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState('text');
  const [newGroupName, setNewGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const reloadBoard = useCallback(async () => {
    const d: any = await api.getBoard(boardId).catch(() => null);
    if (d) setBoard(d.items ?? [], d.columns ?? [], d.groups ?? []);
  }, [boardId, setBoard]);

  const gridRows: GridRow[] = useMemo(
    () => Object.values(items).map((it: any) => ({
      id: it.id, name: it.name, version: it.version, position: it.position ?? 0,
      values: it.values ?? {},
    })),
    [items],
  );

  const gridColumns = useMemo(
    () => columns.map((c: any) => ({ id: c.id, name: c.name, type: c.type, settings: c.settings ?? {} })),
    [columns],
  );

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  };

  /** 新建条目：后端落库后乐观插入到表格顶部 */
  const addItemRow = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const it: any = await api.createItem(boardId, '新条目');
      addItem({ id: it.id, group_id: it.group_id, name: it.name, version: it.version, values: {} });
      flash('已新建条目，双击"条目"单元格重命名');
    } catch (e) {
      flash(`新建失败：${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  }, [boardId, creating, addItem]);

  /** 选中行批量删除 → 回收站可恢复 */
  const deleteSelected = useCallback(async () => {
    const sel = [...selectedIds];
    if (!sel.length) { flash('先勾选要删除的行（左侧复选框）'); return; }
    if (!confirm(`把选中的 ${sel.length} 行移入回收站？`)) return;
    try {
      await api.softDelete(sel);
      setSelectedIds(new Set());
      await reloadBoard();
      flash(`已移入回收站 ${sel.length} 行`);
    } catch (e) {
      flash(`删除失败：${(e as Error).message}`);
    }
  }, [selectedIds, reloadBoard]);

  /** 新增列（status 列后端会带默认标签） */
  const addColumn = useCallback(async () => {
    const name = newColName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await api.addColumn(boardId, name, newColType);
      await reloadBoard();
      setNewColName('');
      flash(`已添加列「${name}」`);
    } catch (e) { flash(`添加列失败：${(e as Error).message}`); }
    finally { setBusy(false); }
  }, [boardId, newColName, newColType, busy, reloadBoard]);

  /** 新增分组 */
  const addGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await api.addGroup(boardId, name);
      await reloadBoard();
      setNewGroupName('');
      flash(`已添加分组「${name}」，去看板视图把条目拖进去`);
    } catch (e) { flash(`添加分组失败：${(e as Error).message}`); }
    finally { setBusy(false); }
  }, [boardId, newGroupName, busy, reloadBoard]);

  /** 删除列（连列值一起清理，不可恢复，需二次确认） */
  const removeColumn = useCallback(async (colId: string, colName: string) => {
    if (!confirm(`删除列「${colName}」？该列所有数据会一并删除，不可恢复。`)) return;
    try {
      await api.deleteColumn(boardId, colId);
      await reloadBoard();
      flash(`已删除列「${colName}」`);
    } catch (e) { flash(`删除列失败：${(e as Error).message}`); }
  }, [boardId, reloadBoard]);

  /** 列级权限：settings.editable = 'all' | 'owner'（保留 settings 其他字段） */
  const setColumnEditable = useCallback(async (col: any, editable: string) => {
    try {
      await api.updateColumnSettings(boardId, col.id, { ...(col.settings ?? {}), editable });
      await reloadBoard();
      flash(editable === 'owner' ? `列「${col.name}」已锁定为仅负责人可编辑` : `列「${col.name}」已开放所有人编辑`);
    } catch (e) { flash(`修改列权限失败：${(e as Error).message}`); }
  }, [boardId, reloadBoard]);

  /** 单元格保存：name 走本体接口，其余走 LWW updateCell */
  const saveCell = useCallback(async (row: GridRow, field: string, value: unknown) => {
    try {
      if (field === 'name') {
        const r: any = await api.updateItem(row.id, { name: value as string });
        if (r?.version) bumpVersion(row.id, r.version);
        return;
      }
      const { version } = await api.updateCell(row.id, field, value, row.version);
      bumpVersion(row.id, version);
    } catch (err: any) {
      if (err.message?.includes('CONFLICT') || err.code === 'CONFLICT') {
        flash('该行已被他人修改，正在加载最新内容…');
        await reloadBoard();
      } else if (String(err.message ?? err).includes('FORBIDDEN')) {
        flash('该列仅负责人（owner）可编辑');
        await reloadBoard();
      } else {
        flash(`保存失败：${err.message ?? err}`);
      }
    }
  }, [bumpVersion, reloadBoard]);

  /** 拖拽排序落库 */
  const saveOrder = useCallback(async (orders: { id: string; position: number }[]) => {
    try { await api.reorderItems(orders); flash('排序已保存'); }
    catch (e) { flash(`排序保存失败：${(e as Error).message}`); await reloadBoard(); }
  }, [reloadBoard]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 工具条：新建 / 批量删除 */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 12px', alignItems: 'center', position: 'relative' }}>
        <button onClick={addItemRow} disabled={creating}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#4f6ef7', color: '#fff',
            cursor: creating ? 'wait' : 'pointer', fontSize: 13, fontWeight: 500 }}>
          {creating ? '创建中…' : '＋ 新建条目'}
        </button>
        <button onClick={deleteSelected}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff',
            cursor: 'pointer', fontSize: 13, color: '#e2445c' }}>
          🗑 删除选中
        </button>
        <button onClick={() => setMembersOpen(true)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff',
            cursor: 'pointer', fontSize: 13, color: '#4f6ef7' }}>
          👥 成员
        </button>
        {membersOpen && <MembersModal boardId={boardId} onClose={() => setMembersOpen(false)} flash={flash} />}
        <button onClick={() => setMgrOpen(!mgrOpen)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: mgrOpen ? '#eef1fe' : '#fff',
            cursor: 'pointer', fontSize: 13, color: '#4f6ef7' }}>
          ⚙ 列与分组
        </button>
        {mgrOpen && (
          <div style={{ position: 'absolute', top: 52, left: 12, zIndex: 50, background: '#fff', borderRadius: 12,
            boxShadow: '0 8px 30px rgba(20,30,70,.15)', padding: 16, width: 400, maxHeight: '70vh', overflow: 'auto' }}>
            <b style={{ fontSize: 13 }}>新增列</b>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input value={newColName} onChange={(e) => setNewColName(e.target.value)} placeholder="列名"
                style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }} />
              <select value={newColType} onChange={(e) => setNewColType(e.target.value)}
                style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
                <option value="text">文本</option>
                <option value="status">状态</option>
                <option value="people">人员</option>
                <option value="date">日期</option>
                <option value="number">数字</option>
              </select>
              <button onClick={addColumn} disabled={busy || !newColName.trim()}
                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 13 }}>添加</button>
            </div>
            <b style={{ fontSize: 13, display: 'block', marginTop: 14 }}>现有列（✕ 删除 · 🔒 设列级权限）</b>
            {columns.map((c: any) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderBottom: '1px solid #f0f1f5', fontSize: 13 }}>
                <span style={{ color: '#7a7f8c', fontSize: 11, width: 44 }}>{typeLabel(c.type)}</span>
                <span style={{ flex: 1 }}>{c.name}{c.settings?.editable === 'owner' ? ' 🔒' : ''}</span>
                <select data-col-perm={c.id} value={c.settings?.editable === 'owner' ? 'owner' : 'all'}
                  onChange={(e) => setColumnEditable(c, e.target.value)}
                  title="列级权限：谁可以编辑这一列"
                  style={{ padding: '3px 5px', borderRadius: 7, border: '1px solid #e6e8ef', fontSize: 12 }}>
                  <option value="all">所有人可编辑</option>
                  <option value="owner">仅负责人</option>
                </select>
                <button onClick={() => removeColumn(c.id, c.name)}
                  style={{ border: 'none', background: 'none', color: '#e2445c', cursor: 'pointer', fontSize: 13 }}>✕</button>
              </div>
            ))}
            <b style={{ fontSize: 13, display: 'block', marginTop: 14 }}>分组（双击名称重命名）</b>
            {groups.map((g: any) => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderBottom: '1px solid #f0f1f5', fontSize: 13 }}>
                <span style={{ flex: 1 }}
                  onDoubleClick={() => {
                    const v = prompt('重命名分组', g.name);
                    if (v && v.trim() && v.trim() !== g.name) {
                      api.renameGroup(boardId, g.id, v.trim()).then(reloadBoard).catch((e) => flash(`重命名失败：${(e as Error).message}`));
                    }
                  }}
                  title="双击重命名">{g.name}</span>
                <button title="删除分组（条目会变为无分组）"
                  onClick={() => {
                    if (!confirm(`删除分组「${g.name}」？组内条目将变为无分组。`)) return;
                    api.deleteGroup(boardId, g.id).then(reloadBoard).catch((e) => flash(`删除分组失败：${(e as Error).message}`));
                  }}
                  style={{ border: 'none', background: 'none', color: '#e2445c', cursor: 'pointer', fontSize: 13 }}>✕</button>
              </div>
            ))}
            <b style={{ fontSize: 13, display: 'block', marginTop: 14 }}>新增分组</b>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="分组名（看板列）"
                style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }} />
              <button onClick={addGroup} disabled={busy || !newGroupName.trim()}
                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 13 }}>添加</button>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: '#7a7f8c' }}>
              共 {groups.length} 个分组
            </div>
          </div>
        )}
        <span style={{ fontSize: 12, color: '#7a7f8c', marginLeft: 'auto' }}>
          {gridRows.length} 条目 · 双击单元格编辑 · 拖 ⠿ 排序 · 点击行打开详情
        </span>
      </div>
      {toast && (
        <div style={{ margin: '0 12px 8px', background: '#eef1fe', color: '#4f6ef7', borderRadius: 8,
          padding: '7px 12px', fontSize: 12 }}>{toast}</div>
      )}
      <BoardGrid
        rows={gridRows}
        columns={gridColumns}
        editable
        onOpenItem={onOpenItem}
        onEdit={saveCell}
        onOrderChange={saveOrder}
        onSelectionChange={setSelectedIds}
      />
    </div>
  );
}
