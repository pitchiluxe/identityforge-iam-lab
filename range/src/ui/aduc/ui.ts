/**
 * ui/consoles/aduc/ui.ts — the Windows controls ADUC is made of.
 *
 * The snap-in is an MMC console on Windows Server: Segoe UI at 9 pt, grey
 * dialog faces, white panes, the pale-blue selection, property sheets whose
 * tabs wrap onto several rows (and swap rows when you click one), and dialogs
 * with OK / Cancel / Apply bottom-right. It looks like that whatever theme
 * the rest of the workstation uses, because that is what the real one does,
 * and the point of practising here is that the real one looks familiar.
 *
 * Everything is scoped under .ad-root / .ad-dlg so none of it leaks into the
 * other windows. No markup is ever parsed: every node is built with
 * createElement and textContent.
 */
import { icon, type IconName } from './icons';

const STYLE_ID = 'aduc-styles';

const CSS = `
.ad-root, .ad-dlg, .ad-menu {
  font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 12px; color: #000;
  -webkit-font-smoothing: antialiased; user-select: none;
  /* Native checkboxes, radios and selects draw light, as on the server,
     whatever scheme the workstation theme sets. */
  color-scheme: light;
}
.ad-root { background: #fff; }
.ad-root *, .ad-dlg *, .ad-menu * { box-sizing: border-box; }
.ad-root ::-webkit-scrollbar, .ad-dlg ::-webkit-scrollbar { width: 17px; height: 17px; }
.ad-root ::-webkit-scrollbar-track, .ad-dlg ::-webkit-scrollbar-track { background: #f0f0f0; }
.ad-root ::-webkit-scrollbar-thumb, .ad-dlg ::-webkit-scrollbar-thumb {
  background: #cdcdcd; border: 4px solid #f0f0f0; border-radius: 0;
}
.ad-root ::-webkit-scrollbar-thumb:hover, .ad-dlg ::-webkit-scrollbar-thumb:hover { background: #a6a6a6; }

/* menu bar */
.ad-menubar { display: flex; background: #fff; padding: 1px 2px; border-bottom: 1px solid #f0f0f0; }
.ad-menubar > span { padding: 2px 7px; border: 1px solid transparent; cursor: default; }
.ad-menubar > span:hover, .ad-menubar > span.open { background: #e5f3ff; border-color: #cce8ff; }

/* toolbar */
.ad-toolbar { display: flex; align-items: center; gap: 1px; padding: 2px 4px; background: #fff;
  border-bottom: 1px solid #d9d9d9; }
.ad-tb { width: 24px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; background: transparent; padding: 0; cursor: default; }
.ad-tb:hover:not(:disabled) { background: #e5f3ff; border-color: #cce8ff; }
.ad-tb:active:not(:disabled) { background: #cce8ff; border-color: #99d1ff; }
.ad-tb:disabled img { opacity: .35; filter: grayscale(1); }
.ad-tb.on { background: #cce8ff; border-color: #99d1ff; }
.ad-tbsep { width: 1px; height: 18px; background: #d9d9d9; margin: 0 4px; }

/* panes */
.ad-panes { flex: 1; display: flex; min-height: 0; background: #fff; }
.ad-tree { overflow: auto; background: #fff; border-right: 1px solid #d9d9d9; padding: 2px 0; outline: none; }
.ad-splitter { width: 4px; cursor: col-resize; background: #f0f0f0; flex-shrink: 0; }
.ad-list { flex: 1; min-width: 0; overflow: auto; background: #fff; outline: none; position: relative; }
.ad-trow { display: flex; align-items: center; height: 20px; white-space: nowrap; cursor: default; padding-right: 8px; }
.ad-trow .ad-twisty { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;
  color: #6b6b6b; font-size: 10px; flex-shrink: 0; }
.ad-chev { width: 6px; height: 6px; border-right: 1.3px solid #7a7a7a; border-bottom: 1.3px solid #7a7a7a;
  transform: rotate(-45deg); margin-left: -2px; }
.ad-chev.open { transform: rotate(45deg); margin: -3px 0 0 0; border-color: #404040; }
.ad-trow .ad-twisty:hover .ad-chev { border-color: #1c97ea; }
.ad-trow .ad-tlabel { padding: 1px 3px; border: 1px solid transparent; margin-left: 3px; }
.ad-trow:hover .ad-tlabel { background: #e5f3ff; }
.ad-trow.sel .ad-tlabel { background: #d9d9d9; }
.ad-tree:focus .ad-trow.sel .ad-tlabel { background: #cce8ff; border-color: #99d1ff; }
.ad-trow.cut { opacity: .5; }

/* details view */
.ad-table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.ad-table th { position: sticky; top: 0; z-index: 1; background: #fff; font-weight: 400; text-align: left;
  padding: 3px 6px 4px; border-right: 1px solid #e5e5e5; border-bottom: 1px solid #e5e5e5; color: #4c607a;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
.ad-table th:hover { background: #d9ebf9; }
.ad-table th .ad-grip { position: absolute; right: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; }
.ad-table td { padding: 1px 6px; height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ad-table td { vertical-align: middle; line-height: 18px; }
.ad-namecell { display: flex; align-items: center; gap: 4px; min-width: 0; }
.ad-namecell img { flex: none; }
.ad-namecell span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ad-table th.ad-fill { cursor: default; border-right: 0; }
.ad-table th.ad-fill:hover { background: #fff; }
.ad-table tr.row:hover td { background: #e5f3ff; }
.ad-table tr.row.sel td { background: #d9d9d9; }
.ad-list:focus .ad-table tr.row.sel td { background: #cce8ff; }
.ad-table tr.row.cut td { opacity: .5; }
.ad-icons { display: flex; flex-wrap: wrap; align-content: flex-start; padding: 4px; gap: 2px; }
.ad-icons.list { flex-direction: column; flex-wrap: wrap; height: 100%; }
.ad-icon-item { display: flex; align-items: center; gap: 4px; padding: 2px 4px; border: 1px solid transparent; cursor: default; }
.ad-icons.large .ad-icon-item { flex-direction: column; width: 76px; text-align: center; padding: 4px 2px; }
.ad-icon-item:hover { background: #e5f3ff; }
.ad-icon-item.sel { background: #d9d9d9; }
.ad-list:focus .ad-icon-item.sel { background: #cce8ff; border-color: #99d1ff; }
.ad-empty { padding: 10px 14px; color: #000; }

.ad-status { display: flex; height: 22px; align-items: center; background: #f0f0f0; border-top: 1px solid #d9d9d9;
  padding: 0 6px; color: #000; white-space: nowrap; overflow: hidden; }

/* menus */
.ad-menu { position: fixed; background: #f2f2f2; border: 1px solid #cccccc; padding: 2px;
  box-shadow: 2px 2px 3px rgba(0,0,0,.28); min-width: 180px; z-index: 2147483000; }
.ad-mi { display: flex; align-items: center; height: 22px; padding: 0 22px 0 28px; position: relative;
  white-space: nowrap; cursor: default; border: 1px solid transparent; }
.ad-mi:hover:not(.dis), .ad-mi.hot { background: #91c9f7; border-color: #91c9f7; }
.ad-mi.dis { color: #6d6d6d; }
.ad-mi.bold { font-weight: 700; }
.ad-mi .chk { position: absolute; left: 8px; font-size: 11px; }
.ad-mi .sub { position: absolute; right: 7px; font-size: 10px; }
.ad-msep { height: 1px; background: #d7d7d7; margin: 3px 2px 3px 28px; }

/* dialogs */
.ad-dlg { position: fixed; background: #f0f0f0; border: 1px solid #7a7a7a;
  box-shadow: 0 6px 22px rgba(0,0,0,.33); display: flex; flex-direction: column; }
.ad-dlg.active { border-color: #1883d7; }
.ad-dlg-title { height: 30px; display: flex; align-items: center; background: #fff; padding-left: 8px;
  gap: 6px; flex-shrink: 0; cursor: default; }
.ad-dlg-title .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ad-dlg-x { width: 46px; height: 30px; border: none; background: transparent; font-size: 16px; line-height: 1; cursor: default; }
.ad-dlg-x:hover { background: #e81123; color: #fff; }
.ad-dlg-body { flex: 1; padding: 10px 11px; overflow: auto; min-height: 0; }
.ad-dlg-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 0 11px 11px; flex-shrink: 0; }
.ad-modal-shield { position: fixed; inset: 0; background: transparent; }

.ad-root ::selection, .ad-dlg ::selection { background: #0078d7; color: #fff; }
.ad-btn { min-width: 75px; height: 23px; padding: 0 10px; white-space: nowrap; background: #e1e1e1; border: 1px solid #adadad;
  font: inherit; color: #000; cursor: default; }
.ad-btn:hover:not(:disabled) { background: #e5f1fb; border-color: #0078d7; }
.ad-btn:active:not(:disabled) { background: #cce4f7; border-color: #005499; }
.ad-btn.default { border: 1px solid #0078d7; box-shadow: inset 0 0 0 1px #0078d7; }
.ad-btn:disabled { background: #cccccc; border-color: #bfbfbf; color: #838383; }
.ad-btn:focus-visible { outline: 1px dotted #000; outline-offset: -4px; }

.ad-dlg input[type=text], .ad-dlg input[type=password], .ad-dlg input[type=date], .ad-dlg select, .ad-dlg textarea,
.ad-root input[type=text] {
  height: 23px; border: 1px solid #7a7a7a; background: #fff; padding: 1px 4px; font: inherit; color: #000;
  outline: none; user-select: text; min-width: 0;
}
.ad-dlg textarea { height: auto; resize: none; padding: 3px 4px; }
.ad-dlg input:hover:not(:disabled), .ad-dlg select:hover:not(:disabled), .ad-dlg textarea:hover:not(:disabled) { border-color: #171717; }
.ad-dlg input[type=text]:focus, .ad-dlg input[type=password]:focus, .ad-dlg input[type=date]:focus,
.ad-dlg select:focus, .ad-dlg textarea:focus, .ad-root input[type=text]:focus {
  border-color: #0078d7 !important; outline: 1px solid #0078d7 !important; outline-offset: -2px !important;
}
.ad-dlg input:disabled, .ad-dlg select:disabled, .ad-dlg textarea:disabled, .ad-dlg input[readonly] {
  background: #f0f0f0; border-color: #cccccc; color: #6d6d6d;
}
.ad-dlg input[readonly].ad-plain { background: transparent; border-color: transparent; color: #000; }
.ad-dlg label { cursor: default; }
.ad-chk { display: flex; align-items: center; gap: 5px; min-height: 20px; }
.ad-chk input { margin: 0; width: 13px; height: 13px; accent-color: #0078d7; }
.ad-chk.dis { color: #6d6d6d; }
.ad-fs { border: 1px solid #dcdcdc; padding: 6px 9px 8px; margin: 0; }
.ad-fs legend { padding: 0 3px; }
.ad-hr { height: 0; border-top: 1px solid #a0a0a0; border-bottom: 1px solid #fff; margin: 10px 0; }
.ad-grid { display: grid; column-gap: 8px; row-gap: 7px; align-items: center; }
.ad-link { color: #0066cc; text-decoration: underline; cursor: pointer; }
.ad-note { color: #000; line-height: 1.45; }

/* property-sheet tabs */
.ad-tabs { position: relative; }
.ad-tabrow { display: flex; margin-bottom: -1px; position: relative; }
.ad-tab { flex: 1 1 auto; padding: 2px 6px 3px; border: 1px solid #d9d9d9; border-bottom: none; background: #f0f0f0;
  text-align: center; white-space: nowrap; cursor: default; margin-right: -1px; }
.ad-tab:hover { background: #d8eaf9; }
.ad-tab.sel { background: #fff; position: relative; z-index: 2; padding-bottom: 5px; margin-top: -2px; }
.ad-tabpanel { background: #fff; border: 1px solid #d9d9d9; padding: 10px 11px; position: relative; z-index: 1; }

/* list boxes inside dialogs */
.ad-lb { background: #fff; border: 1px solid #828790; overflow: auto; outline: none; }
.ad-lb table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.ad-lb th { background: #fff; font-weight: 400; text-align: left; padding: 3px 6px; border-right: 1px solid #e5e5e5;
  border-bottom: 1px solid #e5e5e5; position: sticky; top: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ad-lb td { padding: 1px 6px; height: 19px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ad-lb tr.row:hover td { background: #e5f3ff; }
.ad-lb tr.row.sel td { background: #d9d9d9; }
.ad-lb:focus tr.row.sel td { background: #cce8ff; }
.ad-lb .ad-lbline { display: flex; align-items: center; gap: 5px; }

/* wizard */
.ad-wiz-head { background: #fff; margin: -10px -11px 10px; padding: 12px 16px; border-bottom: 1px solid #a0a0a0; }
.ad-wiz-head b { display: block; margin-bottom: 3px; }
.ad-wiz-side { background: linear-gradient(#1b5aa6, #3d86d6); }
.ad-createin { display: flex; align-items: center; gap: 22px; padding: 4px 4px 12px; border-bottom: 1px solid #a0a0a0;
  margin-bottom: 14px; }
.ad-logon-grid { display: grid; grid-template-columns: 7px repeat(24, 1fr); gap: 1px; }
.ad-hour { height: 18px; background: #fff; border: 1px solid #b5b5b5; }
.ad-hour.on { background: #1f5fbf; border-color: #1f5fbf; }
`;

export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Tiny element helpers
// ---------------------------------------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function css(e: HTMLElement, style: string): HTMLElement {
  e.style.cssText += style;
  return e;
}

export function textbox(value = '', opts: { type?: string; width?: string; disabled?: boolean; readOnly?: boolean } = {}): HTMLInputElement {
  const i = document.createElement('input');
  i.type = opts.type ?? 'text';
  i.value = value;
  i.spellcheck = false;
  i.autocomplete = 'off';
  if (opts.width) i.style.width = opts.width;
  if (opts.disabled) i.disabled = true;
  if (opts.readOnly) i.readOnly = true;
  return i;
}

export function button(
  label: string,
  onClick: () => void,
  opts: { primary?: boolean; disabled?: boolean; width?: string } = {},
): HTMLButtonElement {
  const b = el('button', 'ad-btn' + (opts.primary ? ' default' : ''), label);
  b.type = 'button';
  if (opts.disabled) b.disabled = true;
  if (opts.width) b.style.width = opts.width;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    if (!b.disabled) onClick();
  });
  return b;
}

export interface Check {
  el: HTMLElement;
  input: HTMLInputElement;
  get checked(): boolean;
  set checked(v: boolean);
  setDisabled(v: boolean): void;
}

let uid = 0;
const nextId = (): string => `ad-${++uid}`;

export function checkbox(label: string, checked = false, onChange?: (v: boolean) => void): Check {
  const row = el('div', 'ad-chk');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = nextId();
  input.checked = checked;
  const lab = el('label', undefined, label);
  lab.htmlFor = input.id;
  row.append(input, lab);
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return {
    el: row,
    input,
    get checked() {
      return input.checked;
    },
    set checked(v: boolean) {
      input.checked = v;
    },
    setDisabled(v: boolean) {
      input.disabled = v;
      row.classList.toggle('dis', v);
    },
  };
}

export function radio(name: string, label: string, checked = false, onChange?: () => void): Check {
  const c = checkbox(label, checked);
  c.input.type = 'radio';
  c.input.name = name;
  if (onChange) c.input.addEventListener('change', () => c.input.checked && onChange());
  return c;
}

export function select(options: readonly string[], value?: string, width?: string): HTMLSelectElement {
  const s = document.createElement('select');
  for (const o of options) s.appendChild(new Option(o, o));
  if (value !== undefined) s.value = value;
  if (width) s.style.width = width;
  return s;
}

export function fieldset(legend: string): HTMLFieldSetElement {
  const f = el('fieldset', 'ad-fs');
  f.appendChild(el('legend', undefined, legend));
  return f;
}

export function hr(): HTMLElement {
  return el('div', 'ad-hr');
}

/** A label + control row laid out on a grid; `cols` is grid-template-columns. */
export function grid(cols: string, ...cells: (HTMLElement | string)[]): HTMLElement {
  const g = el('div', 'ad-grid');
  g.style.gridTemplateColumns = cols;
  for (const c of cells) g.appendChild(typeof c === 'string' ? el('label', undefined, c) : c);
  return g;
}

/** The icon-and-name strip at the top of a property sheet or New Object dialog. */
export function headerStrip(iconName: IconName, text: string, label?: string): HTMLElement {
  const h = el('div', 'ad-createin');
  h.appendChild(icon(iconName, 32));
  if (label) {
    const l = el('span', undefined, label);
    const v = el('span', undefined, text);
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;gap:18px;';
    wrap.append(l, v);
    h.appendChild(wrap);
  } else {
    h.appendChild(el('span', undefined, text));
  }
  return h;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

let zTop = 100000;

/** Every open dialog, so a closed console can take its dialogs with it. */
const openDialogs = new Set<Dialog>();

export interface DialogButton {
  label: string;
  /** Return false to keep the dialog open (validation failed). */
  onClick?: () => boolean | void;
  primary?: boolean;
  /** Pressed by Escape and by the title-bar X. */
  cancel?: boolean;
  disabled?: boolean;
  width?: string;
}

export interface Dialog {
  root: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
  buttons: HTMLButtonElement[];
  close(): void;
  setTitle(t: string): void;
  onClose?: () => void;
}

export interface DialogOptions {
  title: string;
  width: number;
  height?: number;
  /** Modal dialogs block the console until closed; property sheets do not. */
  modal?: boolean;
  buttons?: DialogButton[];
  iconName?: IconName;
  /** Which console instance owns this dialog (closed with it). */
  owner?: object;
}

const ownerOf = new WeakMap<Dialog, object>();

export function closeDialogsOf(owner: object): void {
  for (const d of [...openDialogs]) if (ownerOf.get(d) === owner) d.close();
}

/**
 * A Windows dialog: white title bar with the close box, grey face, buttons
 * bottom-right. Draggable by the title bar; Enter presses the default button,
 * Escape the cancel one; the caret starts in the first field.
 */
export function openDialog(opts: DialogOptions): Dialog {
  ensureStyles();
  const shield = opts.modal ? el('div', 'ad-modal-shield') : null;
  const root = el('div', 'ad-dlg active');
  root.setAttribute('role', 'dialog');
  root.style.width = `${opts.width}px`;
  if (opts.height) root.style.height = `${opts.height}px`;
  root.style.maxHeight = 'calc(100vh - 20px)';

  const title = el('div', 'ad-dlg-title');
  if (opts.iconName) title.appendChild(icon(opts.iconName, 16));
  const t = el('span', 't', opts.title);
  const x = el('button', 'ad-dlg-x', '✕');
  x.type = 'button';
  x.title = 'Close';
  title.append(t, x);

  const body = el('div', 'ad-dlg-body');
  const foot = el('div', 'ad-dlg-foot');
  root.append(title, body, foot);

  const bring = (): void => {
    zTop += 2;
    if (shield) shield.style.zIndex = String(zTop - 1);
    root.style.zIndex = String(zTop);
    document.querySelectorAll('.ad-dlg.active').forEach((d) => d.classList.remove('active'));
    root.classList.add('active');
  };

  const dlg: Dialog = {
    root,
    body,
    foot,
    buttons: [],
    close() {
      if (!root.isConnected) return;
      root.remove();
      shield?.remove();
      openDialogs.delete(dlg);
      dlg.onClose?.();
    },
    setTitle(s: string) {
      t.textContent = s;
    },
  };
  openDialogs.add(dlg);
  if (opts.owner) ownerOf.set(dlg, opts.owner);

  const cancel = (): void => {
    const c = (opts.buttons ?? []).find((b) => b.cancel);
    if (c?.onClick && c.onClick() === false) return;
    dlg.close();
  };
  x.addEventListener('click', cancel);

  for (const spec of opts.buttons ?? []) {
    const b = button(
      spec.label,
      () => {
        if (spec.cancel) return cancel();
        if (spec.onClick && spec.onClick() === false) return;
        if (spec.label !== 'Apply') dlg.close();
      },
      { primary: spec.primary, disabled: spec.disabled, width: spec.width },
    );
    dlg.buttons.push(b);
    foot.appendChild(b);
  }
  if (!foot.childElementCount) foot.style.display = 'none';

  /*
   * Keyboard, so the dialog behaves like the Windows one it imitates: Enter
   * commits and Escape cancels. Scoped to the dialog so it cannot answer for
   * the window behind it; Enter inside a textarea is a new line, and on a
   * focused button it presses that button.
   */
  root.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (e.key === 'Enter' && target?.tagName !== 'TEXTAREA' && target?.tagName !== 'BUTTON') {
      const def = dlg.buttons.find((b) => b.classList.contains('default') && !b.disabled);
      if (def) {
        e.preventDefault();
        def.click();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  });

  // Drag by the title bar.
  title.addEventListener('mousedown', (e) => {
    if (e.target === x) return;
    const r = root.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = (ev: MouseEvent): void => {
      root.style.left = `${Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx))}px`;
      root.style.top = `${Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - dy))}px`;
    };
    const up = (): void => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  });
  root.addEventListener('mousedown', bring, true);
  shield?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    // Windows flashes the owned dialog when you click past it.
    root.animate?.([{ borderColor: '#1883d7' }, { borderColor: '#7a7a7a' }, { borderColor: '#1883d7' }], { duration: 240, iterations: 2 });
    focusFirstField(root);
  });

  if (shield) document.body.appendChild(shield);
  document.body.appendChild(root);
  bring();

  // Cascade from the centre, so a second sheet does not hide the first exactly.
  const n = openDialogs.size - 1;
  const w = root.offsetWidth || opts.width;
  const h = root.offsetHeight || opts.height || 300;
  root.style.left = `${Math.max(8, (window.innerWidth - w) / 2 + (n % 6) * 22)}px`;
  root.style.top = `${Math.max(8, (window.innerHeight - h) / 2 + (n % 6) * 22)}px`;

  queueMicrotask(() => focusFirstField(root));
  return dlg;
}

/**
 * Put the caret in the dialog's first field, with any existing text selected
 * so typing replaces it. A dialog that opens looking ready to type into and
 * is not sends the first keystrokes to whatever had focus before, which is
 * indistinguishable from a text box that refuses input.
 */
export function focusFirstField(scope: HTMLElement): void {
  const first = scope.querySelector<HTMLElement>(
    'input[type=text]:not(:disabled):not([readonly]), input[type=password]:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
  );
  const target = first ?? scope.querySelector<HTMLElement>('.ad-btn.default:not(:disabled)');
  if (!target) return;
  target.focus();
  if (target instanceof HTMLInputElement && target.value) target.select();
}

export type MsgKind = 'info' | 'warning' | 'error' | 'question';

/**
 * The console's message box: "Active Directory Domain Services" in the title,
 * an icon, the text, and OK (or Yes / No).
 */
export function messageBox(
  text: string,
  opts: { kind?: MsgKind; title?: string; yesNo?: boolean; onYes?: () => void; onNo?: () => void } = {},
): Dialog {
  const kind = opts.kind ?? 'info';
  const buttons: DialogButton[] = opts.yesNo
    ? [
        { label: 'Yes', primary: true, onClick: () => void opts.onYes?.() },
        { label: 'No', cancel: true, onClick: () => void opts.onNo?.() },
      ]
    : [{ label: 'OK', primary: true, cancel: true }];
  const d = openDialog({ title: opts.title ?? 'Active Directory Domain Services', width: 420, modal: true, buttons });
  const row = el('div');
  row.style.cssText = 'display:flex;gap:14px;align-items:flex-start;padding:10px 6px 14px;';
  const ic = icon(kind, 32);
  const p = el('div', 'ad-note', text);
  p.style.cssText = 'white-space:pre-wrap;padding-top:6px;user-select:text;';
  row.append(ic, p);
  d.body.style.background = '#fff';
  d.body.appendChild(row);
  d.foot.style.cssText += 'padding-top:11px;';
  queueMicrotask(() => d.buttons[0]?.focus());
  return d;
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export type MenuItem =
  | {
      label: string;
      onClick?: () => void;
      disabled?: boolean;
      bold?: boolean;
      checked?: boolean;
      /** A bullet rather than a tick: View > Large Icons / List / Detail. */
      radio?: boolean;
      submenu?: MenuItem[];
      /** What the status bar says while the item is highlighted. */
      hint?: string;
    }
  | { separator: true };

let menuHint: ((t: string | null) => void) | null = null;

/** The status bar listener: menu items describe themselves there, as MMC does. */
export function setMenuHintSink(fn: ((t: string | null) => void) | null): void {
  menuHint = fn;
}

export function closeMenus(): void {
  document.querySelectorAll('.ad-menu').forEach((m) => m.remove());
  menuHint?.(null);
}

/** Open a (cascading) menu at x,y. Returns the menu element. */
export function openMenu(x: number, y: number, items: MenuItem[], level = 0, onClosed?: () => void): HTMLElement {
  ensureStyles();
  if (level === 0) closeMenus();
  const menu = el('div', 'ad-menu');
  menu.dataset.level = String(level);
  menu.setAttribute('role', 'menu');
  let openSub: HTMLElement | null = null;
  let subTimer = 0;

  const closeSub = (): void => {
    if (openSub) {
      // Close deeper levels too.
      document.querySelectorAll('.ad-menu').forEach((m) => {
        if (Number((m as HTMLElement).dataset.level) > level) m.remove();
      });
      openSub = null;
    }
  };

  for (const item of items) {
    if ('separator' in item) {
      menu.appendChild(el('div', 'ad-msep'));
      continue;
    }
    const row = el('div', 'ad-mi' + (item.disabled ? ' dis' : '') + (item.bold ? ' bold' : ''));
    row.setAttribute('role', 'menuitem');
    if (item.checked) row.appendChild(el('span', 'chk', item.radio ? '●' : '✔'));
    row.appendChild(el('span', undefined, item.label));
    if (item.submenu) row.appendChild(el('span', 'sub', '▶'));

    const showSub = (): void => {
      if (!item.submenu || item.disabled) return;
      closeSub();
      const r = row.getBoundingClientRect();
      openSub = openMenu(r.right - 3, r.top - 3, item.submenu, level + 1);
      row.classList.add('hot');
    };
    row.addEventListener('mouseenter', () => {
      menu.querySelectorAll('.ad-mi.hot').forEach((m) => m.classList.remove('hot'));
      menuHint?.(item.hint ?? null);
      window.clearTimeout(subTimer);
      if (item.submenu) subTimer = window.setTimeout(showSub, 220);
      else subTimer = window.setTimeout(closeSub, 220);
    });
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.disabled) return;
      if (item.submenu) {
        showSub();
        return;
      }
      closeMenus();
      onClosed?.();
      item.onClick?.();
    });
    menu.appendChild(row);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);
  // Keep it on screen, flipping to the left of its parent when it would not fit.
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(0, level ? x - r.width - 180 : window.innerWidth - r.width - 2)}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(0, window.innerHeight - r.height - 2)}px`;

  if (level === 0) {
    const away = (ev: MouseEvent): void => {
      if ((ev.target as HTMLElement | null)?.closest?.('.ad-menu')) return;
      closeMenus();
      onClosed?.();
      document.removeEventListener('mousedown', away, true);
      document.removeEventListener('keydown', esc, true);
    };
    const esc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      closeMenus();
      onClosed?.();
      document.removeEventListener('mousedown', away, true);
      document.removeEventListener('keydown', esc, true);
    };
    setTimeout(() => {
      document.addEventListener('mousedown', away, true);
      document.addEventListener('keydown', esc, true);
    }, 0);
  }
  return menu;
}

// ---------------------------------------------------------------------------
// Property sheet
// ---------------------------------------------------------------------------

export interface SheetTab {
  label: string;
  build: (panel: HTMLElement) => void;
}

/**
 * Tabs on several rows, as a property sheet with many pages has them. Clicking
 * a tab on a back row moves that row to the front, next to the page -- the
 * behaviour everyone who has opened user Properties remembers.
 */
export function propertySheet(parent: HTMLElement, rows: SheetTab[][], initial: string): { select(label: string): void } {
  const tabsEl = el('div', 'ad-tabs');
  const panel = el('div', 'ad-tabpanel');
  panel.style.height = '100%';
  const built = new Map<string, HTMLElement>();
  let order = rows.map((r) => r);
  let active = initial;

  const paint = (): void => {
    // The row holding the active tab goes last (front).
    const idx = order.findIndex((r) => r.some((t) => t.label === active));
    if (idx >= 0 && idx !== order.length - 1) {
      const front = order[idx]!;
      order = [...order.slice(0, idx), ...order.slice(idx + 1), front];
    }
    tabsEl.textContent = '';
    for (const row of order) {
      const r = el('div', 'ad-tabrow');
      for (const tab of row) {
        const t = el('div', 'ad-tab' + (tab.label === active ? ' sel' : ''), tab.label);
        t.addEventListener('mousedown', (e) => {
          e.preventDefault();
          select(tab.label);
        });
        r.appendChild(t);
      }
      tabsEl.appendChild(r);
    }
    for (const [label, page] of built) page.style.display = label === active ? '' : 'none';
    if (!built.has(active)) {
      const page = el('div');
      page.style.height = '100%';
      const spec = rows.flat().find((t) => t.label === active);
      spec?.build(page);
      built.set(active, page);
      panel.appendChild(page);
    }
  };
  const select = (label: string): void => {
    active = label;
    paint();
  };

  const wrap = el('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;';
  wrap.append(tabsEl, panel);
  parent.appendChild(wrap);
  paint();
  return { select };
}

// ---------------------------------------------------------------------------
// List box (Member Of, Members, search results)
// ---------------------------------------------------------------------------

export interface ListBox<T> {
  el: HTMLElement;
  setRows(rows: T[]): void;
  selected(): T[];
  onSelect?: (rows: T[]) => void;
}

export function listBox<T>(
  columns: { label: string; width?: string; render: (row: T) => string; iconOf?: (row: T) => IconName }[],
  opts: { height: string; multi?: boolean; onOpen?: (row: T) => void; onContext?: (row: T, e: MouseEvent) => void } ,
): ListBox<T> {
  const box = el('div', 'ad-lb');
  box.tabIndex = 0;
  box.style.height = opts.height;
  const table = el('table');
  const thead = el('thead');
  const hr_ = el('tr');
  for (const c of columns) {
    const th = el('th', undefined, c.label);
    if (c.width) th.style.width = c.width;
    hr_.appendChild(th);
  }
  thead.appendChild(hr_);
  const tbody = el('tbody');
  table.append(thead, tbody);
  box.appendChild(table);

  let rows: T[] = [];
  const sel = new Set<number>();
  const api: ListBox<T> = {
    el: box,
    setRows(r: T[]) {
      rows = r;
      sel.clear();
      paint();
      api.onSelect?.([]);
    },
    selected: () => [...sel].sort((a, b) => a - b).map((i) => rows[i]!),
  };
  const paint = (): void => {
    tbody.textContent = '';
    rows.forEach((row, i) => {
      const tr = el('tr', 'row' + (sel.has(i) ? ' sel' : ''));
      columns.forEach((c, ci) => {
        const td = el('td');
        if (ci === 0 && c.iconOf) {
          const line = el('div', 'ad-lbline');
          line.append(icon(c.iconOf(row)), el('span', undefined, c.render(row)));
          td.appendChild(line);
        } else {
          td.textContent = c.render(row);
        }
        td.title = c.render(row);
        tr.appendChild(td);
      });
      tr.addEventListener('mousedown', (e) => {
        if (opts.multi && (e.ctrlKey || e.metaKey)) {
          if (sel.has(i)) sel.delete(i);
          else sel.add(i);
        } else if (!(e.button === 2 && sel.has(i))) {
          sel.clear();
          sel.add(i);
        }
        paint();
        api.onSelect?.(api.selected());
      });
      tr.addEventListener('dblclick', () => opts.onOpen?.(row));
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        opts.onContext?.(row, e);
      });
      tbody.appendChild(tr);
    });
  };
  return api;
}
