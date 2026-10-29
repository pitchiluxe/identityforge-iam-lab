/**
 * ui/launch.ts — what "open" means for every file and program, in one place.
 * The desktop, File Explorer, Start, and PowerShell's Start-Process all call it.
 */
import { openApp } from './wm.ts';
import { notepadApp, powershellWindow, explorerApp, eventViewerApp, setPowerShellOpener, setFileOpener } from './apps/tools.ts';
import { iseApp } from './apps/ise.ts';
import { batchWindow, terminalApp, terminalWindow } from './apps/terminal.ts';
import { calculatorApp } from './apps/calculator.ts';
import { rdpApp } from './apps/rdp.ts';
import { securityApp } from './apps/security.ts';
import { markdownApp } from './apps/markdown.ts';
import { wordApp, wordStartApp } from './apps/word.ts';
import { excelApp, excelStartApp } from './apps/excel.ts';
import { powerpointApp, powerpointStartApp } from './apps/powerpoint.ts';
import { stickyNotesApp } from './apps/stickynotes.ts';
import { toggleScreenPen } from './pen.ts';
import { sys } from './system.ts';
import { browserApp, chromeWindow } from './apps/browser.ts';
import { aducApp } from './apps/aduc.ts';
import { settingsApp } from './apps/settings.ts';
import { controlPanelApp } from './apps/control.ts';
import { taskManagerApp } from './apps/taskmgr.ts';

export type OpenMode = 'open' | 'edit' | 'notepad' | 'run';

/** Double-click behaviour. .ps1 files run (the lab's choice); Edit opens the ISE. */
export function openFile(path: string, mode: OpenMode = 'open'): void {
  const isScript = /\.ps1$/i.test(path);
  const isBatch = /\.(bat|cmd)$/i.test(path);
  // Settings > Apps > Default apps decides what a double-click does.
  const action = mode === 'open' ? (isScript ? sys().ps1Action : isBatch ? sys().batAction : 'open') : mode;
  if (isScript && action === 'run') return openApp(powershellWindow(path), undefined, false);
  if (isScript && action === 'edit') return openApp(iseApp(path), path);
  if (isBatch && action === 'run') return openApp(batchWindow(path), undefined, false);
  if (/\.(md|markdown)$/i.test(path) && action === 'open') return openApp(markdownApp(path));
  // Office opens its own files; right-click > Edit still opens Notepad.
  if (action === 'open' && /\.docx$/i.test(path)) return openApp(wordApp(path));
  if (action === 'open' && /\.(xlsx|csv)$/i.test(path)) return openApp(excelApp(path));
  if (action === 'open' && /\.pptx$/i.test(path)) return openApp(powerpointApp(path));
  openApp(notepadApp(path));
}

export function openProgram(name: string): void {
  const n = name.toLowerCase();
  if (n === 'notepad') return openApp(notepadApp(''));
  if (n === 'calc' || n === 'calc.exe' || n === 'calculator') return openApp(calculatorApp);
  if (n === 'wt' || n === 'terminal') return openApp(terminalApp, undefined, false);
  if (n === 'cmd' || n === 'cmd.exe') return openApp(terminalWindow({ profile: 'cmd' }), undefined, false);
  if (n === 'mstsc' || n === 'mstsc.exe') return openApp(rdpApp);
  if (n === 'pen' || n === 'screenpen' || n === 'screen pen') return toggleScreenPen();
  if (n === 'winword' || n === 'winword.exe' || n === 'word') return openApp(wordStartApp);
  if (n === 'excel' || n === 'excel.exe') return openApp(excelStartApp);
  if (n === 'powerpnt' || n === 'powerpnt.exe' || n === 'powerpoint') return openApp(powerpointStartApp);
  if (n === 'stikynot' || n === 'stikynot.exe' || n === 'sticky notes' || n === 'stickynotes') return openApp(stickyNotesApp);
  if (n === 'windowsdefender:' || n === 'security' || n === 'windows security') return openApp(securityApp);
  if (n === 'powershell') return openApp(powershellWindow(), undefined, false);
  if (n === 'powershell_ise' || n === 'ise') return openApp(iseApp());
  if (n === 'explorer') return openApp(explorerApp);
  if (n === 'msedge' || n === 'chrome') return openApp(browserApp, undefined, false);
  if (n === 'chrome-incognito') return openApp(chromeWindow('chrome://newtab', true), undefined, false);
  if (n === 'dsa.msc') return openApp(aducApp);
  if (n === 'eventvwr' || n === 'eventvwr.msc') return openApp(eventViewerApp);
  if (n.startsWith('settings:')) return openApp(settingsApp, n.slice(9));
  if (n === 'control') return openApp(controlPanelApp);
  if (n === 'taskmgr' || n === 'taskmgr.exe' || n === 'task manager') return openApp(taskManagerApp);
  if (n === 'ms-settings:') return openApp(settingsApp);
}

export function installLaunchers(): void {
  setFileOpener((p, mode) => openFile(p, mode));
  setPowerShellOpener((t) => {
    const i = t.indexOf(':');
    const kind = t.slice(0, i), target = t.slice(i + 1);
    if (kind === 'notepad') openApp(notepadApp(target));
    else if (kind === 'ise') openApp(iseApp(target || undefined), target || undefined);
    else if (kind === 'explorer') openApp(explorerApp, target);
    else if (kind === 'url') openApp(browserApp, target, false);
    else if (kind === 'app') openProgram(target);
    else if (kind === 'file') openFile(target);
  });
}
