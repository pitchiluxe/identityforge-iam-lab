/**
 * core/pdfdoc.ts — the document model behind PDF-XChange Editor
 * (ui/apps/pdfxchange.ts). Pure: no DOM.
 *
 * A ".pdf" on the virtual disk is a lab format: the real "%PDF-1.7" header
 * line, then JSON with pages of text blocks, comments (annotations), form
 * fields and an optional open password (kept as a hash, never the password).
 * Files can be edited by hand in Notepad, so everything read back is
 * validated: unknown kinds are dropped, colours must be #rrggbb, positions are
 * clamped to the page, annotations must point at a page that exists.
 * Every edit returns a new document; Organize keeps comments and fields on
 * the pages they were placed on.
 */

export type PageSize = 'Letter' | 'A4';
export type Rotation = 0 | 90 | 180 | 270;
export type BlockKind = 'title' | 'heading' | 'text' | 'small';
export interface PdfBlock { kind: BlockKind; text: string }
export interface PdfPage { size: PageSize; rotate: Rotation; blocks: PdfBlock[] }
export type AnnotKind = 'highlight' | 'underline' | 'strikeout' | 'note' | 'typewriter' | 'textbox' | 'stamp' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'pencil' | 'signature' | 'redact';
/** Positions are percentages of the page (0-100), so zoom and page size do not matter. */
export interface PdfAnnot { id: string; page: number; kind: AnnotKind; x: number; y: number; w: number; h: number; text?: string; color: string; author: string; created: string }
export type FieldType = 'text' | 'check' | 'date';
export interface PdfField { id: string; page: number; name: string; type: FieldType; value: string; x: number; y: number; w: number; h: number }
export interface PdfDoc {
  version: 1;
  title: string;
  author: string;
  subject: string;
  producer: string;
  pages: PdfPage[];
  annots: PdfAnnot[];
  fields: PdfField[];
  /** Document Open password, as a salted hash. */
  security?: { openHash: string; salt: string };
}

export const PDF_HEADER = '%PDF-1.7\n';
export const PRODUCER = 'PDF-XChange Editor 10.4.0';
export const STAMPS = ['Approved', 'Not Approved', 'Completed', 'Confidential', 'Draft', 'Final', 'For Comment', 'Void', 'Received'] as const;
export const ANNOT_KINDS: readonly AnnotKind[] = ['highlight', 'underline', 'strikeout', 'note', 'typewriter', 'textbox', 'stamp', 'rect', 'ellipse', 'line', 'arrow', 'pencil', 'signature', 'redact'];
export const DEFAULT_COLOR: Record<AnnotKind, string> = {
  highlight: '#ffff00', underline: '#00a000', strikeout: '#ff0000', note: '#ffd400', typewriter: '#000000', textbox: '#ff0000',
  stamp: '#2e7d32', rect: '#ff0000', ellipse: '#ff0000', line: '#ff0000', arrow: '#ff0000', pencil: '#0000ff', signature: '#0b3d91', redact: '#000000',
};
/** Page size in points (1/72 inch), as Document Properties shows it. */
export const PAGE_POINTS: Record<PageSize, [number, number]> = { Letter: [612, 792], A4: [595, 842] };
const BLOCK_KINDS: readonly BlockKind[] = ['title', 'heading', 'text', 'small'];
const FIELD_TYPES: readonly FieldType[] = ['text', 'check', 'date'];

const FORMAT_ERROR = 'Format error: not a PDF or corrupted.';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 20000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const pct = (v: unknown, def = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v * 100) / 100)) : def);
const safeColor = (v: unknown): string | undefined => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
const rot = (v: unknown): Rotation => ([0, 90, 180, 270].includes(v as number) ? (v as Rotation) : 0);

export function newPdf(title = 'Untitled', author = '', size: PageSize = 'Letter'): PdfDoc {
  return { version: 1, title, author, subject: '', producer: PRODUCER, pages: [{ size, rotate: 0, blocks: [] }], annots: [], fields: [] };
}

export function writePdf(d: PdfDoc): string {
  return `${PDF_HEADER}${JSON.stringify(d)}\n%%EOF\n`;
}

export function parsePdf(raw: string): PdfDoc {
  if (!raw.startsWith('%PDF-')) throw new Error(FORMAT_ERROR);
  const body = raw.replace(/^%PDF-[^\n]*\n/, '').replace(/%%EOF\s*$/, '');
  let j: unknown;
  try { j = JSON.parse(body); } catch { throw new Error(FORMAT_ERROR); }
  if (!isObj(j) || !Array.isArray(j.pages) || !j.pages.length) throw new Error(FORMAT_ERROR);
  const pages: PdfPage[] = j.pages.slice(0, 500).map((p: unknown) => {
    const o = isObj(p) ? p : {};
    const blocks = Array.isArray(o.blocks) ? o.blocks.filter(isObj).map((b) => ({ kind: BLOCK_KINDS.includes(b.kind as BlockKind) ? (b.kind as BlockKind) : 'text', text: str(b.text) })) : [];
    return { size: o.size === 'A4' ? 'A4' : 'Letter', rotate: rot(o.rotate), blocks };
  });
  const onPage = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < pages.length;
  const annots: PdfAnnot[] = (Array.isArray(j.annots) ? j.annots : []).filter(isObj).filter((a) => ANNOT_KINDS.includes(a.kind as AnnotKind) && onPage(a.page)).map((a) => {
    const kind = a.kind as AnnotKind;
    const out: PdfAnnot = { id: str(a.id, 40) || 'a0', page: a.page as number, kind, x: pct(a.x), y: pct(a.y), w: pct(a.w, 5), h: pct(a.h, 5), color: safeColor(a.color) ?? DEFAULT_COLOR[kind], author: str(a.author, 100), created: str(a.created, 40) };
    if (typeof a.text === 'string') out.text = str(a.text, 5000);
    return out;
  });
  const fields: PdfField[] = (Array.isArray(j.fields) ? j.fields : []).filter(isObj).filter((f) => FIELD_TYPES.includes(f.type as FieldType) && onPage(f.page)).map((f) => ({
    id: str(f.id, 40) || 'f0', page: f.page as number, name: str(f.name, 100), type: f.type as FieldType, value: str(f.value, 2000), x: pct(f.x), y: pct(f.y), w: pct(f.w, 20), h: pct(f.h, 3),
  }));
  const d: PdfDoc = { version: 1, title: str(j.title, 300), author: str(j.author, 300), subject: str(j.subject, 300), producer: str(j.producer, 100) || PRODUCER, pages, annots, fields };
  if (isObj(j.security) && typeof j.security.openHash === 'string' && typeof j.security.salt === 'string') d.security = { openHash: j.security.openHash, salt: j.security.salt };
  return d;
}

// ------------------------------------------------------------------ comments

export function addAnnot(d: PdfDoc, a: Omit<PdfAnnot, 'id' | 'created'>, at: string): PdfDoc {
  if (a.page < 0 || a.page >= d.pages.length) throw new Error('The page does not exist.');
  const n = d.annots.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0) + 1;
  return { ...d, annots: [...d.annots, { ...a, id: `a${n}`, created: at }] };
}
export function updateAnnot(d: PdfDoc, id: string, patch: Partial<Pick<PdfAnnot, 'text' | 'color' | 'x' | 'y' | 'w' | 'h'>>): PdfDoc {
  return { ...d, annots: d.annots.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
}
export function removeAnnot(d: PdfDoc, id: string): PdfDoc {
  return { ...d, annots: d.annots.filter((a) => a.id !== id) };
}

// ------------------------------------------------------------------ organize

/** Map every page-bound item through `fn` (new index, or -1 to drop it). */
function remap(d: PdfDoc, pages: PdfPage[], fn: (old: number) => number): PdfDoc {
  return {
    ...d,
    pages,
    annots: d.annots.map((a) => ({ ...a, page: fn(a.page) })).filter((a) => a.page >= 0),
    fields: d.fields.map((f) => ({ ...f, page: fn(f.page) })).filter((f) => f.page >= 0),
  };
}

export function insertPages(d: PdfDoc, at: number, count = 1, size?: PageSize): PdfDoc {
  const i = Math.max(0, Math.min(at, d.pages.length));
  const blank = Array.from({ length: count }, (): PdfPage => ({ size: size ?? d.pages[Math.max(0, i - 1)]?.size ?? 'Letter', rotate: 0, blocks: [] }));
  return remap(d, [...d.pages.slice(0, i), ...blank, ...d.pages.slice(i)], (p) => (p >= i ? p + count : p));
}

export function deletePages(d: PdfDoc, indexes: number[]): PdfDoc {
  const drop = new Set(indexes.filter((i) => i >= 0 && i < d.pages.length));
  if (drop.size >= d.pages.length) throw new Error('You cannot delete all pages in the document.');
  const map = new Map<number, number>();
  let n = 0;
  d.pages.forEach((_p, i) => { if (!drop.has(i)) map.set(i, n++); });
  return remap(d, d.pages.filter((_p, i) => !drop.has(i)), (p) => map.get(p) ?? -1);
}

export function rotatePages(d: PdfDoc, indexes: number[], by: 90 | 180 | 270): PdfDoc {
  return { ...d, pages: d.pages.map((p, i) => (indexes.includes(i) ? { ...p, rotate: ((p.rotate + by) % 360) as Rotation } : p)) };
}

export function movePage(d: PdfDoc, from: number, to: number): PdfDoc {
  if (from === to || from < 0 || from >= d.pages.length) return d;
  const t = Math.max(0, Math.min(to, d.pages.length - 1));
  const order = d.pages.map((_p, i) => i);
  order.splice(from, 1);
  order.splice(t, 0, from);
  const where = new Map(order.map((old, i) => [old, i]));
  return remap(d, order.map((i) => d.pages[i]!), (p) => where.get(p)!);
}

// ------------------------------------------------------------------ text

export function setBlockText(d: PdfDoc, page: number, block: number, text: string): PdfDoc {
  const p = d.pages[page];
  if (!p || !p.blocks[block]) throw new Error(`There is no text block ${block + 1} on page ${page + 1}.`);
  const blocks = p.blocks.map((b, i) => (i === block ? { ...b, text } : b));
  return { ...d, pages: d.pages.map((x, i) => (i === page ? { ...x, blocks } : x)) };
}

export function addTextBlock(d: PdfDoc, page: number, text: string, kind: BlockKind = 'text'): PdfDoc {
  const p = d.pages[page];
  if (!p) throw new Error(`The document has no page ${page + 1}.`);
  return { ...d, pages: d.pages.map((x, i) => (i === page ? { ...x, blocks: [...x.blocks, { kind, text }] } : x)) };
}

/** Plain text of the document, pages separated by a form feed (what copying "all text" gives). */
export function pdfText(d: PdfDoc): string {
  return d.pages.map((p) => p.blocks.map((b) => b.text).join('\n')).join('\n\f');
}

export interface PdfHit { page: number; block: number; start: number; end: number }
export function searchPdf(d: PdfDoc, query: string, o: { matchCase?: boolean; wholeWord?: boolean } = {}): PdfHit[] {
  if (!query) return [];
  let src = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) src = `(?<!\\w)${src}(?!\\w)`;
  const re = new RegExp(src, o.matchCase ? 'g' : 'gi');
  const hits: PdfHit[] = [];
  d.pages.forEach((p, page) => p.blocks.forEach((b, block) => {
    for (const m of b.text.matchAll(re)) hits.push({ page, block, start: m.index, end: m.index + m[0].length });
  }));
  return hits;
}

// ------------------------------------------------------------------ protect

/** Protect > Search & Redact: mark every match with a redaction annotation. */
export function markRedactions(d: PdfDoc, query: string, author: string, at: string): PdfDoc {
  let out = d;
  const pages = new Set(searchPdf(d, query, { matchCase: true }).map((h) => h.page));
  for (const page of pages) out = addAnnot(out, { page, kind: 'redact', x: 0, y: 0, w: 0, h: 0, text: query, color: DEFAULT_COLOR.redact, author }, at);
  return out;
}

/** Protect > Apply All Redactions: the marked text is replaced by solid blocks and cannot be recovered. */
export function applyRedactions(d: PdfDoc): PdfDoc {
  const marks = d.annots.filter((a) => a.kind === 'redact' && a.text);
  const pages = d.pages.map((p, i) => {
    const mine = marks.filter((m) => m.page === i);
    if (!mine.length) return p;
    return { ...p, blocks: p.blocks.map((b) => ({ ...b, text: mine.reduce((t, m) => t.split(m.text!).join('█'.repeat(m.text!.length)), b.text) })) };
  });
  return { ...d, pages, annots: d.annots.filter((a) => a.kind !== 'redact') };
}

/** A small non-cryptographic hash: enough for a lab file, and the password is never stored. */
function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13); }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
}
export function setOpenPassword(d: PdfDoc, password: string | null): PdfDoc {
  const { security: _drop, ...rest } = d;
  if (!password) return rest;
  const salt = hash(`${d.title}|${password.length}|${d.pages.length}`).slice(0, 8);
  return { ...rest, security: { salt, openHash: hash(salt + password) } };
}
export const isProtected = (d: PdfDoc): boolean => !!d.security;
export const checkOpenPassword = (d: PdfDoc, password: string): boolean => !d.security || hash(d.security.salt + password) === d.security.openHash;

// ------------------------------------------------------------------ forms

export function fillField(d: PdfDoc, id: string, value: string): PdfDoc {
  return {
    ...d,
    fields: d.fields.map((f) => {
      if (f.id !== id) return f;
      if (f.type === 'check') return { ...f, value: /^(yes|on|true|1)$/i.test(value) ? 'Yes' : 'Off' };
      return { ...f, value: value.slice(0, 2000) };
    }),
  };
}

export function addField(d: PdfDoc, f: Omit<PdfField, 'id' | 'value'> & { value?: string }): PdfDoc {
  const n = d.fields.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0) + 1;
  return { ...d, fields: [...d.fields, { ...f, id: `f${n}`, value: f.value ?? (f.type === 'check' ? 'Off' : '') }] };
}
