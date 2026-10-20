/**
 * ui/apps/excel.ts — Microsoft Excel: the grid, the Name Box and formula bar,
 * the ribbon (Home, Insert, Formulas, Data, View), sheet tabs and the status
 * bar's Average / Count / Sum. Formulas run in core/sheet.ts.
 *
 * Opens .xlsx (lab JSON) and .csv, so the access-review and HR exports in the
 * lab open the way they do at work. Saves .xlsx, or exports the active sheet
 * as CSV (values only).
 */
import { clear, h, toast } from '../dom.ts';
import { type AppDef } from '../wm.ts';
import { showMenu } from '../ctxmenu.ts';
import { type Addr, MAX_COLS, MAX_ROWS, addrName, colName, evaluator, formatValue, isError, parseAddr, shiftFormula, toCsv } from '../../core/sheet.ts';
import { type BookFile, type CellFormat, newBook, newSheet, readBook, writeBook } from '../../core/office.ts';
import { type OfficeShell, big, col, colorBtn, group, icon, officeShell, row, select, small } from './office.ts';

const DEFAULT_W = 84;
const ROW_H = 22;

export function excelApp(path?: string): AppDef {
  return {
    id: path ? `excel:${path.toLowerCase()}` : `excel:new:${Date.now()}`,
    title: 'Excel',
    icon: 'excel',
    width: 1180,
    height: 760,
    customTitlebar: true,
    mount(host, win) {
      let book: BookFile = newBook();
      let si = 0;
      let anchor: Addr = { col: 0, row: 0 };
      let focus: Addr = { col: 0, row: 0 };
      let editing: { at: Addr; original: string } | null = null;
      let gridlines = true;
      let freeze = false;
      let zoom = 100;
      let clip: { text: string; origin: Addr; raws: string[][] } | null = null;
      let ev = evaluator({});
      let fontColor = '#c00000';
      let fill = '#ffff00';
      let fileName = 'Book1';
      // Assigned once officeShell returns; it loads the file (and so paints) before that.
      let shell!: OfficeShell;

      const sheet = () => book.sheets[si]!;
      const snapshot = (): string => writeBook(book);
      const recalc = (): void => { ev = evaluator(sheet().cells); };
      const rng = (): { c0: number; c1: number; r0: number; r1: number } => ({ c0: Math.min(anchor.col, focus.col), c1: Math.max(anchor.col, focus.col), r0: Math.min(anchor.row, focus.row), r1: Math.max(anchor.row, focus.row) });
      const each = (fn: (a: Addr) => void): void => { const r = rng(); for (let y = r.r0; y <= r.r1; y++) for (let x = r.c0; x <= r.c1; x++) fn({ col: x, row: y }); };
      const used = (): { cols: number; rows: number } => {
        let cols = 0, rows = 0;
        for (const k of Object.keys(sheet().cells)) { const a = parseAddr(k); if (a) { cols = Math.max(cols, a.col + 1); rows = Math.max(rows, a.row + 1); } }
        return { cols, rows };
      };
      const width = (c: number): number => sheet().widths[colName(c)] ?? DEFAULT_W;
      const changed = (): void => { recalc(); shell.markDirty(); shell.undo.push(snapshot()); paintCells(); status(); };

      // ---------------------------------------------------------- grid DOM
      const nameBox = h('input', { class: 'xl-name', 'aria-label': 'Name Box', onKeydown: (e: KeyboardEvent) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const parts = nameBox.value.toUpperCase().split(':');
        const a = parseAddr(parts[0] ?? '');
        const b = parts[1] ? parseAddr(parts[1]) : a;
        if (!a || !b) { toast('Reference isn\'t valid.', 'err'); return; }
        anchor = a; focus = b; ensureSize(); paintSel(); reveal(); grid.focus();
      } });
      const fx = h('input', { class: 'xl-fx', 'aria-label': 'Formula Bar', spellcheck: 'false',
        onFocus: () => { if (!editing) startEdit(undefined, false); },
        onInput: () => { cellIn.value = fx.value; },
        onKeydown: (e: KeyboardEvent) => editKeys(e) });
      const cellIn = h('input', { class: 'xl-edit', 'aria-label': 'Cell editor', spellcheck: 'false', hidden: true,
        onInput: () => { fx.value = cellIn.value; },
        onKeydown: (e: KeyboardEvent) => editKeys(e) });
      const table = h('table', { class: 'xl-grid' });
      const grid = h('div', { class: 'xl-scroll', tabIndex: 0, 'aria-label': 'Worksheet grid' }, table, cellIn);
      const tabs = h('div', { class: 'xl-tabs' });
      const cellEls = new Map<string, HTMLTableCellElement>();
      let nRows = 0, nCols = 0;

      function ensureSize(): void {
        const u = used();
        const wantR = Math.min(MAX_ROWS, Math.max(100, u.rows + 40, focus.row + 30));
        const wantC = Math.min(MAX_COLS, Math.max(26, u.cols + 4, focus.col + 6));
        if (wantR > nRows || wantC > nCols) buildGrid(wantR, wantC);
      }
      function buildGrid(rows: number, cols: number): void {
        nRows = rows; nCols = cols;
        cellEls.clear();
        clear(table);
        const colgroup = h('colgroup', null, h('col', { style: 'width:46px' }), ...Array.from({ length: cols }, (_, c) => h('col', { style: `width:${width(c)}px` })));
        const headRow = h('tr', null, h('th', { class: 'xl-corner', title: 'Select all', onClick: () => { anchor = { col: 0, row: 0 }; focus = { col: nCols - 1, row: nRows - 1 }; paintSel(); } }),
          ...Array.from({ length: cols }, (_, c) => {
            const th = h('th', { class: 'xl-ch', 'data-c': String(c) }, colName(c), h('span', { class: 'xl-resize', 'data-c': String(c), title: 'Drag to resize; double-click to fit' }));
            return th;
          }));
        const body = h('tbody');
        for (let r = 0; r < rows; r++) {
          const tr = h('tr', { style: `height:${ROW_H}px` }, h('th', { class: 'xl-rh', 'data-r': String(r) }, String(r + 1)));
          for (let c = 0; c < cols; c++) {
            const td = h('td', { 'data-c': String(c), 'data-r': String(r) });
            cellEls.set(`${c},${r}`, td);
            tr.append(td);
          }
          body.append(tr);
        }
        table.append(colgroup, h('thead', null, headRow), body);
        table.style.width = `${46 + Array.from({ length: cols }, (_, c) => width(c)).reduce((x, y) => x + y, 0)}px`;
        paintCells();
        paintSel();
      }
      function paintCells(): void {
        for (const [key, td] of cellEls) {
          const [c, r] = key.split(',').map(Number) as [number, number];
          const a = addrName({ col: c, row: r });
          const raw = sheet().cells[a];
          const f: CellFormat = sheet().formats[a] ?? {};
          if (raw === undefined && !sheet().formats[a]) { if (td.textContent || td.getAttribute('style')) { td.textContent = ''; td.removeAttribute('style'); td.className = ''; } continue; }
          const v = raw === undefined ? null : ev.get(a);
          const text = f.fmt === 'text' && raw !== undefined ? raw : formatValue(v, f.fmt ?? 'general');
          td.textContent = text;
          const numeric = typeof v === 'number';
          td.className = `${isError(v) ? 'err' : ''} ${numeric ? 'num' : ''}`.trim();
          td.style.cssText = '';
          if (f.b) td.style.fontWeight = '700';
          if (f.i) td.style.fontStyle = 'italic';
          if (f.u) td.style.textDecoration = 'underline';
          if (f.color) td.style.color = f.color;
          if (f.bg) td.style.backgroundColor = f.bg;
          td.style.textAlign = f.align ?? (numeric || typeof v === 'boolean' || isError(v) ? (typeof v === 'boolean' || isError(v) ? 'center' : 'right') : 'left');
          td.title = raw?.startsWith('=') ? raw : '';
        }
      }
      function paintSel(): void {
        const r = rng();
        for (const el of table.querySelectorAll('.sel, .focus, .hsel')) el.classList.remove('sel', 'focus', 'hsel');
        for (let y = r.r0; y <= Math.min(r.r1, nRows - 1); y++) for (let x = r.c0; x <= Math.min(r.c1, nCols - 1); x++) cellEls.get(`${x},${y}`)?.classList.add('sel');
        cellEls.get(`${focus.col},${focus.row}`)?.classList.add('focus');
        for (let x = r.c0; x <= Math.min(r.c1, nCols - 1); x++) table.querySelector(`th.xl-ch[data-c="${x}"]`)?.classList.add('hsel');
        for (let y = r.r0; y <= Math.min(r.r1, nRows - 1); y++) table.querySelector(`th.xl-rh[data-r="${y}"]`)?.classList.add('hsel');
        nameBox.value = r.c0 === r.c1 && r.r0 === r.r1 ? addrName(focus) : `${addrName({ col: r.c0, row: r.r0 })}:${addrName({ col: r.c1, row: r.r1 })}`;
        if (!editing) fx.value = sheet().cells[addrName(focus)] ?? '';
        status();
        if (currentTab === 'Home') shell?.drawRibbon();
      }
      function reveal(): void {
        const td = cellEls.get(`${focus.col},${focus.row}`);
        if (!td) return;
        const top = td.offsetTop, left = td.offsetLeft;
        const head = ROW_H + 2, rh = 46;
        if (top - head < grid.scrollTop) grid.scrollTop = top - head;
        else if (top + td.offsetHeight > grid.scrollTop + grid.clientHeight) grid.scrollTop = top + td.offsetHeight - grid.clientHeight;
        if (left - rh < grid.scrollLeft) grid.scrollLeft = left - rh;
        else if (left + td.offsetWidth > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = left + td.offsetWidth - grid.clientWidth;
      }

      // ---------------------------------------------------------- editing
      function startEdit(initial?: string, inCell = true): void {
        const a = addrName(focus);
        editing = { at: { ...focus }, original: sheet().cells[a] ?? '' };
        const value = initial ?? editing.original;
        cellIn.value = value;
        fx.value = value;
        const td = cellEls.get(`${focus.col},${focus.row}`)!;
        Object.assign(cellIn.style, { left: `${td.offsetLeft}px`, top: `${td.offsetTop}px`, minWidth: `${td.offsetWidth}px`, height: `${td.offsetHeight}px` });
        cellIn.hidden = false;
        if (inCell) { cellIn.focus(); cellIn.setSelectionRange(value.length, value.length); }
        status();
      }
      function commit(move: [number, number] | null): void {
        if (!editing) return;
        const a = addrName(editing.at);
        const value = cellIn.value;
        editing = null;
        cellIn.hidden = true;
        if (value === '') delete sheet().cells[a]; else sheet().cells[a] = value;
        changed();
        if (move) go(move[0], move[1], false);
        grid.focus();
      }
      function cancel(): void { if (!editing) return; editing = null; cellIn.hidden = true; fx.value = sheet().cells[addrName(focus)] ?? ''; status(); grid.focus(); }
      function editKeys(e: KeyboardEvent): void {
        if (e.key === 'Enter') { e.preventDefault(); commit(e.shiftKey ? [0, -1] : [0, 1]); }
        else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? [-1, 0] : [1, 0]); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }
      /** While typing a formula, clicking a cell inserts its reference, as in Excel. */
      const wantsRef = (): boolean => !!editing && cellIn.value.startsWith('=') && /[=+\-*/(,:&<>^]$/.test(cellIn.value);

      // ---------------------------------------------------------- selection and keys
      function go(dc: number, dr: number, extend: boolean): void {
        focus = { col: Math.min(MAX_COLS - 1, Math.max(0, focus.col + dc)), row: Math.min(MAX_ROWS - 1, Math.max(0, focus.row + dr)) };
        if (!extend) anchor = { ...focus };
        ensureSize();
        paintSel();
        reveal();
      }
      let dragging = false;
      table.addEventListener('pointerdown', (e) => {
        const t = e.target as HTMLElement;
        if (t.classList.contains('xl-resize')) { resizeCol(e, Number(t.dataset.c)); return; }
        const td = t.closest('td');
        const th = t.closest('th');
        if (td) {
          const a = { col: Number(td.dataset.c), row: Number(td.dataset.r) };
          if (wantsRef()) { e.preventDefault(); cellIn.value += addrName(a); fx.value = cellIn.value; cellIn.focus(); return; }
          if (editing) commit(null);
          focus = a;
          if (!e.shiftKey) anchor = { ...a };
          dragging = true;
          paintSel();
          grid.focus();
        } else if (th?.classList.contains('xl-ch')) {
          const c = Number(th.dataset.c); anchor = { col: c, row: 0 }; focus = { col: c, row: nRows - 1 }; paintSel();
        } else if (th?.classList.contains('xl-rh')) {
          const r = Number(th.dataset.r); anchor = { col: 0, row: r }; focus = { col: nCols - 1, row: r }; paintSel();
        }
      });
      table.addEventListener('pointerover', (e) => {
        if (!dragging) return;
        const td = (e.target as HTMLElement).closest('td');
        if (td) { focus = { col: Number(td.dataset.c), row: Number(td.dataset.r) }; paintSel(); }
      });
      const stopDrag = (): void => { dragging = false; };
      window.addEventListener('pointerup', stopDrag);
      table.addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest('td')) startEdit(); else if ((e.target as HTMLElement).classList.contains('xl-resize')) autofit(Number((e.target as HTMLElement).dataset.c)); });
      grid.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: 'Cut', icon: '', onClick: () => copy(true) }, { label: 'Copy', icon: '', onClick: () => copy(false) }, { label: 'Paste', icon: '', onClick: () => { void navigator.clipboard?.readText().then(paste, () => toast('Use Ctrl+V to paste.', 'info')); } },
          '-', { label: 'Insert row', icon: '', onClick: () => insertRow() }, { label: 'Delete row', icon: '', onClick: () => deleteRow() }, { label: 'Clear contents', icon: '', onClick: () => clearCells() },
          '-', { label: 'Sort A to Z', icon: '', onClick: () => sort(true) }, { label: 'Sort Z to A', icon: '', onClick: () => sort(false) },
        ]);
      });
      grid.addEventListener('keydown', (e) => {
        if (editing || e.target !== grid) return;
        const k = e.key;
        const lk = (k ?? '').toLowerCase();
        if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
          e.preventDefault();
          const [dc, dr] = k === 'ArrowUp' ? [0, -1] : k === 'ArrowDown' ? [0, 1] : k === 'ArrowLeft' ? [-1, 0] : [1, 0];
          if (e.ctrlKey) { // jump to the edge of the data, as Ctrl+arrow does
            let n = 0;
            const u = used();
            while (n < MAX_ROWS) { const next = { col: focus.col + dc * (n + 1), row: focus.row + dr * (n + 1) }; if (next.col < 0 || next.row < 0 || next.col >= Math.max(u.cols, 1) + (dc > 0 ? 0 : 1) || next.row >= Math.max(u.rows, 1) + (dr > 0 ? 0 : 1)) break; n++; if (!sheet().cells[addrName(next)]) break; }
            go(dc * Math.max(n, 0), dr * Math.max(n, 0), e.shiftKey);
          } else go(dc, dr, e.shiftKey);
        } else if (k === 'Enter') { e.preventDefault(); go(0, e.shiftKey ? -1 : 1, false); }
        else if (k === 'Tab') { e.preventDefault(); go(e.shiftKey ? -1 : 1, 0, false); }
        else if (k === 'Home') { e.preventDefault(); if (e.ctrlKey) focus = { col: 0, row: 0 }; else focus = { ...focus, col: 0 }; if (!e.shiftKey) anchor = { ...focus }; paintSel(); reveal(); }
        else if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); go(0, (k === 'PageDown' ? 1 : -1) * Math.floor(grid.clientHeight / ROW_H), e.shiftKey); }
        else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearCells(); }
        else if (k === 'F2') { e.preventDefault(); startEdit(); }
        else if (e.ctrlKey && lk === 'b') { e.preventDefault(); toggleFmt('b'); }
        else if (e.ctrlKey && lk === 'i') { e.preventDefault(); toggleFmt('i'); }
        else if (e.ctrlKey && lk === 'u') { e.preventDefault(); toggleFmt('u'); }
        else if (e.ctrlKey && lk === 'a') { e.preventDefault(); const u = used(); anchor = { col: 0, row: 0 }; focus = { col: Math.max(0, u.cols - 1), row: Math.max(0, u.rows - 1) }; paintSel(); }
        else if (e.altKey && k === '=') { e.preventDefault(); autoSum(); }
        else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startEdit(k); }
      });
      // Clipboard: values travel as tab-separated text; inside this workbook, formulas travel and their references shift.
      grid.addEventListener('copy', (e) => { if (editing) return; e.preventDefault(); e.clipboardData?.setData('text/plain', copy(false)); });
      grid.addEventListener('cut', (e) => { if (editing) return; e.preventDefault(); e.clipboardData?.setData('text/plain', copy(true)); });
      grid.addEventListener('paste', (e) => { if (editing) return; e.preventDefault(); paste(e.clipboardData?.getData('text/plain') ?? ''); });

      function copy(cut: boolean): string {
        const r = rng();
        const raws: string[][] = [];
        const shown: string[][] = [];
        for (let y = r.r0; y <= r.r1; y++) {
          raws.push([]); shown.push([]);
          for (let x = r.c0; x <= r.c1; x++) {
            const a = addrName({ col: x, row: y });
            raws[raws.length - 1]!.push(sheet().cells[a] ?? '');
            shown[shown.length - 1]!.push(sheet().cells[a] === undefined ? '' : formatValue(ev.get(a)));
          }
        }
        const text = shown.map((l) => l.join('\t')).join('\r\n');
        clip = { text, origin: { col: r.c0, row: r.r0 }, raws };
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        if (cut) clearCells();
        return text;
      }
      function paste(text: string): void {
        const same = clip && text.replace(/\r\n/g, '\n') === clip.text.replace(/\r\n/g, '\n');
        const rows: string[][] = same ? clip!.raws : text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
        const dc = same ? focus.col - clip!.origin.col : 0, dr = same ? focus.row - clip!.origin.row : 0;
        rows.forEach((line, y) => line.forEach((v, x) => {
          const a = addrName({ col: focus.col + x, row: focus.row + y });
          const val = same ? shiftFormula(v, dc, dr) : v;
          if (val === '') delete sheet().cells[a]; else sheet().cells[a] = val;
        }));
        anchor = { ...focus };
        focus = { col: focus.col + Math.max(0, (rows[0]?.length ?? 1) - 1), row: focus.row + rows.length - 1 };
        ensureSize();
        changed();
        paintSel();
      }
      function clearCells(): void { each((a) => { delete sheet().cells[addrName(a)]; }); changed(); paintSel(); }
      function setFmt(patch: Partial<CellFormat>): void {
        each((a) => {
          const k = addrName(a);
          const f = { ...(sheet().formats[k] ?? {}), ...patch };
          for (const key of Object.keys(f) as (keyof CellFormat)[]) if (f[key] === undefined || f[key] === false) delete f[key];
          if (Object.keys(f).length) sheet().formats[k] = f; else delete sheet().formats[k];
        });
        changed();
        shell.drawRibbon();
      }
      const fmtAt = (): CellFormat => sheet().formats[addrName(focus)] ?? {};
      const toggleFmt = (k: 'b' | 'i' | 'u'): void => setFmt({ [k]: !fmtAt()[k] });

      // ---------------------------------------------------------- rows, sorting, data tools
      function moveRows(from: number, delta: number): void {
        for (const key of ['cells', 'formats'] as const) {
          const src = sheet()[key] as Record<string, unknown>;
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(src)) {
            const a = parseAddr(k)!;
            if (a.row < from) out[k] = v;
            else if (delta > 0 || a.row >= from - delta) out[addrName({ col: a.col, row: a.row + delta })] = v;
          }
          (sheet() as unknown as Record<string, unknown>)[key] = out;
        }
      }
      function insertRow(): void { const r = rng(); moveRows(r.r0, r.r1 - r.r0 + 1); changed(); }
      function deleteRow(): void { const r = rng(); moveRows(r.r1 + 1, -(r.r1 - r.r0 + 1)); changed(); paintSel(); }
      /** Rows a data command works on: the selected rows, or the whole table under a header row. */
      function dataRows(): { r0: number; r1: number; c0: number; c1: number; header: boolean } {
        const r = rng();
        if (r.r1 > r.r0) return { ...r, header: false };
        const u = used();
        return { r0: 1, r1: Math.max(1, u.rows - 1), c0: 0, c1: Math.max(0, u.cols - 1), header: true };
      }
      function sort(asc: boolean): void {
        const d = dataRows();
        const key = focus.col;
        const rows: { cells: Record<number, string>; fmts: Record<number, CellFormat | undefined>; v: unknown }[] = [];
        for (let y = d.r0; y <= d.r1; y++) {
          const cells: Record<number, string> = {}; const fmts: Record<number, CellFormat | undefined> = {};
          for (let x = d.c0; x <= d.c1; x++) { const a = addrName({ col: x, row: y }); if (sheet().cells[a] !== undefined) cells[x] = sheet().cells[a]!; fmts[x] = sheet().formats[a]; }
          rows.push({ cells, fmts, v: ev.get({ col: key, row: y }) });
        }
        const rank = (v: unknown): [number, number | string] => (v === null || v === '' ? [3, ''] : typeof v === 'number' ? [0, v] : typeof v === 'string' ? [1, v.toLowerCase()] : [2, String(v)]);
        rows.sort((a, b) => {
          const [ta, va] = rank(a.v), [tb, vb] = rank(b.v);
          if (ta === 3 || tb === 3) return ta - tb; // blanks always last
          if (ta !== tb) return asc ? ta - tb : tb - ta;
          return (va < vb ? -1 : va > vb ? 1 : 0) * (asc ? 1 : -1);
        });
        rows.forEach((row, i) => {
          for (let x = d.c0; x <= d.c1; x++) {
            const a = addrName({ col: x, row: d.r0 + i });
            if (row.cells[x] !== undefined) sheet().cells[a] = row.cells[x]!; else delete sheet().cells[a];
            if (row.fmts[x]) sheet().formats[a] = row.fmts[x]!; else delete sheet().formats[a];
          }
        });
        changed();
        toast(`Sorted ${rows.length} rows by column ${colName(key)}${d.header ? ', keeping row 1 as the header' : ''}.`, 'ok');
      }
      function removeDuplicates(): void {
        const d = dataRows();
        const seen = new Set<string>();
        const keep: number[] = [];
        for (let y = d.r0; y <= d.r1; y++) {
          const k = String(formatValue(ev.get({ col: focus.col, row: y }))).trim().toLowerCase();
          if (k && seen.has(k)) continue;
          seen.add(k);
          keep.push(y);
        }
        const removed = d.r1 - d.r0 + 1 - keep.length;
        if (!removed) { toast('No duplicate values found.', 'info'); return; }
        const snap = keep.map((y) => { const row: Record<number, [string | undefined, CellFormat | undefined]> = {}; for (let x = d.c0; x <= d.c1; x++) { const a = addrName({ col: x, row: y }); row[x] = [sheet().cells[a], sheet().formats[a]]; } return row; });
        for (let y = d.r0; y <= d.r1; y++) for (let x = d.c0; x <= d.c1; x++) { const a = addrName({ col: x, row: y }); delete sheet().cells[a]; delete sheet().formats[a]; }
        snap.forEach((row, i) => { for (const [x, [v, f]] of Object.entries(row)) { const a = addrName({ col: Number(x), row: d.r0 + i }); if (v !== undefined) sheet().cells[a] = v; if (f) sheet().formats[a] = f; } });
        changed();
        toast(`${removed} duplicate value${removed === 1 ? '' : 's'} found and removed; ${keep.length} unique value${keep.length === 1 ? '' : 's'} remain.`, 'ok');
      }
      function autoSum(fn = 'SUM'): void {
        const r = rng();
        if (r.r1 > r.r0 && r.c0 === r.c1) { // a column of numbers selected: total goes underneath
          const target = { col: r.c0, row: r.r1 + 1 };
          sheet().cells[addrName(target)] = `=${fn}(${addrName({ col: r.c0, row: r.r0 })}:${addrName({ col: r.c0, row: r.r1 })})`;
          focus = target; anchor = { ...target };
          changed(); paintSel(); return;
        }
        let top = focus.row - 1;
        while (top >= 0 && typeof ev.get({ col: focus.col, row: top }) === 'number') top--;
        const from = top + 1, to = focus.row - 1;
        startEdit(from <= to ? `=${fn}(${addrName({ col: focus.col, row: from })}:${addrName({ col: focus.col, row: to })})` : `=${fn}(`);
      }
      function insertFn(name: string): void { startEdit(`=${name}(`); }

      function resizeCol(e: PointerEvent, c: number): void {
        e.preventDefault();
        const startX = e.clientX, startW = width(c);
        const colEl = table.querySelectorAll('col')[c + 1] as HTMLElement | undefined;
        const startT = table.offsetWidth;
        const move = (ev2: PointerEvent): void => { const w = Math.max(24, Math.min(600, startW + ev2.clientX - startX)); sheet().widths[colName(c)] = w; if (colEl) colEl.style.width = `${w}px`; table.style.width = `${startT + w - startW}px`; };
        const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); shell.markDirty(); shell.undo.push(snapshot()); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }
      function autofit(c: number): void {
        let w = 40;
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = '14px Aptos, Calibri, "Segoe UI", sans-serif';
        for (let r = 0; r < nRows; r++) { const t = cellEls.get(`${c},${r}`)?.textContent; if (t) w = Math.max(w, ctx.measureText(t).width + 16); }
        sheet().widths[colName(c)] = Math.min(600, Math.ceil(w));
        buildGrid(nRows, nCols);
        shell.markDirty();
      }

      // ---------------------------------------------------------- sheets
      function drawTabs(): void {
        clear(tabs);
        book.sheets.forEach((s, i) => tabs.append(h('button', { class: `xl-tab ${i === si ? 'on' : ''}`, type: 'button',
          onClick: () => { if (editing) commit(null); si = i; recalc(); buildGrid(Math.max(100, used().rows + 40), Math.max(26, used().cols + 4)); drawTabs(); },
          onDblclick: () => { const n = prompt('Rename sheet', s.name)?.trim(); if (n && !/[\\/?*[\]:]/.test(n)) { s.name = n.slice(0, 31); shell.markDirty(); drawTabs(); } },
          onContextmenu: (e: MouseEvent) => { e.preventDefault(); showMenu(e.clientX, e.clientY, [
            { label: 'Rename', icon: '', onClick: () => { const n = prompt('Rename sheet', s.name)?.trim(); if (n && !/[\\/?*[\]:]/.test(n)) { s.name = n.slice(0, 31); shell.markDirty(); drawTabs(); } } },
            { label: 'Delete', icon: '', disabled: book.sheets.length < 2, onClick: () => { if (!confirm(`Delete ${s.name}?`)) return; book.sheets.splice(i, 1); si = Math.max(0, si - (i <= si ? 1 : 0)); recalc(); buildGrid(nRows, nCols); drawTabs(); changed(); } },
          ]); } }, s.name)));
        tabs.append(h('button', { class: 'xl-tab add', type: 'button', title: 'New sheet', 'aria-label': 'New sheet', onClick: () => {
          let n = book.sheets.length + 1;
          while (book.sheets.some((s) => s.name === `Sheet${n}`)) n++;
          book.sheets.push(newSheet(`Sheet${n}`)); si = book.sheets.length - 1; recalc(); buildGrid(100, 26); drawTabs(); changed();
        } }, icon('')));
      }

      // ---------------------------------------------------------- ribbon
      let currentTab = 'Home';
      function ribbon(t: string, into: HTMLElement): void {
        const f = fmtAt();
        if (t === 'Home') {
          into.append(
            group('Clipboard', big('', 'Paste', () => { void navigator.clipboard?.readText().then(paste, () => toast('Use Ctrl+V to paste.', 'info')); }),
              col(small('', 'Cut', () => copy(true), { text: true }), small('', 'Copy', () => copy(false), { text: true }))),
            group('Font', row(small('', 'Bold (Ctrl+B)', () => toggleFmt('b'), { on: !!f.b }), small('', 'Italic (Ctrl+I)', () => toggleFmt('i'), { on: !!f.i }), small('', 'Underline (Ctrl+U)', () => toggleFmt('u'), { on: !!f.u })),
              row(colorBtn('', 'Fill color', fill, (c) => { fill = c; setFmt({ bg: c }); }), colorBtn('', 'Font color', fontColor, (c) => { fontColor = c; setFmt({ color: c }); }),
                small('', 'Clear formats', () => setFmt({ b: undefined, i: undefined, u: undefined, color: undefined, bg: undefined, align: undefined, fmt: undefined })))),
            group('Alignment', row(small('', 'Align left', () => setFmt({ align: 'left' }), { on: f.align === 'left' }), small('', 'Center', () => setFmt({ align: 'center' }), { on: f.align === 'center' }), small('', 'Align right', () => setFmt({ align: 'right' }), { on: f.align === 'right' }))),
            group('Number', row(select('Number format', f.fmt ?? 'general', [['general', 'General'], ['number', 'Number'], ['currency', 'Currency'], ['percent', 'Percentage'], ['date', 'Short Date'], ['text', 'Text']], (v) => setFmt({ fmt: v as CellFormat['fmt'] }), 120)),
              row(small('', 'Currency', () => setFmt({ fmt: 'currency' })), small('', 'Percent style', () => setFmt({ fmt: 'percent' })), small('', 'Comma style', () => setFmt({ fmt: 'number' })))),
            group('Cells', col(small('', 'Insert rows', insertRow, { text: true }), small('', 'Delete rows', deleteRow, { text: true }), small('', 'AutoFit column', () => autofit(focus.col), { text: true }))),
            group('Editing', col(small('', 'AutoSum (Alt+=)', () => autoSum(), { text: true }), small('', 'Sort A to Z', () => sort(true), { text: true }), small('', 'Clear', clearCells, { text: true }))));
        } else if (t === 'Insert') {
          into.append(group('Text', big('', 'Date', () => { sheet().cells[addrName(focus)] = new Date().toLocaleDateString('en-US'); changed(); }), big('', 'Time', () => { sheet().cells[addrName(focus)] = new Date().toLocaleTimeString('en-US'); changed(); })));
        } else if (t === 'Formulas') {
          into.append(
            group('Function Library', big('', 'AutoSum', () => autoSum()),
              col(small('', 'SUM', () => insertFn('SUM'), { text: true }), small('', 'AVERAGE', () => insertFn('AVERAGE'), { text: true }), small('', 'COUNT', () => insertFn('COUNTA'), { text: true })),
              col(small('', 'COUNTIF', () => insertFn('COUNTIF'), { text: true }), small('', 'VLOOKUP', () => insertFn('VLOOKUP'), { text: true }), small('', 'IF', () => insertFn('IF'), { text: true })),
              col(small('', 'TEXTJOIN', () => insertFn('TEXTJOIN'), { text: true }), small('', 'TRIM', () => insertFn('TRIM'), { text: true }), small('', 'TODAY', () => { sheet().cells[addrName(focus)] = '=TODAY()'; setFmt({ fmt: 'date' }); }, { text: true }))),
            group('Calculation', big('', 'Calculate Now', () => { recalc(); paintCells(); toast('Calculated.', 'ok'); })));
        } else if (t === 'Data') {
          into.append(
            group('Sort & Filter', big('', 'Sort A to Z', () => sort(true)), big('', 'Sort Z to A', () => sort(false))),
            group('Data Tools', big('', 'Remove Duplicates', removeDuplicates, 'Remove rows whose value in the selected column repeats an earlier row')));
        } else if (t === 'View') {
          into.append(
            group('Show', col(small(gridlines ? '' : '', 'Gridlines', () => { gridlines = !gridlines; table.classList.toggle('nogrid', !gridlines); shell.drawRibbon(); }, { on: gridlines, text: true }))),
            group('Window', big('', freeze ? 'Unfreeze Panes' : 'Freeze Top Row', () => { freeze = !freeze; table.classList.toggle('freeze', freeze); shell.drawRibbon(); })),
            group('Zoom', big('', 'Zoom', () => setZoom(zoom === 100 ? 125 : 100)), big('', '100%', () => setZoom(100))));
        }
      }
      function setZoom(z: number): void { zoom = z; table.style.zoom = String(z / 100); cellIn.style.zoom = String(z / 100); status(); }

      function status(): void {
        if (!shell) return;
        const r = rng();
        const nums: number[] = [];
        let count = 0;
        if ((r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1) > 1) each((a) => { const k = addrName(a); if (sheet().cells[k] === undefined) return; count++; const v = ev.get(k); if (typeof v === 'number') nums.push(v); });
        const sum = nums.reduce((s, x) => s + x, 0);
        shell.status.replaceChildren(...[
          h('span', null, editing ? 'Edit' : 'Ready'),
          h('span', { class: 'off-grow' }),
          nums.length ? h('span', null, `Average: ${formatValue(sum / nums.length)}`) : null,
          count > 1 ? h('span', null, `Count: ${count}`) : null,
          nums.length ? h('span', null, `Sum: ${formatValue(sum)}`) : null,
          h('input', { class: 'off-zoom', type: 'range', min: '50', max: '200', step: '10', value: String(zoom), 'aria-label': 'Zoom', onInput: (e: Event) => setZoom(Number((e.target as HTMLInputElement).value)) }),
          h('span', { class: 'off-zpct' }, `${zoom}%`)].filter((x): x is HTMLElement => !!x));
      }

      // ---------------------------------------------------------- shell
      const load = (p: string, content: string): void => {
        fileName = p.split('\\').pop() ?? 'Book1';
        book = readBook(content, fileName);
        // A CSV has no column widths: fit them to the data once, as Excel does when it opens one.
        if (!/\.xlsx$/i.test(p)) {
          const ctx = document.createElement('canvas').getContext('2d')!;
          ctx.font = '14px Aptos, Calibri, "Segoe UI", sans-serif';
          for (const sh of book.sheets) {
            const w: Record<string, number> = {};
            for (const [k, v] of Object.entries(sh.cells)) { const c = k.replace(/\d+$/, ''); w[c] = Math.max(w[c] ?? 0, ctx.measureText(v).width + 14); }
            for (const [c, px] of Object.entries(w)) if (px > DEFAULT_W) sh.widths[c] = Math.min(360, Math.ceil(px));
          }
        }
        si = 0; anchor = { col: 0, row: 0 }; focus = { col: 0, row: 0 };
        recalc();
        nRows = 0; nCols = 0;
        ensureSize();
        drawTabs();
      };
      shell = officeShell('excel', host, win, {
        tabs: ['File', 'Home', 'Insert', 'Formulas', 'Data', 'View'],
        initialPath: path,
        snapshot,
        restore: (s) => { book = readBook(s); si = Math.min(si, book.sheets.length - 1); recalc(); buildGrid(nRows, nCols); drawTabs(); paintSel(); },
        doc: {
          exportTypes: [['.csv', 'CSV (Comma delimited) (*.csv)']],
          serialize: (type) => {
            if (type !== '.csv') return writeBook(book);
            const u = used();
            const rows: string[][] = [];
            for (let y = 0; y < u.rows; y++) { const line: string[] = []; for (let x = 0; x < u.cols; x++) { const a = addrName({ col: x, row: y }); line.push(sheet().cells[a] === undefined ? '' : formatValue(ev.get(a), sheet().formats[a]?.fmt ?? 'general')); } rows.push(line); }
            return toCsv(rows);
          },
          load,
          blank: () => { book = newBook(); si = 0; recalc(); nRows = 0; nCols = 0; ensureSize(); drawTabs(); },
        },
        ribbon: (t, into) => { currentTab = t; ribbon(t, into); },
      });
      shell.docHost.append(h('div', { class: 'xl' },
        h('div', { class: 'xl-bar' }, nameBox, h('span', { class: 'xl-fxsep' }), h('button', { class: 'xl-fxbtn', type: 'button', title: 'Insert Function', 'aria-label': 'Insert Function', onClick: () => insertFn('SUM') }, h('i', null, 'fx')), fx),
        grid, tabs));
      paintSel();
      status();
      setTimeout(() => grid.focus(), 0);
      return { dispose: () => { window.removeEventListener('pointerup', stopDrag); } };
    },
  };
}

export const excelStartApp: AppDef = { ...excelApp(), id: 'excel' };
