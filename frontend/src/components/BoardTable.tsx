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
  cellEditor?: string; valueFormatter?: (v: unknown) => string; cellRenderer?: any;
}> = {
  text:     {},
  number:   { cellEditor: 'agNumberCellEditor' },
  date:     { cellEditor: 'agDateCellEditor', valueFormatter: (v) => v ? String(v).slice(0, 10) : '' },
  checkbox: { cellEditor: 'agCheckboxCellEditor' },
  // status / people / dropdown 由 columnTypes.tsx 的富列渲染器接管
};

export function BoardTable({ boardId, onOpenItem }: { boardId: string; onOpenItem?: (itemId: string) => void }) {
  const { items, columns, bumpVersion } = useItems();

  const rowData = useMemo(
    () => Object.values(items).map((it) => ({ id: it.id, name: it.name, ...it.values })),
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
    const col = e.colDef.field!;
    try {
      const { version } = await api.updateCell(e.data.id, col, e.newValue, e.data.version);
      bumpVersion(e.data.id, version);
    } catch (err: any) {
      if (err.code === 'CONFLICT') {
        alert('该行已被他人修改，是否加载最新内容？');   // LWW：不静默覆盖
        e.node.updateData({ ...e.data });
      }
    }
  }, [bumpVersion]);

  return (
    <div className="ag-theme-alpine" style={{ height: '100%' }}>
      <AgGridReact
        rowData={rowData}
        columnDefs={colDefs}
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
