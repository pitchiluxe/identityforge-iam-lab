/**
 * terminal/cmd.ts — Command Prompt (cmd.exe) and batch files.
 *
 * Built-ins and the console tools an IAM engineer actually types (dir, cd,
 * type, copy, del, set, net user /domain, whoami /groups, ipconfig, gpupdate,
 * klist...), redirection (> >> 2>nul), pipes into find/findstr/more/sort,
 * && || &, and batch scripts with labels, goto, call, if, for, setlocal,
 * delayed expansion and %1..%9. Files are the range's virtual disk and AD
 * answers come from the same world ADUC and PowerShell use.
 */
import type { World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { copyFile, deleteFile, fileExists, homeDir, readFile, renameFile, writeFile } from '../world/docs.ts';
import { findGroup, findUser, principalGroups } from '../world/directory.ts';

export interface CmdLine { text: string; kind?: 'err' }
export interface CmdHooks {
  /** Run a PowerShell command line (powershell -Command). */
  powershell(cmd: string, cwd: string): CmdLine[];
  /** Ask the user for a line of input (set /p). Null when cancelled. */
  ask(prompt: string): string | null;
}

const HOST = 'MHS-IAM-WKS01';
const BAT_LIMIT = 5000;

export class CmdShell {
  w: World;
  cwd: string;
  env = new Map<string, string>();
  echo = true;
  errorlevel = 0;
  history: string[] = [];
  dirs = new Set<string>();
  hooks: CmdHooks;
  private out: CmdLine[] = [];
  private delayed = false;
  private stack: Map<string, string>[] = [];
  private steps = 0;

  /** The signed-in account (sam) and computer: the learner by default, another user inside a Remote Desktop session. */
  user: string;
  host: string;

  constructor(w: World, hooks: CmdHooks, cwd?: string, identity?: { user: string; host: string }) {
    this.w = w;
    this.hooks = hooks;
    this.user = identity?.user ?? w.player.sam;
    this.host = identity?.host ?? HOST;
    this.cwd = cwd ?? (identity ? `C:\\Users\\${identity.user}` : homeDir(w));
    const user = this.user;
    for (const [k, v] of Object.entries({
      USERNAME: user, USERDOMAIN: w.ad.netbios, USERDNSDOMAIN: w.ad.domain.toUpperCase(), COMPUTERNAME: this.host, LOGONSERVER: '\\\\MHS-DC01',
      USERPROFILE: this.cwd, HOMEDRIVE: 'C:', HOMEPATH: this.cwd.slice(2), SystemRoot: 'C:\\Windows', windir: 'C:\\Windows', SystemDrive: 'C:',
      OS: 'Windows_NT', PROCESSOR_ARCHITECTURE: 'AMD64', NUMBER_OF_PROCESSORS: '12', TEMP: `${homeDir(w)}\\AppData\\Local\\Temp`, TMP: `${homeDir(w)}\\AppData\\Local\\Temp`,
      PATH: 'C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\', PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.PS1', PROMPT: '$P$G', ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    })) this.env.set(k.toUpperCase(), v);
  }

  setWorld(w: World): void { this.w = w; }

  /** Run one line typed at the prompt. */
  run(line: string): CmdLine[] {
    this.out = [];
    this.steps = 0;
    if (line.trim()) this.history.push(line);
    try {
      this.exec(line, null);
    } catch (e) {
      if (!(e instanceof ExitSignal)) this.err(e instanceof Error ? e.message : String(e));
    }
    return this.out;
  }

  /** Run a .bat/.cmd file (double-click, or typed at the prompt). */
  runBatch(path: string, args: string[] = []): CmdLine[] {
    this.out = [];
    this.steps = 0;
    try {
      this.batch(path, args);
    } catch (e) {
      if (!(e instanceof ExitSignal)) this.err(e instanceof Error ? e.message : String(e));
    }
    return this.out;
  }

  prompt(): string {
    return `${this.cwd}>`;
  }

  // ---------------------------------------------------------------- output

  private print(text: string): void { for (const l of text.split('\n')) this.out.push({ text: l }); }
  private err(text: string): void { this.out.push({ text, kind: 'err' }); this.errorlevel = 1; }

  // ---------------------------------------------------------------- variables

  private get(name: string): string | undefined {
    const n = name.toUpperCase();
    if (n === 'CD') return this.cwd;
    if (n === 'ERRORLEVEL') return String(this.errorlevel);
    if (n === 'DATE') return new Date().toLocaleDateString('en-US', { weekday: 'short', month: '2-digit', day: '2-digit', year: 'numeric' }).replace(',', '');
    if (n === 'TIME') { const d = new Date(); return `${String(d.getHours()).padStart(2, ' ')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(Math.floor(d.getMilliseconds() / 10)).padStart(2, '0')}`; }
    if (n === 'RANDOM') return String(Math.floor(Math.random() * 32768));
    return this.env.get(n);
  }

  private expandVar(name: string, mod: string | undefined, raw: string): string {
    const v = this.get(name);
    if (v === undefined) return raw;
    if (!mod) return v;
    const sub = /^~(-?\d+)(?:,(-?\d+))?$/.exec(mod);
    if (sub) {
      let start = Number(sub[1]);
      if (start < 0) start = Math.max(0, v.length + start);
      let end = sub[2] === undefined ? v.length : Number(sub[2]) < 0 ? v.length + Number(sub[2]) : start + Number(sub[2]);
      end = Math.max(start, end);
      return v.slice(start, end);
    }
    const rep = /^([^=]*)=(.*)$/.exec(mod);
    if (rep) {
      const find = rep[1]!;
      if (!find) return v;
      const star = find.startsWith('*');
      const needle = star ? find.slice(1) : find;
      if (star) { const i = v.toLowerCase().indexOf(needle.toLowerCase()); return i < 0 ? v : rep[2]! + v.slice(i + needle.length); }
      return v.split(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(rep[2]!);
    }
    return v;
  }

  private expand(text: string, args: string[] | null): string {
    let s = text.replace(/%%/g, '\u0001');
    if (args) {
      s = s.replace(/%~([a-z]*)(\d)/gi, (_m, mods: string, d: string) => {
        const v = (args[Number(d)] ?? '').replace(/^"|"$/g, '');
        if (!mods) return v;
        const full = this.resolve(v);
        const dir = full.slice(0, full.lastIndexOf('\\') + 1);
        const file = full.slice(full.lastIndexOf('\\') + 1);
        let r = '';
        for (const m of mods.toLowerCase()) {
          if (m === 'd') r += 'C:';
          else if (m === 'p') r += dir.slice(2);
          else if (m === 'n') r += file.replace(/\.[^.]*$/, '');
          else if (m === 'x') r += /\.[^.]*$/.exec(file)?.[0] ?? '';
          else if (m === 'f') r += full;
        }
        return r;
      });
      s = s.replace(/%\*/g, args.slice(1).join(' ')).replace(/%(\d)/g, (_m, d: string) => args[Number(d)] ?? '');
    }
    s = s.replace(/%([^%\s:]+)(?::([^%]*))?%/g, (m, name: string, mod: string | undefined) => this.expandVar(name, mod, args ? '' : m));
    return s.replace(/\u0001/g, '%');
  }

  private expandDelayed(text: string): string {
    if (!this.delayed) return text;
    return text.replace(/!([^!\s:]+)(?::([^!]*))?!/g, (m, name: string, mod: string | undefined) => this.expandVar(name, mod, ''));
  }

  // ---------------------------------------------------------------- paths and files

  resolve(p: string): string {
    let path = p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\');
    if (!path || path === '.') return this.cwd;
    if (/^[a-z]:$/i.test(path)) return 'C:';
    if (path.startsWith('\\')) path = `C:${path}`;
    else if (!/^[a-z]:\\/i.test(path)) path = `${this.cwd}\\${path}`;
    const parts: string[] = [];
    for (const seg of path.split('\\')) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') { if (parts.length > 1) parts.pop(); continue; }
      parts.push(seg);
    }
    return parts.length === 1 ? 'C:' : parts.join('\\');
  }

  private live(): { path: string; content: string; modified: string }[] {
    return this.w.files.filter((f) => !f.deleted);
  }

  isDir(path: string): boolean {
    const p = path.toLowerCase();
    if (p === 'c:' || this.dirs.has(p)) return true;
    return this.live().some((f) => f.path.toLowerCase().startsWith(`${p}\\`));
  }

  private children(dir: string): { name: string; dir: boolean; size: number; modified: string }[] {
    const base = dir.toLowerCase() === 'c:' ? 'C:' : dir;
    const lower = `${base.toLowerCase()}\\`;
    const seen = new Map<string, { name: string; dir: boolean; size: number; modified: string }>();
    for (const f of this.live()) {
      if (!f.path.toLowerCase().startsWith(lower)) continue;
      const rest = f.path.slice(lower.length);
      const first = rest.split('\\')[0]!;
      const isDir = rest.includes('\\');
      const prev = seen.get(first.toLowerCase());
      if (!prev) seen.set(first.toLowerCase(), { name: first, dir: isDir, size: isDir ? 0 : f.content.length, modified: f.modified });
      else if (f.modified > prev.modified) prev.modified = f.modified;
    }
    for (const d of this.dirs) {
      if (d.startsWith(lower) && !d.slice(lower.length).includes('\\')) {
        const name = d.slice(lower.length);
        if (!seen.has(name)) seen.set(name, { name: name.replace(/^./, (c) => c.toUpperCase()), dir: true, size: 0, modified: nowIso() });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private match(pattern: string, name: string): boolean {
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
    return re.test(name);
  }

  /** Files matching a path that may contain * and ?. */
  private glob(spec: string): string[] {
    const full = this.resolve(spec);
    const i = full.lastIndexOf('\\');
    const dir = full.slice(0, i);
    const pat = full.slice(i + 1);
    if (!/[*?]/.test(pat)) return fileExists(this.w, full) ? [full] : [];
    return this.children(dir).filter((c) => !c.dir && this.match(pat, c.name)).map((c) => `${dir}\\${c.name}`);
  }

  // ---------------------------------------------------------------- execution

  /** One logical line: may hold & && || and parenthesised blocks. */
  private exec(line: string, args: string[] | null): void {
    if (++this.steps > BAT_LIMIT) throw new Error('The batch file ran too many commands and was stopped (possible endless loop).');
    for (const { cmd, op } of splitOps(this.expand(line, args))) {
      if (op === '&&' && this.errorlevel !== 0) continue;
      if (op === '||' && this.errorlevel === 0) continue;
      this.one(cmd.trim(), args);
    }
  }

  private one(raw: string, args: string[] | null): void {
    let cmd = raw.replace(/^@/, '').trim();
    if (!cmd) return;
    if (cmd.startsWith('(') && cmd.endsWith(')')) {
      for (const l of cmd.slice(1, -1).split('\n')) this.exec(l, args);
      return;
    }
    cmd = this.expandDelayed(cmd);
    // Pipes and redirection.
    const pipes = splitTop(cmd, '|');
    if (pipes.length > 1) {
      const saved = this.out;
      this.out = [];
      this.one(pipes[0]!, args);
      let text = this.out.map((l) => l.text).join('\n');
      for (const stage of pipes.slice(1)) text = this.filter(stage.trim(), text);
      this.out = saved;
      if (text) this.print(text);
      return;
    }
    const redir = /\s*(2>&1|2>\s*nul|[12]?>>?\s*("[^"]+"|\S+))\s*$/i;
    let target: { path: string; append: boolean } | null = null;
    let quietErrors = false;
    for (let m = redir.exec(cmd); m; m = redir.exec(cmd)) {
      const r = m[1]!;
      cmd = cmd.slice(0, m.index).trimEnd();
      if (/^2>&1$/.test(r)) continue;
      if (/^2>\s*nul$/i.test(r)) { quietErrors = true; continue; }
      if (/^2>/.test(r)) { quietErrors = true; continue; }
      const dest = r.replace(/^1?>>?\s*/, '').replace(/^"|"$/g, '');
      target = { path: dest, append: r.includes('>>') };
    }
    if (target || quietErrors) {
      const saved = this.out;
      this.out = [];
      this.builtin(cmd, args);
      const produced = this.out;
      this.out = saved;
      const errors = produced.filter((l) => l.kind === 'err');
      const normal = produced.filter((l) => l.kind !== 'err');
      if (!quietErrors) this.out.push(...errors);
      if (target && target.path.toLowerCase() !== 'nul') {
        const p = this.resolve(target.path);
        const text = normal.map((l) => l.text).join('\r\n') + (normal.length ? '\r\n' : '');
        writeFile(this.w, p, target.append && fileExists(this.w, p) ? readFile(this.w, p) + text : text);
      } else if (!target) this.out.push(...normal);
      return;
    }
    this.builtin(cmd, args);
  }

  private filter(stage: string, text: string): string {
    const [name, ...rest] = tokens(stage);
    const lines = text.split('\n');
    const n = (name ?? '').toLowerCase();
    if (n === 'find' || n === 'findstr') {
      const flags = rest.filter((x) => x.startsWith('/')).map((x) => x.toLowerCase());
      const terms = rest.filter((x) => !x.startsWith('/')).map((x) => x.replace(/^"|"$/g, ''));
      const term = terms.join(' ');
      const ci = flags.includes('/i');
      const not = flags.includes('/v');
      const needles = n === 'findstr' && !term.includes('"') ? term.split(/\s+/).filter(Boolean) : [term];
      const hit = (l: string): boolean => needles.some((t) => (ci ? l.toLowerCase().includes(t.toLowerCase()) : l.includes(t)));
      const res = lines.filter((l) => hit(l) !== not);
      this.errorlevel = res.length ? 0 : 1;
      if (flags.includes('/c')) return String(res.length);
      return res.join('\n');
    }
    if (n === 'sort') return [...lines].sort((a, b) => a.localeCompare(b)).join('\n');
    if (n === 'more') return text;
    if (n === 'clip') return '';
    this.err(`'${name}' is not recognized as an internal or external command,\noperable program or batch file.`);
    return '';
  }

  private builtin(cmd: string, args: string[] | null): void {
    const m = /^(\S+?)(?=[\s.(/\\:]|$)(.*)$/s.exec(cmd);
    if (!m) return;
    let name = m[1]!.toLowerCase();
    let rest = m[2]!;
    if (name.startsWith('echo') && name !== 'echo') { rest = name.slice(4) + rest; name = 'echo'; }
    const argv = tokens(rest);
    const flag = (f: string): boolean => argv.some((a) => a.toLowerCase() === f.toLowerCase());
    this.errorlevel = 0;
    switch (name) {
      case 'rem': case '::': return;
      case 'echo': {
        const t = rest.replace(/^[\s.]/, '');
        if (/^(on|off)$/i.test(t.trim())) { this.echo = t.trim().toLowerCase() === 'on'; return; }
        if (!t.trim() && rest.length && rest[0] !== ' ') { this.print(''); return; }
        if (!t.trim()) { this.print(`ECHO is ${this.echo ? 'on' : 'off'}.`); return; }
        this.print(t);
        return;
      }
      case 'cls': this.out.push({ text: '\u0000CLEAR' }); return;
      case 'title': this.out.push({ text: `\u0000TITLE:${rest.trim()}` }); return;
      case 'color': return;
      case 'ver': this.print('\nMicrosoft Windows [Version 10.0.22631.4317]'); return;
      case 'cd': case 'chdir': {
        const p = argv.filter((a) => a.toLowerCase() !== '/d').join(' ');
        if (!p) { this.print(this.cwd); return; }
        const target = this.resolve(p);
        if (!this.isDir(target)) { this.err('The system cannot find the path specified.'); return; }
        this.cwd = target.length === 2 ? 'C:\\' : this.children(target.slice(0, target.lastIndexOf('\\'))).find((c) => c.name.toLowerCase() === target.slice(target.lastIndexOf('\\') + 1).toLowerCase()) ? this.canonical(target) : target;
        if (this.cwd === 'C:\\') this.cwd = 'C:';
        return;
      }
      case 'dir': return this.dir(argv);
      case 'type': {
        const files = argv.flatMap((a) => this.glob(a));
        if (!files.length) { this.err('The system cannot find the file specified.'); return; }
        for (const f of files) { if (files.length > 1) this.print(`\n${f.slice(f.lastIndexOf('\\') + 1)}\n\n`); this.print(readFile(this.w, f).replace(/\r\n/g, '\n').replace(/\n$/, '')); }
        return;
      }
      case 'more': {
        const files = argv.flatMap((a) => this.glob(a));
        if (!files.length) { this.err(argv.length ? `Cannot access file ${this.resolve(argv[0]!)}` : 'The syntax of the command is incorrect.'); return; }
        for (const f of files) this.print(readFile(this.w, f).replace(/\r\n/g, '\n').replace(/\n$/, ''));
        return;
      }
      case 'find': {
        // find [/i] [/v] [/c] [/n] "text" file...
        const flags = argv.filter((a) => /^\/[ivcn]$/i.test(a)).map((a) => a[1]!.toLowerCase());
        const rest = argv.filter((a) => !/^\/[ivcn]$/i.test(a));
        // The search text is always quoted on Windows; the quotes are not part of it.
        const needle = rest[0]?.replace(/^"(.*)"$/, '$1');
        if (!needle) { this.err('FIND: Parameter format not correct'); return; }
        const files = rest.slice(1).flatMap((a) => this.glob(a));
        if (!files.length) { this.err(rest[1] ? `File not found - ${rest[1].toUpperCase()}` : 'FIND: Parameter format not correct'); return; }
        const ci = flags.includes('i');
        for (const f of files) {
          const lines = readFile(this.w, f).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
          const hits = lines.map((l, i) => ({ l, i })).filter(({ l }) => (ci ? l.toLowerCase().includes(needle.toLowerCase()) : l.includes(needle)) !== flags.includes('v'));
          if (flags.includes('c')) { this.print(`---------- ${f.toUpperCase()}: ${hits.length}`); continue; }
          this.print(`\n---------- ${f.toUpperCase()}`);
          for (const { l, i } of hits) this.print(flags.includes('n') ? `[${i + 1}]${l}` : l);
        }
        return;
      }
      case 'attrib': {
        const files = argv.length ? argv.filter((a) => !/^[+-\/]/.test(a)).flatMap((a) => this.glob(a)) : this.glob('*');
        if (!files.length) { this.err(`File not found - ${argv[0] ?? '*'}`); return; }
        for (const f of files) this.print(`A                    ${f}`);
        return;
      }
      case 'vol':
        this.print(' Volume in drive C has no label.\n Volume Serial Number is 6E2C-1A9F');
        return;
      case 'path':
        if (argv.length) { this.err('Changing PATH is blocked by policy on this workstation.'); return; }
        this.print('PATH=C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\Wbem;C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\;C:\\Windows\\System32\\OpenSSH\\');
        return;
      case 'netstat':
        this.print([
          '', 'Active Connections', '',
          '  Proto  Local Address          Foreign Address        State',
          `  TCP    10.10.20.15:49702      MHS-DC01:ldap          ESTABLISHED`,
          `  TCP    10.10.20.15:49705      MHS-DC01:microsoft-ds  ESTABLISHED`,
          `  TCP    10.10.20.15:49711      MHS-FS01:microsoft-ds  ESTABLISHED`,
          `  TCP    10.10.20.15:49733      MHS-DC01:kerberos      TIME_WAIT`,
          `  TCP    10.10.20.15:49760      outlook.office365:https  ESTABLISHED`,
        ].join('\n'));
        return;
      case 'calc': case 'calc.exe':
        this.out.push({ text: '\u0000OPEN:app:calc' });
        return;
      case 'copy': case 'xcopy': {
        const [src, dst] = argv.filter((a) => !a.startsWith('/'));
        if (!src) { this.err('The syntax of the command is incorrect.'); return; }
        const files = this.glob(src);
        if (!files.length) { this.err('The system cannot find the file specified.'); return; }
        const dest = this.resolve(dst ?? '.');
        for (const f of files) {
          if (this.isDir(dest)) copyFile(this.w, f, dest);
          else writeFile(this.w, dest, readFile(this.w, f));
        }
        this.print(`        ${files.length} file(s) copied.`);
        return;
      }
      case 'move': {
        const [src, dst] = argv.filter((a) => !a.startsWith('/'));
        const files = src ? this.glob(src) : [];
        if (!files.length || !dst) { this.err('The system cannot find the file specified.'); return; }
        const dest = this.resolve(dst);
        for (const f of files) {
          const to = this.isDir(dest) ? `${dest}\\${f.slice(f.lastIndexOf('\\') + 1)}` : dest;
          writeFile(this.w, to, readFile(this.w, f));
          deleteFile(this.w, f);
        }
        this.print(`        ${files.length} file(s) moved.`);
        return;
      }
      case 'del': case 'erase': {
        const files = argv.filter((a) => !a.startsWith('/')).flatMap((a) => this.glob(a));
        if (!files.length) { this.err(`Could Not Find ${this.resolve(argv.filter((a) => !a.startsWith('/'))[0] ?? '')}`); return; }
        for (const f of files) deleteFile(this.w, f);
        return;
      }
      case 'ren': case 'rename': {
        const [src, name2] = argv;
        if (!src || !name2) { this.err('The syntax of the command is incorrect.'); return; }
        const full = this.resolve(src);
        if (!fileExists(this.w, full)) { this.err('The system cannot find the file specified.'); return; }
        renameFile(this.w, full, name2.replace(/^"|"$/g, ''));
        return;
      }
      case 'md': case 'mkdir': {
        for (const a of argv) {
          const p = this.resolve(a);
          if (this.isDir(p)) { this.err(`A subdirectory or file ${a} already exists.`); continue; }
          this.dirs.add(p.toLowerCase());
        }
        return;
      }
      case 'rd': case 'rmdir': {
        const p = this.resolve(argv.filter((a) => !a.startsWith('/'))[0] ?? '');
        if (!this.isDir(p)) { this.err('The system cannot find the file specified.'); return; }
        const inside = this.live().filter((f) => f.path.toLowerCase().startsWith(`${p.toLowerCase()}\\`));
        if (inside.length && !flag('/s')) { this.err('The directory is not empty.'); return; }
        for (const f of inside) deleteFile(this.w, f.path);
        this.dirs.delete(p.toLowerCase());
        return;
      }
      case 'tree': return this.tree(this.resolve(argv[0] ?? '.'));
      case 'set': return this.set(rest.trim());
      case 'setlocal':
        this.stack.push(new Map(this.env));
        if (/enabledelayedexpansion/i.test(rest)) this.delayed = true;
        return;
      case 'endlocal': { const prev = this.stack.pop(); if (prev) this.env = prev; this.delayed = false; return; }
      case 'pause': this.print('Press any key to continue . . . '); return;
      case 'timeout': { const n = argv[argv.findIndex((a) => a.toLowerCase() === '/t') + 1] ?? argv[0] ?? '0'; this.print(`\nWaiting for ${n} seconds, press a key to continue ...0`); return; }
      case 'exit': {
        const code = Number(argv.find((a) => /^\d+$/.test(a)) ?? 0);
        this.errorlevel = code;
        if (flag('/b')) throw new ExitSignal(true);
        this.out.push({ text: '\u0000EXIT' });
        throw new ExitSignal(false);
      }
      case 'if': return this.iff(rest.trim(), args);
      case 'for': return this.forLoop(rest.trim(), args);
      case 'goto': case 'call': throw new Error(`${name.toUpperCase()} can only be used in a batch file.`);
      case 'whoami': return this.whoami(argv);
      case 'hostname': this.print(this.host); return;
      case 'ipconfig': return this.ipconfig(flag('/all'));
      case 'ping': {
        const host = argv.find((a) => !a.startsWith('-') && !a.startsWith('/')) ?? '';
        const comp = this.w.ad.computers.find((c) => c.name.toLowerCase() === host.toLowerCase().replace(`.${this.w.ad.domain}`, ''));
        if (!comp && !/^(\d+\.){3}\d+$/.test(host) && !/^(localhost|mhs-dc01)/i.test(host)) { this.err(`Ping request could not find host ${host}. Please check the name and try again.`); return; }
        const ip = comp?.ip ?? (/^(\d+\.){3}\d+$/.test(host) ? host : '10.10.0.10');
        this.print(`\nPinging ${host} [${ip}] with 32 bytes of data:`);
        for (let i = 0; i < 4; i++) this.print(`Reply from ${ip}: bytes=32 time<1ms TTL=128`);
        this.print(`\nPing statistics for ${ip}:\n    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),\nApproximate round trip times in milli-seconds:\n    Minimum = 0ms, Maximum = 1ms, Average = 0ms`);
        return;
      }
      case 'nslookup': {
        const host = argv[0] ?? '';
        const comp = this.w.ad.computers.find((c) => c.name.toLowerCase() === host.toLowerCase().split('.')[0]);
        this.print(`Server:  MHS-DC01.${this.w.ad.domain}\nAddress:  10.10.0.10\n`);
        if (comp) this.print(`Name:    ${comp.name}.${this.w.ad.domain}\nAddress:  ${comp.ip}`);
        else this.err(`*** MHS-DC01.${this.w.ad.domain} can't find ${host}: Non-existent domain`);
        return;
      }
      case 'net': return this.net(argv);
      case 'gpupdate': this.print('Updating policy...\n\nComputer Policy update has completed successfully.\nUser Policy update has completed successfully.\n'); return;
      case 'gpresult': return this.gpresult();
      case 'klist': return this.klist();
      case 'systeminfo': this.print(`\nHost Name:                 ${this.host}\nOS Name:                   Microsoft Windows 11 Enterprise\nOS Version:                10.0.22631 N/A Build 22631\nOS Manufacturer:           Microsoft Corporation\nOS Configuration:          Member Workstation\nRegistered Owner:          ${this.w.company.name}\nSystem Type:               x64-based PC\nTotal Physical Memory:     16,083 MB\nDomain:                    ${this.w.ad.domain}\nLogon Server:              \\\\MHS-DC01\nHotfix(s):                 3 Hotfix(s) Installed.\n`); return;
      case 'tasklist': this.print('\nImage Name                     PID Session Name        Session#    Mem Usage\n========================= ======== ================ =========== ============\nSystem                           4 Services                   0        144 K\nlsass.exe                      804 Services                   0     22,412 K\nexplorer.exe                  5124 Console                    1    168,220 K\nchrome.exe                    7744 Console                    1    312,904 K\nWindowsTerminal.exe           9012 Console                    1     74,316 K\ncmd.exe                       9120 Console                    1      4,688 K'); return;
      case 'date': this.print(flag('/t') ? this.get('DATE')! : `The current date is: ${this.get('DATE')}`); return;
      case 'time': this.print(flag('/t') ? new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : `The current time is: ${this.get('TIME')}`); return;
      case 'where': {
        const known = ['cmd', 'powershell', 'notepad', 'ping', 'whoami', 'net', 'ipconfig', 'gpupdate', 'nslookup', 'klist', 'mstsc', 'explorer'];
        const n = (argv[0] ?? '').toLowerCase().replace(/\.exe$/, '');
        if (known.includes(n)) this.print(`C:\\Windows\\System32\\${n === 'powershell' ? 'WindowsPowerShell\\v1.0\\' : ''}${n}.exe`);
        else this.err('INFO: Could not find files for the given pattern(s).');
        return;
      }
      case 'help': this.print(HELP); return;
      case 'cmd': {
        const c = argv.findIndex((a) => /^\/[ck]$/i.test(a));
        if (c >= 0) this.exec(argv.slice(c + 1).join(' '), args);
        else this.print('Microsoft Windows [Version 10.0.22631.4317]\n(c) Microsoft Corporation. All rights reserved.');
        return;
      }
      case 'powershell': case 'pwsh': case 'powershell.exe': {
        const c = argv.findIndex((a) => /^-c(ommand)?$/i.test(a));
        const f = argv.findIndex((a) => /^-f(ile)?$/i.test(a));
        if (c >= 0) { this.out.push(...this.hooks.powershell(argv.slice(c + 1).join(' ').replace(/^"|"$/g, ''), this.cwd)); return; }
        if (f >= 0) { this.out.push(...this.hooks.powershell(`& '${this.resolve(argv[f + 1] ?? '')}'`, this.cwd)); return; }
        this.out.push({ text: '\u0000SWITCH:powershell' });
        return;
      }
      case 'start': {
        const target = argv.filter((a) => !a.startsWith('/')).map((a) => a.replace(/^"|"$/g, '')).filter(Boolean).pop() ?? '';
        this.open(target);
        return;
      }
      case 'notepad': case 'notepad.exe': this.out.push({ text: `\u0000OPEN:notepad:${argv[0] ? this.resolve(argv[0]) : ''}` }); return;
      case 'notepad++': case 'notepad++.exe': this.out.push({ text: `\u0000OPEN:npp:${argv[0] ? this.resolve(argv[0].replace(/^"|"$/g, '')) : ''}` }); return;
      case 'pdfxedit': case 'pdfxedit.exe': this.out.push({ text: argv[0] ? `\u0000OPEN:file:${this.resolve(argv[0].replace(/^"|"$/g, ''))}` : '\u0000OPEN:app:pdfxedit' }); return;
      case 'explorer': case 'explorer.exe': this.out.push({ text: `\u0000OPEN:explorer:${this.resolve(argv[0] ?? '.')}` }); return;
      case 'mstsc': case 'mstsc.exe': this.out.push({ text: '\u0000OPEN:app:mstsc' }); return;
      case 'shutdown': this.err('Access is denied.(5)'); return;
    }
    // A program or script on disk.
    const file = this.findRunnable(m[1]!);
    if (file) {
      if (/\.(bat|cmd)$/i.test(file)) { this.batch(file, [file, ...argv]); return; }
      if (/\.ps1$/i.test(file)) { this.out.push(...this.hooks.powershell(`& '${file}' ${argv.join(' ')}`, this.cwd)); return; }
      this.open(file);
      return;
    }
    if (/^(dsa\.msc|eventvwr(\.msc)?|control|ms-settings:|wt|chrome|msedge|powershell_ise|notepad\+\+|pdfxedit)$/i.test(m[1]!)) { this.out.push({ text: `\u0000OPEN:app:${m[1]!.toLowerCase()}` }); return; }
    this.err(`'${m[1]}' is not recognized as an internal or external command,\noperable program or batch file.`);
    this.errorlevel = 9009;
  }

  private canonical(p: string): string {
    const parts = p.split('\\');
    let cur = 'C:';
    for (const seg of parts.slice(1)) {
      const hit = this.children(cur).find((c) => c.name.toLowerCase() === seg.toLowerCase());
      cur = `${cur}\\${hit?.name ?? seg}`;
    }
    return cur;
  }

  private findRunnable(name: string): string | null {
    const raw = name.replace(/^"|"$/g, '');
    for (const ext of ['', '.bat', '.cmd', '.ps1']) {
      const p = this.resolve(raw + ext);
      if (fileExists(this.w, p)) return p;
    }
    return null;
  }

  private open(target: string): void {
    if (!target) { this.out.push({ text: '\u0000OPEN:app:cmd' }); return; }
    if (/^https?:\/\//i.test(target)) { this.out.push({ text: `\u0000OPEN:url:${target}` }); return; }
    const p = this.resolve(target);
    if (fileExists(this.w, p)) { this.out.push({ text: `\u0000OPEN:file:${p}` }); return; }
    if (this.isDir(p)) { this.out.push({ text: `\u0000OPEN:explorer:${p}` }); return; }
    this.out.push({ text: `\u0000OPEN:app:${target.toLowerCase()}` });
  }

  // ---------------------------------------------------------------- set, if, for

  private set(rest: string): void {
    if (!rest) { for (const [k, v] of [...this.env].sort()) this.print(`${k}=${v}`); return; }
    const a = /^\/a\s+(.*)$/i.exec(rest);
    if (a) { const r = this.arith(a[1]!.replace(/^"|"$/g, '')); this.print(String(r)); this.out.pop(); return; }
    const p = /^\/p\s+"?([^=]+)=([^"]*)"?$/i.exec(rest);
    if (p) { const v = this.hooks.ask(p[2]!); if (v !== null) this.env.set(p[1]!.trim().toUpperCase(), v); return; }
    const kv = /^"?([^=]+)=(.*?)"?$/.exec(rest);
    if (!kv) {
      const prefix = rest.toUpperCase();
      const hits = [...this.env].filter(([k]) => k.startsWith(prefix)).sort();
      if (!hits.length) { this.err(`Environment variable ${rest} not defined`); return; }
      for (const [k, v] of hits) this.print(`${k}=${v}`);
      return;
    }
    const key = kv[1]!.trim().toUpperCase();
    if (kv[2] === '') this.env.delete(key); else this.env.set(key, kv[2]!);
  }

  /** set /a: integer arithmetic with variables, + - * / % and parentheses, = += -= *= /=. */
  private arith(expr: string): number {
    let last = 0;
    for (const part of expr.split(',')) {
      const asg = /^\s*([A-Za-z_][\w]*)\s*([+\-*/%]?=)\s*(.+)$/.exec(part);
      const value = (e: string): number => {
        const safe = e.replace(/[A-Za-z_]\w*/g, (n) => String(Number(this.get(n) ?? 0) || 0));
        if (!/^[\d\s+\-*/%()]*$/.test(safe)) throw new Error('Missing operand.');
        return evalInt(safe || '0');
      };
      if (asg) {
        const cur = Number(this.get(asg[1]!) ?? 0) || 0;
        const v = value(asg[3]!);
        const next = asg[2] === '=' ? v : asg[2] === '+=' ? cur + v : asg[2] === '-=' ? cur - v : asg[2] === '*=' ? cur * v : asg[2] === '/=' ? Math.trunc(cur / v) : cur % v;
        this.env.set(asg[1]!.toUpperCase(), String(next));
        last = next;
      } else last = value(part);
    }
    return last;
  }

  private iff(rest: string, args: string[] | null): void {
    let s = rest;
    let ci = false;
    let not = false;
    if (/^\/i\s+/i.test(s)) { ci = true; s = s.replace(/^\/i\s+/i, ''); }
    if (/^not\s+/i.test(s)) { not = true; s = s.replace(/^not\s+/i, ''); }
    let cond = false;
    let body = '';
    let m: RegExpExecArray | null;
    if ((m = /^exist\s+("[^"]+"|\S+)\s+(.*)$/is.exec(s))) {
      const p = this.resolve(m[1]!);
      cond = fileExists(this.w, p) || this.isDir(p) || this.glob(m[1]!).length > 0;
      body = m[2]!;
    } else if ((m = /^defined\s+(\S+)\s+(.*)$/is.exec(s))) {
      cond = this.get(m[1]!) !== undefined;
      body = m[2]!;
    } else if ((m = /^errorlevel\s+(\d+)\s+(.*)$/is.exec(s))) {
      cond = this.errorlevel >= Number(m[1]);
      body = m[2]!;
    } else if ((m = /^("[^"]*"|\S*?)\s*(==|\s(?:equ|neq|lss|leq|gtr|geq)\s)\s*("[^"]*"|\S+)\s+(.*)$/is.exec(s))) {
      const a = m[1]!.replace(/^"|"$/g, '');
      const b = m[3]!.replace(/^"|"$/g, '');
      const op = m[2]!.trim().toLowerCase();
      const num = /^-?\d+$/.test(a) && /^-?\d+$/.test(b);
      const cmp = num ? Number(a) - Number(b) : ci ? a.toLowerCase().localeCompare(b.toLowerCase()) : a === b ? 0 : a < b ? -1 : 1;
      cond = op === '==' ? (ci ? a.toLowerCase() === b.toLowerCase() : a === b) : op === 'equ' ? cmp === 0 : op === 'neq' ? cmp !== 0 : op === 'lss' ? cmp < 0 : op === 'leq' ? cmp <= 0 : op === 'gtr' ? cmp > 0 : cmp >= 0;
      body = m[4]!;
    } else { this.err('The syntax of the command is incorrect.'); return; }
    if (not) cond = !cond;
    const [then, otherwise] = splitElse(body);
    if (cond) this.one(then, args);
    else if (otherwise) this.one(otherwise, args);
  }

  private forLoop(rest: string, args: string[] | null): void {
    const m = /^(\/[lfdr]\s+)?(?:("[^"]*")\s+)?%%?([a-z])\s+in\s*\((.*?)\)\s*do\s+(.*)$/is.exec(rest);
    if (!m) { this.err('The syntax of the command is incorrect.'); return; }
    const mode = (m[1] ?? '').trim().toLowerCase();
    const opts = (m[2] ?? '').replace(/^"|"$/g, '');
    const v = m[3]!;
    const set = m[4]!.trim();
    const body = m[5]!;
    const run = (values: Record<string, string>): void => {
      let b = body;
      for (const [k, val] of Object.entries(values)) b = b.replace(new RegExp(`%%?${k}`, 'g'), val);
      this.one(b, args);
    };
    if (mode === '/l') {
      const [start, step, end] = set.split(/[\s,]+/).map(Number) as [number, number, number];
      if (!step) return;
      for (let i = start; step > 0 ? i <= end : i >= end; i += step) run({ [v]: String(i) });
      return;
    }
    if (mode === '/f') {
      const delims = /delims=([^"]*?)(?:\s+\w+=|$)/i.exec(opts)?.[1] ?? ' \t';
      const tokSpec = /tokens=([\d,\-*]+)/i.exec(opts)?.[1] ?? '1';
      const skip = Number(/skip=(\d+)/i.exec(opts)?.[1] ?? 0);
      let lines: string[];
      if (/^".*"$/.test(set)) lines = [set.slice(1, -1)];
      else if (/^'.*'$/.test(set)) {
        const saved = this.out; this.out = []; this.exec(set.slice(1, -1), args); lines = this.out.map((l) => l.text); this.out = saved;
      } else lines = this.glob(set).flatMap((f) => readFile(this.w, f).split(/\r?\n/));
      const wanted: number[] = [];
      let star = false;
      for (const part of tokSpec.split(',')) {
        if (part === '*') star = true;
        else if (part.includes('-')) { const [a, b] = part.split('-').map(Number) as [number, number]; for (let i = a; i <= b; i++) wanted.push(i); }
        else if (part.endsWith('*')) { wanted.push(Number(part.slice(0, -1))); star = true; }
        else wanted.push(Number(part));
      }
      const splitter = new RegExp(`[${delims.replace(/[\]\\^-]/g, '\\$&') || ' '}]+`);
      for (const line of lines.slice(skip)) {
        if (!line.trim() || line.startsWith(';')) continue;
        const parts = delims ? line.split(splitter).filter((x, i) => x !== '' || i > 0) : [line];
        const values: Record<string, string> = {};
        wanted.forEach((n, i) => { values[String.fromCharCode(v.charCodeAt(0) + i)] = parts[n - 1] ?? ''; });
        if (star) values[String.fromCharCode(v.charCodeAt(0) + wanted.length)] = parts.slice(Math.max(...wanted, 0)).join(delims[0] ?? ' ');
        run(values);
      }
      return;
    }
    for (const item of tokens(set)) {
      const files = /[*?]/.test(item) ? this.glob(item).map((f) => (item.includes('\\') ? f : f.slice(f.lastIndexOf('\\') + 1))) : [item];
      for (const f of files) run({ [v]: f });
    }
  }

  // ---------------------------------------------------------------- batch files

  private batch(path: string, args: string[]): void {
    const full = this.resolve(path);
    if (!fileExists(this.w, full)) { this.err('The system cannot find the path specified.'); return; }
    const lines = joinBlocks(readFile(this.w, full).split(/\r?\n/));
    const labels = new Map<string, number>();
    lines.forEach((l, i) => { const lab = /^\s*:([^\s:]+)/.exec(l); if (lab && !l.trim().startsWith('::')) labels.set(lab[1]!.toLowerCase(), i); });
    const argv = args.length ? args : [full];
    const savedEcho = this.echo;
    const runFrom = (start: number, local: string[]): void => {
      for (let i = start; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (this.echo && !trimmed.startsWith('@')) this.print(`\n${this.prompt()}${this.expand(trimmed, local)}`);
        const expanded = this.expand(trimmed, local).replace(/^@/, '').trim();
        const go = /^goto\s+:?(\S+)/i.exec(expanded);
        if (go) {
          if (go[1]!.toLowerCase() === 'eof') return;
          const to = labels.get(go[1]!.toLowerCase());
          if (to === undefined) { this.err('The system cannot find the batch label specified - ' + go[1]); return; }
          i = to;
          continue;
        }
        const call = /^call\s+(\S+)(.*)$/i.exec(expanded);
        if (call) {
          const callArgs = tokens(call[2]!);
          if (call[1]!.startsWith(':')) {
            const to = labels.get(call[1]!.slice(1).toLowerCase());
            if (to === undefined) { this.err('The system cannot find the batch label specified - ' + call[1]!.slice(1)); continue; }
            try { runFrom(to + 1, [call[1]!, ...callArgs]); } catch (e) { if (!(e instanceof ExitSignal && e.batchOnly)) throw e; }
          } else {
            const f = this.findRunnable(call[1]!);
            if (f && /\.(bat|cmd)$/i.test(f)) { try { this.batch(f, [f, ...callArgs]); } catch (e) { if (!(e instanceof ExitSignal && e.batchOnly)) throw e; } }
            else this.exec(call[1]! + call[2]!, local);
          }
          continue;
        }
        if (++this.steps > BAT_LIMIT) throw new Error('The batch file ran too many commands and was stopped (possible endless loop).');
        for (const { cmd, op } of splitOps(expanded)) {
          if (op === '&&' && this.errorlevel !== 0) continue;
          if (op === '||' && this.errorlevel === 0) continue;
          const g = /^goto\s+:?(\S+)/i.exec(cmd.trim());
          if (g) {
            if (g[1]!.toLowerCase() === 'eof') return;
            const to = labels.get(g[1]!.toLowerCase());
            if (to !== undefined) { i = to; break; }
          }
          this.one(cmd.trim(), local);
        }
      }
    };
    try {
      runFrom(0, argv);
    } catch (e) {
      if (!(e instanceof ExitSignal && e.batchOnly)) throw e;
    } finally {
      this.echo = savedEcho;
    }
  }

  // ---------------------------------------------------------------- listings

  private dir(argv: string[]): void {
    const bare = argv.some((a) => a.toLowerCase() === '/b');
    const spec = argv.find((a) => !a.startsWith('/')) ?? '.';
    let dir = this.resolve(spec);
    let pattern = '*';
    if (!this.isDir(dir)) { pattern = dir.slice(dir.lastIndexOf('\\') + 1); dir = dir.slice(0, dir.lastIndexOf('\\')); }
    if (!this.isDir(dir)) { this.err('File Not Found'); return; }
    const items = this.children(dir).filter((c) => this.match(pattern, c.name));
    if (!items.length && pattern !== '*') { this.err('File Not Found'); return; }
    if (bare) { this.print(items.map((i) => i.name).join('\n')); return; }
    const when = (iso: string): string => {
      const d = new Date(iso);
      return `${d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}  ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    };
    const files = items.filter((i) => !i.dir);
    const bytes = files.reduce((n, f) => n + f.size, 0);
    this.print(` Volume in drive C has no label.\n Volume Serial Number is 6E2C-1A9F\n\n Directory of ${this.canonical(dir)}\n`);
    const now = nowIso();
    if (dir.length > 2) this.print(`${when(now)}    <DIR>          .\n${when(now)}    <DIR>          ..`);
    for (const i of items) this.print(`${when(i.modified)}    ${i.dir ? '<DIR>         ' : i.size.toLocaleString('en-US').padStart(14)} ${i.name}`);
    this.print(`${String(files.length).padStart(16)} File(s) ${bytes.toLocaleString('en-US').padStart(14)} bytes\n${String(items.length - files.length + (dir.length > 2 ? 2 : 0)).padStart(16)} Dir(s)  212,345,678,912 bytes free`);
  }

  private tree(dir: string): void {
    this.print(`Folder PATH listing\nVolume serial number is 6E2C-1A9F\n${this.canonical(dir)}`);
    const walk = (d: string, prefix: string, depth: number): void => {
      const subs = this.children(d).filter((c) => c.dir);
      subs.forEach((s, i) => {
        const last = i === subs.length - 1;
        this.print(`${prefix}${last ? '\\---' : '+---'}${s.name}`);
        if (depth < 6) walk(`${d}\\${s.name}`, `${prefix}${last ? '    ' : '|   '}`, depth + 1);
      });
    };
    walk(dir, '', 0);
  }

  // ---------------------------------------------------------------- identity tools

  private whoami(argv: string[]): void {
    const w = this.w;
    const sam = this.user;
    const u = findUser(w, sam);
    const f = argv.map((a) => a.toLowerCase());
    if (f.includes('/upn')) { this.print(u?.upn ?? `${sam}@${w.ad.domain}`); return; }
    if (f.includes('/fqdn')) { this.print(`CN=${u?.displayName ?? sam},OU=${u?.ou.split('/').reverse().join(',OU=') ?? 'Users'},DC=${w.ad.domain.split('.').join(',DC=')}`); return; }
    const userLine = `${w.ad.netbios.toLowerCase()}\\${sam}`;
    if (!f.length) { this.print(userLine); return; }
    if (f.includes('/user') || f.includes('/all')) this.print(`\nUSER INFORMATION\n----------------\n\nUser Name${' '.repeat(Math.max(1, userLine.length - 8))} SID\n${'='.repeat(userLine.length)} ${'='.repeat(46)}\n${userLine} S-1-5-21-3623811015-3361044348-30300820-1104`);
    if (f.includes('/groups') || f.includes('/all')) {
      const groups = u ? principalGroups(u) : ['Domain Users'];
      this.print('\nGROUP INFORMATION\n-----------------\n\nGroup Name                                    Type             Attributes\n============================================= ================ ==================================================');
      this.print('Everyone                                      Well-known group Mandatory group, Enabled by default, Enabled group');
      this.print('BUILTIN\\Users                                 Alias            Mandatory group, Enabled by default, Enabled group');
      for (const g of groups) this.print(`${`${w.ad.netbios}\\${g}`.padEnd(45)} Group            Mandatory group, Enabled by default, Enabled group`);
    }
  }

  private ipconfig(all: boolean): void {
    this.print('\nWindows IP Configuration\n');
    if (all) this.print(`   Host Name . . . . . . . . . . . . : ${this.host}\n   Primary Dns Suffix  . . . . . . . : ${this.w.ad.domain}\n   Node Type . . . . . . . . . . . . : Hybrid\n   IP Routing Enabled. . . . . . . . : No\n   DNS Suffix Search List. . . . . . : ${this.w.ad.domain}\n`);
    this.print(`Ethernet adapter Ethernet:\n\n   Connection-specific DNS Suffix  . : ${this.w.ad.domain}`);
    if (all) this.print('   Description . . . . . . . . . . . : Intel(R) Ethernet Connection (16) I219-LM\n   Physical Address. . . . . . . . . : 00-15-5D-4A-21-0F\n   DHCP Enabled. . . . . . . . . . . : Yes');
    this.print('   IPv4 Address. . . . . . . . . . . : 10.10.20.15\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . : 10.10.20.1');
    if (all) this.print('   DNS Servers . . . . . . . . . . . : 10.10.0.10');
  }

  private gpresult(): void {
    const u = findUser(this.w, this.user);
    this.print(`\nMicrosoft (R) Windows (R) Operating System Group Policy Result tool v2.0\n\nRSOP data for ${this.w.ad.netbios}\\${this.user} on ${this.host} : Logging Mode\n\nOS Configuration:            Member Workstation\nSite Name:                   Boston-Main\nDomain Name:                 ${this.w.ad.netbios}\nDomain Type:                 Windows 2008 or later\n\nUSER SETTINGS\n--------------\n    Last time Group Policy was applied: ${new Date().toLocaleString('en-US')}\n    Group Policy was applied from:      MHS-DC01.${this.w.ad.domain}\n\n    Applied Group Policy Objects\n    -----------------------------\n        MHS - User Baseline\n        MHS - IAM Operations Drive Maps\n        Default Domain Policy\n\n    The user is a part of the following security groups\n    ---------------------------------------------------`);
    for (const g of u ? principalGroups(u) : ['Domain Users']) this.print(`        ${g}`);
  }

  private klist(): void {
    const realm = this.w.ad.domain.toUpperCase();
    this.print(`\nCurrent LogonId is 0:0x3e7a1c\n\nCached Tickets: (2)\n\n#0>     Client: ${this.user} @ ${realm}\n        Server: krbtgt/${realm} @ ${realm}\n        KerbTicket Encryption Type: AES-256-CTS-HMAC-SHA1-96\n        Ticket Flags 0x40e10000 -> forwardable renewable initial pre_authent name_canonicalize\n        Kdc Called: MHS-DC01.${this.w.ad.domain}\n\n#1>     Client: ${this.user} @ ${realm}\n        Server: ldap/MHS-DC01.${this.w.ad.domain} @ ${realm}\n        KerbTicket Encryption Type: AES-256-CTS-HMAC-SHA1-96\n        Kdc Called: MHS-DC01.${this.w.ad.domain}`);
  }

  private net(argv: string[]): void {
    const sub = (argv[0] ?? '').toLowerCase();
    const domain = argv.some((a) => a.toLowerCase() === '/domain');
    const names = argv.slice(1).filter((a) => !a.startsWith('/')).map((a) => a.replace(/^"|"$/g, ''));
    const fmt = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-US').replace(',', '') : 'Never');
    const done = (): void => this.print('The command completed successfully.\n');
    const cols = (items: string[], width: number): string[] => {
      const rows: string[] = [];
      for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3).map((x) => x.padEnd(width)).join('').trimEnd());
      return rows;
    };
    if (sub === 'user' || sub === 'users') {
      if (domain) this.print(`The request will be processed at a domain controller for domain ${this.w.ad.domain}.\n`);
      if (!names.length) {
        this.print(`\nUser accounts for \\\\${domain ? 'MHS-DC01' : this.host}\n\n${'-'.repeat(79)}`);
        const list = domain ? this.w.ad.users.map((u) => u.sam).sort() : ['Administrator', 'DefaultAccount', 'Guest', 'WDAGUtilityAccount'];
        for (const r of cols(list, 25)) this.print(r);
        done();
        return;
      }
      if (!domain) { this.err(`The user name could not be found.\n\nMore help is available by typing NET HELPMSG 2221.`); this.errorlevel = 2; return; }
      const u = findUser(this.w, names[0]!);
      if (!u) { this.err('The user name could not be found.\n\nMore help is available by typing NET HELPMSG 2221.'); this.errorlevel = 2; return; }
      const pwdExp = u.passwordNeverExpires ? 'Never' : fmt(new Date(Date.parse(u.pwdLastSet) + 90 * 864e5).toISOString());
      const row = (k: string, v: string): void => this.print(`${k.padEnd(29)}${v}`);
      row('User name', u.sam); row('Full Name', u.displayName); row('Comment', u.description); row("User's comment", ''); row('Country/region code', '000 (System Default)');
      row('Account active', u.lockedOut ? 'Locked' : u.enabled ? 'Yes' : 'No');
      row('Account expires', fmt(u.accountExpires)); this.print('');
      row('Password last set', u.mustChangePassword ? 'Never (must change at next logon)' : fmt(u.pwdLastSet)); row('Password expires', pwdExp); row('Password changeable', fmt(u.pwdLastSet));
      row('Password required', 'Yes'); row('User may change password', 'Yes'); this.print('');
      row('Workstations allowed', 'All'); row('Logon script', ''); row('User profile', ''); row('Home directory', ''); row('Last logon', fmt(u.lastLogon)); this.print('');
      row('Logon hours allowed', 'All'); this.print('');
      row('Local Group Memberships', '');
      const g = principalGroups(u).map((x) => `*${x}`);
      cols(g, 22).forEach((r, i) => this.print(`${(i === 0 ? 'Global Group memberships' : '').padEnd(29)}${r}`));
      done();
      return;
    }
    if (sub === 'group' || sub === 'groups') {
      if (!domain) { this.err('This command can be used only on a Windows Domain Controller.\n\nMore help is available by typing NET HELPMSG 3515.'); this.errorlevel = 2; return; }
      this.print(`The request will be processed at a domain controller for domain ${this.w.ad.domain}.\n`);
      if (!names.length) {
        this.print(`\nGroup Accounts for \\\\MHS-DC01\n\n${'-'.repeat(79)}`);
        for (const g of this.w.ad.groups.map((x) => `*${x.name}`).sort()) this.print(g);
        done();
        return;
      }
      const grp = findGroup(this.w, names[0]!);
      if (!grp) { this.err('The group name could not be found.\n\nMore help is available by typing NET HELPMSG 2220.'); this.errorlevel = 2; return; }
      const members = grp.name === 'Domain Users' ? this.w.ad.users.map((u) => u.sam) : this.w.ad.users.filter((u) => u.memberOf.includes(grp.name)).map((u) => u.sam);
      this.print(`Group name     ${grp.name}\nComment        ${grp.description}\n\nMembers\n\n${'-'.repeat(79)}`);
      for (const r of cols(members.sort(), 25)) this.print(r);
      done();
      return;
    }
    if (sub === 'localgroup') {
      if ((names[0] ?? '').toLowerCase() === 'administrators') this.print(`Alias name     administrators\nComment        Administrators have complete and unrestricted access to the computer/domain\n\nMembers\n\n${'-'.repeat(79)}\nAdministrator\n${this.w.ad.netbios}\\Domain Admins\n${this.w.ad.netbios}\\grp-iam-admins`);
      else this.print(`\nAliases for \\\\${this.host}\n\n${'-'.repeat(79)}\n*Administrators\n*Remote Desktop Users\n*Users`);
      done();
      return;
    }
    if (sub === 'accounts') {
      this.print(`${domain ? `The request will be processed at a domain controller for domain ${this.w.ad.domain}.\n\n` : ''}Force user logoff how long after time expires?:       Never\nMinimum password age (days):                          1\nMaximum password age (days):                          90\nMinimum password length:                              12\nLength of password history maintained:                24\nLockout threshold:                                    5\nLockout duration (minutes):                           30\nLockout observation window (minutes):                 30\nComputer role:                                        ${domain ? 'PRIMARY' : 'WORKSTATION'}`);
      done();
      return;
    }
    if (sub === 'use') { this.print(`New connections will be remembered.\n\n\nStatus       Local     Remote                    Network\n\n-------------------------------------------------------------------------------\nOK           H:        \\\\MHS-FS01\\home$\\${this.user}  Microsoft Windows Network\nOK           S:        \\\\MHS-FS01\\shared         Microsoft Windows Network`); done(); return; }
    if (sub === 'time') { this.print(`Current time at \\\\MHS-DC01.${this.w.ad.domain} is ${new Date().toLocaleString('en-US')}\n`); done(); return; }
    this.print('The syntax of this command is:\n\nNET\n    [ ACCOUNTS | COMPUTER | CONFIG | CONTINUE | FILE | GROUP | HELP |\n      HELPMSG | LOCALGROUP | PAUSE | SESSION | SHARE | START |\n      STATISTICS | STOP | TIME | USE | USER | VIEW ]\n');
  }
}

class ExitSignal extends Error {
  batchOnly: boolean;
  constructor(batchOnly: boolean) {
    super('exit');
    this.batchOnly = batchOnly;
  }
}

/** Integer arithmetic for set /a: + - * / % and parentheses, no eval. */
function evalInt(src: string): number {
  const toks = src.match(/\d+|[+\-*/%()]/g) ?? [];
  let i = 0;
  const peek = (): string | undefined => toks[i];
  const atom = (): number => {
    const t = toks[i++];
    if (t === '(') { const v = sum(); if (toks[i++] !== ')') throw new Error('Missing operand.'); return v; }
    if (t === '-') return -atom();
    if (t === '+') return atom();
    if (t === undefined || !/^\d+$/.test(t)) throw new Error('Missing operand.');
    return Number(t);
  };
  const product = (): number => {
    let v = atom();
    for (let op = peek(); op === '*' || op === '/' || op === '%'; op = peek()) {
      i++;
      const r = atom();
      if ((op === '/' || op === '%') && r === 0) throw new Error('Divide by zero error.');
      v = op === '*' ? v * r : op === '/' ? Math.trunc(v / r) : v % r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    for (let op = peek(); op === '+' || op === '-'; op = peek()) { i++; v = op === '+' ? v + product() : v - product(); }
    return v;
  };
  const v = sum();
  if (i < toks.length) throw new Error('Missing operator.');
  return v;
}

/** Split at & && || outside quotes and parentheses. */
function splitOps(line: string): { cmd: string; op: '' | '&' | '&&' | '||' }[] {
  const out: { cmd: string; op: '' | '&' | '&&' | '||' }[] = [];
  let cur = '';
  let op: '' | '&' | '&&' | '||' = '';
  let depth = 0;
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') q = !q;
    if (!q && c === '(') depth++;
    if (!q && c === ')') depth = Math.max(0, depth - 1);
    if (!q && depth === 0 && (c === '&' || (c === '|' && line[i + 1] === '|'))) {
      if (c === '&' && line[i - 1] === '>' ) { cur += c; continue; }
      out.push({ cmd: cur, op });
      if (c === '&' && line[i + 1] === '&') { op = '&&'; i++; } else if (c === '|') { op = '||'; i++; } else op = '&';
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push({ cmd: cur, op });
  return out.filter((x) => x.cmd.trim());
}

function splitTop(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') q = !q;
    if (!q && c === '(') depth++;
    if (!q && c === ')') depth--;
    if (!q && depth === 0 && c === sep && line[i + 1] !== sep && line[i - 1] !== sep) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** "then" and "else" parts of an if body: ( ... ) else ( ... ). */
function splitElse(body: string): [string, string | null] {
  const b = body.trim();
  if (!b.startsWith('(')) return [b, null];
  let depth = 0;
  let q = false;
  for (let i = 0; i < b.length; i++) {
    const c = b[i]!;
    if (c === '"') q = !q;
    if (q) continue;
    if (c === '(') depth++;
    if (c === ')') { depth--; if (depth === 0) { const rest = b.slice(i + 1).trim(); const e = /^else\s+(.*)$/is.exec(rest); return [b.slice(0, i + 1), e ? e[1]! : null]; } }
  }
  return [b, null];
}

/** Join lines that belong to one parenthesised block into a single logical line. */
function joinBlocks(lines: string[]): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!depth && /^\s*(rem\b|::)/i.test(line)) { out.push(line); continue; }
    let q = false;
    for (const c of line) {
      if (c === '"') q = !q;
      if (!q && c === '(') depth++;
      if (!q && c === ')') depth = Math.max(0, depth - 1);
    }
    buf = buf ? `${buf}\n${line}` : line;
    if (depth === 0) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  // Keep line numbers stable for labels: pad joined blocks with blank lines.
  const padded: string[] = [];
  for (const l of out) { padded.push(l); for (let i = 1; i < l.split('\n').length; i++) padded.push(''); }
  return padded;
}

function tokens(s: string): string[] {
  return (s.match(/"[^"]*"|\S+/g) ?? []);
}

const HELP = `For more information on a specific command, type HELP command-name
CALL           Calls one batch program from another.
CD             Displays the name of or changes the current directory.
CLS            Clears the screen.
COPY           Copies one or more files to another location.
DEL            Deletes one or more files.
DIR            Displays a list of files and subdirectories in a directory.
ECHO           Displays messages, or turns command echoing on or off.
EXIT           Quits the CMD.EXE program (command interpreter).
FIND           Searches for a text string in a file or files.
FINDSTR        Searches for strings in files.
FOR            Runs a specified command for each file in a set of files.
GOTO           Directs the Windows command interpreter to a labeled line.
GPRESULT       Displays Group Policy information for machine or user.
IF             Performs conditional processing in batch programs.
IPCONFIG       Displays IP configuration.
KLIST          Displays cached Kerberos tickets.
MD             Creates a directory.
MOVE           Moves one or more files from one directory to another.
NET            NET USER /DOMAIN, NET GROUP /DOMAIN, NET ACCOUNTS, NET USE.
PAUSE          Suspends processing of a batch file and displays a message.
REM            Records comments (remarks) in batch files.
REN            Renames a file or files.
RD             Removes a directory.
SET            Displays, sets, or removes Windows environment variables.
SETLOCAL       Begins localization of environment changes in a batch file.
START          Starts a separate window to run a specified program or command.
TITLE          Sets the window title for a CMD.EXE session.
TREE           Graphically displays the directory structure of a drive or path.
TYPE           Displays the contents of a text file.
VER            Displays the Windows version.
WHOAMI         Displays user, group and privileges information.`;
