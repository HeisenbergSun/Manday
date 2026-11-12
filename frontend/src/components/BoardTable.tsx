/**
 * 表格视图 — AG Grid Community（P0 落地，P1 换自研 TanStack）
 * 列类型渲染器走统一注册表：表格/看板/详情面板三处复用
 */
import { useMemo, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, CellValueChangedEvent } from 'ag-grid-community';
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

export function BoardTable({ boardId, onOpenItem }: { boardId: string; onOpenItem?: (itemId: string) => void }) {
  const { items, columns, bumpVersion } = useItems();

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

  const onCellValueChanged = useCallback(async (e: CellValueChangedEvent) => {
    const field = e.colDef.field!;
    if (field === 'name') return;              // 条目名走独立接口（这里暂不落库，避免误当列 ID）
    try {
      const { version } = await api.updateCell(e.data.id, field, e.newValue, e.data.version);
      bumpVersion(e.data.id, version);
      // 本地行也要带上新 version，否则同一行连续改第二次会拿旧 version → 409
      e.data.version = version;
      e.node.setDataValue(field, e.newValue);
    } catch (err: any) {
      if (err.code === 'CONFLICT') {
        alert('该行已被他人修改，是否加载最新内容？');   // LWW：不静默覆盖
        e.node.updateData({ ...e.data });
      } else {
        alert(`保存失败：${err.message ?? err}`);
      }
    }
  }, [bumpVersion]);

  return (
    <div className="ag-theme-alpine" style={{ height: '100%' }}>
      <AgGridReact
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
  );
}
