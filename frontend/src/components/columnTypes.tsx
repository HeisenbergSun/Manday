/**
 * 列类型渲染器（前端）— status / people / dropdown 三种富列
 * 表格（AG Grid cellRenderer）、看板卡片、详情面板三处复用本注册表
 */
import type { ICellRendererParams } from 'ag-grid-community';

export interface ColumnOption { label: string; color: string; }

export const richColumnTypes = {
  status: {
    /** settings.labels: ColumnOption[]；value: label 字符串 */
    cellRenderer: (p: ICellRendererParams) => {
      const labels: ColumnOption[] = p.colDef?.cellRendererParams?.labels ?? [];
      const opt = labels.find((l: ColumnOption) => l.label === p.value);
      if (!opt) return String(p.value ?? '');
      return `<span style="display:inline-flex;align-items:center;gap:6px;background:${opt.color}22;
        color:${opt.color};padding:2px 10px;border-radius:20px;font-size:12px">
        <span style="width:7px;height:7px;border-radius:50%;background:${opt.color}"></span>${opt.label}</span>`;
    },
    editor: {
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: (p: any) => ({ values: (p.colDef?.cellRendererParams?.labels ?? []).map((l: ColumnOption) => l.label) }),
    },
  },

  people: {
    /** value: userId；settings.members: {id,name,color}[] */
    cellRenderer: (p: ICellRendererParams) => {
      const members: { id: string; name: string; color: string }[] = p.colDef?.cellRendererParams?.members ?? [];
      const m = members.find((u: any) => u.id === p.value);
      if (!m) return String(p.value ?? '');
      return `<span style="display:inline-flex;align-items:center;gap:5px">
        <span style="width:20px;height:20px;border-radius:50%;background:${m.color};color:#fff;font-size:10px;
          display:inline-flex;align-items:center;justify-content:center">${m.name[0]}</span>${m.name}</span>`;
    },
    editor: {
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: (p: any) => ({
        values: (p.colDef?.cellRendererParams?.members ?? []).map((u: any) => u.id),
      }),
    },
  },

  dropdown: {
    /** settings.options: ColumnOption[]；支持多选（value: string[]） */
    cellRenderer: (p: ICellRendererParams) => {
      const options: ColumnOption[] = p.colDef?.cellRendererParams?.options ?? [];
      const vals = Array.isArray(p.value) ? p.value : p.value ? [p.value] : [];
      return vals.map((v: any) => {
        const opt = options.find((o: ColumnOption) => o.label === v);
        return `<span style="display:inline-block;background:${opt?.color ?? '#d0d4e0'}26;
          color:${opt?.color ?? '#5a6072'};padding:2px 9px;border-radius:5px;font-size:12px;margin-right:4px">${v}</span>`;
      }).join('');
    },
    editor: {
      cellEditor: 'agRichSelectCellEditor',
      cellEditorParams: (p: any) => ({
        values: (p.colDef?.cellRendererParams?.options ?? []).map((o: ColumnOption) => o.label), multiple: true,
      }),
    },
  },
};

/** 把 board_columns 定义转换为 AG Grid colDef 片段 */
export function buildAgColumnExtras(column: { type: string; settings: Record<string, unknown> }) {
  const rich = (richColumnTypes as any)[column.type];
  if (!rich) return {};                                       // text/number/date 走 BoardTable 默认
  return { ...rich.editor, cellRenderer: rich.cellRenderer, cellRendererParams: column.settings };
}
