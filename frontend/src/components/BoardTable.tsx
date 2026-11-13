/**
 * 表格视图 — 自研 React 表格（P1：替换 AG Grid）
 * 列类型渲染/编辑器统一在 Grid.tsx；LWW 保存与冲突刷新在本组件
 */
import { useMemo, useCallback, useState, useEffect } from 'react';
import { BoardGrid, type GridRow } from './Grid';
import { useItems } from '../store';
import { api } from '../api';
import { UI, TAG, doneLabelsOf } from '../theme';
import { AutomationPanel } from './AutomationPanel';

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
  const { items, columns, groups, myRole, bumpVersion, applyPatch, addItem, setBoard } = useItems();
  // P1-1：结构（列/组增删改）仅 owner；内容（cell/条目）editor+；myRole 未加载时保守按 owner 展示
  const isOwner = !myRole || myRole === 'owner';
  const canEditContent = isOwner || myRole === 'editor';
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState('');
  const [mgrOpen, setMgrOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState('text');
  const [newGroupName, setNewGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 视图（P1-3）：命名视图（排序配置）+ 锁定；prefs（P1-4）：每 board 每用户独立
  const [views, setViews] = useState<any[]>([]);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [newViewName, setNewViewName] = useState('');

  const loadViews = useCallback(async () => {
    const vs: any = await api.listViews(boardId).catch(() => []);
    setViews(Array.isArray(vs) ? vs : []);
  }, [boardId]);

  useEffect(() => { loadViews(); setActiveViewId(null); setSortBy(null); setSortDir('asc'); }, [boardId]);

  /** 应用视图：写入本地排序态 */
  const applyView = (v: any) => {
    setActiveViewId(v.id);
    const cfg = v.config ?? {};
    setSortBy(cfg.sortBy ?? null);
    setSortDir(cfg.sortDir === 'desc' ? 'desc' : 'asc');
    setViewsOpen(false);
  };

  /** 表头点击排序：锁定视图不可改配置；点击即切回自由排序（脱离视图） */
  const onSortChange = (field: string) => {
    if (activeViewId && views.find((v) => v.id === activeViewId)?.locked) { flash('该视图已被负责人锁定，配置不可修改'); return; }
    if (activeViewId) setActiveViewId(null);
    if (sortBy === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setSortDir('asc'); }
  };

  const saveView = async () => {
    const name = newViewName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const v: any = await api.createView(boardId, name, 'table', { sortBy, sortDir });
      await loadViews();
      setActiveViewId(v.id);
      setNewViewName('');
      flash(`已保存视图「${name}」`);
    } catch (e) { flash(`保存视图失败：${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const setViewLock = async (v: any, locked: boolean) => {
    try {
      await api.lockView(boardId, v.id, locked);
      await loadViews();
      flash(locked ? `视图「${v.name}」已锁定（仅负责人可改）` : `视图「${v.name}」已解锁`);
    } catch (e) { flash(`操作失败：${(e as Error).message}`); }
  };

  const removeView = async (v: any) => {
    if (!confirm(`删除视图「${v.name}」？`)) return;
    try {
      await api.deleteView(boardId, v.id);
      if (activeViewId === v.id) setActiveViewId(null);
      await loadViews();
      flash(`已删除视图「${v.name}」`);
    } catch (e) { flash(`删除失败：${(e as Error).message}`); }
  };

  /** 设为我的默认视图（P1-4）：仅影响自己 */
  const setDefaultView = async (v: any) => {
    try {
      await api.putPrefs(boardId, { viewId: v.id });
      flash(`已设为我的默认视图：${v.name}`);
    } catch (e) { flash(`设置失败：${(e as Error).message}`); }
  };

  const reloadBoard = useCallback(async () => {
    const d: any = await api.getBoard(boardId).catch(() => null);
    if (d) setBoard(d.items ?? [], d.columns ?? [], d.groups ?? [], d.myRole);
  }, [boardId, setBoard]);

  const gridRows: GridRow[] = useMemo(
    () => Object.values(items).map((it: any) => ({
      id: it.id, name: it.name, version: it.version, position: it.position ?? 0,
      values: it.values ?? {},
    })),
    [items],
  );

  const gridColumns = useMemo(
    () => columns.map((c: any) => ({ id: c.id, name: c.name, type: c.type, settings: c.settings ?? {}, restricted: !!c.restricted })),
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

  /** 列级权限（P1-2 互斥）：editPermission 与 viewPermission 二选一生效，设一个另一个自动回 all */
  const setColumnPerm = useCallback(async (col: any, kind: 'edit' | 'view', value: 'all' | 'owner') => {
    const s: any = { ...(col.settings ?? {}) };
    delete s.editable; // 旧字段归一化
    if (kind === 'edit') { s.editPermission = value; if (value === 'owner') s.viewPermission = 'all'; }
    else { s.viewPermission = value; if (value === 'owner') s.editPermission = 'all'; }
    try {
      await api.updateColumnSettings(boardId, col.id, s);
      await reloadBoard();
      flash(value === 'owner'
        ? (kind === 'edit' ? `列「${col.name}」已限制为仅负责人编辑` : `列「${col.name}」已限制为仅负责人可见`)
        : `列「${col.name}」已解除限制`);
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
      // 本地同步值 + 版本（applyPatch 自带 LWW 守卫，先于任何回声；不能再先 bumpVersion，否则补丁被当旧包丢弃）
      applyPatch(row.id, field, value, version);
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
  }, [bumpVersion, applyPatch, reloadBoard]);

  /** 拖拽排序落库 */
  const saveOrder = useCallback(async (orders: { id: string; position: number }[]) => {
    try { await api.reorderItems(orders); flash('排序已保存'); }
    catch (e) { flash(`排序保存失败：${(e as Error).message}`); await reloadBoard(); }
  }, [reloadBoard]);

  /** 删除标签 = 停用（P0-2）：保留历史数据，旧值照常展示，只是编辑时不可再选 */
  const toggleLabelInactive = useCallback(async (col: any, label: string) => {
    const cur: string[] = col.settings?.inactiveLabels ?? [];
    const next = cur.includes(label) ? cur.filter((l: string) => l !== label) : [...cur, label];
    try {
      await api.updateColumnSettings(boardId, col.id, { ...(col.settings ?? {}), inactiveLabels: next });
      await reloadBoard();
      flash(cur.includes(label) ? `已恢复标签「${label}」` : `已停用标签「${label}」（旧数据保留）`);
    } catch (e) { flash(`修改标签失败：${(e as Error).message}`); }
  }, [boardId, reloadBoard]);

  /** 设为完成语义标签（P0-3）：doneLabels 决定哪些标签算「完成」（甘特变灰、行名删除线） */
  const toggleDoneLabel = useCallback(async (col: any, label: string) => {
    const cur = doneLabelsOf(col.settings);
    const next = cur.has(label) ? [...cur].filter((l) => l !== label) : [...cur, label];
    if (!next.length) { flash('至少保留一个完成语义标签'); return; }
    try {
      await api.updateColumnSettings(boardId, col.id, { ...(col.settings ?? {}), doneLabels: next });
      await reloadBoard();
      flash(`「${label}」${cur.has(label) ? '不再算作' : '已设为'}完成状态`);
    } catch (e) { flash(`修改失败：${(e as Error).message}`); }
  }, [boardId, reloadBoard]);

  /** 批量改状态（P0-4）：选中 ≥3 行时底部工具条，逐行 LWW 写入 */
  const statusCol = useMemo(() => columns.find((c: any) => c.type === 'status'), [columns]);
  const batchSetStatus = useCallback(async (label: string) => {
    if (!statusCol) return;
    const rows = gridRows.filter((r) => selectedIds.has(r.id));
    let ok = 0, fail = 0;
    for (const r of rows) {
      try { await saveCell(r, statusCol.id, label); ok++; } catch { fail++; }
    }
    flash(`批量改状态：成功 ${ok}${fail ? `，失败 ${fail}` : ''}`);
  }, [statusCol, gridRows, selectedIds, saveCell]);

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
            boxShadow: '0 8px 30px rgba(20,30,70,.15)', padding: 16, width: 440, maxHeight: '70vh', overflow: 'auto' }}>
            {!isOwner && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fff8e6', borderRadius: 8, fontSize: 12, color: '#b8860b' }}>
                🔒 仅看板负责人可修改结构（列/分组）；你可以编辑条目内容
              </div>
            )}
            {isOwner && (<>
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
            </>)}
            <b style={{ fontSize: 13, display: 'block', marginTop: 14 }}>现有列{isOwner ? '（✕ 删除 · 编辑/查看权限二选一）' : ''}</b>
            {columns.map((c: any) => {
              const ep = c.settings?.editPermission ?? c.settings?.editable;
              const vp = c.settings?.viewPermission;
              return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderBottom: '1px solid #f0f1f5', fontSize: 13 }}>
                <span style={{ color: '#7a7f8c', fontSize: 11, width: 44 }}>{typeLabel(c.type)}</span>
                <span style={{ flex: 1 }}>{c.name}{ep === 'owner' ? ' ✏️🔒' : ''}{vp === 'owner' ? ' 👁🔒' : ''}</span>
                {c.type === 'status' && (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 200 }} data-label-chips={c.id}>
                    {(c.settings?.labels ?? []).map((l: any) => {
                      const inactive = (c.settings?.inactiveLabels ?? []).includes(l.label);
                      const isDone = doneLabelsOf(c.settings).has(l.label);
                      return <span key={l.label} onClick={(e) => { if (!isOwner) return; e.shiftKey ? toggleDoneLabel(c, l.label) : toggleLabelInactive(c, l.label); }}
                        title={isOwner ? (inactive ? '已停用，点恢复' : '点击停用标签（Shift+点 = 设/取消完成语义）') : '仅负责人可修改标签'}
                        style={{ cursor: isOwner ? 'pointer' : 'default', fontSize: 11, padding: '1px 7px', borderRadius: 10,
                          background: `${l.color}22`, color: inactive ? UI.textFaint : l.color,
                          textDecoration: inactive ? 'line-through' : 'none',
                          border: isDone ? `1px solid ${TAG.done}` : 'none' }}>
                        {l.label}{isDone ? ' ✓' : ''}</span>;
                    })}
                  </div>
                )}
                {isOwner && (
                  <>
                    <select data-col-editperm={c.id} value={ep === 'owner' ? 'owner' : 'all'}
                      onChange={(e) => setColumnPerm(c, 'edit', e.target.value as 'all' | 'owner')}
                      title="列级权限：谁可以编辑这一列（与限制查看互斥）"
                      style={{ padding: '3px 5px', borderRadius: 7, border: '1px solid #e6e8ef', fontSize: 12 }}>
                      <option value="all">所有人可编辑</option>
                      <option value="owner">仅负责人编辑</option>
                    </select>
                    <select data-col-viewperm={c.id} value={vp === 'owner' ? 'owner' : 'all'}
                      onChange={(e) => setColumnPerm(c, 'view', e.target.value as 'all' | 'owner')}
                      title="列级权限：谁可以看这一列（与限制编辑互斥）"
                      style={{ padding: '3px 5px', borderRadius: 7, border: '1px solid #e6e8ef', fontSize: 12 }}>
                      <option value="all">所有人可见</option>
                      <option value="owner">仅负责人可见</option>
                    </select>
                    <button onClick={() => removeColumn(c.id, c.name)}
                      style={{ border: 'none', background: 'none', color: '#e2445c', cursor: 'pointer', fontSize: 13 }}>✕</button>
                  </>
                )}
              </div>
              );
            })}
            {isOwner && (<>
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
            <div style={{ marginTop: 10, fontSize: 12, color: '#7a7f8c', lineHeight: 1.7 }}>
              共 {groups.length} 个分组<br />
              状态列标签：点一下停用（旧数据保留），再点恢复；带 ✓ 边框的是「完成」语义标签
            </div>
            </>)}
          </div>
        )}
        <button onClick={() => setAutoOpen(!autoOpen)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: autoOpen ? '#eef1fe' : '#fff',
            cursor: 'pointer', fontSize: 13, color: '#4f6ef7' }}>
          ⚡ 自动化
        </button>
        {autoOpen && <AutomationPanel boardId={boardId} onClose={() => setAutoOpen(false)} flash={flash} />}
        <button onClick={() => setViewsOpen(!viewsOpen)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: viewsOpen ? '#eef1fe' : '#fff',
            cursor: 'pointer', fontSize: 13, color: '#4f6ef7' }}>
          ⧉ 视图{activeViewId ? `：${views.find((v) => v.id === activeViewId)?.name ?? ''}${views.find((v) => v.id === activeViewId)?.locked ? ' 🔒' : ''}` : ''}
        </button>
        {viewsOpen && (
          <div data-views-panel="1" style={{ position: 'absolute', top: 52, left: 12, zIndex: 50, background: '#fff', borderRadius: 12,
            boxShadow: '0 8px 30px rgba(20,30,70,.15)', padding: 16, width: 420, maxHeight: '70vh', overflow: 'auto' }}>
            <b style={{ fontSize: 13 }}>已保存视图</b>
            {views.length === 0 && <div style={{ fontSize: 12, color: '#7a7f8c', margin: '8px 0' }}>还没有保存的视图——先点表头排序，再起个名字保存</div>}
            {views.map((v) => (
              <div key={v.id} data-view-item={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
                borderBottom: '1px solid #f0f1f5', fontSize: 13 }}>
                <span onClick={() => applyView(v)} title="点击应用视图"
                  style={{ flex: 1, cursor: 'pointer', color: activeViewId === v.id ? '#4f6ef7' : '#1f2330', fontWeight: activeViewId === v.id ? 600 : 400 }}>
                  {v.name}{v.locked ? ' 🔒' : ''}
                  {sortBy && v.id === activeViewId ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                </span>
                {isOwner && (
                  <button onClick={() => setViewLock(v, !v.locked)} title={v.locked ? '解锁' : '锁定（仅负责人可改配置）'}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13 }}>{v.locked ? '🔓' : '🔒'}</button>
                )}
                <button onClick={() => setDefaultView(v)} title="设为我的默认视图"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#b8860b' }}>★</button>
                {!v.locked && <button onClick={() => removeView(v)} title="删除视图"
                  style={{ border: 'none', background: 'none', color: '#e2445c', cursor: 'pointer', fontSize: 13 }}>✕</button>}
              </div>
            ))}
            <b style={{ fontSize: 13, display: 'block', marginTop: 12 }}>保存当前排序为新视图</b>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input value={newViewName} onChange={(e) => setNewViewName(e.target.value)} placeholder="视图名"
                style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }} />
              <button onClick={saveView} disabled={busy || !newViewName.trim()}
                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 13 }}>保存</button>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: '#7a7f8c', lineHeight: 1.7 }}>
              当前排序：{sortBy ? `${sortBy === 'name' ? '条目' : columns.find((c: any) => c.id === sortBy)?.name ?? sortBy} ${sortDir === 'desc' ? '降序' : '升序'}` : '未排序'}<br />
              🔒 锁定后仅负责人可改配置 · ★ 设为我的默认视图（只影响自己）
            </div>
          </div>
        )}
        <span style={{ fontSize: 12, color: '#7a7f8c', marginLeft: 'auto' }}>
          {gridRows.length} 条目 · 双击编辑 · 拖 ⠿ 排序 · ↑↓/Enter/Space 快捷键 · 勾选 3 行以上出批量工具条
        </span>
      </div>
      {toast && (
        <div style={{ margin: '0 12px 8px', background: '#eef1fe', color: '#4f6ef7', borderRadius: 8,
          padding: '7px 12px', fontSize: 12 }}>{toast}</div>
      )}
      {/* 底部浮动批量工具条（P0-4）：勾选 ≥3 行浮出 */}
      {selectedIds.size >= 3 && (
        <div data-batch-bar="1" style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)',
          background: UI.text, color: '#fff', borderRadius: 12, padding: '9px 16px',
          display: 'flex', gap: 10, alignItems: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.25)', zIndex: 80,
          fontSize: 13 }}>
          <span>已选 {selectedIds.size} 行</span>
          {statusCol && (
            <select data-batch-status defaultValue="" title="批量改状态"
              onChange={(e) => { const v = e.target.value; if (v) { batchSetStatus(v); e.target.value = ''; } }}
              style={{ padding: '4px 8px', borderRadius: 7, border: 'none', fontSize: 12 }}>
              <option value="">改状态…</option>
              {((statusCol.settings?.labels ?? []) as any[])
                .filter((l: any) => !((statusCol.settings?.inactiveLabels ?? []) as string[]).includes(l.label))
                .map((l: any) => <option key={l.label} value={l.label}>{l.label}</option>)}
            </select>
          )}
          <button data-batch-delete onClick={() => { deleteSelected(); }}
            style={{ border: 'none', background: 'transparent', color: '#ff9aa9', cursor: 'pointer', fontSize: 13 }}>
            🗑 移入回收站</button>
          <button onClick={() => setSelectedIds(new Set())}
            style={{ border: 'none', background: 'transparent', color: '#c5c9d4', cursor: 'pointer', fontSize: 13 }}>
            清除选择</button>
        </div>
      )}
      <BoardGrid
        rows={gridRows}
        columns={gridColumns}
        editable={canEditContent}
        isOwner={isOwner}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={onSortChange}
        onOpenItem={onOpenItem}
        onEdit={saveCell}
        onOrderChange={saveOrder}
        onSelectionChange={setSelectedIds}
      />
    </div>
  );
}
