// P2-3 Formula 列：安全求值引擎（tokenizer + 递归下降 parser，不用 eval）
// 语法：{列名} 引用本行数值；+ - * / ( )；SUM({列名}) / COUNT({列名}) 聚合子条目
//      无子条目时 SUM({列名}) 回退为本行该列的值

interface Token {
  type: 'num' | 'ref' | 'op' | 'lparen' | 'rparen' | 'ident';
  value: string;
  num?: number;
}

export interface FormulaRow {
  id: number;
  parentItemId?: number | null;
  values: Record<string, string | null>; // column name -> raw value text
}

export interface FormulaColumn {
  id: number;
  name: string;
  type: string;
  settings?: any;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{') {
      const end = expr.indexOf('}', i);
      if (end === -1) throw new Error('BAD_FORMULA');
      tokens.push({ type: 'ref', value: expr.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      const num = Number(expr.slice(i, j));
      if (!isFinite(num)) throw new Error('BAD_FORMULA');
      tokens.push({ type: 'num', value: expr.slice(i, j), num });
      i = j;
      continue;
    }
    if ('+-*/'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    if (c === '(') { tokens.push({ type: 'lparen', value: c }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rparen', value: c }); i++; continue; }
    if (/[A-Za-z_\u4e00-\u9fa5]/.test(c)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_\u4e00-\u9fa5]/.test(expr[j])) j++;
      tokens.push({ type: 'ident', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error('BAD_FORMULA');
  }
  return tokens;
}

function toNumber(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

class Parser {
  tokens: Token[];
  pos = 0;
  row: FormulaRow;
  children: FormulaRow[];
  errors: boolean;

  constructor(tokens: Token[], row: FormulaRow, children: FormulaRow[]) {
    this.tokens = tokens;
    this.row = row;
    this.children = children;
    this.errors = false;
  }

  peek(): Token | undefined { return this.tokens[this.pos]; }
  next(): Token | undefined { return this.tokens[this.pos++]; }

  parseExpr(): number | null {
    let left = this.parseTerm();
    while (this.peek() && this.peek()!.type === 'op' && (this.peek()!.value === '+' || this.peek()!.value === '-')) {
      const op = this.next()!.value;
      const right = this.parseTerm();
      if (left === null || right === null) { this.errors = true; return null; }
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  parseTerm(): number | null {
    let left = this.parseFactor();
    while (this.peek() && this.peek()!.type === 'op' && (this.peek()!.value === '*' || this.peek()!.value === '/')) {
      const op = this.next()!.value;
      const right = this.parseFactor();
      if (left === null || right === null) { this.errors = true; return null; }
      if (op === '*') left = left * right;
      else {
        if (right === 0) { this.errors = true; return null; }
        left = left / right;
      }
    }
    return left;
  }

  parseFactor(): number | null {
    const t = this.peek();
    if (!t) { this.errors = true; return null; }
    if (t.type === 'op' && t.value === '-') { this.next(); const v = this.parseFactor(); return v === null ? null : -v; }
    if (t.type === 'num') { this.next(); return t.num!; }
    if (t.type === 'lparen') {
      this.next();
      const v = this.parseExpr();
      if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
      return v;
    }
    if (t.type === 'ref') { this.next(); return toNumber(this.row.values[t.value]); }
    if (t.type === 'ident') {
      const fn = t.value.toUpperCase();
      this.next();
      if (this.peek()?.type !== 'lparen') { this.errors = true; return null; }
      this.next();
      if (this.peek()?.type !== 'ref') { this.errors = true; return null; }
      const refName = this.next()!.value;
      if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
      if (fn === 'SUM') return this.sumAgg(refName);
      if (fn === 'COUNT') return this.children.length;
      this.errors = true;
      return null;
    }
    this.errors = true;
    return null;
  }

  // SUM({col})：聚合子条目该列之和；无子条目时回退本行该列值
  private sumAgg(colName: string): number | null {
    if (this.children.length === 0) return toNumber(this.row.values[colName]);
    let sum = 0;
    for (const c of this.children) {
      const n = toNumber(c.values[colName]);
      if (n === null) return null;
      sum += n;
    }
    return sum;
  }
}

export function evaluateFormula(expr: string, row: FormulaRow, children: FormulaRow[]): number | null {
  const tokens = tokenize(expr);
  const p = new Parser(tokens, row, children);
  const v = p.parseExpr();
  if (p.pos !== tokens.length || p.errors || v === null || !isFinite(v)) return null;
  return v;
}

/** 仅语法校验：所有 {引用} 视为 0（缺失引用不算语法错），解析无 errors 且消费完所有 token 即合法 */
export function validateFormula(expr: string): boolean {
  try {
    const tokens = tokenize(expr);
    const zeroRow = {
      id: 0,
      values: new Proxy({}, { get: () => '0' }),
    } as unknown as FormulaRow;
    const p = new Parser(tokens, zeroRow, []);
    p.parseExpr();
    return !p.errors && p.pos === tokens.length;
  } catch { return false; }
}

// 计算所有 formula 列的值并注入 itemRows
export function injectFormulaValues(
  columns: FormulaColumn[],
  itemRows: any[],          // 已有 values: { columnId: rawText|null }
  childRows: FormulaRow[],  // 子条目（values 以 columnId 为键，parentItemId 必填）
): void {
  const formulaCols = columns.filter((c) => c.type === 'formula' && c.settings?.formula);
  if (formulaCols.length === 0) return;
  const nameById = new Map<string, string>();
  for (const c of columns) nameById.set(String(c.id), c.name);

  // parent item id -> 子条目（values 以列名为键）
  const childrenByParent = new Map<number, FormulaRow[]>();
  for (const ch of childRows) {
    const pid = ch.parentItemId;
    if (pid == null) continue;
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid)!.push(ch);
  }

  for (const it of itemRows) {
    for (const fc of formulaCols) {
      const rawExpr = String(fc.settings.formula);
      const rowValues: Record<string, string | null> = {};
      for (const [cid, v] of Object.entries(it.values || {})) {
        const nm = nameById.get(String(cid));
        if (nm) rowValues[nm] = v as string | null;
      }
      const childNameRows = (childrenByParent.get(it.id) || []).map((ch) => {
        const cv: Record<string, string | null> = {};
        for (const [cid, v] of Object.entries(ch.values || {})) {
          const nm = nameById.get(String(cid));
          if (nm) cv[nm] = v as string | null;
        }
        return { id: ch.id, parentItemId: ch.parentItemId ?? null, values: cv } as FormulaRow;
      });
      const val = evaluateFormula(rawExpr, { id: it.id, values: rowValues }, childNameRows);
      if (val !== null) it.values[fc.id] = String(Math.round(val * 1e9) / 1e9); // 浮点精度规整
    }
  }
}
