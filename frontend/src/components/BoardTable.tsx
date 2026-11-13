/**
 * 表格视图 — AG Grid Community（P0 落地，P1 换自研 TanStack）
 * 列类型渲染器走统一注册表：表格/看板/详情面板三处复用
 */
import { useMemo, useCallback, useState, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, CellValueChangedEvent, GridApi } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useItems } from '../store';
import { api } from '../api';
import { buildAgColumnExtras } from './columnTypes';

/** 列类型渲染器注册表 — 新增列类型 = 注册一个模块，视图层零改动 */
export const columnTypeRegistry: Record<string, {
  cellEditor?: string; valueFormatter?: (p: any) => string; cellRenderer?: any;
}> = {
  text: {},
  number: { cellEditor: 'agNumberCellEditor' },
  // date 列：值是 ISO 字符串，AG Grid 的 agDateCellEditor 会当成 Date 对象 → 显示 [object Object]
  // 这里改用文本格式化 + 原生 date input 编辑器，避免隐式转换
  date: {
    cellEditor: 'agTextCellEditor',
    valueFormatter: (p) => (p.value ? String(p.value).slice(0, 10) : ''),
  },
  checkbox: { cellEditor: 'agCheckboxCellEditor' },
  // status / people / dropdown 由 columnTypes.tsx 的富列渲染器接管
};

/** 列类型的中文展示名 */
const typeLabel = (t: string) => ({ text: '文本', status: '状态', people: '人员', date: '日期', number: '数字', checkbox: '勾选' } as Record<string, string>)[t] ?? t;

export function BoardTable({ boardId, onOpenItem }: { boardId: string; onOpenItem?: (itemId: string) => void }) {
  const { items, columns, groups, bumpVersion, addItem, patchItem, setBoard } = useItems();
  const gridRef = useRef<GridApi>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState('');
  const [mgrOpen, setMgrOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState('text');
  const [newGroupName, setNewGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  const reloadBoard = useCallback(async () => {
    const d: any = await api.getBoard(boardId).catch(() => null);
    if (d) setBoard(d.items ?? [], d.columns ?? [], d.groups ?? []);
  }, [boardId, setBoard]);

  const rowData = useMemo(
    // 必须带 version：updateCell 走 LWW，缺 version 会被后端判 409
    () => Object.values(items).map((it) => ({ ...it.values, id: it.id, name: it.name, version: it.version })),
    [items],
  );

  const colDefs = useMemo<ColDef[]>(() => [
    { field: 'name', headerName: '条目', editable: true, flex: 2 },
    ...columns.map((c) => ({
      field: c.id,
      headerName: c.name,
      editable: true,
      flex: 1,
      ...columnTypeRegistry[c.type] ?? {},
      ...buildAgColumnExtras(c),
    })),
  ], [columns]);

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
      flash('已新建条目，点击"条目"单元格重命名');
    } catch (e) {
      flash(`新建失败：${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  }, [boardId, creating, addItem]);

  /** 选中行批量删除 → 回收站可恢复 */
  const deleteSelected = useCallback(async () => {
    const g: any = gridRef.current;
    const sel = (g?.api?.getSelectedRows?.() ?? g?.getSelectedRows?.()) ?? [];
    if (!sel.length) { flash('先勾选要删除的行（左侧复选框）'); return; }
    if (!confirm(`把选中的 ${sel.length} 行移入回收站？`)) return;
    try {
      await api.softDelete(sel.map((r: any) => r.id));
      await reloadBoard();
      flash(`已移入回收站 ${sel.length} 行`);
    } catch (e) {
      flash(`删除失败：${(e as Error).message}`);
    }
  }, [reloadBoard]);

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

  const onCellValueChanged = useCallback(async (e: CellValueChangedEvent) => {
    const field = e.colDef.field!;
    try {
      if (field === 'name') {
        // 条目名走独立本体接口（name 是 items 列，不是动态列值）
        const r: any = await api.updateItem(e.data.id, { name: e.newValue });
        if (r?.version) bumpVersion(e.data.id, r.version);
        return;
      }
      const { version } = await api.updateCell(e.data.id, field, e.newValue, e.data.version);
      bumpVersion(e.data.id, version);
      // 本地行也要带上新 version，否则同一行连续改第二次会拿旧 version → 409
      e.data.version = version;
    } catch (err: any) {
      if (err.code === 'CONFLICT') {
        flash('该行已被他人修改，正在加载最新内容…');   // LWW：不静默覆盖
        const d: any = await api.getBoard(boardId).catch(() => null);
        if (d) setBoard(d.items ?? [], d.columns ?? [], d.groups ?? []);
        e.node.updateData({ ...e.data });
      } else {
        flash(`保存失败：${err.message ?? err}`);
      }
    }
  }, [bumpVersion, boardId, setBoard]);

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
        <button onClick={() => setMgrOpen(!mgrOpen)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e6e8ef', background: mgrOpen ? '#eef1fe' : '#fff',
            cursor: 'pointer', fontSize: 13, color: '#4f6ef7' }}>
          ⚙ 列与分组
        </button>
        {mgrOpen && (
          <div style={{ position: 'absolute', top: 52, left: 12, zIndex: 50, background: '#fff', borderRadius: 12,
            boxShadow: '0 8px 30px rgba(20,30,70,.15)', padding: 16, width: 340 }}>
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
            <b style={{ fontSize: 13, display: 'block', marginTop: 14 }}>现有列（点击 ✕ 删除）</b>
            {columns.map((c: any) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f0f1f5', fontSize: 13 }}>
                <span style={{ color: '#7a7f8c', fontSize: 11, width: 44 }}>{typeLabel(c.type)}</span>
                <span style={{ flex: 1 }}>{c.name}</span>
                <button onClick={() => removeColumn(c.id, c.name)}
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
              分组：{groups.map((g: any) => g.name).join(' / ') || '无'}
            </div>
          </div>
        )}
        <span style={{ fontSize: 12, color: '#7a7f8c', marginLeft: 'auto' }}>
          {rowData.length} 条目 · 双击单元格编辑 · 点击行打开详情
        </span>
      </div>
      {toast && (
        <div style={{ margin: '0 12px 8px', background: '#eef1fe', color: '#4f6ef7', borderRadius: 8,
          padding: '7px 12px', fontSize: 12 }}>{toast}</div>
      )}
      <div className="ag-theme-alpine" style={{ flex: 1, position: 'relative' }}>
        <AgGridReact
          ref={gridRef as any}
          rowData={rowData}
          columnDefs={colDefs}
          getRowId={(p) => p.data.id}       // 稳定行 ID：store 刷新后不丢选中/不重挂载
          rowSelection="multiple"
          pagination
          paginationPageSize={100}
          rowBuffer={10}                    // 虚拟滚动缓冲
          onCellValueChanged={onCellValueChanged}
          onRowClicked={(e) => onOpenItem?.(e.data.id)}
          animateRows
        />
      </div>
    </div>
  );
}
