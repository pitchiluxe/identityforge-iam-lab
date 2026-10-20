/**
 * core/time.ts — the range's clock.
 *
 * Wall-clock time by default, so "the leaver signed in 10 minutes ago" is true
 * when you read it. Tests pin it so grading is deterministic.
 */
let clock: () => number = () => Date.now();

export function setClock(fn: () => number): void {
  clock = fn;
}

export function nowMs(): number {
  return clock();
}

export function nowIso(): string {
  return new Date(clock()).toISOString();
}

export function minutesAgo(min: number): string {
  return new Date(clock() - min * 60_000).toISOString();
}

export function daysAgo(days: number): string {
  return new Date(clock() - days * 86_400_000).toISOString();
}

export function daysFromNow(days: number): string {
  return new Date(clock() + days * 86_400_000).toISOString();
}

export function isAfter(a: string | null | undefined, b: string): boolean {
  return !!a && Date.parse(a) > Date.parse(b);
}

/** "2026-10-19 09:14" in the viewer's local time. */
export function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(iso: string | null | undefined): string {
  return fmt(iso).slice(0, 10);
}
