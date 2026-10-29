/**
 * ui/sites/azure/apps.ts — App registrations and Enterprise applications blades.
 */
import { daysFromNow, fmt, isAfter, nowIso } from '../../../core/time.ts';
import { badge, h, table } from '../../dom.ts';
import { addApiPermission, addSecret, assignApp, ensureApps, grantAdminConsent, registerApp, removeSecret, setAssignmentRequired } from '../../../world/apps.ts';
import { blade, cmd, form, info, input, select, type Portal } from './frame.ts';

const GRAPH_PERMS: [string, string][] = [
  ['Delegated|User.Read', 'Delegated · User.Read'], ['Delegated|User.Read.All', 'Delegated · User.Read.All'], ['Delegated|Mail.Send', 'Delegated · Mail.Send'],
  ['Delegated|Files.Read.All', 'Delegated · Files.Read.All'], ['Application|User.Read.All', 'Application · User.Read.All'],
  ['Application|Directory.Read.All', 'Application · Directory.Read.All'], ['Application|Mail.Send', 'Application · Mail.Send'], ['Application|AuditLog.Read.All', 'Application · AuditLog.Read.All'],
];
let newApp = false;

function expiry(iso: string): HTMLElement | string {
  const soon = !isAfter(iso, daysFromNow(30));
  return isAfter(iso, nowIso()) ? (soon ? badge(`Expires ${fmt(iso)}`, 'warn') : fmt(iso)) : badge('Expired', 'bad');
}

export function appsPage(p: Portal): HTMLElement {
  const regs = ensureApps(p.w);
  const name = input({ placeholder: 'Name' });
  const uri = input({ placeholder: 'Redirect URI (optional)' });
  return blade('App registrations', `${regs.length} applications`, [cmd('New registration', '+', () => { newApp = !newApp; p.go({ k: 'entra', page: 'apps' }); })],
    newApp ? h('section', { class: 'az-card' }, h('h3', null, 'Register an application'), form(['Name', name], ['Redirect URI (Web)', uri]),
      h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => {
        let id = '';
        if (p.run((x, a) => { id = registerApp(x, a, { name: name.value, redirectUris: uri.value.trim() ? [uri.value.trim()] : [] }).appId; }, 'Application registered')) { newApp = false; p.go({ k: 'appReg', appId: id }); }
      } }, 'Register'))) : null,
    table(['Display name', 'Application (client) ID', 'Owners', 'Certificates & secrets'], regs.map((r) => [
      h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); p.go({ k: 'appReg', appId: r.appId }); } }, r.name), r.appId, r.owners.join(', ') || '—',
      r.secrets.length ? expiry(r.secrets.map((s) => s.expires).sort()[0]!) : '—'])));
}

export function appRegPage(p: Portal, appId: string): HTMLElement {
  const r = ensureApps(p.w).find((x) => x.appId === appId);
  if (!r) return blade('Application not found', null, [], h('p', { class: 'empty' }, appId));
  const desc = input({ placeholder: 'Description' });
  const months = select([['6', '6 months'], ['12', '12 months'], ['24', '24 months']], '6');
  const perm = select(GRAPH_PERMS);
  return blade(r.name, 'App registration', [],
    h('dl', { class: 'kv' }, ...[['Application (client) ID', r.appId], ['Object ID', r.objectId], ['Owners', r.owners.join(', ') || 'No owners'], ['Redirect URIs', r.redirectUris.join(', ') || '—']].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('section', { class: 'az-card' }, h('h3', null, 'Certificates & secrets'),
      table(['Description', 'Expires', 'Secret ID', ''], r.secrets.map((s) => [s.description, expiry(s.expires), s.id, h('button', { class: 'btn slim ghost', type: 'button', onClick: () => p.run((x, a) => removeSecret(x, a, appId, s.id), 'Secret deleted') }, 'Delete')])),
      h('div', { class: 'row' }, desc, months, h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => { addSecret(x, a, appId, desc.value, Number(months.value) as 6); }, 'Client secret added. Copy the value now: it is shown only once.') }, '+ New client secret')),
      info('Rotate before expiry: add the new secret, update the application that uses it, then delete the old one.')),
    h('section', { class: 'az-card' }, h('h3', null, 'API permissions'),
      table(['API / Permission', 'Type', 'Status'], r.permissions.map((x) => [`${x.api} · ${x.name}`, x.type, x.consented ? badge(`Granted for ${p.w.company.name}`, 'ok') : badge('Not granted', 'warn')])),
      h('div', { class: 'row' }, perm, h('button', { class: 'btn', type: 'button', onClick: () => { const [type, name] = perm.value.split('|'); p.run((x, a) => addApiPermission(x, a, appId, { api: 'Microsoft Graph', name: name!, type: type as 'Delegated' }), 'Permission added'); } }, '+ Add a permission'),
        h('button', { class: 'btn primary', type: 'button', onClick: () => p.run((x, a) => grantAdminConsent(x, a, appId), 'Admin consent granted') }, `Grant admin consent for ${p.w.company.name}`)),
      info('Application permissions to Microsoft Graph need a Privileged Role Administrator to consent. Delegated permissions need a Cloud Application Administrator.')));
}

export function enterprisePage(p: Portal): HTMLElement {
  ensureApps(p.w);
  return blade('Enterprise applications', 'All applications', [], table(['Name', 'Single sign-on', 'Assignment required', 'Assigned'], p.w.entra.apps.map((a) => [
    h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); p.go({ k: 'entApp', id: a.id }); } }, a.name), a.sso, a.assignmentRequired ? 'Yes' : 'No', String(a.assignedGroups.length + a.assignedUsers.length)])));
}

export function entAppPage(p: Portal, id: string): HTMLElement {
  ensureApps(p.w);
  const a = p.w.entra.apps.find((x) => x.id === id);
  if (!a) return blade('Application not found', null, [], h('p', { class: 'empty' }, id));
  const who = input({ placeholder: 'User principal name or group name', list: 'az-app-principals', 'aria-label': 'User or group' });
  const principals = [...p.w.entra.users.filter((e) => !e.deleted).map((e) => e.upn), ...p.w.ad.groups.map((g) => g.name), ...(p.w.entra.cloudGroups ?? []).map((g) => g.name)];
  return blade(a.name, 'Enterprise Application', [cmd(a.assignmentRequired ? 'Assignment required: Yes' : 'Assignment required: No', '⚙', () => p.run((x, actor) => setAssignmentRequired(x, actor, id, !a.assignmentRequired), 'Properties saved'))],
    h('dl', { class: 'kv' }, ...[['Single sign-on', a.sso], ['Provisioning', a.provisioning], ['Owners', (a.owners ?? []).join(', ') || 'No owners']].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('section', { class: 'az-card' }, h('h3', null, 'Users and groups'),
      h('datalist', { id: 'az-app-principals' }, principals.map((x) => h('option', { value: x }))),
      h('div', { class: 'row' }, who, h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, actor) => assignApp(x, actor, id, who.value.trim(), true), 'Assignment added') }, '+ Add user/group')),
      table(['Display name', 'Object type', ''], [...a.assignedGroups.map((g) => [g, 'Group', g] as const), ...a.assignedUsers.map((u) => [u, 'User', u] as const)].map(([n, type, key]) => [n, type,
        h('button', { class: 'btn slim ghost', type: 'button', onClick: () => p.run((x, actor) => assignApp(x, actor, id, key, false), 'Assignment removed') }, 'Remove')]))),
    info(a.assignmentRequired ? 'Assignment is required: only the users and groups above can sign in.' : 'Assignment is not required: every user in the tenant can sign in to this app.'));
}
