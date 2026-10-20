/**
 * ui/apps/console.ts — the Command Prompt console: the cmd.exe engine
 * (terminal/cmd.ts) behind a prompt line, with history, Tab completion of
 * paths, Ctrl+C, copy on right-click, and batch files. Hosted by Windows
 * Terminal; double-clicking a .bat opens one.
 */
import { clear, h } from '../dom.ts';
import { notify, persist, store, subscribe } from '../store.ts';
import { CmdShell } from '../../terminal/cmd.ts';
import { CMDLETS } from '../../terminal/cmdlets.ts';
import { Shell } from '../../terminal/shell.ts';
import { openFromShell } from './tools.ts';

export interface ConsoleControl {
  focus(): void;
  output: HTMLElement;
  title(): string;
  dispose(): void;
}

export interface CmdOptions {
  cwd?: string;
  /** Run this batch file first, then report the exit code as Windows Terminal does. */
  batch?: string;
  args?: string[];
  onExit?: () => void;
  onTitle?: (t: string) => void;
  /** "powershell" typed at the prompt: the host swaps this pane for PowerShell. */
  onSwitch?: (shell: CmdShell) => void;
  shell?: CmdShell;
}

export function mountCmd(host: HTMLElement, opts: CmdOptions = {}): ConsoleControl {
  const ps = new Shell(store.world, CMDLETS);
  const sh = opts.shell ?? new CmdShell(store.world, {
    powershell: (cmd, cwd) => {
      ps.setWorld(store.world);
      ps.cwd = cwd;
      return ps.run(cmd).filter((l) => !l.text.startsWith('\u0000')).flatMap((l) => l.text.split('\n').map((t) => ({ text: t, kind: l.kind === 'err' ? 'err' as const : undefined })));
    },
    ask: (prompt) => window.prompt(prompt.trim() || 'Input', ''),
  }, opts.cwd);
  let title = opts.batch ? `C:\\Windows\\system32\\cmd.exe - ${opts.batch.split('\\').pop()}` : 'Command Prompt';
  const out = h('div', { class: 'ps-out', 'aria-live': 'polite' });
  const input = h('input', { class: 'ps-in', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Command Prompt' });
  const prompt = h('span', { class: 'ps-prompt' });
  let hist = -1;
  let finished = false;
  let tab: { base: string; hits: string[]; i: number } | null = null;
  const line = (text: string, cls = ''): void => { out.appendChild(h('div', { class: `ps-line ${cls}` }, text || ' ')); };
  const setPrompt = (): void => { prompt.textContent = finished ? '' : sh.prompt(); };
  const show = (lines: { text: string; kind?: 'err' }[]): void => {
    for (const l of lines) {
      if (l.text === '\u0000CLEAR') { clear(out); continue; }
      if (l.text === '\u0000EXIT') { opts.onExit?.(); continue; }
      if (l.text.startsWith('\u0000TITLE:')) { title = l.text.slice(7) || 'Command Prompt'; opts.onTitle?.(title); continue; }
      if (l.text === '\u0000SWITCH:powershell') { opts.onSwitch?.(sh); continue; }
      if (l.text.startsWith('\u0000OPEN:')) { openFromShell(l.text.slice(6)); continue; }
      for (const part of l.text.split('\n')) line(part, l.kind === 'err' ? 'cmd-err' : '');
    }
    (out.parentElement ?? out).scrollTop = 1e9;
  };
  const exec = (cmd: string): void => {
    sh.setWorld(store.world);
    show(sh.run(cmd));
    if (cmd.trim()) { persist(); notify(); }
  };
  if (!opts.shell) {
    line('Microsoft Windows [Version 10.0.22631.4317]');
    line('(c) Microsoft Corporation. All rights reserved.');
    line('');
  }
  if (opts.batch) {
    sh.setWorld(store.world);
    const lines = sh.runBatch(opts.batch, [opts.batch, ...(opts.args ?? [])]);
    show(lines);
    persist();
    notify();
    const code = sh.errorlevel;
    line('');
    line(`[process exited with code ${code} (0x${code.toString(16).padStart(8, '0')})]`, 'cmd-note');
    line('You can now close this terminal with Ctrl+D, or press Enter to restart.', 'cmd-note');
    finished = true;
  }
  setPrompt();
  const unsub = subscribe(() => sh.setWorld(store.world));

  const complete = (): void => {
    const v = input.value;
    if (!tab) {
      const tok = /("[^"]*|\S*)$/.exec(v)![1]!.replace(/^"/, '');
      const before = v.slice(0, v.length - /("[^"]*|\S*)$/.exec(v)![1]!.length);
      const dirPart = tok.includes('\\') ? tok.slice(0, tok.lastIndexOf('\\') + 1) : '';
      const base = sh.resolve(dirPart || '.').toLowerCase();
      const seen = new Set<string>();
      for (const f of store.world.files) {
        if (f.deleted || !f.path.toLowerCase().startsWith(`${base}\\`)) continue;
        const first = f.path.slice(base.length + 1).split('\\')[0]!;
        if (first.toLowerCase().startsWith(tok.slice(dirPart.length).toLowerCase())) seen.add(first);
      }
      const hits = [...seen].sort().map((n) => { const p = dirPart + n; return /\s/.test(p) ? `"${p}"` : p; });
      if (!hits.length) return;
      tab = { base: before, hits, i: 0 };
    } else tab.i = (tab.i + 1) % tab.hits.length;
    input.value = tab.base + tab.hits[tab.i];
  };

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') tab = null;
    if (finished) {
      if (e.key === 'Enter') { finished = false; clear(out); line('Microsoft Windows [Version 10.0.22631.4317]'); line('(c) Microsoft Corporation. All rights reserved.'); line(''); setPrompt(); }
      else if (e.key === 'd' && e.ctrlKey) { e.preventDefault(); opts.onExit?.(); }
      return;
    }
    if (e.key === 'Enter') {
      const cmd = input.value;
      input.value = '';
      hist = -1;
      line(`${prompt.textContent}${cmd}`, 'echo');
      exec(cmd);
      line('');
      setPrompt();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const hs = sh.history;
      if (!hs.length) return;
      hist = e.key === 'ArrowUp' ? (hist < 0 ? hs.length - 1 : Math.max(0, hist - 1)) : hist < 0 ? -1 : Math.min(hs.length, hist + 1);
      input.value = hist >= 0 && hist < hs.length ? hs[hist]! : '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'Escape') {
      input.value = '';
    } else if (e.key === 'c' && e.ctrlKey && !e.shiftKey && !input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)) {
      e.preventDefault();
      line(`${prompt.textContent}${input.value}^C`, 'echo');
      input.value = '';
    } else if (e.key === 'F7') {
      e.preventDefault();
      sh.history.slice(-20).forEach((c, i) => line(`${String(i).padStart(3)}: ${c}`));
    }
  });
  const wrap = h('div', { class: 'ps cmd', onClick: () => { if (!window.getSelection()?.toString()) input.focus(); } }, out, h('div', { class: 'ps-row' }, prompt, input));
  host.appendChild(wrap);
  setTimeout(() => input.focus(), 0);
  return { focus: () => input.focus(), output: out, title: () => title, dispose: unsub };
}
