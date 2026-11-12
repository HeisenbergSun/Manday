/**
 * 列类型渲染器（前端）— status / people / dropdown 三种富列
 * 表格（AG Grid cellRenderer）、看板卡片、详情面板三处复用本注册表
 *
 * 注意：AG Grid v31 已移除 suppressHtmlEscaping，返回 HTML 字符串会被转义成纯文本。
 * 这里统一用 React 组件渲染（AG Grid React 版原生支持），JSX 零转义风险、也便于后续加交互。
 */
import type { ICellRendererParams } from 'ag-grid-community';

/** 值可能是 {label}/{id,name} 对象（历史数据/接口演进），统一取出标量再比较 */
function scalar(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as any;
    return String(o.label ?? o.name ?? o.id ?? '');
  }
  return String(v);
}

export interface ColumnOption { label: string; color: string; }
interface Member { id: string; name: string; color: string; }

const EMPTY = () => <span style={{ color: '#c3c8d4' }}>—</span>;

const StatusCell = (p: ICellRendererParams) => {
  const labels: ColumnOption[] = (p.colDef as any)?.cellRendererParams?.labels ?? [];
  const v = scalar(p.value);
  if (!v) return <EMPTY />;
  const opt = labels.find((l) => l.label === v);
  if (!opt) return <span style={{ color: '#7a7f8c', fontSize: 12 }}>{v}</span>;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: `${opt.color}22`, color: opt.color,
      padding: '2px 10px', borderRadius: 20, fontSize: 12,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: opt.color }} />
      {opt.label}
    </span>
  );
};

const PeopleCell = (p: ICellRendererParams) => {
  const members: Member[] = (p.colDef as any)?.cellRendererParams?.members ?? [];
  const v = scalar(p.value);
  if (!v) return <EMPTY />;
  const m = members.find((u) => u.id === v || u.name === v);
  if (!m) return <span style={{ fontSize: 12 }}>{v}</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        width: 20, height: 20, borderRadius: '50%', background: m.color, color: '#fff', fontSize: 10,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>{(m.name || '?')[0]}</span>
      {m.name}
    </span>
  );
};

const DropdownCell = (p: ICellRendererParams) => {
  const options: ColumnOption[] = (p.colDef as any)?.cellRendererParams?.options ?? [];
  const raw = Array.isArray(p.value) ? p.value : p.value ? [p.value] : [];
  if (!raw.length) return <EMPTY />;
  return (
    <span>
      {raw.map((r: any, i: number) => {
        const v = scalar(r);
        const opt = options.find((o) => o.label === v);
        return (
          <span key={i} style={{
            display: 'inline-block', background: `${opt?.color ?? '#d0d4e0'}26`,
            color: opt?.color ?? '#5a6072', padding: '2px 9px', borderRadius: 5,
            fontSize: 12, marginRight: 4,
          }}>{v}</span>
        );
      })}
    </span>
  );
};

export const richColumnTypes = {
  status: {
    /** settings.labels: ColumnOption[]；value: label 字符串 */
    cellRenderer: StatusCell,
    editor: {
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: (p: any) => ({
        values: ((p.colDef?.cellRendererParams?.labels ?? []) as ColumnOption[]).map((l) => l.label),
      }),
    },
  },

  people: {
    /** value: userId；settings.members: {id,name,color}[] */
    cellRenderer: PeopleCell,
    editor: {
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: (p: any) => ({
        values: ((p.colDef?.cellRendererParams?.members ?? []) as Member[]).map((u) => u.id),
      }),
    },
  },

  dropdown: {
    /** settings.options: ColumnOption[]；支持多选（value: string[]） */
    cellRenderer: DropdownCell,
    editor: {
      cellEditor: 'agRichSelectCellEditor',
      cellEditorParams: (p: any) => ({
        values: ((p.colDef?.cellRendererParams?.options ?? []) as ColumnOption[]).map((o) => o.label),
        multiple: true,
      }),
    },
  },
};

/** 把 board_columns 定义转换为 AG Grid colDef 片段 */
export function buildAgColumnExtras(column: { type: string; settings: Record<string, unknown> }) {
  const rich = (richColumnTypes as any)[column.type];
  if (!rich) return {};                                       // text/number/date 走 BoardTable 默认
  return {
    ...rich.editor,
    cellRenderer: rich.cellRenderer,
    cellRendererParams: column.settings,
  };
}
