/**
 * Excel 导入（第二十八批）— 客户端解析 + 列映射 + 值转换
 * 流程：文件 → SheetJS 解析 → 表头映射到看板列 → 逐行建条目 + 写单元格
 * 表头映射规则：
 *   - 「条目」「名称」「任务」→ 条目名
 *   - 其余按列名精确/去空格匹配现有列
 *   - 匹配不到且为负责人 → 自动建列（类型按内容推断：日期→date、数字→number、布尔→checkbox、其余→text）
 * 值转换：date（Excel 序列号/常见格式→YYYY-MM-DD）、number、checkbox（是/否/true/false/√）、
 *         people（姓名按 逗号/、/; 分隔→真实用户 id）、status/dropdown（原样作为标签）
 */
import * as XLSX from 'xlsx';

export interface ImportCol { id: string; name: string; type: string; settings?: any }
export interface UserLike { id: string; name: string; email?: string }

/** Excel 日期序列号（1900 体系）→ YYYY-MM-DD */
export function excelSerialToDate(n: number): string {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 宽松解析日期字符串 → YYYY-MM-DD（失败返回 null） */
export function parseDateLike(v: string): string | null {
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

/** 布尔值识别（checkbox） */
export function parseBool(v: unknown): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (['true', '是', 'y', 'yes', '√', '✓', '1', '完成', '已完成'].includes(s)) return true;
  if (['false', '否', 'n', 'no', '0', '未完成'].includes(s)) return false;
  return null;
}

/** 人员单元格：姓名串（逗号/、/;分隔）→ 真实用户 id 数组 */
export function parsePeople(v: unknown, users: UserLike[]): string[] {
  if (v == null || v === '') return [];
  const raw = Array.isArray(v) ? v.map(String) : String(v).split(/[,、;；]/);
  const ids: string[] = [];
  for (const token of raw) {
    const t = token.trim();
    if (!t) continue;
    const u = users.find((x) => x.name === t) ?? users.find((x) => x.email === t)
      ?? users.find((x) => x.name.includes(t) || t.includes(x.name));
    if (u && !ids.includes(u.id)) ids.push(u.id);
  }
  return ids;
}

/** 推断列类型（自动建列用） */
export function inferType(values: unknown[]): string {
  const nonEmpty = values.filter((v) => v != null && String(v).trim() !== '');
  if (!nonEmpty.length) return 'text';
  const dateCnt = nonEmpty.filter((v) =>
    typeof v === 'number' ? v > 20000 && v < 60000 : !!parseDateLike(String(v))).length;
  if (dateCnt / nonEmpty.length > 0.7) return 'date';
  const numCnt = nonEmpty.filter((v) => v !== '' && !isNaN(Number(v))).length;
  if (numCnt / nonEmpty.length > 0.7) return 'number';
  const boolCnt = nonEmpty.filter((v) => parseBool(v) !== null).length;
  if (boolCnt / nonEmpty.length > 0.7) return 'checkbox';
  return 'text';
}

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];   // 表头 → 单元格值
}

/** 解析 Excel/CSV 文件数据（取第一个非空 sheet） */
export function parseWorkbook(data: ArrayBuffer): ParsedSheet {
  const wb = XLSX.read(data, { type: 'array', cellDates: false });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    if (!aoa.length) continue;
    const headers = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim());
    if (!headers.some((h) => h)) continue; // 空表头行，换下一个 sheet
    const rows = aoa.slice(1)
      .filter((r) => (r as unknown[]).some((c) => c != null && String(c).trim() !== ''))
      .map((r) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => { if (h) obj[h] = (r as unknown[])[i]; });
        return obj;
      });
    return { headers, rows };
  }
  return { headers: [], rows: [] };
}

const NAME_KEYS = ['条目', '名称', '任务', 'item', 'name', 'task', 'title'];

export interface ConvertCtx {
  columns: ImportCol[];
  users: UserLike[];
  isOwner: boolean;
}
export interface ConvertedCell { columnId: string; value: unknown }
export interface ConvertedRow { name: string; cells: ConvertedCell[] }

/**
 * 把一行原始数据转换为 { 条目名, 单元格值 }
 * unmatchedCols：需要自动新建的列（调用方建完列后再调一次本函数补映射）
 */
export function convertRow(
  row: Record<string, unknown>,
  headerMap: Record<string, ImportCol | 'name' | null>,
  users: UserLike[] = [],
): ConvertedRow | null {
  const name = NAME_KEYS.map((k) => row[k]).find((v) => v != null && String(v).trim() !== '');
  if (name == null || String(name).trim() === '') return null;
  const cells: ConvertedCell[] = [];
  for (const [header, col] of Object.entries(headerMap)) {
    if (!col || col === 'name') continue;
    const v = row[header];
    if (v == null || String(v).trim() === '') continue;
    cells.push({ columnId: col.id, value: convertValue(v, col, users) });
  }
  return { name: String(name).trim(), cells };
}

/** 按列类型转换单元格值 */
export function convertValue(v: unknown, col: ImportCol, users: UserLike[] = []): unknown {
  switch (col.type) {
    case 'date': {
      if (typeof v === 'number') return excelSerialToDate(v);
      return parseDateLike(String(v)) ?? String(v).trim();
    }
    case 'number': {
      const n = Number(v);
      return isNaN(n) ? String(v).trim() : n;
    }
    case 'checkbox': return parseBool(v) ?? false;
    case 'people': return parsePeople(v, users);
    case 'rating': {
      const n = Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
      return n;
    }
    default: return String(v).trim();  // text/status/dropdown/longtext/tags 原样
  }
}

/** 生成表头 → 列 的映射（找不到列返回 null，由调用方决定是否自动建列） */
export function mapHeaders(headers: string[], columns: ImportCol[]): Record<string, ImportCol | 'name' | null> {
  const map: Record<string, ImportCol | 'name' | null> = {};
  for (const h of headers) {
    const key = h.trim();
    if (!key) { map[h] = null; continue; }
    if (NAME_KEYS.some((k) => key.toLowerCase() === k.toLowerCase())) { map[h] = 'name'; continue; }
    const col = columns.find((c) => c.name === key) ?? columns.find((c) => c.name.trim() === key);
    map[h] = col ?? null;
  }
  return map;
}
