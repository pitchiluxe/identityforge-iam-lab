/**
 * core/office.ts — the document formats of Word, PowerPoint and Sticky Notes,
 * and Excel workbooks. Pure: no DOM.
 *
 * Rich text is a list of paragraphs, each a list of formatted runs. Files on
 * the virtual disk hold this as JSON (".docx", ".pptx", ".xlsx" here are lab
 * formats, not the real zip packages). Files can be edited by hand in
 * Notepad, so everything read back is validated: colours must be #rrggbb,
 * fonts come from a fixed list, sizes are clamped. The editors only ever set
 * those values through element.style, never through markup.
 */
import { parseCsv } from './sheet.ts';

export interface Run { text: string; b?: boolean; i?: boolean; u?: boolean; s?: boolean; color?: string; bg?: string; size?: number; font?: string }
export type ParaStyle = 'p' | 'title' | 'subtitle' | 'h1' | 'h2' | 'h3' | 'quote' | 'ul' | 'ol';
export type Align = 'left' | 'center' | 'right' | 'justify';
export interface Para { style: ParaStyle; align?: Align; runs: Run[] }
export interface RichDoc { paras: Para[] }

export const FONTS = ['Aptos', 'Calibri', 'Arial', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Times New Roman', 'Verdana'] as const;
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const STYLES: readonly ParaStyle[] = ['p', 'title', 'subtitle', 'h1', 'h2', 'h3', 'quote', 'ul', 'ol'];
const ALIGNS: readonly Align[] = ['left', 'center', 'right', 'justify'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const safeColor = (v: unknown): string | undefined => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
export const safeFont = (v: unknown): string | undefined => (typeof v === 'string' ? FONTS.find((f) => f.toLowerCase() === v.toLowerCase().replace(/["']/g, '').split(',')[0]!.trim()) : undefined);
export const safeSize = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(96, Math.max(6, Math.round(v * 2) / 2)) : undefined);

const sameFormat = (a: Run, b: Run): boolean => a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s && a.color === b.color && a.bg === b.bg && a.size === b.size && a.font === b.font;

/** Merge neighbouring runs with the same format and drop empty ones. */
export function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameFormat(last, r)) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

function cleanRun(v: unknown): Run | null {
  if (!isObj(v) || typeof v.text !== 'string') return null;
  const r: Run = { text: v.text.slice(0, 200_000) };
  for (const k of ['b', 'i', 'u', 's'] as const) if (v[k] === true) r[k] = true;
  const color = safeColor(v.color); if (color) r.color = color;
  const bg = safeColor(v.bg); if (bg) r.bg = bg;
  const size = safeSize(v.size); if (size) r.size = size;
  const font = safeFont(v.font); if (font) r.font = font;
  return r;
}

export function cleanDoc(v: unknown): RichDoc {
  const paras = isObj(v) && Array.isArray(v.paras) ? v.paras : [];
  const out: Para[] = paras.slice(0, 20_000).filter(isObj).map((p) => ({
    style: STYLES.includes(p.style as ParaStyle) ? (p.style as ParaStyle) : 'p',
    ...(ALIGNS.includes(p.align as Align) && p.align !== 'left' ? { align: p.align as Align } : {}),
    runs: normalizeRuns((Array.isArray(p.runs) ? p.runs : []).map(cleanRun).filter((r): r is Run => r !== null)),
  }));
  return { paras: out.length ? out : [{ style: 'p', runs: [] }] };
}

export const docText = (d: RichDoc): string => d.paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
export const fromText = (text: string): RichDoc => ({ paras: text.replace(/\r\n?/g, '\n').split('\n').map((line) => ({ style: 'p' as const, runs: line ? [{ text: line }] : [] })) });
export const wordCount = (text: string): number => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

// ------------------------------------------------------------------ Word

export type Margins = 'normal' | 'narrow' | 'wide';
export interface WordFile { type: 'word'; doc: RichDoc; margins: Margins; landscape: boolean }

export function newWord(): WordFile { return { type: 'word', doc: { paras: [{ style: 'p', runs: [] }] }, margins: 'normal', landscape: false }; }

/** Open a .docx (lab JSON), or any text file as plain paragraphs. */
export function readWord(content: string): WordFile {
  try {
    const v: unknown = JSON.parse(content);
    if (isObj(v) && v.type === 'word') return { type: 'word', doc: cleanDoc(v.doc), margins: (['normal', 'narrow', 'wide'] as const).find((m) => m === v.margins) ?? 'normal', landscape: v.landscape === true };
  } catch { /* plain text */ }
  return { ...newWord(), doc: content ? fromText(content) : newWord().doc };
}
export const writeWord = (f: WordFile): string => JSON.stringify(f);

// ------------------------------------------------------------------ PowerPoint

export type Layout = 'title' | 'content' | 'section' | 'blank';
export interface Slide { layout: Layout; title: RichDoc; body: RichDoc; notes: string }
export const THEMES = {
  office: { name: 'Office Theme', bg: '#ffffff', fg: '#1f1f1f', accent: '#c43e1c', title: '#1f1f1f' },
  meridian: { name: 'Meridian', bg: '#0b2545', fg: '#e8f1fb', accent: '#5fd3c4', title: '#ffffff' },
  ion: { name: 'Ion', bg: '#1b5e57', fg: '#e8fff9', accent: '#f2c14e', title: '#ffffff' },
  facet: { name: 'Facet', bg: '#f4fbf2', fg: '#22331f', accent: '#5a9a3c', title: '#2f5d1f' },
  slate: { name: 'Slate', bg: '#2b2b2b', fg: '#e6e6e6', accent: '#e8a33d', title: '#ffffff' },
} as const;
export type ThemeId = keyof typeof THEMES;
export interface DeckFile { type: 'powerpoint'; theme: ThemeId; slides: Slide[] }

const blankDoc = (): RichDoc => ({ paras: [{ style: 'p', runs: [] }] });
export const newSlide = (layout: Layout): Slide => ({ layout, title: blankDoc(), body: layout === 'content' ? { paras: [{ style: 'ul', runs: [] }] } : blankDoc(), notes: '' });
export function newDeck(): DeckFile { return { type: 'powerpoint', theme: 'office', slides: [newSlide('title')] }; }

export function readDeck(content: string): DeckFile {
  try {
    const v: unknown = JSON.parse(content);
    if (isObj(v) && v.type === 'powerpoint' && Array.isArray(v.slides)) {
      const slides = v.slides.slice(0, 500).filter(isObj).map((s): Slide => ({
        layout: (['title', 'content', 'section', 'blank'] as const).find((l) => l === s.layout) ?? 'content',
        title: cleanDoc(s.title), body: cleanDoc(s.body), notes: typeof s.notes === 'string' ? s.notes.slice(0, 50_000) : '',
      }));
      return { type: 'powerpoint', theme: (Object.keys(THEMES) as ThemeId[]).find((t) => t === v.theme) ?? 'office', slides: slides.length ? slides : newDeck().slides };
    }
  } catch { /* not a deck */ }
  return newDeck();
}
export const writeDeck = (f: DeckFile): string => JSON.stringify(f);

// ------------------------------------------------------------------ Excel

export interface CellFormat { b?: boolean; i?: boolean; u?: boolean; align?: 'left' | 'center' | 'right'; fmt?: 'general' | 'number' | 'currency' | 'percent' | 'date' | 'text'; color?: string; bg?: string }
export interface Sheet { name: string; cells: Record<string, string>; formats: Record<string, CellFormat>; widths: Record<string, number> }
export interface BookFile { type: 'excel'; sheets: Sheet[] }

export const newSheet = (name: string): Sheet => ({ name, cells: {}, formats: {}, widths: {} });
export function newBook(): BookFile { return { type: 'excel', sheets: [newSheet('Sheet1')] }; }

const CELL = /^[A-Z]{1,2}[1-9]\d{0,4}$/;
function cleanFormat(v: unknown): CellFormat | null {
  if (!isObj(v)) return null;
  const f: CellFormat = {};
  for (const k of ['b', 'i', 'u'] as const) if (v[k] === true) f[k] = true;
  if (v.align === 'left' || v.align === 'center' || v.align === 'right') f.align = v.align;
  if (['general', 'number', 'currency', 'percent', 'date', 'text'].includes(v.fmt as string)) f.fmt = v.fmt as CellFormat['fmt'];
  const color = safeColor(v.color); if (color) f.color = color;
  const bg = safeColor(v.bg); if (bg) f.bg = bg;
  return Object.keys(f).length ? f : null;
}

/** Open an .xlsx (lab JSON) or a .csv: one sheet named after the file, as Excel does. */
export function readBook(content: string, name = 'Sheet1'): BookFile {
  try {
    const v: unknown = JSON.parse(content);
    if (isObj(v) && v.type === 'excel' && Array.isArray(v.sheets)) {
      const sheets = v.sheets.slice(0, 50).filter(isObj).map((s, i): Sheet => {
        const sh = newSheet(typeof s.name === 'string' && s.name.trim() ? s.name.slice(0, 31) : `Sheet${i + 1}`);
        if (isObj(s.cells)) for (const [k, val] of Object.entries(s.cells)) if (CELL.test(k) && typeof val === 'string') sh.cells[k] = val.slice(0, 32_767);
        if (isObj(s.formats)) for (const [k, val] of Object.entries(s.formats)) { const f = cleanFormat(val); if (CELL.test(k) && f) sh.formats[k] = f; }
        if (isObj(s.widths)) for (const [k, val] of Object.entries(s.widths)) if (/^[A-Z]{1,2}$/.test(k) && typeof val === 'number') sh.widths[k] = Math.min(600, Math.max(24, Math.round(val)));
        return sh;
      });
      if (sheets.length) return { type: 'excel', sheets };
    }
  } catch { /* CSV or text */ }
  const sh = newSheet(name.replace(/\.[^.]+$/, '').slice(0, 31) || 'Sheet1');
  parseCsv(content).slice(0, 10_000).forEach((row, r) => row.slice(0, 702).forEach((val, c) => {
    if (val !== '') sh.cells[`${colLetters(c)}${r + 1}`] = val;
  }));
  return { type: 'excel', sheets: [sh] };
}
export const writeBook = (f: BookFile): string => JSON.stringify(f);

function colLetters(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
