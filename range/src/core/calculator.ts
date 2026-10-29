/**
 * core/calculator.ts — the Windows Calculator (Standard mode) engine.
 *
 * Pure: a state and a key give the next state, so the app window only draws
 * it. Behaviour follows the real Calculator: operations run left to right
 * (2 + 3 × 4 = 20), "=" repeats the last operation, percent depends on the
 * pending operator (200 + 10% is 20), unary keys show as sqr(x), √(x), 1/(x)
 * in the expression line, and errors ("Cannot divide by zero", "Invalid
 * input") lock the keypad until a digit, C or CE.
 */

export type CalcOp = '+' | '−' | '×' | '÷';
export type CalcKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.'
  | CalcOp | '=' | '%' | '√' | 'x²' | '1/x' | '±' | '⌫' | 'CE' | 'C'
  | 'MC' | 'MR' | 'M+' | 'M-' | 'MS';

export interface CalcState {
  /** What is being typed, without separators ("12.5", "-3"). */
  entry: string;
  /** The left operand waiting for the pending operator. */
  acc: number | null;
  op: CalcOp | null;
  /** The next digit starts a new number. */
  fresh: boolean;
  /** The entry is a value to use (a result, MR, a unary or % result) even though typing would replace it. */
  provided: boolean;
  /** Last "=" operation, repeated by pressing "=" again. */
  last: { op: CalcOp; operand: number } | null;
  /** The small line above the display. */
  expression: string;
  justEvaluated: boolean;
  error: string | null;
  memory: number | null;
  /** Newest first. */
  history: { expression: string; result: string }[];
}

const MAX_DIGITS = 16;

export function calcInit(keep?: Pick<CalcState, 'memory' | 'history'>): CalcState {
  return { entry: '0', acc: null, op: null, fresh: true, provided: false, last: null, expression: '', justEvaluated: false, error: null, memory: keep?.memory ?? null, history: keep?.history ?? [] };
}

/** A number as Calculator shows it: up to 16 significant digits, no floating-point noise. */
export function fmtNum(n: number): string {
  if (Object.is(n, -0)) n = 0;
  const clean = Number.parseFloat(n.toPrecision(15));
  const abs = Math.abs(clean);
  if (abs !== 0 && (abs >= 1e16 || abs < 1e-15)) return clean.toExponential();
  return String(clean);
}

const num = (s: string): number => Number.parseFloat(s) || 0;

function group(raw: string): string {
  if (/e/i.test(raw)) return raw;
  const neg = raw.startsWith('-');
  const [int, frac] = (neg ? raw.slice(1) : raw).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}

export function displayText(s: CalcState): string {
  return s.error ?? group(s.entry);
}

function fail(s: CalcState, message: string): CalcState {
  return { ...s, error: message, fresh: true, provided: false };
}

function apply(a: number, op: CalcOp, b: number): number | string {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? (a === 0 ? 'Result is undefined' : 'Cannot divide by zero') : a / b;
  }
}

function result(s: CalcState, value: number | string, expression: string): CalcState {
  if (typeof value === 'string') return fail({ ...s, expression }, value);
  if (!Number.isFinite(value)) return fail({ ...s, expression }, 'Overflow');
  return { ...s, entry: fmtNum(value), expression };
}

export function press(state: CalcState, key: CalcKey): CalcState {
  let s = state;
  if (s.error) {
    if (!/^[0-9.]$/.test(key) && key !== 'C' && key !== 'CE') return s;
    s = calcInit(s);
    if (key === 'C' || key === 'CE') return s;
  }
  switch (key) {
    case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9': {
      if (s.fresh) {
        const reset = s.justEvaluated && !s.op ? { acc: null, expression: '', last: null } : {};
        return { ...s, ...reset, entry: key, fresh: false, provided: false, justEvaluated: false };
      }
      if (s.entry.replace(/[-.]/g, '').length >= MAX_DIGITS) return s;
      return { ...s, entry: s.entry === '0' ? key : s.entry === '-0' ? `-${key}` : s.entry + key };
    }
    case '.': {
      if (s.fresh) {
        const reset = s.justEvaluated && !s.op ? { acc: null, expression: '', last: null } : {};
        return { ...s, ...reset, entry: '0.', fresh: false, provided: false, justEvaluated: false };
      }
      return s.entry.includes('.') ? s : { ...s, entry: `${s.entry}.` };
    }
    case '+': case '−': case '×': case '÷': {
      const x = num(s.entry);
      const typed = !s.fresh || s.provided;
      if (s.acc !== null && s.op && typed && !s.justEvaluated) {
        const v = apply(s.acc, s.op, x);
        if (typeof v === 'string') return fail({ ...s, expression: `${fmtNum(s.acc)} ${s.op} ${fmtNum(x)}` }, v);
        return { ...s, acc: v, entry: fmtNum(v), op: key, fresh: true, provided: false, justEvaluated: false, expression: `${fmtNum(v)} ${key}` };
      }
      const acc = s.acc !== null && s.op && !typed ? s.acc : x;
      return { ...s, acc, op: key, fresh: true, provided: false, justEvaluated: false, expression: `${fmtNum(acc)} ${key}` };
    }
    case '=': {
      if (s.op && s.acc !== null) {
        const operand = !s.fresh || s.provided ? num(s.entry) : s.acc;
        const expr = `${fmtNum(s.acc)} ${s.op} ${fmtNum(operand)} =`;
        const out = result(s, apply(s.acc, s.op, operand), expr);
        if (out.error) return out;
        return { ...out, acc: num(out.entry), op: null, last: { op: s.op, operand }, fresh: true, provided: false, justEvaluated: true, history: [{ expression: expr, result: out.entry }, ...s.history].slice(0, 50) };
      }
      if (s.last) {
        const x = num(s.entry);
        const expr = `${fmtNum(x)} ${s.last.op} ${fmtNum(s.last.operand)} =`;
        const out = result(s, apply(x, s.last.op, s.last.operand), expr);
        if (out.error) return out;
        return { ...out, acc: num(out.entry), fresh: true, provided: false, justEvaluated: true, history: [{ expression: expr, result: out.entry }, ...s.history].slice(0, 50) };
      }
      return { ...s, expression: `${fmtNum(num(s.entry))} =`, fresh: true, provided: false, justEvaluated: true };
    }
    case '%': {
      const x = num(s.entry);
      const v = s.op && s.acc !== null ? (s.op === '+' || s.op === '−' ? (s.acc * x) / 100 : x / 100) : 0;
      return { ...s, entry: fmtNum(v), fresh: true, provided: true, expression: s.op && s.acc !== null ? `${fmtNum(s.acc)} ${s.op} ${fmtNum(v)}` : fmtNum(v) };
    }
    case '√': case 'x²': case '1/x': {
      const x = num(s.entry);
      const lead = s.op && s.acc !== null && !s.justEvaluated ? `${fmtNum(s.acc)} ${s.op} ` : '';
      const label = key === '√' ? `√(${fmtNum(x)})` : key === 'x²' ? `sqr(${fmtNum(x)})` : `1/(${fmtNum(x)})`;
      const v = key === '√' ? (x < 0 ? 'Invalid input' : Math.sqrt(x)) : key === 'x²' ? x * x : x === 0 ? 'Cannot divide by zero' : 1 / x;
      const out = result(s, v, lead + label);
      return out.error ? out : { ...out, fresh: true, provided: true, justEvaluated: false };
    }
    case '±': {
      if (s.entry === '0') return s;
      const entry = s.entry.startsWith('-') ? s.entry.slice(1) : `-${s.entry}`;
      return { ...s, entry, provided: s.fresh ? true : s.provided, justEvaluated: false };
    }
    case '⌫': {
      if (s.justEvaluated) return { ...s, expression: '' };
      if (s.fresh) return s;
      const next = s.entry.slice(0, -1);
      return { ...s, entry: next === '' || next === '-' ? '0' : next };
    }
    case 'CE':
      return { ...s, entry: '0', fresh: true, provided: false, expression: s.justEvaluated ? '' : s.expression, justEvaluated: false };
    case 'C':
      return calcInit(s);
    case 'MS': return { ...s, memory: num(s.entry), fresh: true, provided: true };
    case 'M+': return { ...s, memory: (s.memory ?? 0) + num(s.entry), fresh: true, provided: true };
    case 'M-': return { ...s, memory: (s.memory ?? 0) - num(s.entry), fresh: true, provided: true };
    case 'MR': return s.memory === null ? s : { ...s, entry: fmtNum(s.memory), fresh: true, provided: true, justEvaluated: false };
    case 'MC': return { ...s, memory: null };
  }
}
