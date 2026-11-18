// P2-3 Formula 列：安全求值引擎（tokenizer + 递归下降 parser，不用 eval）
// 第二十三批扩展：IF/AND/OR/NOT/SWITCH 条件函数、CONCATENATE/LEFT/RIGHT/UPPER/LOWER/LEN/TRIM 字符串函数、
//   DAYS/FORMAT_DATE/TODAY 日期函数、比较运算符(> < >= <= = !=)
// 语法：{列名} 引用本行数值；+ - * / ( )；SUM({列名}) / COUNT({列名}) 聚合子条目
//      无子条目时 SUM({列名}) 回退为本行该列的值

interface Token {
  type: 'num' | 'ref' | 'op' | 'lparen' | 'rparen' | 'ident' | 'string' | 'comma';
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

type FVal = string | number | null;

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
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < expr.length && expr[j] !== quote) j++;
      if (j >= expr.length) throw new Error('BAD_FORMULA');
      tokens.push({ type: 'string', value: expr.slice(i + 1, j) });
      i = j + 1;
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
    // 多字符运算符：>= <= != ==
    if (c === '>' || c === '<' || c === '!' || c === '=') {
      if (expr[i + 1] === '=') { tokens.push({ type: 'op', value: c + '=' }); i += 2; continue; }
      if (c === '!' && expr[i + 1] !== '=') throw new Error('BAD_FORMULA');
      if (c === '=') throw new Error('BAD_FORMULA'); // 单个 = 不合法
      tokens.push({ type: 'op', value: c }); i++; continue;
    }
    if ('+-*/'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    if (c === '(') { tokens.push({ type: 'lparen', value: c }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rparen', value: c }); i++; continue; }
    if (c === ',') { tokens.push({ type: 'comma', value: c }); i++; continue; }
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

function toNumber(v: FVal): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function toStr(v: FVal): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function toBool(v: FVal): boolean {
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === '已完成' || s === 'done';
}

function parseDate(v: FVal): Date | null {
  if (v === null || v === '') return null;
  const s = String(v).slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
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

  parseExpr(): FVal {
    // 比较层：> < >= <= = !=
    let left = this.parseAddSub();
    while (this.peek() && this.peek()!.type === 'op' && ['>', '<', '>=', '<=', '!=', '='].includes(this.peek()!.value)) {
      const op = this.next()!.value;
      const right = this.parseAddSub();
      const ln = toNumber(left), rn = toNumber(right);
      if (ln !== null && rn !== null) {
        switch (op) {
          case '>': left = ln > rn ? 1 : 0; break;
          case '<': left = ln < rn ? 1 : 0; break;
          case '>=': left = ln >= rn ? 1 : 0; break;
          case '<=': left = ln <= rn ? 1 : 0; break;
          case '=': left = ln === rn ? 1 : 0; break;
          case '!=': left = ln !== rn ? 1 : 0; break;
        }
      } else {
        // 字符串比较
        const ls = toStr(left), rs = toStr(right);
        switch (op) {
          case '=': left = ls === rs ? 1 : 0; break;
          case '!=': left = ls !== rs ? 1 : 0; break;
          case '>': left = ls > rs ? 1 : 0; break;
          case '<': left = ls < rs ? 1 : 0; break;
          case '>=': left = ls >= rs ? 1 : 0; break;
          case '<=': left = ls <= rs ? 1 : 0; break;
        }
      }
    }
    return left;
  }

  parseAddSub(): FVal {
    let left = this.parseTerm();
    while (this.peek() && this.peek()!.type === 'op' && (this.peek()!.value === '+' || this.peek()!.value === '-')) {
      const op = this.next()!.value;
      const right = this.parseTerm();
      // 字符串拼接：+ 有一侧是字符串且另一侧非 null → 拼接
      if (op === '+' && (typeof left === 'string' || typeof right === 'string') && left !== null && right !== null) {
        left = toStr(left) + toStr(right);
        continue;
      }
      const ln = toNumber(left), rn = toNumber(right);
      if (ln === null || rn === null) { this.errors = true; return null; }
      left = op === '+' ? ln + rn : ln - rn;
    }
    return left;
  }

  parseTerm(): FVal {
    let left = this.parseFactor();
    while (this.peek() && this.peek()!.type === 'op' && (this.peek()!.value === '*' || this.peek()!.value === '/')) {
      const op = this.next()!.value;
      const right = this.parseFactor();
      const ln = toNumber(left), rn = toNumber(right);
      if (ln === null || rn === null) { this.errors = true; return null; }
      if (op === '*') left = ln * rn;
      else {
        if (rn === 0) { this.errors = true; return null; }
        left = ln / rn;
      }
    }
    return left;
  }

  parseFactor(): FVal {
    const t = this.peek();
    if (!t) { this.errors = true; return null; }
    if (t.type === 'op' && t.value === '-') { this.next(); const v = this.parseFactor(); const n = toNumber(v); return n === null ? null : -n; }
    if (t.type === 'num') { this.next(); return t.num!; }
    if (t.type === 'string') { this.next(); return t.value; }
    if (t.type === 'lparen') {
      this.next();
      const v = this.parseExpr();
      if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
      return v;
    }
    if (t.type === 'ref') { this.next(); return this.row.values[t.value] ?? null; }
    if (t.type === 'ident') {
      const fn = t.value.toUpperCase();
      this.next();
      if (this.peek()?.type !== 'lparen') { this.errors = true; return null; }
      this.next();

      // 零参数函数
      if (fn === 'TODAY') {
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        return new Date().toISOString().slice(0, 10);
      }

      // 一元数值函数：ROUND / ABS
      if (fn === 'ROUND' || fn === 'ABS') {
        const v = this.parseExpr();
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        const n = toNumber(v);
        if (n === null) { this.errors = true; return null; }
        return fn === 'ABS' ? Math.abs(n) : Math.round(n);
      }

      // IF(condition, then, else)
      if (fn === 'IF') {
        const cond = this.parseExpr();
        if (this.peek()?.type !== 'comma') { this.errors = true; return null; }
        this.next();
        const thenVal = this.parseExpr();
        if (this.peek()?.type !== 'comma') { this.errors = true; return null; }
        this.next();
        const elseVal = this.parseExpr();
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        return toBool(cond) ? thenVal : elseVal;
      }

      // SWITCH(expr, val1, res1, val2, res2, ..., default)
      if (fn === 'SWITCH') {
        const sw = this.parseExpr();
        let result: FVal = null;
        let matched = false;
        while (this.peek()?.type === 'comma') {
          this.next();
          const cmp = this.parseExpr();
          if (this.peek()?.type !== 'comma') { this.errors = true; break; }
          this.next();
          const res = this.parseExpr();
          if (!matched && toStr(sw) === toStr(cmp)) { result = res; matched = true; }
        }
        // 最后一个参数是 default（如果没匹配且有多余 comma+value）
        if (!matched && this.peek()?.type === 'comma') {
          this.next();
          result = this.parseExpr();
        }
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        return result;
      }

      // AND / OR / NOT（布尔函数，支持多参数）
      if (fn === 'AND' || fn === 'OR') {
        const args: FVal[] = [];
        args.push(this.parseExpr());
        while (this.peek()?.type === 'comma') { this.next(); args.push(this.parseExpr()); }
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        const bools = args.map(toBool);
        return fn === 'AND' ? (bools.every(Boolean) ? 1 : 0) : (bools.some(Boolean) ? 1 : 0);
      }
      if (fn === 'NOT') {
        const v = this.parseExpr();
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        return toBool(v) ? 0 : 1;
      }

      // CONCATENATE(str1, str2, ...)
      if (fn === 'CONCATENATE' || fn === 'CONCAT') {
        const parts: FVal[] = [];
        parts.push(this.parseExpr());
        while (this.peek()?.type === 'comma') { this.next(); parts.push(this.parseExpr()); }
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        return parts.map(toStr).join('');
      }

      // 字符串函数：LEFT/RIGHT/UPPER/LOWER/LEN/TRIM
      if (fn === 'LEFT' || fn === 'RIGHT') {
        const s = this.parseExpr();
        if (this.peek()?.type !== 'comma') { this.errors = true; return null; }
        this.next();
        const n = toNumber(this.parseExpr());
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        const str = toStr(s);
        const cnt = n ?? 0;
        return fn === 'LEFT' ? str.slice(0, cnt) : str.slice(-cnt);
      }
      if (fn === 'UPPER' || fn === 'LOWER') {
        const s = this.parseExpr();
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        const str = toStr(s);
        return fn === 'UPPER' ? str.toUpperCase() : str.toLowerCase();
      }
      if (fn === 'LEN') {
        const s = this.parseExpr();
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        return toStr(s).length;
      }
      if (fn === 'TRIM') {
        const s = this.parseExpr();
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        return toStr(s).trim();
      }

      // 日期函数：DAYS(date1, date2) → 相差天数；FORMAT_DATE(date, "fmt")
      if (fn === 'DAYS') {
        const d1 = parseDate(this.parseExpr());
        if (this.peek()?.type !== 'comma') { this.errors = true; return null; }
        this.next();
        const d2 = parseDate(this.parseExpr());
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        if (!d1 || !d2) return null;
        return Math.round((d1.getTime() - d2.getTime()) / 86400000);
      }
      if (fn === 'FORMAT_DATE') {
        const d = parseDate(this.parseExpr());
        let fmt = 'YYYY-MM-DD';
        if (this.peek()?.type === 'comma') {
          this.next();
          fmt = toStr(this.parseExpr());
        }
        if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
        if (!d) return '';
        return fmt
          .replace('YYYY', String(d.getFullYear()))
          .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
          .replace('DD', String(d.getDate()).padStart(2, '0'));
      }

      // 聚合函数：SUM/AVG/MIN/MAX/COUNT({col})
      if (this.peek()?.type !== 'ref') { this.errors = true; return null; }
      const refName = this.next()!.value;
      if (this.peek()?.type !== 'rparen') { this.errors = true; } else { this.next(); }
      if (fn === 'SUM') return this.sumAgg(refName);
      if (fn === 'AVG') return this.agg(refName, 'avg');
      if (fn === 'MIN') return this.agg(refName, 'min');
      if (fn === 'MAX') return this.agg(refName, 'max');
      if (fn === 'COUNT') return this.children.length;
      this.errors = true;
      return null;
    }
    this.errors = true;
    return null;
  }

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

  private agg(colName: string, kind: 'avg' | 'min' | 'max'): number | null {
    if (this.children.length === 0) return toNumber(this.row.values[colName]);
    const nums: number[] = [];
    for (const c of this.children) {
      const n = toNumber(c.values[colName]);
      if (n === null) return null;
      nums.push(n);
    }
    if (kind === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (kind === 'min') return Math.min(...nums);
    return Math.max(...nums);
  }
}

export function evaluateFormula(expr: string, row: FormulaRow, children: FormulaRow[]): FVal {
  const tokens = tokenize(expr);
  const p = new Parser(tokens, row, children);
  const v = p.parseExpr();
  if (p.pos !== tokens.length || p.errors || v === null) return null;
  if (typeof v === 'number' && !isFinite(v)) return null;
  return v;
}

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

export function injectFormulaValues(
  columns: FormulaColumn[],
  itemRows: any[],
  childRows: FormulaRow[],
): void {
  const formulaCols = columns.filter((c) => c.type === 'formula' && c.settings?.formula);
  if (formulaCols.length === 0) return;
  const nameById = new Map<string, string>();
  for (const c of columns) nameById.set(String(c.id), c.name);

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
      if (val !== null) {
        if (typeof val === 'number') it.values[fc.id] = String(Math.round(val * 1e9) / 1e9);
        else it.values[fc.id] = val;
      }
    }
  }
}
