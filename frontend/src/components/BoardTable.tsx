/**
 * 表格视图 — 自研 React 表格（P1：替换 AG Grid）
 * 列类型渲染/编辑器统一在 Grid.tsx；LWW 保存与冲突刷新在本组件
 */
import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { BoardGrid, type GridRow, type FilterCondition } from './Grid';
import { useItems, useToast } from '../store';
import { api } from '../api';
import { UI, TAG, doneLabelsOf, soften } from '../theme';
import { AutomationPanel } from './AutomationPanel';
import { parseWorkbook, mapHeaders, convertRow, inferType, type ImportCol } from '../importExcel';
import { loadCompanyUsers } from '../people';
import * as XLSX from 'xlsx';

/** 列类型的中文展示名 */
const typeLabel = (t: string) => ({ text: '文本', status: '状态', people: '人员', date: '日期', number: '数字', checkbox: '勾选', dropdown: '多选', formula: '公式', mirror: '镜像', dependency: '前置', attachment: '附件', rating: '星级', tags: '标签', longtext: '长文本' } as Record<string, string>)[t] ?? t;

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
    <div data-members-panel="1" style={{ position: 'absolute', top: 52, left: 12, zIndex: 60, background: '#fff', borderRadius: 12,
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

export function BoardTable({ boardId, onOpenItem, onSwitchView }: { boardId: string; onOpenItem?: (itemId: string) => void; onSwitchView?: (v: string) => void }) {
  const { items, columns, groups, myRole, bumpVersion, applyPatch, addItem, setBoard, boardLoading } = useItems();
  // P1-1：结构（列/组增删改）仅 owner；内容（cell/条目）editor+；myRole 未加载时保守按 owner 展示
  const isOwner = !myRole || myRole === 'owner';
  const canEditContent = isOwner || myRole === 'editor';
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  // #57 导入预览：解析结果先弹窗确认再落库
  const [importPreview, setImportPreview] = useState<{
    fileName: string; sheet: { headers: string[]; rows: Record<string, unknown>[] };
    headerMap: Record<string, ImportCol | 'name' | null>;
  } | null>(null);
  // #61 筛选状态提升到本组件（视图持久化 + 导出范围用）
  const [tableFilters, setTableFilters] = useState<FilterCondition[]>([]);
  const filteredRowsRef = useRef<GridRow[]>([]);
  /** 统一 toast（第二十批）：全部路由到全局 ToastHost；「已…」开头默认 success，其余 info */
  const [mgrOpen, setMgrOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState('text');
  const [newColFormula, setNewColFormula] = useState('');
  const [newColMirrorBoard, setNewColMirrorBoard] = useState('');
  const [boardOptions, setBoardOptions] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (newColType !== 'mirror') return;
    api.getBoards().then((list: any[]) => setBoardOptions((list ?? []).map((b) => ({ id: b.id, name: b.name })))).catch(() => {});
  }, [newColType, mgrOpen]);
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

  /** 需求2：点击弹窗外部区域自动关闭所有上部弹窗面板 */
  useEffect(() => {
    if (!mgrOpen && !viewsOpen && !autoOpen && !membersOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-mgr-panel],[data-views-panel],[data-auto-panel],[data-members-panel],[data-mgr-trigger],[data-views-trigger],[data-auto-trigger],[data-members-trigger]')) return;
      setMgrOpen(false);
      setViewsOpen(false);
      setAutoOpen(false);
      setMembersOpen(false);
    };
    // 用 setTimeout 确保当前点击事件先冒泡完再挂监听，避免打开按钮的同一个 click 触发关闭
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler); };
  }, [mgrOpen, viewsOpen, autoOpen, membersOpen]);

  /** 应用视图：写入本地排序态；若视图声明了非 table 类型则跳转到对应视图（第二十二批） */
  const applyView = (v: any) => {
    setActiveViewId(v.id);
    const cfg = v.config ?? {};
    setSortBy(cfg.sortBy ?? null);
    setSortDir(cfg.sortDir === 'desc' ? 'desc' : 'asc');
    // #61：恢复视图保存时的筛选条件
    setTableFilters(Array.isArray(cfg.filters) ? cfg.filters : []);
    setViewsOpen(false);
    if (v.view_type && v.view_type !== 'table') onSwitchView?.(v.view_type);
  };

  /** 预设视图集（第二十二批）：一键创建六种类型命名视图，跳过同名已存在 */
  const applyPresetViews = async () => {
    if (busy) return;
    setBusy(true);
    const presets = [
      { name: '⚡ 表格', viewType: 'table', config: {} },
      { name: '⚡ 看板', viewType: 'kanban', config: {} },
      { name: '⚡ 日历', viewType: 'calendar', config: {} },
      { name: '⚡ 甘特', viewType: 'gantt', config: {} },
      { name: '⚡ Workload', viewType: 'workload', config: {} },
      { name: '⚡ 分析', viewType: 'insights', config: {} },
    ];
    try {
      for (const p of presets) {
        if (views.some((v) => v.name === p.name)) continue;
        await api.createView(boardId, p.name, p.viewType, p.config);
      }
      await loadViews();
      flash('已套用预设视图集');
    } catch { flash('套用预设视图集失败'); } finally { setBusy(false); }
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
      const v: any = await api.createView(boardId, name, 'table', { sortBy, sortDir, filters: tableFilters });
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
      values: it.values ?? {}, group_id: it.group_id,
      subtasks: it.subtasks ? { total: it.subtasks.total, done: it.subtasks.done } : undefined,
    })),
    [items],
  );

  const gridColumns = useMemo(
    () => columns.map((c: any) => ({ id: c.id, name: c.name, type: c.type, settings: c.settings ?? {}, restricted: !!c.restricted })),
    [columns],
  );

  const flash = (msg: string, kind?: 'info' | 'success' | 'error') => {
    useToast.getState().toast(msg, kind ?? (msg.startsWith('已') ? 'success' : 'info'));
  };

  /** 新建条目：后端落库后乐观插入到表格顶部 */
  const addItemRow = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const it: any = await api.createItem(boardId, '新条目');
      addItem({ id: it.id, group_id: it.group_id, name: it.name, version: it.version, values: {} });
      flash('已新建条目，单击"条目"单元格重命名');
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

  /** #64 空板一键添加常用列（仅 owner 且无列时出现） */
  const addCommonColumns = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      for (const [name, type] of [['负责人', 'people'], ['状态', 'status'], ['截止日期', 'date']] as const) {
        try { await api.addColumn(boardId, name, type); } catch { /* 已存在同名列则跳过 */ }
      }
      await reloadBoard();
      flash('已添加常用列：负责人 / 状态 / 截止日期');
    } catch (e) { flash(`添加失败：${(e as Error).message}`); }
    finally { setBusy(false); }
  }, [boardId, busy, reloadBoard]);

  /** 新增列（status 列后端会带默认标签） */
  const addColumn = useCallback(async () => {
    const name = newColName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await api.addColumn(boardId, name, newColType, newColType === 'formula' ? { formula: newColFormula.trim() }
        : newColType === 'mirror' ? { connectBoardId: newColMirrorBoard } : undefined);
      await reloadBoard();
      setNewColName('');
      flash(`已添加列「${name}」`);
    } catch (e) { flash(`添加列失败：${(e as Error).message}`); }
    finally { setBusy(false); }
  }, [boardId, newColName, newColType, newColFormula, newColMirrorBoard, busy, reloadBoard]);

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

  /** 单元格保存：name 走本体接口，其余走 LWW updateCell
   *  #56 智能合并重试：409 时取行最新 version → 重放保存一次；仍冲突才整板刷新 */
  const saveCell = useCallback(async (row: GridRow, field: string, value: unknown) => {
    if (field === '__attachments__') { await reloadBoard(); return; } // P3-2：附件上传后刷新（cell 由附件端点维护）
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
        // #56：尝试用最新 version 重放一次（自动合并），失败才回退整板刷新
        const fresh: any = await api.item(row.id).catch(() => null);
        if (fresh?.version && fresh.version !== row.version) {
          try {
            const { version } = await api.updateCell(row.id, field, value, fresh.version);
            applyPatch(row.id, field, value, version);
            flash('该行已被他人修改，已自动合并保存');
            return;
          } catch { /* 重放仍冲突 → 走刷新兜底 */ }
        }
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

  /** 自定义选项（status/dropdown/tags）：添加预置选项 */
  const OPTION_COLORS = ['#579bfc', '#00c875', '#fdab3d', '#e2445c', '#9d3dd7', '#00d1d1', '#ff8a65', '#a25ddc'];
  const addColumnOption = useCallback(async (col: any, label: string) => {
    label = label.trim();
    if (!label) return;
    const s: any = { ...(col.settings ?? {}) };
    const key = col.type === 'status' ? 'labels' : 'options';
    const list: any[] = Array.isArray(s[key]) ? [...s[key]] : [];
    if (list.some((o) => (o?.label ?? o) === label)) { flash(`选项「${label}」已存在`); return; }
    list.push(col.type === 'status' ? { label, color: OPTION_COLORS[list.length % OPTION_COLORS.length] } : { label });
    s[key] = list;
    try {
      await api.updateColumnSettings(boardId, col.id, s);
      await reloadBoard();
      flash(`已添加选项「${label}」`);
    } catch (e) { flash(`添加选项失败：${(e as Error).message}`); }
  }, [boardId, reloadBoard]);

  /** 自定义选项：删除预置选项（status 同步清理 doneLabels/inactiveLabels） */
  const removeColumnOption = useCallback(async (col: any, label: string) => {
    if (!confirm(`删除选项「${label}」？已使用该选项的单元格会保留原值，但无法再选择。`)) return;
    const s: any = { ...(col.settings ?? {}) };
    const key = col.type === 'status' ? 'labels' : 'options';
    s[key] = (Array.isArray(s[key]) ? s[key] : []).filter((o: any) => (o?.label ?? o) !== label);
    if (col.type === 'status') {
      s.inactiveLabels = (s.inactiveLabels ?? []).filter((l: string) => l !== label);
      s.doneLabels = (s.doneLabels ?? []).filter((l: string) => l !== label);
    }
    try {
      await api.updateColumnSettings(boardId, col.id, s);
      await reloadBoard();
      flash(`已删除选项「${label}」`);
    } catch (e) { flash(`删除选项失败：${(e as Error).message}`); }
  }, [boardId, reloadBoard]);

  /** 自定义选项：重命名预置选项（同步 doneLabels/inactiveLabels 引用） */
  const renameColumnOption = useCallback(async (col: any, oldLabel: string, newLabel: string) => {
    newLabel = newLabel.trim();
    if (!newLabel || newLabel === oldLabel) return;
    const s: any = { ...(col.settings ?? {}) };
    const key = col.type === 'status' ? 'labels' : 'options';
    s[key] = (Array.isArray(s[key]) ? s[key] : []).map((o: any) => (o?.label ?? o) === oldLabel
      ? (col.type === 'status' ? { ...o, label: newLabel } : { label: newLabel }) : o);
    if (col.type === 'status') {
      s.inactiveLabels = (s.inactiveLabels ?? []).map((l: string) => l === oldLabel ? newLabel : l);
      s.doneLabels = (s.doneLabels ?? []).map((l: string) => l === oldLabel ? newLabel : l);
    }
    try {
      await api.updateColumnSettings(boardId, col.id, s);
      await reloadBoard();
      flash(`已重命名「${oldLabel}」→「${newLabel}」`);
    } catch (e) { flash(`重命名失败：${(e as Error).message}`); }
  }, [boardId, reloadBoard]);

  /** 自定义选项：status 标签改颜色 */
  const setOptionColor = useCallback(async (col: any, label: string, color: string) => {
    const s: any = { ...(col.settings ?? {}) };
    s.labels = (Array.isArray(s.labels) ? s.labels : []).map((o: any) => o.label === label ? { ...o, color } : o);
    try {
      await api.updateColumnSettings(boardId, col.id, s);
      await reloadBoard();
    } catch (e) { flash(`改色失败：${(e as Error).message}`); }
  }, [boardId, reloadBoard]);

  /** 批量改状态（P0-4）：选中 ≥3 行时底部工具条，逐行 LWW 写入 */
  const statusCol = useMemo(() => columns.find((c: any) => c.type === 'status'), [columns]);
  // P2-2：示例条目（名称以「示例：」开头）可一键删除
  const sampleIds = useMemo(() => gridRows.filter((r) => r.name.startsWith('示例：')).map((r) => r.id), [gridRows]);
  const removeSamples = useCallback(async () => {
    if (!sampleIds.length) return;
    if (!confirm(`删除 ${sampleIds.length} 条示例条目？（可在回收站找回）`)) return;
    try {
      await api.softDelete(sampleIds);
      await reloadBoard();
      flash(`已删除 ${sampleIds.length} 条示例条目`);
    } catch (e) { flash(`删除失败：${(e as Error).message}`); }
  }, [sampleIds, reloadBoard]);
  const batchSetStatus = useCallback(async (label: string) => {
    if (!statusCol) return;
    const rows = gridRows.filter((r) => selectedIds.has(r.id));
    let ok = 0, fail = 0;
    for (const r of rows) {
      try { await saveCell(r, statusCol.id, label); ok++; } catch { fail++; }
    }
    flash(`批量改状态：成功 ${ok}${fail ? `，失败 ${fail}` : ''}`);
  }, [statusCol, gridRows, selectedIds, saveCell]);

  /** CSV 导出（第二十三批）：导出当前看板条目和列；#58 有筛选时仅导出筛选后行 */
  const exportRows = useCallback(() => {
    if (tableFilters.length === 0) return gridRows;
    const ids = new Set(filteredRowsRef.current.map((r) => r.id));
    const f = gridRows.filter((r) => ids.has(r.id));
    return f.length ? f : gridRows;
  }, [tableFilters, gridRows]);

  const rowToCells = (r: GridRow) => [
    r.name,
    ...columns.map((c: any) => {
      const v = r.values[c.id];
      if (v == null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }),
  ];

  /** #58 Excel 导出（xlsx）：有筛选时仅导出筛选后行 */
  const exportXLSX = useCallback(() => {
    const headers = ['条目', ...columns.map((c: any) => c.name)];
    const dataRows = exportRows().map(rowToCells);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws['!cols'] = [{ wch: 28 }, ...columns.map(() => ({ wch: 16 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Manday');
    XLSX.writeFile(wb, `manday-export-${Date.now()}.xlsx`);
    flash(tableFilters.length ? `已导出 Excel（筛选后 ${dataRows.length} 条）` : '已导出 Excel');
  }, [exportRows, columns, tableFilters]);

  /** Excel 导入（第二十八批 → #57 两段式）：解析+映射 → 预览弹窗确认 → 逐行建条目 + 写单元格 */
  const importFileRef = useRef<HTMLInputElement>(null);
  const prepareImport = useCallback(async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const sheet = parseWorkbook(buf);
      if (!sheet.rows.length) { flash('导入失败：表格无数据行'); return; }
      const cols: ImportCol[] = columns.map((c: any) => ({ id: c.id, name: c.name, type: c.type, settings: c.settings }));
      const headerMap = mapHeaders(sheet.headers, cols);
      setImportPreview({ fileName: file.name, sheet, headerMap });
    } catch (e) {
      flash(`导入失败：${(e as Error).message}`);
    }
  }, [columns]);

  /** 预览确认后真正落库：owner 对未匹配表头自动建列，再逐行写 */
  const confirmImport = useCallback(async () => {
    const p = importPreview;
    if (!p) return;
    setImportPreview(null);
    setImporting(true);
    const okRows: string[] = [];
    const failRows: string[] = [];
    try {
      let cols: ImportCol[] = columns.map((c: any) => ({ id: c.id, name: c.name, type: c.type, settings: c.settings }));
      const headerMap = { ...p.headerMap };
      const users = await loadCompanyUsers();
      // 未匹配列 → owner 自动建列（按内容推断类型）
      const missing = p.sheet.headers.filter((h) => headerMap[h] === null);
      if (missing.length && isOwner) {
        for (const h of missing) {
          const vals = p.sheet.rows.map((r) => r[h]);
          const type = inferType(vals);
          try {
            const created: any = await api.addColumn(boardId, h.trim(), type);
            cols = [...cols, { id: created.id, name: created.name, type: created.type, settings: created.settings }];
            headerMap[h] = cols[cols.length - 1];
          } catch { headerMap[h] = null; }
        }
      }
      const firstGroup = (await api.getBoard(boardId) as any)?.groups?.[0]?.id;
      for (const row of p.sheet.rows) {
        try {
          const converted = convertRow(row, headerMap, users);
          if (!converted) { failRows.push('(空行/无条目名)'); continue; }
          const item: any = await api.createItem(boardId, converted.name, firstGroup);
          let ver = item?.version ?? 1;
          for (const cell of converted.cells) {
            const r: any = await api.updateCell(item.id, cell.columnId, cell.value, ver);
            if (r?.version) ver = r.version;
          }
          okRows.push(converted.name);
        } catch (e) { failRows.push(`${row['条目'] ?? row['名称'] ?? row['任务'] ?? '?'}：${(e as Error).message}`); }
      }
      await reloadBoard();
      flash(`导入完成：成功 ${okRows.length} 条${failRows.length ? `，失败 ${failRows.length} 条` : ''}`);
    } catch (e) {
      flash(`导入失败：${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  }, [importPreview, columns, boardId, isOwner, reloadBoard]);

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
        <button data-members-trigger="1" onClick={() => setMembersOpen(true)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff',
            cursor: 'pointer', fontSize: 13, color: '#4f6ef7' }}>
          👥 成员
        </button>
        {membersOpen && <MembersModal boardId={boardId} onClose={() => setMembersOpen(false)} flash={flash} />}
        <button data-mgr-trigger="1" onClick={() => setMgrOpen(!mgrOpen)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: mgrOpen ? '#eef1fe' : '#fff',
            cursor: 'pointer', fontSize: 13, color: '#4f6ef7' }}>
          ⚙ 列与分组
        </button>
        {mgrOpen && (
          <div data-mgr-panel="1" style={{ position: 'absolute', top: 52, left: 12, zIndex: 50, background: '#fff', borderRadius: 12,
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
                <option value="checkbox">勾选</option>
                <option value="formula">公式</option>
                <option value="mirror">镜像</option>
                <option value="dependency">前置任务</option>
                <option value="attachment">附件</option>
                <option value="rating">星级</option>
                <option value="tags">标签</option>
                <option value="longtext">长文本</option>
              </select>
              {newColType === 'formula' && (
                <input value={newColFormula} onChange={(e) => setNewColFormula(e.target.value)} data-newcol-formula
                  placeholder="{列名} 引用列，支持 + - * / 比较(> < = !=) IF/AND/OR/SWITCH CONCATENATE/DAYS/FORMAT_DATE SUM/AVG/COUNT/ROUND/ABS"
                  style={{ flex: 1.4, padding: '7px 10px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }} />
              )}
              {newColType === 'mirror' && (
                <select value={newColMirrorBoard} onChange={(e) => setNewColMirrorBoard(e.target.value)} data-newcol-mirror
                  style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid #e6e8ef', fontSize: 13 }}>
                  <option value="">连接看板…</option>
                  {boardOptions.filter((b) => b.id !== boardId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <button onClick={addColumn} disabled={busy || !newColName.trim() || (newColType === 'formula' && !newColFormula.trim()) || (newColType === 'mirror' && !newColMirrorBoard)}
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
                      const chip = soften(l.color) ?? '#d0d4e0';
                      return <span key={l.label}
                        onClick={(e) => { if (!isOwner) return; e.shiftKey ? toggleDoneLabel(c, l.label) : toggleLabelInactive(c, l.label); }}
                        onDoubleClick={() => { if (!isOwner) return; const v = prompt('重命名标签', l.label); if (v && v.trim() && v.trim() !== l.label) renameColumnOption(c, l.label, v.trim()); }}
                        title={isOwner ? (inactive ? '已停用，点恢复' : '点击停用标签 · 双击重命名 · 点色块换色 · Shift+点设完成') : '仅负责人可修改标签'}
                        style={{ cursor: isOwner ? 'pointer' : 'default', fontSize: 11, padding: '1px 7px', borderRadius: 10,
                          background: `${chip}22`, color: inactive ? UI.textFaint : chip,
                          textDecoration: inactive ? 'line-through' : 'none',
                          border: isDone ? `1px solid ${TAG.done}` : 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {isOwner && <span data-option-color onClick={(e) => { e.stopPropagation(); setOptionColor(c, l.label, OPTION_COLORS[(OPTION_COLORS.indexOf(l.color) + 1) % OPTION_COLORS.length] ?? '#579bfc'); }}
                          title="点击换色" style={{ width: 8, height: 8, borderRadius: '50%', background: chip, flexShrink: 0, cursor: 'pointer' }} />}
                        {l.label}{isDone ? ' ✓' : ''}</span>;
                    })}
                    {isOwner && (
                      <input data-option-input={c.id} placeholder="＋ 新标签" onKeyDown={(e) => {
                        if (e.key === 'Enter') { addColumnOption(c, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; }
                      }} style={{ width: 66, padding: '1px 6px', borderRadius: 10, border: '1px dashed #b5bac8', fontSize: 11 }} />
                    )}
                  </div>
                )}
                {['dropdown', 'tags'].includes(c.type) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', maxWidth: 220 }} data-option-editor={c.id}>
                    {(c.settings?.options ?? []).map((o: any) => {
                      const label = o?.label ?? o;
                      return <span key={label} data-option-chip={label}
                        onDoubleClick={() => { if (!isOwner) return; const v = prompt('重命名选项', label); if (v && v.trim() && v.trim() !== label) renameColumnOption(c, label, v.trim()); }}
                        title={isOwner ? '预置选项（双击重命名 · 点击 × 删除）' : '预置选项'}
                        style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#eef1fe', color: '#4f6ef7',
                          display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {label}
                        {isOwner && <span data-option-remove onClick={() => removeColumnOption(c, label)}
                          style={{ color: '#a0a4b1', fontWeight: 700, cursor: 'pointer', padding: '0 2px' }}>×</span>}
                      </span>;
                    })}
                    {isOwner && (
                      <input data-option-input={c.id} placeholder={c.type === 'dropdown' ? '＋ 新选项' : '＋ 新标签'} onKeyDown={(e) => {
                        if (e.key === 'Enter') { addColumnOption(c, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; }
                      }} style={{ width: 66, padding: '1px 6px', borderRadius: 10, border: '1px dashed #b5bac8', fontSize: 11 }} />
                    )}
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
        {sampleIds.length > 0 && (
          <button onClick={removeSamples} data-remove-samples="1"
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px dashed #b8860b', background: '#fff8e6',
              cursor: 'pointer', fontSize: 13, color: '#b8860b' }}>
            🧹 删除 {sampleIds.length} 条示例
          </button>
        )}
        <button data-auto-trigger="1" onClick={() => setAutoOpen(!autoOpen)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: autoOpen ? '#eef1fe' : '#fff',
            cursor: 'pointer', fontSize: 13, color: '#4f6ef7' }}>
          ⚡ 自动化
        </button>
        {autoOpen && <div data-auto-panel="1"><AutomationPanel boardId={boardId} onClose={() => setAutoOpen(false)} flash={flash} /></div>}
        <button data-export-xlsx onClick={exportXLSX}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff',
            cursor: 'pointer', fontSize: 13, color: '#00a25b' }}>
          📗 导出 Excel{tableFilters.length ? '（筛选后）' : ''}
        </button>
        <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) prepareImport(f);
          }} />
        <button data-import-excel onClick={() => importFileRef.current?.click()} disabled={importing}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff',
            cursor: importing ? 'wait' : 'pointer', fontSize: 13, color: '#00a25b' }}>
          {importing ? '导入中…' : '📤 导入 Excel'}
        </button>
        <button data-views-trigger="1" onClick={() => setViewsOpen(!viewsOpen)}
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
            <button data-preset-views onClick={applyPresetViews} disabled={busy}
              style={{ marginTop: 8, width: '100%', padding: '8px 0', borderRadius: 8, border: '1px dashed #4f6ef7',
                background: '#f5f7ff', color: '#4f6ef7', cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600 }}>
              ✨ 一键套用预设视图集（表格/看板/日历/甘特/Workload/分析）
            </button>
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
          {gridRows.length} 条目 · 单击编辑 · 拖 ⠿ 排序 · ↑↓/Enter/Space 快捷键 · 勾选 3 行以上出批量工具条
        </span>
      </div>
      {/* toast 统一走右下角全局 ToastHost（第二十批） */}      {/* #57 导入预览确认弹窗 */}
      {importPreview && (
        <div data-import-preview="1" style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,30,.45)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 620, maxHeight: '80vh', overflow: 'auto',
            boxShadow: '0 12px 40px rgba(0,0,0,.25)' }}>
            <b style={{ fontSize: 15 }}>📥 导入预览 — {importPreview.fileName}</b>
            <div style={{ fontSize: 12, color: '#7a7f8c', margin: '6px 0 10px' }}>
              共 {importPreview.sheet.rows.length} 行数据 · 确认后写入当前看板
            </div>
            <b style={{ fontSize: 13 }}>列映射</b>
            <div style={{ margin: '6px 0 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {importPreview.sheet.headers.filter((h) => h).map((h) => {
                const m = importPreview.headerMap[h];
                const tag = m === 'name' ? { text: '→ 条目名', bg: '#eef1fe', color: '#4f6ef7' }
                  : m ? { text: `→ ${m.name}（${typeLabel(m.type)}）`, bg: '#e6f7ef', color: '#00a25b' }
                  : isOwner ? { text: '→ 新建列', bg: '#fff8e6', color: '#b8860b' }
                  : { text: '→ 忽略（无匹配列）', bg: '#f0f1f5', color: '#a0a4b1' };
                return <span key={h} style={{ fontSize: 12, padding: '2px 9px', borderRadius: 9, background: tag.bg, color: tag.color }}>
                  {h} {tag.text}</span>;
              })}
            </div>
            <b style={{ fontSize: 13 }}>前 5 行样例</b>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '6px 0 14px' }}>
              <thead><tr>{importPreview.sheet.headers.filter((h) => h).map((h) => (
                <th key={h} style={{ padding: '4px 8px', borderBottom: '1px solid #e6e8ef', textAlign: 'left', color: '#7a7f8c' }}>{h}</th>))}</tr></thead>
              <tbody>{importPreview.sheet.rows.slice(0, 5).map((r, i) => (
                <tr key={i}>{importPreview.sheet.headers.filter((h) => h).map((h) => (
                  <td key={h} style={{ padding: '4px 8px', borderBottom: '1px solid #f0f1f5' }}>{r[h] == null ? '' : String(r[h])}</td>))}</tr>))}</tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button data-import-cancel onClick={() => setImportPreview(null)}
                style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff', cursor: 'pointer', fontSize: 13 }}>取消</button>
              <button data-import-confirm onClick={confirmImport} disabled={importing}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#4f6ef7', color: '#fff',
                  cursor: importing ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                {importing ? '导入中…' : `确认导入 ${importPreview.sheet.rows.length} 行`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* toast 统一走右下角全局 ToastHost（第二十批） */}      {/* 底部浮动批量工具条（P0-4）：勾选 ≥3 行浮出 */}
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
      {boardLoading ? (
        <div data-skeleton style={{ padding: '12px 12px 20px' }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: 34, borderRadius: 6, marginBottom: 8,
              background: 'linear-gradient(90deg,#eef0f5 25%,#e2e5ec 50%,#eef0f5 75%)',
              backgroundSize: '200% 100%', animation: 'skeleton 1.2s infinite linear' }} />
          ))}
          <style>{`@keyframes skeleton { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
        </div>
      ) : (
        <>
          {gridRows.length === 0 && (
            <div data-empty-hint style={{ margin: 24, padding: '32px 20px', textAlign: 'center', background: '#f7f8fb',
              borderRadius: 12, border: '1px dashed #d5d9e3' }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>🪄</div>
              <b style={{ fontSize: 14 }}>这个 Board 还没有条目</b>
              <div style={{ color: '#7a7f8c', fontSize: 12, marginTop: 6 }}>
                点左上角「＋ 新建条目」开始，或用「⚙ 列与分组」先建状态/人员/日期列
              </div>
              {isOwner && columns.length === 0 && (
                <button data-quick-columns onClick={addCommonColumns}
                  style={{ marginTop: 14, padding: '8px 18px', borderRadius: 8, border: '1px dashed #4f6ef7',
                    background: '#f5f7ff', color: '#4f6ef7', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  ✨ 一键添加常用列（负责人 / 状态 / 截止日期）
                </button>
              )}
            </div>
          )}
          <BoardGrid
            rows={gridRows}
            columns={gridColumns}
            groups={groups}
            editable={canEditContent}
            isOwner={isOwner}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={onSortChange}
            onOpenItem={onOpenItem}
            onEdit={saveCell}
            onOrderChange={saveOrder}
            onSelectionChange={setSelectedIds}
            boardId={boardId}
            filters={tableFilters}
            onFiltersChange={setTableFilters}
            onFilteredRowsChange={(rs) => { filteredRowsRef.current = rs; }}
            onAddColumn={async (name, type, settings) => {
              try {
                await api.addColumn(boardId, name, type, settings);
                await reloadBoard();
                flash(`已添加列「${name}」`);
              } catch (e) { flash(`添加列失败：${(e as Error).message}`); }
            }}
            onRenameColumn={async (colId, name) => {
              try {
                await api.renameColumn(boardId, colId, name);
                await reloadBoard();
                flash(`已重命名为「${name}」`);
              } catch (e) { flash(`重命名失败：${(e as Error).message}`); }
            }}
            onChangeColumnType={async (colId, type, settings) => {
              try {
                await api.changeColumnType(boardId, colId, type, settings);
                await reloadBoard();
                flash(`列类型已更改为「${type}」`);
              } catch (e) { flash(`更改类型失败：${(e as Error).message}`); }
            }}
            onDeleteColumn={async (colId) => {
              try {
                await api.deleteColumn(boardId, colId);
                await reloadBoard();
                flash('列已删除');
              } catch (e) { flash(`删除列失败：${(e as Error).message}`); }
            }}
            onDuplicateColumn={async (colId) => {
              try {
                await api.duplicateColumn(boardId, colId);
                await reloadBoard();
                flash('列已复制');
              } catch (e) { flash(`复制列失败：${(e as Error).message}`); }
            }}
            onRenameGroup={async (gid, name) => {
              try {
                await api.renameGroup(boardId, gid, name);
                await reloadBoard();
                flash(`分组已重命名为「${name}」`);
              } catch (e) { flash(`重命名分组失败：${(e as Error).message}`); }
            }}
            onAddGroup={async (name) => {
              try {
                await api.addGroup(boardId, name);
                await reloadBoard();
                flash(`已添加分组「${name}」`);
              } catch (e) { flash(`添加分组失败：${(e as Error).message}`); }
            }}
            onDeleteGroup={async (gid) => {
              try {
                await api.deleteGroup(boardId, gid);
                await reloadBoard();
                flash('分组已删除，条目已移至未分组');
              } catch (e) { flash(`删除分组失败：${(e as Error).message}`); }
            }}
            onDuplicateGroup={async (gid) => {
              try {
                await api.duplicateGroup(boardId, gid);
                await reloadBoard();
                flash('分组已复制（含条目）');
              } catch (e) { flash(`复制分组失败：${(e as Error).message}`); }
            }}
            onDuplicateItem={async (itemId) => {
              try {
                await api.duplicateItem(itemId);
                await reloadBoard();
                flash('行已复制');
              } catch (e) { flash(`复制行失败：${(e as Error).message}`); }
            }}
            onDeleteItem={async (itemId) => {
              try {
                await api.softDelete([itemId]);
                await reloadBoard();
                flash('行已移至回收站');
              } catch (e) { flash(`删除行失败：${(e as Error).message}`); }
            }}
            onMoveItem={async (itemId, groupId) => {
              try {
                await api.updateItem(itemId, { groupId: groupId ?? undefined });
                await reloadBoard();
                flash('行已移动');
              } catch (e) { flash(`移动行失败：${(e as Error).message}`); }
            }}
          />
        </>
      )}
    </div>
  );
}
