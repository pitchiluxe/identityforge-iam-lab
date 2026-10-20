/**
 * Windows PowerShell ISE: script tabs, a line-numbered editor, F5 Run Script,
 * F8 Run Selection, and a console pane sharing the same session.
 */
import { homeDir, writeFile } from '../../world/docs.ts';
import { clear, h, toast } from '../dom.ts';
import { act, store } from '../store.ts';
import { appIcon } from '../icons.ts';
import { showMenu, type MenuEntry } from '../ctxmenu.ts';
import { type AppDef, onOpenArg } from '../wm.ts';
import { mountPowerShell } from './tools.ts';

interface Doc { path: string | null; name: string; text: string; saved: string }

let untitled = 0;

export function iseApp(path?: string): AppDef {
  return {
    id: 'ise',
    title: 'Windows PowerShell ISE',
    icon: 'powershell',
    width: 1080,
    height: 700,
    mount(host, win) {
      const docs: Doc[] = [];
      let cur = 0;
      const open = (p?: string): void => {
        if (p) {
          const existing = docs.findIndex((d) => d.path?.toLowerCase() === p.toLowerCase());
          if (existing >= 0) { cur = existing; return draw(); }
          const f = store.world.files.find((x) => x.path.toLowerCase() === p.toLowerCase() && !x.deleted);
          const text = f?.content ?? '';
          docs.push({ path: p, name: p.split('\\').pop()!, text, saved: text });
        } else {
          docs.push({ path: null, name: `Untitled${++untitled}.ps1`, text: '', saved: '' });
        }
        cur = docs.length - 1;
        draw();
      };
      const doc = (): Doc => docs[cur]!;
      const editor = h('textarea', { class: 'ise-code', spellcheck: 'false', wrap: 'off', 'aria-label': 'Script pane' });
      const gutter = h('div', { class: 'ise-gutter', 'aria-hidden': 'true' });
      const tabs = h('div', { class: 'ise-tabs', role: 'tablist' });
      const status = h('div', { class: 'ise-status' });
      const consoleHost = h('div', { class: 'ise-console' });
      const ps = mountPowerShell(consoleHost, { compact: true, onExit: () => win.close() });

      const lines = (): void => {
        const n = editor.value.split('\n').length;
        gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
        gutter.scrollTop = editor.scrollTop;
      };
      const pos = (): void => {
        const before = editor.value.slice(0, editor.selectionStart);
        status.textContent = `Ln ${before.split('\n').length}  Col ${before.length - before.lastIndexOf('\n')}`;
      };
      const saveAs = (): void => {
        const box = h('input', { class: 'w-input', value: doc().path ?? `${homeDir(store.world)}\\Documents\\Scripts\\${doc().name}`, 'aria-label': 'File name' });
        const bar = h('div', { class: 'np-saveas' }, h('span', null, 'Save as:'), box,
          h('button', { class: 'w-btn accent', type: 'button', onClick: () => { saveTo(box.value); bar.remove(); } }, 'Save'),
          h('button', { class: 'w-btn', type: 'button', onClick: () => bar.remove() }, 'Cancel'));
        host.querySelector('.ise')!.insertBefore(bar, host.querySelector('.ise-tabs'));
        box.focus();
        box.select();
      };
      const saveTo = (p: string): void => {
        if (!/\.ps1$|\.psm1$|\.txt$/i.test(p)) p = `${p}.ps1`;
        if (act((w) => writeFile(w, p, editor.value))) {
          const d = doc();
          d.path = p; d.name = p.split('\\').pop()!; d.text = editor.value; d.saved = editor.value;
          drawTabs();
        }
      };
      const save = (): void => { if (doc().path) saveTo(doc().path!); else saveAs(); };
      const runText = (text: string, label: string): void => {
        if (!text.trim()) return;
        ps.control.run(text, false);
        void label;
      };
      const runScript = (): void => {
        doc().text = editor.value;
        const label = doc().path ?? doc().name;
        consoleHost.querySelector('.ps-out')!.appendChild(h('div', { class: 'ps-line echo' }, `PS ${ps.shell.cwd}> ${doc().path ? `& '${label}'` : label}`));
        runText(editor.value, label);
      };
      const runSelection = (): void => {
        const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
        const text = sel || editor.value.split('\n')[editor.value.slice(0, editor.selectionStart).split('\n').length - 1] || '';
        consoleHost.querySelector('.ps-out')!.appendChild(h('div', { class: 'ps-line echo' }, `PS ${ps.shell.cwd}> ${text}`));
        runText(text, 'selection');
      };
      const openDialog = (): void => {
        const scripts = store.world.files.filter((f) => !f.deleted && /\.(ps1|psm1)$/i.test(f.path));
        const list = h('div', { class: 'ise-open' }, h('strong', null, 'Open'),
          scripts.map((f) => h('button', { class: 'ise-openrow', type: 'button', onClick: () => { list.remove(); open(f.path); } }, appIcon('powershell', 16), h('span', null, f.path.split('\\').pop()), h('small', null, f.path))),
          h('button', { class: 'w-btn', type: 'button', onClick: () => list.remove() }, 'Cancel'));
        host.querySelector('.ise')!.appendChild(list);
      };
      const menus: Record<string, () => MenuEntry[]> = {
        File: () => [
          { label: 'New', shortcut: 'Ctrl+N', onClick: () => open() },
          { label: 'Open...', shortcut: 'Ctrl+O', onClick: openDialog },
          { label: 'Save', shortcut: 'Ctrl+S', onClick: save },
          { label: 'Save As...', onClick: saveAs },
          '-',
          { label: 'Run', shortcut: 'F5', onClick: runScript },
          { label: 'Run Selection', shortcut: 'F8', onClick: runSelection },
          '-',
          { label: 'Close', shortcut: 'Ctrl+F4', onClick: () => closeTab(cur) },
          { label: 'Exit', shortcut: 'Alt+F4', onClick: () => win.close() },
        ],
        Edit: () => [
          { label: 'Undo', shortcut: 'Ctrl+Z', onClick: () => { editor.focus(); document.execCommand('undo'); } },
          { label: 'Redo', shortcut: 'Ctrl+Y', onClick: () => { editor.focus(); document.execCommand('redo'); } },
          '-',
          { label: 'Select All', shortcut: 'Ctrl+A', onClick: () => { editor.focus(); editor.select(); } },
          { label: 'Go to Line...', shortcut: 'Ctrl+G', onClick: () => { const n = Number(window.prompt?.('Line number:') ?? 0); if (n > 0) { const idx = editor.value.split('\n').slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0); editor.focus(); editor.setSelectionRange(idx, idx); } } },
        ],
        View: () => [{ label: 'Show Script Pane', checked: true }, { label: 'Clear Console Pane', onClick: () => clear(consoleHost.querySelector('.ps-out')!) }],
        Debug: () => [{ label: 'Run/Continue', shortcut: 'F5', onClick: runScript }, { label: 'Stop Debugger', shortcut: 'Shift+F5', disabled: true }],
        Help: () => [{ label: 'Windows PowerShell ISE Help', onClick: () => ps.control.run('Get-Help', true) }],
      };
      const closeTab = (i: number): void => {
        docs.splice(i, 1);
        if (!docs.length) open();
        cur = Math.min(cur, docs.length - 1);
        draw();
      };
      function drawTabs(): void {
        clear(tabs);
        docs.forEach((d, i) => tabs.appendChild(h('div', { class: `ise-tab ${i === cur ? 'on' : ''}`, role: 'tab' },
          h('button', { type: 'button', class: 'ise-tablabel', onClick: () => { doc().text = editor.value; cur = i; draw(); } }, `${d.name}${(i === cur ? editor.value : d.text) !== d.saved ? '*' : ''}`),
          h('button', { type: 'button', class: 'ise-tabx', 'aria-label': 'Close', onClick: () => closeTab(i) }, '✕'))));
        win.setTitle(`Administrator: Windows PowerShell ISE${doc().path ? ` - ${doc().path}` : ''}`);
      }
      function draw(): void {
        editor.value = doc().text;
        drawTabs();
        lines();
        pos();
      }
      editor.addEventListener('input', () => { doc().text = editor.value; lines(); pos(); drawTabs(); });
      editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });
      editor.addEventListener('click', pos);
      editor.addEventListener('keyup', pos);
      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') { e.preventDefault(); editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); }
      });
      host.addEventListener('keydown', (e) => {
        if (e.key === 'F5') { e.preventDefault(); runScript(); }
        else if (e.key === 'F8') { e.preventDefault(); runSelection(); }
        else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
        else if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); open(); }
        else if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openDialog(); }
      });
      const tb = (glyphCh: string, title: string, fn: () => void, cls = ''): HTMLButtonElement => h('button', { class: `ise-tb ${cls}`, type: 'button', title, 'aria-label': title, onClick: fn }, glyphCh);
      host.appendChild(h('div', { class: 'ise' },
        h('div', { class: 'ise-menubar' }, Object.keys(menus).map((m) => h('button', { type: 'button', onClick: (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); showMenu(r.left, r.bottom, menus[m]!()); } }, m))),
        h('div', { class: 'ise-toolbar' },
          tb('', 'New Script (Ctrl+N)', () => open()), tb('', 'Open Script (Ctrl+O)', openDialog), tb('', 'Save Script (Ctrl+S)', save),
          h('span', { class: 'fx-sep' }),
          tb('', 'Run Script (F5)', runScript, 'run'), tb('', 'Run Selection (F8)', runSelection, 'run'), tb('', 'Stop Operation (Ctrl+Break)', () => toast('Nothing is running.')),
          h('span', { class: 'fx-sep' }),
          tb('', 'Clear Console Pane', () => clear(consoleHost.querySelector('.ps-out')!))),
        tabs,
        h('div', { class: 'ise-editor' }, gutter, editor),
        consoleHost,
        status));
      onOpenArg(win, (p) => { if (p) open(p); });
      open(path);
      setTimeout(() => editor.focus(), 0);
      return { dispose: ps.dispose };
    },
  };
}
