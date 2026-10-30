import { fmt } from '../../../core/time.ts';
import { filterSignIns, filterAudit, type AuditFilter, type SignInFilter } from '../../../core/portalLogs.ts';
import { badge, h, table } from '../../dom.ts';
import { blade, form, info, input, select, type Portal } from './frame.ts';

type Kind = 'signins' | 'audit';
const filters = new Map<string, SignInFilter & AuditFilter>();

export function logsPage(p: Portal, kind: Kind): HTMLElement {
  const key = `${p.domain}:${kind}`;
  const state = filters.get(key) ?? {};
  const query = input({ type: 'search', value: state.query ?? '', placeholder: 'User, application, IP, activity or error', 'aria-label': 'Search logs' });
  const from = input({ type: 'date', value: state.from ?? '', 'aria-label': 'From date' });
  const to = input({ type: 'date', value: state.to ?? '', 'aria-label': 'To date' });
  const category = kind === 'signins'
    ? select([['', 'All statuses'], ['Success', 'Success'], ['Failure', 'Failure'], ['Interrupted', 'Interrupted']], state.status)
    : select([['', 'All services'], ['Entra ID', 'Core Directory'], ['Azure', 'Azure RBAC']], state.source);
  category.setAttribute('aria-label', kind === 'signins' ? 'Sign-in status' : 'Audit service');
  const controls = h('form', { onSubmit: (e: Event) => {
    e.preventDefault();
    filters.set(key, { query: query.value, from: from.value, to: to.value, ...(kind === 'signins' ? { status: category.value as SignInFilter['status'] } : { source: category.value as AuditFilter['source'] }) });
    p.go({ k: 'entra', page: kind });
  } }, form(['Search', query], ['From (UTC)', from], ['To (UTC)', to], [kind === 'signins' ? 'Status' : 'Service', category]),
  h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Apply filters'),
    h('button', { class: 'btn', type: 'button', onClick: () => { filters.delete(key); p.go({ k: 'entra', page: kind }); } }, 'Clear filters')));
  const rows = kind === 'signins' ? filterSignIns(p.w.entra.signIns, state).map((s) => [fmt(s.time), s.upn, s.app, badge(s.result, s.result === 'Success' ? 'ok' : s.result === 'Failure' ? 'bad' : 'warn'), s.ip, s.location, s.failureReason || '—'])
    : filterAudit(p.w.audit, state).map((e) => [fmt(e.time), e.source === 'Azure' ? 'Azure RBAC' : 'Core Directory', e.action, e.target, e.actor, e.detail ?? '']);
  return blade(kind === 'signins' ? 'Sign-in logs' : 'Audit logs', `${rows.length} matching events shown`, [], controls,
    state.from && state.to && state.from > state.to ? info('The From date must be on or before the To date.') : null,
    info('Dates are in UTC. The newest 200 matching events are shown.'),
    rows.length ? table(kind === 'signins' ? ['Date', 'User', 'Application', 'Status', 'IP address', 'Location', 'Failure reason'] : ['Date', 'Service', 'Activity', 'Target', 'Initiated by', 'Detail'], rows)
      : h('p', { class: 'empty' }, 'No matching events. Change or clear the filters.'));
}
