/**
 * terminal/shell.ts — evaluates parsed PowerShell against the world.
 *
 * Values are plain JS: strings, numbers, booleans, Date, arrays and objects
 * whose keys are PowerShell property names. AD objects carry a hidden __ref
 * so a piped user can be used as -Identity, as in real PowerShell.
 */
import type { World } from '../core/types.ts';
import { type Arg, type Expr, type Param, type Stmt, parse, parseExpression, ParseError } from './parser.ts';

export interface OutLine {
  text: string;
  kind: 'out' | 'err' | 'warn' | 'host';
  color?: string;
}

export interface ErrorDetail {
  /** The .NET exception Windows PowerShell names in CategoryInfo. */
  exception?: string;
  /** The first part of FullyQualifiedErrorId. */
  errorId?: string;
  /** The target in CategoryInfo, e.g. "taskinfo:String". */
  target?: string;
  /** The command the error belongs to, when it is raised before the cmdlet runs. */
  source?: string;
}

export class PsError extends Error {
  category: string;
  detail: ErrorDetail;
  constructor(message: string, category = 'InvalidOperation', detail: ErrorDetail = {}) {
    super(message);
    this.category = category;
    this.detail = detail;
  }
}

/** A mandatory parameter was not supplied. At the prompt PowerShell asks for it instead. */
export class MissingParamError extends PsError {
  param: string;
  constructor(param: string) {
    super(`Cannot process command because of one or more missing mandatory parameters: ${param}.`, 'InvalidArgument', { exception: 'ParameterBindingException', errorId: 'MissingMandatoryParameter' });
    this.param = param;
  }
}

/** The message PowerShell gives for a name that is not a cmdlet, function, script or program. */
export function commandNotFound(name: string, source?: string): PsError {
  return new PsError(`The term '${name}' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again.`, 'ObjectNotFound', { exception: 'CommandNotFoundException', errorId: 'CommandNotFoundException', target: `${name}:String`, source });
}

/** Control flow: thrown, caught by the construct that owns it. */
export class ReturnSignal { value: unknown[]; constructor(v: unknown[]) { this.value = v; } }
export class BreakSignal {}
export class ContinueSignal {}
export class ExitSignal { code: number; constructor(c: number) { this.code = c; } }

/** A user-defined function or a script with a param() block. */
export interface PsFunction { name: string; params: Param[]; body: Stmt[] }

export class SecureStringValue {
  /** The text, when the range knows it (ConvertTo-SecureString). Null when typed through Read-Host. */
  plain: string | null;
  constructor(plain: string | null = null) { this.plain = plain; }
  toString(): string { return 'System.Security.SecureString'; }
}

export class ScriptBlock {
  body: Stmt[];
  text: string;
  constructor(body: Stmt[], text: string) {
    this.body = body;
    this.text = text;
  }
}

export class Formatted {
  lines: string[];
  constructor(lines: string[]) { this.lines = lines; }
}

export interface Ref {
  type: 'user' | 'group' | 'computer' | 'ou' | 'cloud' | 'event';
  key: string;
  /** Domain an AD object came from when it was read with -Server; later cmdlets go back to it. */
  domain?: string;
}

export function withRef<T extends object>(o: T, ref: Ref): T {
  Object.defineProperty(o, '__ref', { value: ref, enumerable: false });
  return o;
}

export function refOf(v: unknown): Ref | undefined {
  return v && typeof v === 'object' ? (v as { __ref?: Ref }).__ref : undefined;
}

export interface CmdletCtx {
  shell: Shell;
  w: World;
  name: string;
  named: Record<string, unknown>;
  pos: unknown[];
  input: unknown[] | null;
  whatIf: boolean;
  has(param: string): boolean;
  str(param: string, required?: boolean): string;
}

export interface CmdletDef {
  name: string;
  aliases?: string[];
  params?: string[];
  switches?: string[];
  positional?: string[];
  /** 'each': run once per piped item, binding it to pipeParam. 'all': receive the whole input. */
  pipe?: 'each' | 'all';
  pipeParam?: string;
  mutates?: boolean;
  module: 'ActiveDirectory' | 'ADSync' | 'Microsoft.Graph' | 'Core';
  synopsis: string;
  example?: string;
  /** Meridian practice for this command, shown as NOTES by Get-Help (see helpdocs.ts). */
  notes?: string;
  /**
   * An executable (tasklist.exe, net.exe): no PowerShell parameter binding.
   * Every argument arrives in `pos` as the text that was typed, as Windows
   * passes a command line to a program.
   */
  native?: boolean;
  run(c: CmdletCtx): unknown;
}

const COMMON = ['WhatIf', 'Confirm', 'ErrorAction', 'Verbose', 'Server', 'Credential', 'Force', 'PassThru'];

export function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  return true;
}

export function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  // PowerShell prints dates without the comma: 10/20/2026 4:19:58 PM.
  if (v instanceof Date) return v.toLocaleString('en-US').replace(',', '');
  if (Array.isArray(v)) return v.map(toStr).join(' ');
  if (v instanceof ScriptBlock) return v.text;
  if (typeof v === 'object' && !(v instanceof SecureStringValue)) {
    const ref = refOf(v);
    const o = v as Record<string, unknown>;
    if (ref && typeof o.DistinguishedName === 'string') return o.DistinguishedName;
    return `@{${Object.entries(o).map(([k, x]) => `${k}=${toStr(x)}`).join('; ')}}`;
  }
  return String(v);
}

function wildcard(pattern: string): RegExp {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

function asTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return Date.parse(v);
  return null;
}

function asBool(x: unknown): boolean {
  if (typeof x === 'boolean') return x;
  if (/^true$/i.test(toStr(x))) return true;
  if (/^false$/i.test(toStr(x))) return false;
  return truthy(x);
}

function eq(a: unknown, b: unknown, caseSensitive = false): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (a instanceof Date || b instanceof Date) { const ta = asTime(a); return ta !== null && ta === asTime(b); }
  if (typeof a === 'boolean' || typeof b === 'boolean') return asBool(a) === asBool(b);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return caseSensitive ? toStr(a) === toStr(b) : toStr(a).toLowerCase() === toStr(b).toLowerCase();
}

function cmp(a: unknown, b: unknown): number {
  const ta = asTime(a), tb = asTime(b);
  if (ta !== null && tb !== null) return ta - tb;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
  return toStr(a).localeCompare(toStr(b), undefined, { sensitivity: 'base' });
}

export function getProp(o: unknown, name: string): unknown {
  if (o === null || o === undefined) return null;
  if (Array.isArray(o)) {
    if (/^(count|length)$/i.test(name)) return o.length;
    return o.map((x) => getProp(x, name)).filter((x) => x !== null && x !== undefined);
  }
  if (typeof o === 'string') {
    if (/^length$/i.test(name)) return o.length;
    return null;
  }
  if (o instanceof Date) {
    const map: Record<string, unknown> = { year: o.getFullYear(), month: o.getMonth() + 1, day: o.getDate(), hour: o.getHours(), dayofweek: o.toLocaleDateString('en-US', { weekday: 'long' }) };
    return map[name.toLowerCase()] ?? null;
  }
  if (typeof o === 'object') {
    const key = Object.keys(o).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key) return (o as Record<string, unknown>)[key];
    if (/^count$/i.test(name)) return 1;
  }
  return null;
}

export class Shell {
  w: World;
  cwd: string;
  vars = new Map<string, unknown>();
  cmdlets = new Map<string, CmdletDef>();
  out: OutLine[] = [];
  history: string[] = [];
  /** The command line being run, for error positions. */
  lastLine = '';
  /**
   * Finds the world behind an AD -Server value (domain, NetBIOS name or DC
   * FQDN): the MSP companies. Null means only this shell's own domain answers.
   */
  resolveServer: ((server: string) => World | undefined) | null = null;
  /** Finds a tenant for Connect-MgGraph -TenantId (tenant id, onmicrosoft domain, AD domain or NetBIOS name). */
  resolveTenant: ((tenant: string) => World | undefined) | null = null;
  /** The tenant Microsoft.Graph cmdlets act in after Connect-MgGraph -TenantId; null means this shell's own world. */
  graphWorld: World | null = null;
  graphConnected = false;
  /** Scopes granted at Connect-MgGraph, as Get-MgContext reports them. */
  graphScopes: string[] = [];
  functions = new Map<string, PsFunction>();
  errors: string[] = [];
  private filterObj: unknown = undefined;
  private depth = 0;
  /**
   * A mandatory parameter PowerShell is asking for ("Supply values for the
   * following parameters"). The host shows `<param>: ` as the prompt and
   * passes the answer to answerPrompt().
   */
  pendingPrompt: { cmd: string; param: string; line: string } | null = null;
  /** The command a line consists of, when it is a single command: only then does PowerShell prompt. */
  private promptable: CmdletDef | null = null;

  constructor(w: World, cmdlets: CmdletDef[]) {
    this.w = w;
    this.cwd = `C:\\Users\\${w.player.sam}`;
    for (const c of cmdlets) {
      this.cmdlets.set(c.name.toLowerCase(), c);
      for (const a of c.aliases ?? []) this.cmdlets.set(a.toLowerCase(), c);
    }
  }

  /** The world an AD cmdlet's -Server names, or the AD server-down error real PowerShell gives. */
  private serverWorld(server: string, named: Record<string, unknown>, cmd: string): World {
    const name = server.trim().replace(/:\d+$/, '').toLowerCase();
    const own = (n: string): World | undefined => (n === this.w.ad.domain.toLowerCase() || n === this.w.ad.netbios.toLowerCase() ? this.w : undefined);
    const find = (n: string): World | undefined => own(n) ?? this.resolveServer?.(n);
    // A DC's FQDN (dc01.brightwaterlaw.test) names its domain once the host label is dropped.
    const hit = find(name) ?? (name.includes('.') ? find(name.slice(name.indexOf('.') + 1)) : undefined);
    if (hit) return hit;
    const id = named.Identity !== undefined ? (refOf(named.Identity)?.key ?? toStr(named.Identity)) : '';
    const noun = cmd.replace(/^\w+-AD/, 'AD');
    throw new PsError('Unable to contact the server. This may be because this server does not exist, it is currently down, or it does not have the Active Directory Web Services running.', 'ResourceUnavailable', { exception: 'ADServerDownException', errorId: 'ActiveDirectoryServer:0', target: `${id}:${noun}`, source: cmd });
  }

  setWorld(w: World): void {
    this.w = w;
  }

  /** Runs one command line or script; returns the lines it produced. */
  run(src: string): OutLine[] {
    this.out = [];
    if (src.trim()) this.history.push(src);
    this.lastLine = src.split('\n')[0]!.slice(0, 120);
    try {
      const prog = parse(src);
      const only = prog.length === 1 ? prog[0]! : null;
      const first = only && only.k === 'pipe' && only.cmds.length === 1 ? only.cmds[0]! : null;
      this.promptable = first && first.k !== 'expr' ? this.cmdlets.get(first.name.toLowerCase()) ?? null : null;
      for (const st of prog) {
        const vals = this.execStmt(st, null);
        this.emitValues(vals);
      }
    } catch (e) {
      if (e instanceof ExitSignal) this.out.push({ text: '\u0000EXIT', kind: 'host' });
      else if (e instanceof ReturnSignal) this.emitValues(e.value);
      else if (e instanceof BreakSignal || e instanceof ContinueSignal) { /* outside a loop: ends the script, as in PowerShell */ }
      else this.emitError(e);
    } finally {
      this.promptable = null;
    }
    return this.out;
  }

  /**
   * The answer typed at a "Supply values for the following parameters" prompt.
   * Empty cancels with the error PowerShell gives; !? asks for help on the parameter.
   */
  answerPrompt(value: string): OutLine[] {
    const p = this.pendingPrompt;
    this.out = [];
    if (!p) return this.out;
    if (value.trim() === '!?') {
      this.host(`-${p.param}: no help message is defined for this parameter. Run Get-Help ${p.cmd} for its syntax.`);
      return this.out;
    }
    this.pendingPrompt = null;
    if (!value.trim()) {
      this.lastLine = p.line;
      this.emitError(new MissingParamError(p.param), p.cmd);
      return this.out;
    }
    const quoted = /^[\w*.@-]+$/.test(value) ? value : `'${value.replace(/'/g, "''")}'`;
    const lines = this.run(`${p.line} -${p.param} ${quoted}`);
    this.history.pop();
    return lines;
  }

  /** The text a list of values prints as, for programs that read piped input (findstr). */
  textOf(vals: unknown[]): string[] {
    const saved = this.out;
    this.out = [];
    this.emitValues(vals);
    const lines = this.out.map((l) => l.text);
    this.out = saved;
    return lines;
  }

  /** A program writing to stderr: PowerShell prints it as is. */
  nativeError(text: string): void {
    this.out.push({ text, kind: 'err' });
  }

  host(text: string, color?: string): void {
    this.out.push({ text, kind: 'host', color });
  }

  warn(text: string): void {
    this.out.push({ text: `WARNING: ${text}`, kind: 'warn' });
  }

  /**
   * An error record as Windows PowerShell 5.1 prints it: the message (after the
   * command name), the position, CategoryInfo with the .NET exception and the
   * FullyQualifiedErrorId.
   */
  emitError(e: unknown, cmd?: string): void {
    if (e instanceof ParseError) {
      this.out.push({ text: `ParserError: ${e.message}`, kind: 'err' });
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    this.errors.unshift(msg);
    const d: ErrorDetail = e instanceof PsError ? e.detail : {};
    const category = e instanceof PsError ? e.category : /not found|cannot find/i.test(msg) ? 'ObjectNotFound' : /access|denied|insufficient/i.test(msg) ? 'PermissionDenied' : 'InvalidOperation';
    const name = cmd ?? d.source;
    const def = name ? this.cmdlets.get(name.toLowerCase()) : undefined;
    const notFound = d.exception === 'CommandNotFoundException';
    const ad = def?.module === 'ActiveDirectory';
    const exception = d.exception ?? (ad ? (category === 'ObjectNotFound' ? 'ADIdentityNotFoundException' : 'ADException')
      : category === 'ObjectNotFound' ? 'ItemNotFoundException' : category === 'InvalidArgument' ? 'ParameterBindingException' : category === 'PermissionDenied' ? 'UnauthorizedAccessException' : 'RuntimeException');
    const typeName = def ? def.name.replace(/-/g, '') : '';
    const owner = !def ? '' : ad ? `Microsoft.ActiveDirectory.Management.Commands.${typeName}` : def.module === 'Microsoft.Graph' ? `Microsoft.Graph.PowerShell.Cmdlets.${typeName}` : `Microsoft.PowerShell.Commands.${typeName}Command`;
    const errorId = notFound && !cmd ? 'CommandNotFoundException'
      : d.errorId ? `${d.errorId}${owner ? `,${owner}` : ''}`
      : ad ? `ActiveDirectoryCmdlet:Microsoft.ActiveDirectory.Management.${exception},${owner}`
      : `${exception}${owner ? `,${owner}` : ''}`;
    const shown = def?.name ?? name;
    this.out.push({ text: `${shown ? `${notFound && !cmd ? name : shown} : ` : ''}${msg}`, kind: 'err' });
    if (this.lastLine) {
      const at = notFound && !cmd && name ? Math.max(0, this.lastLine.toLowerCase().indexOf(name.toLowerCase())) : 0;
      const len = notFound && !cmd && name ? name.length : this.lastLine.length - at;
      this.out.push({ text: `At line:1 char:${at + 1}\n+ ${this.lastLine}\n+ ${' '.repeat(at)}${'~'.repeat(Math.min(80, Math.max(1, len)))}`, kind: 'err' });
    }
    this.out.push({ text: `    + CategoryInfo          : ${category}: (${d.target ?? ':'}) [${notFound && !cmd ? '' : shown ?? ''}], ${exception}`, kind: 'err' });
    this.out.push({ text: `    + FullyQualifiedErrorId : ${errorId}`, kind: 'err' });
    this.out.push({ text: '', kind: 'err' });
  }

  // ------------------------------------------------------------- statements

  execBlock(body: Stmt[], input: unknown[] | null): unknown[] {
    const out: unknown[] = [];
    for (const st of body) out.push(...this.execStmt(st, input));
    return out;
  }

  execStmt(st: Stmt, input: unknown[] | null): unknown[] {
    if (++this.depth > 200) { this.depth = 0; throw new PsError('The script failed due to call depth overflow.'); }
    try {
      switch (st.k) {
        case 'assign': {
          const vals = this.execStmt(st.value, input);
          this.vars.set(st.name.toLowerCase(), vals.length === 1 ? vals[0] : vals.length === 0 ? null : vals);
          return [];
        }
        case 'foreach': {
          const raw = this.execStmt(st.list, input);
          const items = raw.length === 1 && Array.isArray(raw[0]) ? (raw[0] as unknown[]) : raw;
          const out: unknown[] = [];
          for (const item of items) {
            this.vars.set(st.name.toLowerCase(), item);
            try { out.push(...this.execBlock(st.body, input)); } catch (e) {
              if (e instanceof BreakSignal) break;
              if (e instanceof ContinueSignal) continue;
              throw e;
            }
          }
          return out;
        }
        case 'if': {
          if (truthy(this.evalExpr(st.cond))) return this.execBlock(st.then, input);
          return st.else ? this.execBlock(st.else, input) : [];
        }
        case 'function':
          this.functions.set(st.name.toLowerCase(), { name: st.name, params: st.params, body: st.body });
          return [];
        case 'param': {
          // A script's param() block outside a call: apply defaults for unset parameters.
          for (const prm of st.params) if (!this.vars.has(prm.name.toLowerCase())) this.vars.set(prm.name.toLowerCase(), prm.def ? this.evalExpr(prm.def) : null);
          return [];
        }
        case 'while': {
          const out: unknown[] = [];
          let guard = 0;
          while (truthy(this.evalExpr(st.cond))) {
            if (++guard > 10000) throw new PsError('The loop ran more than 10,000 times and was stopped.');
            try { out.push(...this.execBlock(st.body, input)); } catch (e) {
              if (e instanceof BreakSignal) break;
              if (e instanceof ContinueSignal) continue;
              throw e;
            }
          }
          return out;
        }
        case 'try': {
          const out: unknown[] = [];
          try {
            out.push(...this.execBlock(st.body, input));
          } catch (e) {
            if (e instanceof ReturnSignal || e instanceof BreakSignal || e instanceof ContinueSignal || e instanceof ExitSignal || !st.catchBody) throw e;
            const message = e instanceof Error ? e.message : String(e);
            const prev = this.vars.get('_');
            this.vars.set('_', { Exception: { Message: message, GetType: 'System.Management.Automation.RuntimeException' }, CategoryInfo: e instanceof PsError ? e.category : 'NotSpecified', ToString: message });
            try { out.push(...this.execBlock(st.catchBody, input)); } finally { this.vars.set('_', prev); }
          } finally {
            if (st.finallyBody) out.push(...this.execBlock(st.finallyBody, input));
          }
          return out;
        }
        case 'throw': {
          const v = st.value ? this.evalExpr(st.value) : 'ScriptHalted';
          throw new PsError(toStr(v) || 'ScriptHalted', 'OperationStopped');
        }
        case 'return': throw new ReturnSignal(st.value ? this.execStmt(st.value, input) : []);
        case 'break': throw new BreakSignal();
        case 'continue': throw new ContinueSignal();
        case 'opassign': {
          const cur = this.getVar(st.name);
          const vals = this.execStmt(st.value, input);
          const v = vals.length === 1 ? vals[0] : vals;
          let next: unknown;
          if (st.op === '+') {
            if (Array.isArray(cur)) next = [...cur, ...(Array.isArray(v) ? v : [v])];
            else if (typeof cur === 'number' && typeof v === 'number') next = cur + v;
            else if (cur === null || cur === undefined) next = v;
            else if (cur instanceof Date) next = new Date(cur.getTime() + Number(v));
            else next = toStr(cur) + toStr(v);
          } else next = Number(cur) - Number(v);
          this.vars.set(st.name.toLowerCase(), next);
          return [];
        }
        case 'incr':
          this.vars.set(st.name.toLowerCase(), Number(this.getVar(st.name) ?? 0) + st.delta);
          return [];
        case 'pipe': {
          let data: unknown[] | null = null;
          for (const [i, cmd] of st.cmds.entries()) {
            if (cmd.k === 'expr') {
              if (i > 0) throw new PsError('Expressions are only allowed as the first element of a pipeline.');
              const v = this.evalExpr(cmd.e);
              data = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
              continue;
            }
            data = this.invoke(cmd.name, cmd.args, i === 0 ? null : data);
          }
          return data ?? [];
        }
      }
    } finally {
      this.depth--;
    }
  }

  // ------------------------------------------------------------- commands

  private invoke(name: string, args: Arg[], input: unknown[] | null): unknown[] {
    if (/\.ps1$/i.test(name)) return this.runScriptFile(name, args);
    const fn = this.functions.get(name.toLowerCase());
    if (fn) return this.callFunction(fn, args, input);
    // PowerShell tries the Get- verb when nothing else matches: `date` runs Get-Date.
    const def = this.cmdlets.get(name.toLowerCase()) ?? (name.includes('-') ? undefined : this.cmdlets.get(`get-${name.toLowerCase()}`));
    if (!def) throw commandNotFound(name, name);
    if (def.native) return this.invokeNative(def, args, input);
    const named: Record<string, unknown> = {};
    const pos: unknown[] = [];
    const all = [...(def.params ?? []), ...(def.switches ?? []), ...COMMON];
    const resolve = (p: string): string => {
      const exact = all.find((x) => x.toLowerCase() === p.toLowerCase());
      if (exact) return exact;
      const pre = all.filter((x) => x.toLowerCase().startsWith(p.toLowerCase()));
      if (pre.length === 1) return pre[0]!;
      if (pre.length > 1) throw new PsError(`Parameter cannot be processed because the parameter name '${p}' is ambiguous. Possible matches include: ${pre.map((x) => `-${x}`).join(' ')}.`, 'InvalidArgument', { exception: 'ParameterBindingException', errorId: 'AmbiguousParameter', source: def.name });
      throw new PsError(`A parameter cannot be found that matches parameter name '${p}'.`, 'InvalidArgument', { exception: 'ParameterBindingException', errorId: 'NamedParameterNotFound', source: def.name });
    };
    for (const a of args) {
      if (a.k === 'named') {
        const key = resolve(a.name);
        const isSwitch = [...(def.switches ?? []), 'WhatIf', 'Confirm', 'Verbose', 'Force', 'PassThru'].includes(key);
        if (isSwitch) {
          named[key] = a.value && a.colon ? truthy(this.evalExpr(a.value)) : true;
          if (a.value && !a.colon) pos.push(this.evalArg(a.value));
        } else {
          if (!a.value) throw new PsError(`Missing an argument for parameter '${key}'. Specify a parameter of the required type and try again.`, 'InvalidArgument', { exception: 'ParameterBindingException', errorId: 'MissingArgument', source: def.name });
          named[key] = this.evalArg(a.value);
        }
      } else pos.push(this.evalArg(a.value));
    }
    for (const p of def.positional ?? []) {
      if (named[p] === undefined && pos.length) named[p] = pos.shift();
    }
    const whatIf = named.WhatIf === true;
    // As in real AD, an object read from another domain takes later cmdlets back to that domain's DC.
    const from = def.module === 'ActiveDirectory' ? [...(input ?? []), ...Object.values(named)].map((v) => refOf(v)?.domain).find((d) => d) : undefined;
    const server = named.Server !== undefined && named.Server !== null && named.Server !== '' ? toStr(named.Server) : from;
    const target = def.module === 'Microsoft.Graph' && this.graphWorld ? this.graphWorld
      : def.module === 'ActiveDirectory' && server ? this.serverWorld(server, named, def.name) : this.w;
    const tag = (r: unknown[]): unknown[] => {
      if (target !== this.w) for (const o of r) { const ref = refOf(o); if (ref) ref.domain ??= target.ad.domain; }
      return r;
    };
    const makeCtx = (n: Record<string, unknown>, inp: unknown[] | null): CmdletCtx => ({
      shell: this, w: target, name: def.name, named: n, pos, input: inp, whatIf,
      has: (p) => n[p] !== undefined && n[p] !== false,
      str: (p, required) => {
        const v = n[p];
        if ((v === undefined || v === null || v === '') && required) throw new MissingParamError(p);
        const r = refOf(v);
        if (r && r.type !== 'event') return r.key;
        if (Array.isArray(v)) return v.map((x) => refOf(x)?.key ?? toStr(x)).join(',');
        return toStr(v);
      },
    });
    const collect = (r: unknown): unknown[] => (r === undefined || r === null ? [] : Array.isArray(r) ? r : [r]);
    try {
      if (input && def.pipe === 'each' && def.pipeParam) {
        const out: unknown[] = [];
        for (const item of input) {
          const n = { ...named };
          if (n[def.pipeParam] === undefined) n[def.pipeParam] = item;
          out.push(...collect(def.run(makeCtx(n, [item]))));
        }
        return tag(out);
      }
      return tag(collect(def.run(makeCtx(named, def.pipe === 'all' ? input ?? [] : input))));
    } catch (e) {
      if (e instanceof ExitSignal || e instanceof ReturnSignal || e instanceof BreakSignal || e instanceof ContinueSignal) throw e;
      if (named.ErrorAction && /silentlycontinue|ignore/i.test(toStr(named.ErrorAction))) return [];
      // -ErrorAction Stop makes the error terminating, so try/catch sees it.
      if (named.ErrorAction && /^stop$/i.test(toStr(named.ErrorAction))) throw e;
      if (e instanceof MissingParamError && this.promptable === def && this.depth <= 1 && !input) {
        this.pendingPrompt = { cmd: def.name, param: e.param, line: this.lastLine };
        this.host(`cmdlet ${def.name} at command pipeline position 1`);
        this.host('Supply values for the following parameters:');
        this.host('(Type !? for Help.)');
        return [];
      }
      this.emitError(e, def.name);
      return [];
    }
  }

  /** A program: the typed arguments as text, piped input as the lines it would print. */
  private invokeNative(def: CmdletDef, args: Arg[], input: unknown[] | null): unknown[] {
    const pos: unknown[] = [];
    for (const a of args) {
      if (a.k === 'named') {
        pos.push(`-${a.name}`);
        if (a.value) pos.push(toStr(this.evalArg(a.value)));
      } else {
        const v = this.evalArg(a.value);
        if (Array.isArray(v)) pos.push(...v.map(toStr)); else pos.push(toStr(v));
      }
    }
    const ctx: CmdletCtx = {
      shell: this, w: this.w, name: def.name, named: {}, pos, input: input ? this.textOf(input) : null, whatIf: false,
      has: () => false, str: () => '',
    };
    try {
      const r = def.run(ctx);
      return r === undefined || r === null ? [] : Array.isArray(r) ? r : [r];
    } catch (e) {
      this.emitError(e, def.name);
      return [];
    }
  }

  runScriptFile(path: string, args: Arg[] = []): unknown[] {
    const full = this.resolvePath(path);
    const f = this.w.files.find((x) => x.path.toLowerCase() === full.toLowerCase() && !x.deleted);
    if (!f) throw new PsError(`The term '${path}' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again.`, 'ObjectNotFound');
    const prog = parse(f.content);
    const first = prog[0];
    const params = first && first.k === 'param' ? first.params : [];
    try {
      return this.callFunction({ name: f.path, params, body: first && first.k === 'param' ? prog.slice(1) : prog }, args, null, false);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
  }

  /** Call a function or script: bind -Named and positional arguments to its parameters. */
  callFunction(fn: PsFunction, args: Arg[], input: unknown[] | null, scoped = true): unknown[] {
    const saved = new Map<string, unknown>();
    const touched = [...fn.params.map((x) => x.name.toLowerCase()), 'args', 'input'];
    for (const k of touched) saved.set(k, this.vars.get(k));
    const bound = new Map<string, unknown>();
    const rest: unknown[] = [];
    for (const a of args) {
      if (a.k === 'named') {
        const prm = fn.params.find((x) => x.name.toLowerCase() === a.name.toLowerCase()) ?? fn.params.filter((x) => x.name.toLowerCase().startsWith(a.name.toLowerCase()))[0];
        if (!prm) throw new PsError(`A parameter cannot be found that matches parameter name '${a.name}'.`, 'InvalidArgument');
        bound.set(prm.name.toLowerCase(), a.value ? this.evalArgPublic(a.value) : true);
      } else rest.push(this.evalArgPublic(a.value));
    }
    for (const prm of fn.params) {
      const k = prm.name.toLowerCase();
      if (!bound.has(k) && rest.length) bound.set(k, rest.shift());
      this.vars.set(k, bound.has(k) ? bound.get(k) : prm.def ? this.evalExpr(prm.def) : null);
    }
    this.vars.set('args', rest);
    this.vars.set('input', input ?? []);
    try {
      return this.execBlock(fn.body, input);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    } finally {
      if (scoped) for (const [k, v] of saved) { if (v === undefined) this.vars.delete(k); else this.vars.set(k, v); }
    }
  }

  evalArgPublic(e: Expr): unknown {
    return e.k === 'word' ? e.v : this.evalExpr(e);
  }

  resolvePath(p: string): string {
    let path = p.replace(/\//g, '\\').replace(/^["']|["']$/g, '');
    if (/^~/.test(path)) path = `C:\\Users\\${this.w.player.sam}${path.slice(1)}`;
    if (!/^[A-Za-z]:\\/.test(path)) path = `${this.cwd}\\${path.replace(/^\.\\/, '')}`;
    const parts: string[] = [];
    for (const seg of path.split('\\')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { if (parts.length > 1) parts.pop(); continue; }
      parts.push(seg);
    }
    return parts.join('\\');
  }

  // ------------------------------------------------------------- expressions

  private evalArg(e: Expr): unknown {
    if (e.k === 'word') return e.v;
    return this.evalExpr(e);
  }

  evalExpr(e: Expr): unknown {
    switch (e.k) {
      case 'lit': return e.v;
      case 'str': return e.dq ? this.interpolate(e.raw) : e.raw;
      case 'word': {
        if (this.filterObj !== undefined) {
          const v = getProp(this.filterObj, e.v);
          if (v !== null || (this.filterObj && Object.keys(this.filterObj as object).some((k) => k.toLowerCase() === e.v.toLowerCase()))) return v;
        }
        return e.v;
      }
      case 'var': return this.getVar(e.name);
      case 'member': {
        const obj = this.evalExpr(e.obj);
        if (e.args) return this.callMethod(obj, e.name, e.args.map((a) => this.evalExpr(a)));
        return getProp(obj, e.name);
      }
      case 'index': {
        const obj = this.evalExpr(e.obj);
        const i = Number(this.evalExpr(e.idx));
        if (Array.isArray(obj)) return obj[i < 0 ? obj.length + i : i] ?? null;
        if (typeof obj === 'string') return obj[i < 0 ? obj.length + i : i] ?? null;
        if (obj && typeof obj === 'object') return getProp(obj, toStr(this.evalExpr(e.idx)));
        return null;
      }
      case 'sub': {
        const vals = this.execBlock(e.body, null);
        return vals.length === 0 ? null : vals.length === 1 ? vals[0] : vals;
      }
      case 'array': {
        const out: unknown[] = [];
        for (const it of e.items) {
          const v = it.k === 'word' ? it.v : this.evalExpr(it);
          if (Array.isArray(v) && it.k === 'sub') out.push(...v);
          else if (v !== null && v !== undefined) out.push(v);
          else if (it.k !== 'sub') out.push(v);
        }
        return out;
      }
      case 'hash': {
        const o: Record<string, unknown> = {};
        for (const [k, v] of e.entries) o[k] = this.evalExpr(v);
        return o;
      }
      case 'block': return new ScriptBlock(e.body, e.text);
      case 'not': return !truthy(this.evalExpr(e.e));
      case 'cast': {
        const v = this.evalExpr(e.e);
        switch (e.type) {
          case 'datetime': { const d = v instanceof Date ? v : new Date(toStr(v)); if (Number.isNaN(d.getTime())) throw new PsError(`Cannot convert value "${toStr(v)}" to type "System.DateTime".`); return d; }
          case 'int': return Math.trunc(Number(v));
          case 'string': return toStr(v);
          case 'bool': return truthy(v);
          case 'array': return Array.isArray(v) ? v : [v];
          default: return v;
        }
      }
      case 'bin': return this.binary(e.op, e.l, e.r);
      case 'static': return this.staticCall(e.type, e.name, e.args ? e.args.map((a) => this.evalExpr(a)) : null);
    }
  }

  private staticCall(type: string, name: string, args: unknown[] | null): unknown {
    const t = type.replace(/^system\./, '');
    const n = name.toLowerCase();
    const a = args ?? [];
    const s0 = toStr(a[0]);
    switch (`${t}::${n}`) {
      case 'string::isnullorempty': return a[0] === null || a[0] === undefined || s0 === '';
      case 'string::isnullorwhitespace': return a[0] === null || a[0] === undefined || s0.trim() === '';
      case 'string::join': return (Array.isArray(a[1]) ? a[1] : a.slice(1)).map(toStr).join(s0);
      case 'string::empty': return '';
      case 'datetime::now': return new Date();
      case 'datetime::utcnow': return new Date();
      case 'datetime::today': { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
      case 'datetime::parse': return new Date(s0);
      case 'math::round': return Number(Number(a[0]).toFixed(Number(a[1] ?? 0)));
      case 'math::floor': return Math.floor(Number(a[0]));
      case 'math::ceiling': return Math.ceil(Number(a[0]));
      case 'math::abs': return Math.abs(Number(a[0]));
      case 'math::max': return Math.max(Number(a[0]), Number(a[1]));
      case 'math::min': return Math.min(Number(a[0]), Number(a[1]));
      case 'guid::newguid': return crypto.randomUUID();
      case 'environment::machinename': return 'MHS-IAM-WKS01';
      case 'environment::username': return this.w.player.sam;
      case 'environment::newline': return '\n';
      case 'int::maxvalue': return 2147483647;
      case 'io.path::getfilename': return s0.split('\\').pop() ?? '';
      case 'io.path::combine': return a.map(toStr).join('\\').replace(/\\+/g, '\\');
      case 'web.security.membership::generatepassword': {
        const len = Math.max(12, Number(a[0]) || 14);
        const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];
        const pick = (set: string): string => set[Math.floor(Math.random() * set.length)]!;
        const chars = sets.map(pick);
        while (chars.length < len) chars.push(pick(sets.join('')));
        return chars.sort(() => Math.random() - 0.5).join('');
      }
    }
    throw new PsError(`Method invocation failed because [${type}] does not contain a method named '${name}'.`);
  }

  private format(fmt: string, values: unknown[]): string {
    return fmt.replace(/\{(\d+)(?::([^}]+))?\}/g, (_m, i: string, spec?: string) => {
      const v = values[Number(i)];
      if (spec && typeof v === 'number') {
        const d = /^[DdNn](\d*)$/.exec(spec);
        if (d && /[Dd]/.test(spec)) return String(Math.trunc(v)).padStart(Number(d[1] || 0), '0');
        if (d) return v.toLocaleString('en-US', { minimumFractionDigits: Number(d[1] || 2), maximumFractionDigits: Number(d[1] || 2) });
      }
      if (spec && v instanceof Date) return formatDate(v, spec);
      return toStr(v);
    });
  }

  private binary(op: string, le: Expr, re: Expr): unknown {
    if (op === 'f') {
      const r = this.evalExpr(re);
      return this.format(toStr(this.evalExpr(le)), Array.isArray(r) ? r : [r]);
    }
    if (op === 'and') return truthy(this.evalExpr(le)) && truthy(this.evalExpr(re));
    if (op === 'or') return truthy(this.evalExpr(le)) || truthy(this.evalExpr(re));
    const l = this.evalExpr(le);
    const r = this.evalExpr(re);
    if (op === '+') {
      if (l instanceof Date) return new Date(l.getTime() + Number(r));
      if (typeof l === 'number' && typeof r === 'number') return l + r;
      if (Array.isArray(l)) return [...l, ...(Array.isArray(r) ? r : [r])];
      return toStr(l) + toStr(r);
    }
    if (op === '-') return Number(l) - Number(r);
    const test = (x: unknown): boolean => {
      switch (op) {
        case 'eq': return eq(x, r);
        case 'ceq': return eq(x, r, true);
        case 'ne': return !eq(x, r);
        case 'cne': return !eq(x, r, true);
        case 'gt': return cmp(x, r) > 0;
        case 'ge': return cmp(x, r) >= 0;
        case 'lt': return cmp(x, r) < 0;
        case 'le': return cmp(x, r) <= 0;
        case 'like': return wildcard(toStr(r)).test(toStr(x));
        case 'notlike': return !wildcard(toStr(r)).test(toStr(x));
        case 'match': return new RegExp(toStr(r), 'i').test(toStr(x));
        case 'notmatch': return !new RegExp(toStr(r), 'i').test(toStr(x));
        default: return false;
      }
    };
    if (op === 'contains' || op === 'notcontains') {
      const has = (Array.isArray(l) ? l : [l]).some((x) => eq(x, r));
      return op === 'contains' ? has : !has;
    }
    if (op === 'in' || op === 'notin') {
      const has = (Array.isArray(r) ? r : [r]).some((x) => eq(l, x));
      return op === 'in' ? has : !has;
    }
    if (Array.isArray(l)) return l.filter(test);
    return test(l);
  }

  private callMethod(obj: unknown, name: string, args: unknown[]): unknown {
    const n = name.toLowerCase();
    if (typeof obj === 'string') {
      switch (n) {
        case 'tolower': return obj.toLowerCase();
        case 'toupper': return obj.toUpperCase();
        case 'trim': return obj.trim();
        case 'replace': return obj.split(toStr(args[0])).join(toStr(args[1]));
        case 'split': return obj.split(toStr(args[0] ?? ' '));
        case 'substring': return args.length > 1 ? obj.substr(Number(args[0]), Number(args[1])) : obj.slice(Number(args[0]));
        case 'contains': return obj.includes(toStr(args[0]));
        case 'startswith': return obj.toLowerCase().startsWith(toStr(args[0]).toLowerCase());
        case 'endswith': return obj.toLowerCase().endsWith(toStr(args[0]).toLowerCase());
        case 'tostring': return obj;
      }
    }
    if (obj instanceof Date) {
      switch (n) {
        case 'adddays': return new Date(obj.getTime() + Number(args[0]) * 86_400_000);
        case 'addhours': return new Date(obj.getTime() + Number(args[0]) * 3_600_000);
        case 'tostring': return args.length ? formatDate(obj, toStr(args[0])) : obj.toLocaleString('en-US');
      }
    }
    if (Array.isArray(obj) && n === 'contains') return obj.some((x) => eq(x, args[0]));
    if (n === 'tostring') return toStr(obj);
    throw new PsError(`Method invocation failed because [${obj === null ? 'null' : Array.isArray(obj) ? 'System.Object[]' : typeof obj}] does not contain a method named '${name}'.`);
  }

  interpolate(raw: string): string {
    let s = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]!;
      if (c === '`' && i + 1 < raw.length) {
        const nx = raw[++i]!;
        s += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx;
        continue;
      }
      if (c === '$' && raw[i + 1] === '(') {
        let depth = 1, j = i + 2;
        while (j < raw.length && depth) { if (raw[j] === '(') depth++; else if (raw[j] === ')') depth--; j++; }
        const vals = this.execBlock(parse(raw.slice(i + 2, j - 1)), null);
        s += vals.map(toStr).join(' ');
        i = j - 1;
        continue;
      }
      if (c === '$' && /[A-Za-z_]/.test(raw[i + 1] ?? '')) {
        let j = i + 1;
        while (j < raw.length && /[A-Za-z0-9_:]/.test(raw[j]!)) j++;
        s += toStr(this.getVar(raw.slice(i + 1, j)));
        i = j - 1;
        continue;
      }
      s += c;
    }
    return s;
  }

  getVar(name: string): unknown {
    const n = name.toLowerCase();
    if (n === 'true') return true;
    if (n === 'false') return false;
    if (n === 'null') return null;
    if (n === 'pwd') return this.cwd;
    if (n === 'env:username') return this.w.player.sam;
    if (n === 'env:userdomain') return this.w.ad.netbios;
    if (n === 'env:computername') return 'MHS-IAM-WKS01';
    if (n === 'env:userprofile') return `C:\\Users\\${this.w.player.sam}`;
    if (n === 'env:userdnsdomain') return this.w.ad.domain.toUpperCase();
    if (n === 'env:logonserver') return '\\\\MHS-DC01';
    if (n === 'host') return { Name: 'ConsoleHost', Version: '5.1.22621.4111' };
    if (n === 'psversiontable') return { PSVersion: '5.1.22621.4111', PSEdition: 'Desktop', BuildVersion: '10.0.22621.4111', CLRVersion: '4.0.30319.42000', WSManStackVersion: '3.0', PSRemotingProtocolVersion: '2.3', SerializationVersion: '1.1.0.1' };
    if (n === 'error') return this.errors;
    if (n === 'home') return `C:\\Users\\${this.w.player.sam}`;
    return this.vars.has(n) ? this.vars.get(n) : null;
  }

  /** Evaluate a filter against an object: properties appear as bare words. */
  matches(filter: unknown, obj: unknown): boolean {
    if (filter === '*' ) return true;
    const prev = this.filterObj;
    this.filterObj = obj;
    try {
      if (filter instanceof ScriptBlock) {
        // AD -Filter { Department -eq 'Finance' } is a property expression, not a pipeline.
        const first = filter.body[0];
        if (first && first.k === 'pipe' && first.cmds[0]?.k === 'call') return truthy(this.evalExpr(parseExpression(filter.text)));
        this.vars.set('_', obj);
        const vals = this.execBlock(filter.body, null);
        return truthy(vals.length === 1 ? vals[0] : vals);
      }
      return truthy(this.evalExpr(parseExpression(toStr(filter))));
    } finally {
      this.filterObj = prev;
    }
  }

  /** Run a script block once per item with $_ bound (Where-Object, ForEach-Object). */
  each(block: ScriptBlock, item: unknown): unknown[] {
    const prev = this.vars.get('_');
    this.vars.set('_', item);
    this.vars.set('psitem', item);
    try {
      return this.execBlock(block.body, null);
    } finally {
      this.vars.set('_', prev);
    }
  }

  // ------------------------------------------------------------- output

  emitValues(vals: unknown[]): void {
    let group: Record<string, unknown>[] = [];
    const flush = (): void => {
      if (!group.length) return;
      for (const l of formatObjects(group, null)) this.out.push({ text: l, kind: 'out' });
      group = [];
    };
    for (const v of vals) {
      if (v instanceof Formatted) { flush(); for (const l of v.lines) this.out.push({ text: l, kind: 'out' }); continue; }
      if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof SecureStringValue) && !(v instanceof ScriptBlock) && !Array.isArray(v)) {
        if (group.length && Object.keys(group[0]!).join() !== Object.keys(v).join()) flush();
        group.push(v as Record<string, unknown>);
        continue;
      }
      flush();
      if (Array.isArray(v)) { this.emitValues(v); continue; }
      if (v === null || v === undefined) continue;
      // A date on its own prints in the long form: Tuesday, October 20, 2026 4:19:58 PM.
      if (v instanceof Date) { this.out.push({ text: `${v.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${v.toLocaleTimeString('en-US')}`, kind: 'out' }); continue; }
      for (const l of toStr(v).split('\n')) this.out.push({ text: l, kind: 'out' });
    }
    flush();
  }
}

export function cell(v: unknown): string {
  if (Array.isArray(v)) return `{${v.map(cell).join(', ')}}`;
  if (v instanceof Date) return toStr(v);
  return toStr(v).replace(/\n/g, ' ');
}

export function formatObjects(objs: Record<string, unknown>[], mode: 'table' | 'list' | null, props?: string[]): string[] {
  if (!objs.length) return [];
  const keys = props?.length ? props : Object.keys(objs[0]!);
  const asList = mode === 'list' || (mode === null && keys.length > 4);
  if (asList) {
    const width = Math.max(...keys.map((k) => k.length));
    const lines: string[] = [''];
    for (const o of objs) {
      for (const k of keys) lines.push(`${k.padEnd(width)} : ${cell(getProp(o, k))}`);
      lines.push('');
    }
    return lines;
  }
  const rows = objs.map((o) => keys.map((k) => cell(getProp(o, k))));
  const widths = keys.map((k, i) => Math.min(48, Math.max(k.length, ...rows.map((r) => r[i]!.length))));
  const fit = (s: string, wdt: number): string => (s.length > wdt ? s.slice(0, wdt - 3) + '...' : s.padEnd(wdt));
  return [
    '',
    keys.map((k, i) => fit(k, widths[i]!)).join(' ').trimEnd(),
    widths.map((wdt) => '-'.repeat(wdt)).join(' '),
    ...rows.map((r) => r.map((c, i) => fit(c, widths[i]!)).join(' ').trimEnd()),
    '',
  ];
}

export function formatDate(d: Date, f: string): string {
  const p = (n: number, l = 2): string => String(n).padStart(l, '0');
  return f
    .replace(/yyyy/g, String(d.getFullYear()))
    .replace(/MM/g, p(d.getMonth() + 1))
    .replace(/dd/g, p(d.getDate()))
    .replace(/HH/g, p(d.getHours()))
    .replace(/mm/g, p(d.getMinutes()))
    .replace(/ss/g, p(d.getSeconds()));
}
