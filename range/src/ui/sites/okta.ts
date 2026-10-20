/**
 * Okta admin console (simulated): people, groups, applications and
 * assignments, the AD integration import, and the System Log.
 */
import type { OktaUser } from '../../core/types.ts';
import { fmt } from '../../core/time.ts';
import { oktaAssignApp, oktaClearSessions, oktaHasApp, oktaLifecycle, oktaResetFactors, runOktaImport } from '../../world/cloud.ts';
import { eventsFor } from '../../world/audit.ts';
import { badge, button, h, table } from '../dom.ts';
import { act, store } from '../store.ts';
import { type Site, type SiteCtx, empty, kv, link, shell } from './common.ts';

let q = '';

function statusBadge(o: OktaUser): HTMLElement {
  return badge(o.status, o.status === 'ACTIVE' ? 'ok' : o.status === 'DEPROVISIONED' ? 'bad' : 'warn');
}

function person(ctx: SiteCtx, o: OktaUser): HTMLElement {
  const w = store.world;
  const apps = w.okta.apps.filter((a) => oktaHasApp(w, o, a.id));
  const lc = (action: Parameters<typeof oktaLifecycle>[2], label: string, cls = 'btn'): HTMLButtonElement => button(label, () => act((x) => oktaLifecycle(x, o.login, action), `${label}: ${o.login}`), cls);
  return h('div', null, link('← People', () => ctx.go('/people')),
    h('div', { class: 'row-between' }, h('h2', null, o.displayName), statusBadge(o)),
    h('div', { class: 'row wrap' },
      o.status === 'ACTIVE' ? [lc('suspend', 'Suspend'), lc('deactivate', 'Deactivate', 'btn danger')] : null,
      o.status === 'SUSPENDED' ? lc('unsuspend', 'Unsuspend') : null,
      o.status === 'DEPROVISIONED' ? lc('reactivate', 'Activate') : null,
      o.status === 'LOCKED_OUT' ? lc('unlock', 'Unlock') : null,
      button('Reset multifactor', () => act((x) => oktaResetFactors(x, o.login), 'All factors reset')),
      button('Clear user sessions', () => act((x) => oktaClearSessions(x, o.login), 'Sessions cleared'), 'btn primary')),
    kv([['Username', o.login], ['Source', o.source === 'Active Directory' ? `Active Directory (${o.onPremSam})` : 'Okta'], ['Status', o.status], ['Last login', fmt(o.lastLogin)], ['Live sessions', String(o.sessions)], ['Factors', o.factors.join(', ') || 'None enrolled'], ['Groups', o.groups.join(', ') || '—']]),
    h('h3', null, 'Applications'),
    apps.length ? table(['Application', 'Assigned by', ''], apps.map((a) => [a.name, a.assignedUsers.includes(o.login) ? badge('Direct (individual)', 'warn') : `Group: ${a.assignedGroups.filter((g) => o.groups.includes(g)).join(', ')}`,
      a.assignedUsers.includes(o.login) ? button('Remove direct assignment', () => act((x) => oktaAssignApp(x, a.id, o.login, false), 'Direct assignment removed'), 'btn slim') : ''])) : empty('No applications assigned.'),
    o.source === 'Active Directory' ? h('p', { class: 'muted' }, 'Profile, status and groups are mastered in Active Directory and refreshed by the AD import.') : null);
}

function app(ctx: SiteCtx, id: string): HTMLElement {
  const w = store.world;
  const a = w.okta.apps.find((x) => x.id === id);
  if (!a) return empty('Application not found.');
  const who = h('input', { class: 'input', placeholder: 'user@meridianhealth.test', 'aria-label': 'Assign to person' });
  return h('div', null, link('← Applications', () => ctx.go('/apps')), h('h2', null, a.name),
    kv([['Sign-on', a.sso], ['Provisioning', a.provisioning === 'SCIM' ? 'SCIM: create, update and deactivate users' : 'None (accounts are managed in the app)'], ['Assigned groups', a.assignedGroups.join(', ') || '—']]),
    h('h3', null, 'Direct assignments'),
    a.assignedUsers.length ? table(['Person', ''], a.assignedUsers.map((u) => [u, button('Remove', () => act((x) => oktaAssignApp(x, a.id, u, false), 'Direct assignment removed'), 'btn slim')])) : empty('None. Access comes from the assigned groups.'),
    h('div', { class: 'row' }, who, button('Assign to person', () => act((x) => oktaAssignApp(x, a.id, who.value, true), 'Assigned'), 'btn')),
    h('p', { class: 'muted' }, 'IAM-POL-004: grant access through the access group in AD. Direct assignments are invisible to access reviews.'));
}

export const okta: Site = {
  host: 'meridianhealth-admin.okta.test',
  name: 'Okta Admin Console',
  short: 'Okta',
  color: '#1c2f5e',
  render(ctx) {
    const w = store.world;
    const nav: [string, string][] = [['Dashboard', '/'], ['People', '/people'], ['Groups', '/groups'], ['Applications', '/apps'], ['Directory integrations', '/ad'], ['System Log', '/syslog']];
    let content: HTMLElement;
    const pm = /^\/people\/(.+)$/.exec(ctx.path);
    const am = /^\/apps\/(.+)$/.exec(ctx.path);
    if (pm) {
      const o = w.okta.users.find((x) => x.login === decodeURIComponent(pm[1]!));
      content = o ? person(ctx, o) : empty('Person not found. Run an AD import if they are new.');
    } else if (am) content = app(ctx, am[1]!);
    else if (ctx.path === '/people') {
      const input = h('input', { class: 'input', type: 'search', placeholder: 'Search people', value: q, 'aria-label': 'Search people' });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { q = input.value; ctx.go('/people'); } });
      const list = w.okta.users.filter((o) => `${o.displayName} ${o.login}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.displayName.localeCompare(b.displayName));
      content = h('div', null, h('h2', null, 'People'), h('div', { class: 'row' }, input, button('Search', () => { q = input.value; ctx.go('/people'); })),
        table(['Person', 'Username', 'Status', 'Source', 'Last login'], list.map((o) => [o.displayName, o.login, statusBadge(o), o.source, fmt(o.lastLogin)]), (i) => ctx.go(`/people/${encodeURIComponent(list[i]!.login)}`)));
    } else if (ctx.path === '/groups') {
      const groups = [...new Set(w.okta.users.flatMap((o) => o.groups))].sort();
      content = h('div', null, h('h2', null, 'Groups'), table(['Group', 'People', 'Source', 'Apps'], groups.map((g) => [g, String(w.okta.users.filter((o) => o.groups.includes(g)).length), 'Active Directory', w.okta.apps.filter((a) => a.assignedGroups.includes(g)).map((a) => a.name).join(', ') || '—'])));
    } else if (ctx.path === '/apps') {
      content = h('div', null, h('h2', null, 'Applications'), table(['Application', 'Sign-on', 'Provisioning', 'Assigned groups', 'Direct assignments'], w.okta.apps.map((a) => [a.name, a.sso, a.provisioning === 'SCIM' ? 'SCIM' : badge('None', 'warn'), a.assignedGroups.join(', '), a.assignedUsers.length ? badge(String(a.assignedUsers.length), 'warn') : '0']), (i) => ctx.go(`/apps/${w.okta.apps[i]!.id}`)));
    } else if (ctx.path === '/ad') {
      content = h('div', null, h('h2', null, 'Active Directory: meridianhealth.test'),
        kv([['Agent', 'MHS-DC01 (svc-idp-sync)'], ['Last import', fmt(w.okta.lastImport)], ['Schedule', 'Hourly'], ['Import scope', 'Corp/Users, Corp/Disabled Users, Corp/Admins'], ['On AD disable', 'Deactivate the Okta user']]),
        button('Import now', () => act((x) => { const r = runOktaImport(x); if (!r) throw new Error('Import failed'); }, 'Import complete. SCIM provisioning ran for connected apps.'), 'btn primary'));
    } else if (ctx.path === '/syslog') {
      const ev = eventsFor(w, 'Okta').slice(0, 200);
      content = h('div', null, h('h2', null, 'System Log'), table(['Time', 'Event', 'Target', 'Actor', 'Detail'], ev.map((e) => [fmt(e.time), e.action, e.target, e.actor, e.detail])));
    } else {
      content = h('div', null, h('h2', null, 'Dashboard'),
        kv([['People', String(w.okta.users.length)], ['Active', String(w.okta.users.filter((o) => o.status === 'ACTIVE').length)], ['Deactivated', String(w.okta.users.filter((o) => o.status === 'DEPROVISIONED').length)], ['Apps', String(w.okta.apps.length)], ['Last AD import', fmt(w.okta.lastImport)]]));
    }
    return shell(this, nav, ctx, content, w.okta.orgUrl.replace('https://', ''));
  },
};
