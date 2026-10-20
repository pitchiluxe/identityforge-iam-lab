/**
 * terminal/parser.ts — a small PowerShell parser.
 *
 * Enough of the language for the scripts an IAM engineer actually writes:
 * pipelines, variables, -Param value, -Switch:$false, arrays, hashtables,
 * script blocks, ( ) / $( ) / @( ), member access and a few string methods,
 * comparisons, foreach and if. Not a full PowerShell, and it says so when it
 * meets something it does not understand.
 */

export type Tok =
  | { t: 'word'; v: string; sp: boolean }
  | { t: 'str'; v: string; dq: boolean; sp: boolean }
  | { t: 'num'; v: number; sp: boolean }
  | { t: 'var'; v: string; sp: boolean }
  | { t: 'param'; v: string; colon: boolean; sp: boolean }
  | { t: 'op'; v: string; sp: boolean }
  | { t: 'type'; v: string; sp: boolean };

export class ParseError extends Error {}

const WORD_CHAR = /[A-Za-z0-9_\-.\\/:*?~+%#@]/;

export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let sp: boolean = true;
  const push = (tok: Tok): void => { out.push(tok); sp = false; };
  while (i < src.length) {
    const c = src[i]!;
    if (c === '`' && (src[i + 1] === '\n' || src[i + 1] === '\r')) { i += src[i + 1] === '\r' ? 3 : 2; sp = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; sp = true; continue; }
    if (c === '\n') { push({ t: 'op', v: 'nl', sp }); i++; sp = true; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === "'") {
      let s = '';
      i++;
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") { s += "'"; i += 2; continue; }
        if (src[i] === "'") break;
        s += src[i++];
      }
      if (i >= src.length) throw new ParseError("The string is missing the terminator: '.");
      i++;
      push({ t: 'str', v: s, dq: false, sp });
      continue;
    }
    if (c === '"') {
      let s = '';
      i++;
      let depth = 0;
      while (i < src.length) {
        const ch = src[i]!;
        if (ch === '`' && i + 1 < src.length) { s += ch + src[i + 1]; i += 2; continue; }
        if (ch === '$' && src[i + 1] === '(') { depth++; s += '$('; i += 2; continue; }
        if (depth > 0 && ch === '(') { depth++; s += ch; i++; continue; }
        if (depth > 0 && ch === ')') { depth--; s += ch; i++; continue; }
        if (ch === '"' && depth === 0) break;
        s += ch;
        i++;
      }
      if (i >= src.length) throw new ParseError('The string is missing the terminator: ".');
      i++;
      push({ t: 'str', v: s, dq: true, sp });
      continue;
    }
    if (c === '$') {
      if (src[i + 1] === '(') { push({ t: 'op', v: '$(', sp }); i += 2; continue; }
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_:?]/.test(src[j]!)) j++;
      const name = src.slice(i + 1, j);
      if (!name) throw new ParseError("Variable reference is not valid. '$' was not followed by a valid variable name character.");
      push({ t: 'var', v: name, sp });
      i = j;
      continue;
    }
    if (c === '@' && (src[i + 1] === '(' || src[i + 1] === '{')) { push({ t: 'op', v: '@' + src[i + 1], sp }); i += 2; continue; }
    if (c === '[' && sp && /[A-Za-z]/.test(src[i + 1] ?? '')) {
      const close = src.indexOf(']', i);
      const inner = close > 0 ? src.slice(i + 1, close) : '';
      if (close > 0 && /^[A-Za-z.]+$/.test(inner)) { push({ t: 'type', v: inner.toLowerCase(), sp }); i = close + 1; continue; }
    }
    if (c === ':' && src[i + 1] === ':') { push({ t: 'op', v: '::', sp }); i += 2; continue; }
    if ('|;,=(){}[]&!'.includes(c)) {
      if (c === '=' && src[i + 1] === '=') throw new ParseError("Use -eq to compare in PowerShell, not '=='.");
      push({ t: 'op', v: c, sp });
      i++;
      continue;
    }
    if (c === '-' && sp && /[A-Za-z]/.test(src[i + 1] ?? '')) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const name = src.slice(i + 1, j);
      const colon = src[j] === ':';
      push({ t: 'param', v: name, colon, sp });
      i = colon ? j + 1 : j;
      continue;
    }
    if (c === '.' && src[i + 1] && /[A-Za-z]/.test(src[i + 1]!) && !sp && out.length) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      push({ t: 'op', v: '.', sp: false });
      push({ t: 'word', v: src.slice(i + 1, j), sp: false });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      if ((j < src.length && WORD_CHAR.test(src[j]!) && !/[.]/.test(src[j]!)) || (src.slice(i, j).match(/\./g)?.length ?? 0) > 1) {
        while (j < src.length && WORD_CHAR.test(src[j]!)) j++;
        push({ t: 'word', v: src.slice(i, j), sp });
      } else {
        const text = src.slice(i, j);
        const mult = /^(kb|mb|gb)/i.exec(src.slice(j, j + 2));
        push({ t: 'num', v: Number(text) * (mult ? { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[mult[1]!.toLowerCase() as 'kb'] : 1), sp });
        if (mult) j += 2;
      }
      i = j;
      continue;
    }
    if (WORD_CHAR.test(c)) {
      let j = i;
      while (j < src.length && WORD_CHAR.test(src[j]!)) j++;
      push({ t: 'word', v: src.slice(i, j), sp });
      i = j;
      continue;
    }
    throw new ParseError(`Unexpected character '${c}'.`);
  }
  return out;
}

// ------------------------------------------------------------------- AST

export type Expr =
  | { k: 'lit'; v: unknown }
  | { k: 'str'; raw: string; dq: boolean }
  | { k: 'word'; v: string }
  | { k: 'var'; name: string }
  | { k: 'member'; obj: Expr; name: string; args: Expr[] | null }
  | { k: 'index'; obj: Expr; idx: Expr }
  | { k: 'sub'; body: Stmt[] }
  | { k: 'array'; items: Expr[] }
  | { k: 'hash'; entries: [string, Expr][] }
  | { k: 'block'; body: Stmt[]; text: string }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'cast'; type: string; e: Expr }
  | { k: 'static'; type: string; name: string; args: Expr[] | null };

export type Arg = { k: 'named'; name: string; value: Expr | null; colon: boolean } | { k: 'pos'; value: Expr };

export type Cmd = { k: 'call'; name: string; args: Arg[] } | { k: 'expr'; e: Expr };

export type Stmt =
  | { k: 'pipe'; cmds: Cmd[] }
  | { k: 'assign'; name: string; value: Stmt }
  | { k: 'foreach'; name: string; list: Stmt; body: Stmt[] }
  | { k: 'if'; cond: Expr; then: Stmt[]; else: Stmt[] | null }
  | { k: 'function'; name: string; params: Param[]; body: Stmt[] }
  | { k: 'param'; params: Param[] }
  | { k: 'while'; cond: Expr; body: Stmt[] }
  | { k: 'try'; body: Stmt[]; catchBody: Stmt[] | null; finallyBody: Stmt[] | null }
  | { k: 'throw'; value: Expr | null }
  | { k: 'return'; value: Stmt | null }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'opassign'; name: string; op: '+' | '-'; value: Stmt }
  | { k: 'incr'; name: string; delta: number };

export interface Param {
  name: string;
  def: Expr | null;
}

const COMPARE = new Set(['f', 'eq', 'ne', 'gt', 'ge', 'lt', 'le', 'like', 'notlike', 'match', 'notmatch', 'contains', 'notcontains', 'in', 'notin', 'ceq', 'cne']);

function makeParser(src: string): { program: () => Stmt[]; expr: () => Expr } {
  const toks = lex(src);
  let p = 0;
  const peek = (o = 0): Tok | undefined => toks[p + o];
  const isOp = (v: string, o = 0): boolean => { const t = peek(o); return !!t && t.t === 'op' && t.v === v; };
  const eat = (v: string): void => {
    if (!isOp(v)) throw new ParseError(`Missing '${v}'${peek() ? ` near '${describe(peek()!)}'` : ' at end of input'}.`);
    p++;
  };
  const skipNl = (): void => { while (isOp('nl') || isOp(';')) p++; };
  const atEnd = (): boolean => {
    const t = peek();
    return !t || (t.t === 'op' && ['|', ';', 'nl', ')', '}'].includes(t.v));
  };

  function statements(stop: string | null): Stmt[] {
    const list: Stmt[] = [];
    skipNl();
    while (peek() && !(stop && isOp(stop))) {
      list.push(statement());
      if (peek() && !(stop && isOp(stop))) {
        if (!isOp('nl') && !isOp(';')) throw new ParseError(`Unexpected token '${describe(peek()!)}'.`);
      }
      skipNl();
    }
    return list;
  }

  function block(): Stmt[] {
    skipNlOnly();
    eat('{');
    const body = statements('}');
    eat('}');
    return body;
  }

  function skipNlOnly(): void { while (isOp('nl')) p++; }

  function statement(): Stmt {
    const t = peek()!;
    if (t.t === 'word' && t.v.toLowerCase() === 'foreach' && isOp('(', 1)) {
      p += 2;
      const v = peek();
      if (!v || v.t !== 'var') throw new ParseError('foreach needs a variable: foreach ($item in $list) { ... }');
      p++;
      const kw = peek();
      if (!kw || kw.t !== 'word' || kw.v.toLowerCase() !== 'in') throw new ParseError("foreach needs 'in': foreach ($item in $list) { ... }");
      p++;
      const list = pipeline();
      eat(')');
      return { k: 'foreach', name: v.v, list, body: block() };
    }
    const kw = t.t === 'word' ? t.v.toLowerCase() : '';
    if (kw === 'if' && isOp('(', 1)) { p++; return ifRest(); }
    if (kw === 'while' && isOp('(', 1)) {
      p += 2;
      const cond = expression();
      eat(')');
      return { k: 'while', cond, body: block() };
    }
    if (kw === 'function' || kw === 'filter') {
      p++;
      const n = peek();
      if (!n || n.t !== 'word') throw new ParseError('Missing function name.');
      p++;
      let params: Param[] = [];
      if (isOp('(')) { p++; params = paramList(); }
      skipNlOnly();
      eat('{');
      skipNl();
      const first = peek();
      if (first && first.t === 'word' && first.v.toLowerCase() === 'param' && isOp('(', 1)) { p += 2; params = paramList(); }
      const body = statements('}');
      eat('}');
      return { k: 'function', name: n.v, params, body };
    }
    if (kw === 'param' && isOp('(', 1)) { p += 2; return { k: 'param', params: paramList() }; }
    if (kw === 'try' && (isOp('{', 1) || isOp('nl', 1))) {
      p++;
      const body = block();
      let catchBody: Stmt[] | null = null;
      let finallyBody: Stmt[] | null = null;
      for (;;) {
        const save = p;
        skipNlOnly();
        const c = peek();
        if (c && c.t === 'word' && c.v.toLowerCase() === 'catch') {
          p++;
          while (peek() && peek()!.t === 'type') p++;
          catchBody = block();
          continue;
        }
        if (c && c.t === 'word' && c.v.toLowerCase() === 'finally') { p++; finallyBody = block(); continue; }
        p = save;
        break;
      }
      if (!catchBody && !finallyBody) throw new ParseError('The Try statement is missing its Catch or Finally block.');
      return { k: 'try', body, catchBody, finallyBody };
    }
    if (kw === 'throw') { p++; return { k: 'throw', value: atEnd() ? null : expression() }; }
    if (kw === 'return') { p++; return { k: 'return', value: atEnd() ? null : pipeline() }; }
    if (kw === 'break') { p++; return { k: 'break' }; }
    if (kw === 'continue') { p++; return { k: 'continue' }; }
    if (t.t === 'var' && isOp('=', 1)) {
      p += 2;
      return { k: 'assign', name: t.v, value: pipeline() };
    }
    const nx = peek(1);
    if (t.t === 'var' && nx && nx.t === 'word' && (nx.v === '+' || nx.v === '-') && isOp('=', 2)) {
      p += 3;
      return { k: 'opassign', name: t.v, op: nx.v as '+' | '-', value: pipeline() };
    }
    if (t.t === 'var' && nx && nx.t === 'word' && (nx.v === '++' || nx.v === '--') && !nx.sp) {
      p += 2;
      return { k: 'incr', name: t.v, delta: nx.v === '++' ? 1 : -1 };
    }
    return pipeline();
  }

  function ifRest(): Stmt {
    eat('(');
    skipNlOnly();
    const cond = expression();
    skipNlOnly();
    eat(')');
    const then = block();
    let els: Stmt[] | null = null;
    const save = p;
    skipNlOnly();
    const e = peek();
    if (e && e.t === 'word' && e.v.toLowerCase() === 'elseif') { p++; els = [ifRest()]; }
    else if (e && e.t === 'word' && e.v.toLowerCase() === 'else') { p++; els = block(); }
    else p = save;
    return { k: 'if', cond, then, else: els };
  }

  function paramList(): Param[] {
    const list: Param[] = [];
    skipNl();
    while (!isOp(')')) {
      if (!peek()) throw new ParseError("Missing ')' in parameter list.");
      if (isOp('[')) {
        let depth = 0;
        do { if (isOp('[')) depth++; if (isOp(']')) depth--; p++; } while (depth > 0 && peek());
        skipNl();
        continue;
      }
      const t = peek()!;
      if (t.t === 'type') { p++; continue; }
      if (t.t !== 'var') throw new ParseError(`Unexpected token '${describe(t)}' in parameter list.`);
      p++;
      let def: Expr | null = null;
      if (isOp('=')) { p++; def = expression(); }
      list.push({ name: t.v, def });
      skipNl();
      if (isOp(',')) { p++; skipNl(); }
    }
    p++;
    return list;
  }

  function pipeline(): Stmt {
    const cmds: Cmd[] = [command()];
    while (isOp('|')) {
      p++;
      skipNlOnly();
      cmds.push(command());
    }
    return { k: 'pipe', cmds };
  }

  function command(): Cmd {
    const t = peek();
    if (!t) throw new ParseError('An empty pipe element is not allowed.');
    if (t.t === 'op' && t.v === '&') {
      p++;
      const n = peek();
      if (!n || (n.t !== 'str' && n.t !== 'word')) throw new ParseError("The '&' operator needs a command or script path.");
      p++;
      return { k: 'call', name: n.v, args: args() };
    }
    if (t.t === 'word' && !/^[0-9]/.test(t.v)) {
      p++;
      return { k: 'call', name: t.v, args: args() };
    }
    return { k: 'expr', e: expression() };
  }

  function args(): Arg[] {
    const list: Arg[] = [];
    while (!atEnd()) {
      const t = peek()!;
      if (t.t === 'param') {
        p++;
        if (t.colon) { list.push({ k: 'named', name: t.v, value: argValue(), colon: true }); continue; }
        if (!atEnd() && peek()!.t !== 'param') list.push({ k: 'named', name: t.v, value: argValue(), colon: false });
        else list.push({ k: 'named', name: t.v, value: null, colon: false });
        continue;
      }
      list.push({ k: 'pos', value: argValue() });
    }
    return list;
  }

  function argValue(): Expr {
    const first = postfix(primary(true));
    if (!isOp(',')) return first;
    const items = [first];
    while (isOp(',')) { p++; items.push(postfix(primary(true))); }
    return { k: 'array', items };
  }

  function expression(): Expr {
    let left = comparison();
    for (;;) {
      const t = peek();
      if (t && t.t === 'param' && ['and', 'or'].includes(t.v.toLowerCase())) {
        p++;
        skipNlOnly();
        left = { k: 'bin', op: t.v.toLowerCase(), l: left, r: comparison() };
      } else return left;
    }
  }

  function comparison(): Expr {
    const left = additive();
    const t = peek();
    if (t && t.t === 'param' && COMPARE.has(t.v.toLowerCase())) {
      p++;
      return { k: 'bin', op: t.v.toLowerCase(), l: left, r: additive() };
    }
    return left;
  }

  function additive(): Expr {
    let left = unary();
    while (peek() && peek()!.t === 'word' && ['+', '-'].includes((peek() as { v: string }).v)) {
      const op = (peek() as { v: string }).v;
      p++;
      left = { k: 'bin', op, l: left, r: unary() };
    }
    return left;
  }

  function unary(): Expr {
    const t = peek();
    if (t && t.t === 'op' && t.v === '!') { p++; return { k: 'not', e: unary() }; }
    if (t && t.t === 'param' && t.v.toLowerCase() === 'not') { p++; return { k: 'not', e: unary() }; }
    const first = postfix(primary(false));
    if (isOp(',')) {
      const items = [first];
      while (isOp(',')) { p++; items.push(postfix(primary(false))); }
      return { k: 'array', items };
    }
    return first;
  }

  function postfix(e: Expr): Expr {
    for (;;) {
      if (isOp('.') ) {
        p++;
        const n = peek();
        if (!n || n.t !== 'word') throw new ParseError('Missing property name after ".".');
        p++;
        let callArgs: Expr[] | null = null;
        if (isOp('(') && !peek()!.sp) {
          p++;
          callArgs = [];
          while (!isOp(')')) {
            callArgs.push(additive());
            if (isOp(',')) p++;
            else if (!isOp(')')) throw new ParseError("Missing ')' in method call.");
          }
          p++;
        }
        e = { k: 'member', obj: e, name: n.v, args: callArgs };
        continue;
      }
      if (isOp('[') && !peek()!.sp) {
        p++;
        const idx = expression();
        eat(']');
        e = { k: 'index', obj: e, idx };
        continue;
      }
      return e;
    }
  }

  function primary(argMode: boolean): Expr {
    const t = peek();
    if (!t) throw new ParseError('Expression expected.');
    p++;
    switch (t.t) {
      case 'str': return { k: 'str', raw: t.v, dq: t.dq };
      case 'num': return { k: 'lit', v: t.v };
      case 'var': return { k: 'var', name: t.v };
      case 'word': return { k: 'word', v: t.v };
      case 'param':
        if (argMode) return { k: 'word', v: `-${t.v}` };
        throw new ParseError(`Unexpected parameter -${t.v}.`);
      case 'type': {
        if (isOp('::')) {
          p++;
          const n = peek();
          if (!n || n.t !== 'word') throw new ParseError("Missing member name after '::'.");
          p++;
          let sargs: Expr[] | null = null;
          if (isOp('(') && !peek()!.sp) {
            p++;
            sargs = [];
            skipNl();
            while (!isOp(')')) {
              sargs.push(additive());
              skipNl();
              if (isOp(',')) { p++; skipNl(); } else if (!isOp(')')) throw new ParseError("Missing ')' in method call.");
            }
            p++;
          }
          return { k: 'static', type: t.v, name: n.v, args: sargs };
        }
        if (atEnd()) return { k: 'word', v: `[${t.v}]` };
        return { k: 'cast', type: t.v, e: postfix(primary(argMode)) };
      }
      case 'op': {
        if (t.v === '(' || t.v === '$(' || t.v === '@(') {
          const body = t.v === '(' ? [statement()] : statements(')');
          skipNlOnly();
          eat(')');
          return t.v === '@(' ? { k: 'array', items: [{ k: 'sub', body }] } : { k: 'sub', body };
        }
        if (t.v === '{') {
          const start = p;
          const body = statements('}');
          const text = toks.slice(start, p).map(describe).join(' ');
          eat('}');
          return { k: 'block', body, text };
        }
        if (t.v === '@{') {
          const entries: [string, Expr][] = [];
          skipNl();
          while (!isOp('}')) {
            const key = peek();
            if (!key || (key.t !== 'word' && key.t !== 'str')) throw new ParseError('Missing key in hash literal.');
            p++;
            eat('=');
            entries.push([key.v, expression()]);
            skipNl();
          }
          eat('}');
          return { k: 'hash', entries };
        }
        throw new ParseError(`Unexpected token '${t.v === 'nl' ? 'newline' : t.v}'.`);
      }
    }
  }

  return {
    program: () => statements(null),
    expr: () => {
      const e = expression();
      if (peek()) throw new ParseError(`Unexpected token '${describe(peek()!)}' in expression.`);
      return e;
    },
  };
}

export function parse(src: string): Stmt[] {
  return makeParser(src).program();
}

/** An expression on its own, as used by -Filter "Department -eq 'Finance'". */
export function parseExpression(src: string): Expr {
  return makeParser(src).expr();
}

function describe(t: Tok): string {
  switch (t.t) {
    case 'str': return t.dq ? `"${t.v}"` : `'${t.v}'`;
    case 'var': return `$${t.v}`;
    case 'param': return `-${t.v}${t.colon ? ':' : ''}`;
    case 'type': return `[${t.v}]`;
    case 'num': return String(t.v);
    case 'op': return t.v === 'nl' ? '\n' : t.v;
    default: return t.v;
  }
}
