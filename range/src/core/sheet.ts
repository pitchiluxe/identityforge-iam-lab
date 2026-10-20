/**
 * core/sheet.ts — the spreadsheet engine behind Excel. Pure: no DOM.
 *
 * Cells hold what the user typed ("42", "Nursing", "=COUNTIF(D2:D40,"Disabled")").
 * Formulas are parsed by a small recursive-descent parser (the app's CSP
 * forbids eval, and a sheet must never run code anyway) and evaluated lazily
 * with cycle detection. Errors are values, as in Excel: #DIV/0!, #VALUE!,
 * #REF!, #NAME?, #N/A, and #CIRC! for a circular reference.
 *
 * Also CSV, because access reviews and HR feeds arrive as CSV and Excel is
 * what people open them with.
 */

export type ErrorCode = '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#N/A' | '#NUM!' | '#CIRC!' | '#ERROR!';
export interface CellError { error: ErrorCode }
export type Value = number | string | boolean | CellError | null;

export const isError = (v: unknown): v is CellError => typeof v === 'object' && v !== null && 'error' in v;
const err = (e: ErrorCode): CellError => ({ error: e });

// ------------------------------------------------------------------ addresses

export const MAX_COLS = 26 * 27; // A..ZZ
export const MAX_ROWS = 10000;

export function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface Addr { col: number; row: number }

export function parseAddr(a: string): Addr | null {
  const m = /^\$?([A-Za-z]{1,2})\$?(\d{1,5})$/.exec(a.trim());
  if (!m) return null;
  const col = colIndex(m[1]!);
  const row = Number(m[2]) - 1;
  return row >= 0 && row < MAX_ROWS && col < MAX_COLS ? { col, row } : null;
}

export const addrName = (a: Addr): string => `${colName(a.col)}${a.row + 1}`;

/** Every address in A1:C3, row by row. */
export function expandRange(from: Addr, to: Addr): Addr[] {
  const out: Addr[] = [];
  for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++)
    for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) out.push({ col: c, row: r });
  return out;
}

// ------------------------------------------------------------------ literals

/** What a typed value means when it is not a formula: number, boolean or text. */
export function literal(raw: string): Value {
  const s = raw.trim();
  if (raw.startsWith("'")) return raw.slice(1);
  if (s === '') return null;
  if (/^(true|false)$/i.test(s)) return s.toUpperCase() === 'TRUE';
  const pct = /^([-+]?[\d,]*\.?\d+(?:e[-+]?\d+)?)\s*%$/i.exec(s);
  if (pct && /^[-+]?\d{1,3}(,\d{3})*(\.\d+)?$|^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(pct[1]!)) return Number(pct[1]!.replace(/,/g, '')) / 100;
  const cur = /^[-+]?\$?\s*([\d,]*\.?\d+)$/.exec(s);
  if (cur && /^[-+]?\$?\s*(\d{1,3}(,\d{3})*(\.\d+)?|\d*\.?\d+)$/.test(s)) return (s.startsWith('-') ? -1 : 1) * Number(cur[1]!.replace(/,/g, ''));
  if (/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return Number(s);
  return raw;
}

// ------------------------------------------------------------------ parser

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'ref'; a: Addr }
  | { k: 'range'; from: Addr; to: Addr }
  | { k: 'fn'; name: string; args: Node[] }
  | { k: 'un'; op: '-' | '+' | '%'; x: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'err'; e: ErrorCode };

interface Tok { t: 'num' | 'str' | 'id' | 'op' | 'end'; v: string }

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(rest);
    if (num) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
    if (ch === '"') {
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= src.length) return null;
        if (src[j] === '"') { if (src[j + 1] === '"') { v += '"'; j += 2; continue; } break; }
        v += src[j++];
      }
      out.push({ t: 'str', v });
      i = j + 1;
      continue;
    }
    const id = /^\$?[A-Za-z_][A-Za-z0-9_.]*\$?\d*/.exec(rest);
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(<>|<=|>=|[-+*/^&=<>(),:%;])/.exec(rest);
    if (op) { out.push({ t: 'op', v: op[0] === ';' ? ',' : op[0] }); i += op[0].length; continue; }
    return null;
  }
  out.push({ t: 'end', v: '' });
  return out;
}

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  if (!toks) return { k: 'err', e: '#ERROR!' };
  let p = 0;
  const peek = (): Tok => toks[p]!;
  const take = (): Tok => toks[p++]!;
  const isOp = (v: string): boolean => peek().t === 'op' && peek().v === v;
  const fail = (): never => { throw new Error('parse'); };

  const primary = (): Node => {
    const t = take();
    if (t.t === 'num') return { k: 'num', v: Number(t.v) };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'op' && t.v === '(') { const e = comparison(); if (!isOp(')')) fail(); take(); return e; }
    if (t.t === 'id') {
      if (isOp('(')) {
        take();
        const args: Node[] = [];
        if (!isOp(')')) {
          for (;;) {
            args.push(isOp(',') || isOp(')') ? { k: 'str', v: '' } : comparison());
            if (isOp(',')) { take(); continue; }
            break;
          }
        }
        if (!isOp(')')) fail();
        take();
        return { k: 'fn', name: t.v.toUpperCase(), args };
      }
      if (/^true$/i.test(t.v)) return { k: 'bool', v: true };
      if (/^false$/i.test(t.v)) return { k: 'bool', v: false };
      const a = parseAddr(t.v);
      if (a) {
        if (isOp(':')) {
          take();
          const b = take();
          const to = b.t === 'id' ? parseAddr(b.v) : null;
          if (!to) return { k: 'err', e: '#REF!' };
          return { k: 'range', from: a, to };
        }
        return { k: 'ref', a };
      }
      return { k: 'err', e: '#NAME?' };
    }
    return fail();
  };
  const postfix = (): Node => { let x = primary(); while (isOp('%')) { take(); x = { k: 'un', op: '%', x }; } return x; };
  const unary = (): Node => (isOp('-') || isOp('+') ? { k: 'un', op: take().v as '-' | '+', x: unary() } : postfix());
  const power = (): Node => { let l = unary(); while (isOp('^')) { take(); l = { k: 'bin', op: '^', l, r: unary() }; } return l; };
  const term = (): Node => { let l = power(); while (isOp('*') || isOp('/')) { const op = take().v; l = { k: 'bin', op, l, r: power() }; } return l; };
  const additive = (): Node => { let l = term(); while (isOp('+') || isOp('-')) { const op = take().v; l = { k: 'bin', op, l, r: term() }; } return l; };
  const concat = (): Node => { let l = additive(); while (isOp('&')) { take(); l = { k: 'bin', op: '&', l, r: additive() }; } return l; };
  const comparison = (): Node => {
    let l = concat();
    while (['=', '<>', '<', '>', '<=', '>='].some(isOp)) { const op = take().v; l = { k: 'bin', op, l, r: concat() }; }
    return l;
  };
  try {
    const n = comparison();
    if (peek().t !== 'end') return { k: 'err', e: '#ERROR!' };
    return n;
  } catch {
    return { k: 'err', e: '#ERROR!' };
  }
}

// ------------------------------------------------------------------ evaluation

const toNum = (v: Value): number | CellError => {
  if (isError(v)) return v;
  if (v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const l = literal(v);
  return typeof l === 'number' ? l : err('#VALUE!');
};
const toStr = (v: Value): string | CellError => {
  if (isError(v)) return v;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return fmtGeneral(v);
  return v;
};
const toBool = (v: Value): boolean | CellError => {
  if (isError(v)) return v;
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return err('#VALUE!');
};

/** Excel's COUNTIF criteria: ">5", "<>Disabled", "=x", "Nurs*" or a plain value. */
function criteria(c: Value): (v: Value) => boolean {
  if (typeof c === 'number' || typeof c === 'boolean') return (v) => v === c || (typeof v === 'string' && literal(v) === c);
  const s = String(c ?? '');
  const m = /^(<>|<=|>=|=|<|>)?(.*)$/s.exec(s)!;
  const op = m[1] ?? '=';
  const rhs = m[2]!;
  const rn = literal(rhs);
  if (typeof rn === 'number' && rhs.trim() !== '') {
    return (v) => {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? literal(v) : null;
      if (typeof n !== 'number') return op === '<>';
      return op === '=' ? n === rn : op === '<>' ? n !== rn : op === '<' ? n < (rn as number) : op === '>' ? n > (rn as number) : op === '<=' ? n <= (rn as number) : n >= (rn as number);
    };
  }
  const pattern = new RegExp(`^${rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*')}$`, 'i');
  const eq = (v: Value): boolean => (rhs === '' ? v === null || v === '' : pattern.test(String(toStr(v))));
  if (op === '<>') return (v) => !eq(v);
  if (op === '=') return eq;
  return (v) => {
    const a = String(toStr(v)).toLowerCase();
    const b = rhs.toLowerCase();
    return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
  };
}

export interface Evaluator {
  /** The value of a cell (formulas evaluated). */
  get(a: string | Addr): Value;
}

export function evaluator(cells: Record<string, string>, opts: { now?: Date } = {}): Evaluator {
  const memo = new Map<string, Value>();
  const busy = new Set<string>();
  const now = opts.now ?? new Date();

  const cell = (a: Addr): Value => {
    const key = addrName(a);
    if (memo.has(key)) return memo.get(key)!;
    if (busy.has(key)) return err('#CIRC!');
    const raw = cells[key] ?? '';
    let v: Value;
    if (raw.startsWith('=') && raw.length > 1) {
      busy.add(key);
      try { v = evalNode(parseFormula(raw.slice(1))); } finally { busy.delete(key); }
      if (Array.isArray(v)) v = (v as Value[])[0] ?? null;
    } else v = literal(raw);
    memo.set(key, v);
    return v;
  };

  /** A function argument as a flat list: ranges expand, scalars stay single. */
  const list = (n: Node): Value[] => (n.k === 'range' ? expandRange(n.from, n.to).map(cell) : [evalNode(n)]);
  const nums = (args: Node[]): number[] | CellError => {
    const out: number[] = [];
    for (const a of args) {
      for (const v of list(a)) {
        if (isError(v)) return v;
        if (typeof v === 'number') out.push(v);
        // Typed directly into a function, text and booleans count; in a range they are skipped (Excel's rule).
        else if (a.k !== 'range' && v !== null) { const n = toNum(v); if (isError(n)) return n; out.push(n); }
      }
    }
    return out;
  };
  const one = (n: Node | undefined): Value => (n ? evalNode(n) : null);

  function evalFn(name: string, a: Node[]): Value {
    switch (name) {
      case 'SUM': { const n = nums(a); return isError(n) ? n : n.reduce((s, x) => s + x, 0); }
      case 'AVERAGE': { const n = nums(a); return isError(n) ? n : n.length ? n.reduce((s, x) => s + x, 0) / n.length : err('#DIV/0!'); }
      case 'MIN': { const n = nums(a); return isError(n) ? n : n.length ? Math.min(...n) : 0; }
      case 'MAX': { const n = nums(a); return isError(n) ? n : n.length ? Math.max(...n) : 0; }
      case 'COUNT': return a.flatMap(list).filter((v) => typeof v === 'number').length;
      case 'COUNTA': return a.flatMap(list).filter((v) => v !== null && v !== '').length;
      case 'COUNTBLANK': return a.flatMap(list).filter((v) => v === null || v === '').length;
      case 'COUNTIF': { if (a.length !== 2) return err('#VALUE!'); const test = criteria(one(a[1])); return list(a[0]!).filter(test).length; }
      case 'SUMIF': {
        if (a.length < 2) return err('#VALUE!');
        const test = criteria(one(a[1]));
        const keys = list(a[0]!);
        const vals = a[2] ? list(a[2]) : keys;
        return keys.reduce<number>((s, k, i) => (test(k) && typeof vals[i] === 'number' ? s + (vals[i] as number) : s), 0);
      }
      case 'IF': { const c = toBool(one(a[0])); if (isError(c)) return c; return c ? (a[1] ? one(a[1]) : true) : (a[2] ? one(a[2]) : false); }
      case 'IFERROR': { const v = one(a[0]); return isError(v) ? one(a[1]) : v; }
      case 'ISBLANK': { const v = one(a[0]); return v === null || v === ''; }
      case 'ISNUMBER': return typeof one(a[0]) === 'number';
      case 'ISERROR': return isError(one(a[0]));
      case 'AND': case 'OR': {
        const bs = a.flatMap(list).filter((v) => v !== null).map(toBool);
        const e = bs.find(isError);
        if (e) return e;
        return name === 'AND' ? bs.every(Boolean) : bs.some(Boolean);
      }
      case 'NOT': { const b = toBool(one(a[0])); return isError(b) ? b : !b; }
      case 'ROUND': case 'ROUNDUP': case 'ROUNDDOWN': {
        const x = toNum(one(a[0])); const d = a[1] ? toNum(one(a[1])) : 0;
        if (isError(x)) return x; if (isError(d)) return d;
        const f = 10 ** d;
        const fn = name === 'ROUND' ? Math.round : name === 'ROUNDUP' ? (y: number) => Math.sign(y) * Math.ceil(Math.abs(y)) : (y: number) => Math.sign(y) * Math.floor(Math.abs(y));
        return fn(x * f) / f;
      }
      case 'ABS': { const x = toNum(one(a[0])); return isError(x) ? x : Math.abs(x); }
      case 'LEN': { const s = toStr(one(a[0])); return isError(s) ? s : s.length; }
      case 'UPPER': case 'LOWER': case 'TRIM': case 'PROPER': {
        const s = toStr(one(a[0]));
        if (isError(s)) return s;
        return name === 'UPPER' ? s.toUpperCase() : name === 'LOWER' ? s.toLowerCase() : name === 'TRIM' ? s.trim().replace(/\s+/g, ' ') : s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
      }
      case 'LEFT': case 'RIGHT': {
        const s = toStr(one(a[0])); const n = a[1] ? toNum(one(a[1])) : 1;
        if (isError(s)) return s; if (isError(n)) return n;
        return name === 'LEFT' ? s.slice(0, n) : n ? s.slice(-n) : '';
      }
      case 'MID': {
        const s = toStr(one(a[0])); const st = toNum(one(a[1])); const n = toNum(one(a[2]));
        if (isError(s)) return s; if (isError(st)) return st; if (isError(n)) return n;
        return st < 1 ? err('#VALUE!') : s.substr(st - 1, n);
      }
      case 'CONCAT': case 'CONCATENATE': {
        let out = '';
        for (const v of a.flatMap(list)) { const s = toStr(v); if (isError(s)) return s; out += s; }
        return out;
      }
      case 'TEXTJOIN': {
        const sep = toStr(one(a[0])); const skip = toBool(one(a[1]));
        if (isError(sep)) return sep; if (isError(skip)) return skip;
        const parts: string[] = [];
        for (const v of a.slice(2).flatMap(list)) { const s = toStr(v); if (isError(s)) return s; if (!skip || s !== '') parts.push(s); }
        return parts.join(sep);
      }
      case 'VLOOKUP': {
        const look = one(a[0]);
        const r = a[1];
        const col = toNum(one(a[2]));
        const approx = a[3] ? toBool(one(a[3])) : true;
        if (!r || r.k !== 'range') return err('#REF!');
        if (isError(col)) return col;
        if (isError(approx)) return approx;
        const top = Math.min(r.from.row, r.to.row), bottom = Math.max(r.from.row, r.to.row), left = Math.min(r.from.col, r.to.col);
        if (col < 1 || left + col - 1 > Math.max(r.from.col, r.to.col)) return err('#REF!');
        const ls = String(toStr(look)).toLowerCase();
        for (let row = top; row <= bottom; row++) {
          const k = cell({ col: left, row });
          if (k === look || String(toStr(k)).toLowerCase() === ls) return cell({ col: left + col - 1, row });
        }
        return err('#N/A');
      }
      case 'TODAY': return Math.floor(serial(now));
      case 'NOW': return serial(now);
      case 'UNIQUE': case 'FILTER': return err('#NAME?');
      default: return err('#NAME?');
    }
  }

  function evalNode(n: Node): Value {
    switch (n.k) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'bool': return n.v;
      case 'err': return err(n.e);
      case 'ref': return cell(n.a);
      case 'range': return cell(n.from); // a bare range in a scalar position: its first cell
      case 'fn': return evalFn(n.name, n.args);
      case 'un': {
        const x = toNum(evalNode(n.x));
        if (isError(x)) return x;
        return n.op === '-' ? -x : n.op === '%' ? x / 100 : x;
      }
      case 'bin': {
        const l = evalNode(n.l);
        const r = evalNode(n.r);
        if (isError(l)) return l;
        if (isError(r)) return r;
        if (n.op === '&') return `${toStr(l) as string}${toStr(r) as string}`;
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
          const bothNum = (typeof l === 'number' || l === null) && (typeof r === 'number' || r === null);
          const a: string | number = bothNum ? (l ?? 0) as number : String(toStr(l)).toLowerCase();
          const b: string | number = bothNum ? (r ?? 0) as number : String(toStr(r)).toLowerCase();
          return n.op === '=' ? a === b : n.op === '<>' ? a !== b : n.op === '<' ? a < b : n.op === '>' ? a > b : n.op === '<=' ? a <= b : a >= b;
        }
        const x = toNum(l), y = toNum(r);
        if (isError(x)) return x;
        if (isError(y)) return y;
        if (n.op === '/' && y === 0) return err('#DIV/0!');
        const out = n.op === '+' ? x + y : n.op === '-' ? x - y : n.op === '*' ? x * y : n.op === '/' ? x / y : x ** y;
        return Number.isFinite(out) ? out : err('#NUM!');
      }
    }
  }

  return { get: (a) => { const ad = typeof a === 'string' ? parseAddr(a) : a; return ad ? cell(ad) : err('#REF!'); } };
}

/** Excel date serial (days since 1899-12-30). */
export function serial(d: Date): number {
  return (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000 - d.getTimezoneOffset() / 1440;
}

// ------------------------------------------------------------------ display

export type NumFmt = 'general' | 'number' | 'currency' | 'percent' | 'date' | 'text';

export function fmtGeneral(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = Number(n.toPrecision(11)).toString();
  return s.includes('e') ? n.toExponential(5).toUpperCase() : s;
}

export function formatValue(v: Value, fmt: NumFmt = 'general', decimals = 2): string {
  if (isError(v)) return v.error;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  switch (fmt) {
    case 'number': return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    case 'currency': return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
    case 'percent': return `${(v * 100).toFixed(decimals)}%`;
    case 'date': {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
    }
    default: return fmtGeneral(v);
  }
}

/** Move a formula's relative references when it is copied (A1 -> B2 for +1,+1). $ anchors stay. */
export function shiftFormula(raw: string, dCol: number, dRow: number): string {
  if (!raw.startsWith('=')) return raw;
  let out = '';
  let inStr = false;
  const src = raw;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr) { out += ch; continue; }
    const m = /^(\$?)([A-Za-z]{1,2})(\$?)(\d{1,5})(?![A-Za-z0-9_(])/.exec(src.slice(i));
    const prev = src[i - 1] ?? '';
    if (m && !/[A-Za-z0-9_.$]/.test(prev)) {
      const c = m[1] ? colIndex(m[2]!) : colIndex(m[2]!) + dCol;
      const r = m[3] ? Number(m[4]) - 1 : Number(m[4]) - 1 + dRow;
      out += c < 0 || r < 0 ? '#REF!' : `${m[1]}${colName(c)}${m[3]}${r + 1}`;
      i += m[0].length - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

// ------------------------------------------------------------------ CSV

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
      continue;
    }
    if (ch === '"' && cur === '') { q = true; continue; }
    if (ch === ',') { row.push(cur); cur = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\r\n]/.test(c) || /^\s|\s$/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';
}
