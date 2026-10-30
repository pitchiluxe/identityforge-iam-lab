/** Read-only Azure log selectors. Dates use UTC, including the entire end date. */
import type { AuditEvent, SignIn } from './types.ts';

export interface LogFilter { query?: string; from?: string; to?: string }
export interface SignInFilter extends LogFilter { status?: '' | SignIn['result'] }
export interface AuditFilter extends LogFilter { source?: '' | 'Entra ID' | 'Azure' }
function matches(time: string, text: string[], filter: LogFilter): boolean {
  const day = time.slice(0, 10);
  return (!filter.from || day >= filter.from) && (!filter.to || day <= filter.to)
    && (!filter.query?.trim() || text.join(' ').toLowerCase().includes(filter.query.trim().toLowerCase()));
}
export function filterSignIns(list: readonly SignIn[], filter: SignInFilter = {}): SignIn[] {
  return list.filter((s) => (!filter.status || s.result === filter.status) && matches(s.time, [s.upn, s.app, s.ip, s.location, s.result, s.failureReason, s.device, s.ca, s.mfa, s.risk], filter))
    .sort((a, b) => b.time.localeCompare(a.time)).slice(0, 200);
}
export function filterAudit(list: readonly AuditEvent[], filter: AuditFilter = {}): AuditEvent[] {
  return list.filter((e) => (e.source === 'Entra ID' || e.source === 'Azure') && (!filter.source || e.source === filter.source) && matches(e.time, [e.source, e.action, e.actor, e.target, e.detail ?? '', e.origin], filter))
    .sort((a, b) => b.time.localeCompare(a.time)).slice(0, 200);
}
