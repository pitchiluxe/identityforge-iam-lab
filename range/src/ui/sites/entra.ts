/**
 * Entra admin center (simulated): users, groups, enterprise apps, Conditional
 * Access, PIM, sign-in and audit logs, and Entra Connect sync health.
 */
import type { CaPolicy, EntraUser } from '../../core/types.ts';
import { fmt } from '../../core/time.ts';
import { BREAK_GLASS } from '../../world/company.ts';
import { ENTRA_ROLES, assignRole, deleteCaPolicy, deleteMfaMethod, removeRole, requireMfaReregistration, revokeSessions, saveCaPolicy, setCloudAccountEnabled, setRisk } from '../../world/cloud.ts';
import { eventsFor } from '../../world/audit.ts';
import { badge, button, field, h, table } from '../dom.ts';
import { act, store } from '../store.ts';
import { type Site, type SiteCtx, empty, kv, link, shell } from './common.ts';

let userQuery = '';
let signInQuery = '';
let userTab: 'overview' | 'groups' | 'auth' | 'signins' | 'roles' = 'overview';

const validSessions = (e: EntraUser): number => e.sessions.filter((s) => Date.parse(s.issued) >= Date.parse(e.sessionsValidFrom)).length;

function users(ctx: SiteCtx): HTMLElement {
  const w = store.world;
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Search users by name or UPN', value: userQuery, 'aria-label': 'Search users' });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { userQuery = q.value; ctx.go('/users'); } });
  const list = w.entra.users.filter((e) => !e.deleted && `${e.displayName} ${e.upn}`.toLowerCase().includes(userQuery.toLowerCase())).sort((a, b) => a.displayName.localeCompare(b.displayName));
  return h('div', null, h('h2', null, 'All users'), h('div', { class: 'row' }, q, button('Search', () => { userQuery = q.value; ctx.go('/users'); })),
    table(['Display name', 'User principal name', 'Account enabled', 'On-premises sync', 'Risk'], list.map((e) => [e.displayName, e.upn, e.accountEnabled ? 'Yes' : badge('No', 'bad'), e.source === 'synced' ? 'Yes' : 'No (cloud)', e.riskLevel === 'none' ? '—' : badge(e.riskLevel, e.riskLevel === 'high' ? 'bad' : 'warn')]), (i) => { userTab = 'overview'; ctx.go(`/users/${encodeURIComponent(list[i]!.upn)}`); }));
}

function userDetail(ctx: SiteCtx, e: EntraUser): HTMLElement {
  const w = store.world;
  const tabs: [typeof userTab, string][] = [['overview', 'Overview'], ['groups', 'Groups'], ['auth', 'Authentication methods'], ['signins', 'Sign-in logs'], ['roles', 'Assigned roles']];
  const actions = h('div', { class: 'row' },
    button('Revoke sessions', () => act((x) => revokeSessions(x, e.upn), `Sessions revoked for ${e.upn}`), 'btn primary'),
    e.source === 'cloud'
      ? button(e.accountEnabled ? 'Block sign-in' : 'Allow sign-in', () => act((x) => setCloudAccountEnabled(x, e.upn, !e.accountEnabled), 'Updated'))
      : button('Block sign-in', () => act((x) => setCloudAccountEnabled(x, e.upn, false))),
    e.riskLevel !== 'none' ? button('Dismiss user risk', () => act((x) => setRisk(x, e.upn, 'none'), 'Risk dismissed')) : null,
    button('Confirm user compromised', () => act((x) => setRisk(x, e.upn, 'high'), 'Marked compromised'), 'btn ghost'));
  let body: HTMLElement;
  if (userTab === 'overview') {
    body = kv([
      ['Object ID', e.id], ['User principal name', e.upn], ['Account enabled', e.accountEnabled ? 'Yes' : 'No'], ['Source', e.source === 'synced' ? `Windows Server AD (${e.onPremSam})` : 'Cloud only'],
      ['Job title', e.jobTitle], ['Department', e.department], ['Licenses', e.licenses.join(', ') || 'None'], ['Risk level', e.riskLevel],
      ['Active sessions', `${validSessions(e)} (sessions valid from ${fmt(e.sessionsValidFrom)})`],
    ]);
  } else if (userTab === 'groups') {
    body = e.groups.length ? table(['Group', 'Source'], e.groups.map((g) => [g, w.ad.groups.some((a) => a.name === g) ? 'Windows Server AD' : 'Cloud'])) : empty('No group memberships.');
  } else if (userTab === 'auth') {
    body = h('div', null,
      h('div', { class: 'row' }, button('Require re-register multifactor authentication', () => act((x) => requireMfaReregistration(x, e.upn), 'Methods removed. The user registers MFA at next sign-in.'), 'btn primary')),
      e.mfaMethods.length ? table(['Method', 'Detail', 'Added', ''], e.mfaMethods.map((m, i) => [m.type, m.detail, fmt(m.added), button('Delete', () => act((x) => deleteMfaMethod(x, e.upn, i), 'Method deleted'), 'btn slim')])) : empty(`No methods registered${e.mfaResetAt ? ` (reset ${fmt(e.mfaResetAt)})` : ''}.`));
  } else if (userTab === 'signins') {
    const s = w.entra.signIns.filter((x) => x.upn.toLowerCase() === e.upn.toLowerCase()).sort((a, b) => b.time.localeCompare(a.time));
    body = s.length ? signInTable(s) : empty('No sign-ins in the last 30 days.');
  } else {
    body = e.roles.length ? table(['Role', 'Assignment', 'Duration', 'Justification'], e.roles.map((r) => [r.role, badge(r.assignment === 'active' ? 'Active' : 'Eligible', r.assignment === 'active' ? 'warn' : 'ok'), r.permanent ? 'Permanent' : `Until ${fmt(r.expires)}`, r.justification])) : empty('No directory roles. Manage roles in Privileged Identity Management.');
  }
  return h('div', null, link('← All users', () => ctx.go('/users')), h('h2', null, e.displayName), actions,
    h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) => h('button', { class: `tab ${userTab === id ? 'on' : ''}`, role: 'tab', type: 'button', 'aria-selected': String(userTab === id), onClick: () => { userTab = id; ctx.go(ctx.path); } }, label))),
    body);
}

function signInTable(list: typeof store.world.entra.signIns): HTMLElement {
  return table(['Date', 'User', 'Application', 'IP address', 'Location', 'Status', 'MFA', 'Risk'], list.slice(0, 200).map((s) => [
    fmt(s.time), s.upn, s.app, s.ip, s.location, s.result === 'Success' ? badge('Success', 'ok') : badge(`${s.result}: ${s.failureReason}`, s.result === 'Failure' ? 'bad' : 'warn'), s.mfa, s.risk === 'none' ? '—' : badge(s.risk, s.risk === 'high' ? 'bad' : 'warn'),
  ]));
}

function caEditor(ctx: SiteCtx, p: CaPolicy | null): HTMLElement {
  const name = h('input', { class: 'input', value: p?.name ?? '', placeholder: 'CA010 - Require MFA for all users', 'aria-label': 'Policy name' });
  const users = h('select', { class: 'input', 'aria-label': 'Include users' }, ['All users', 'Directory roles'].map((x) => h('option', { value: x, selected: p?.includeUsers === x }, x)));
  const apps = h('select', { class: 'input', 'aria-label': 'Target resources' }, ['All cloud apps', 'Office 365', 'CareChart EHR'].map((x) => h('option', { value: x, selected: p?.apps === x }, x)));
  const cond = h('select', { class: 'input', 'aria-label': 'Condition' }, [['none', 'None'], ['legacy-auth', 'Client apps: legacy authentication'], ['sign-in-risk-high', 'Sign-in risk: high'], ['outside-trusted-locations', 'Outside trusted locations']].map(([v, l]) => h('option', { value: v, selected: p?.condition === v }, l)));
  const grant = h('select', { class: 'input', 'aria-label': 'Grant' }, [['require-mfa', 'Grant access: require multifactor authentication'], ['require-compliant-device', 'Grant access: require compliant device'], ['block', 'Block access']].map(([v, l]) => h('option', { value: v, selected: p?.grant === v }, l)));
  const state = h('select', { class: 'input', 'aria-label': 'Enable policy' }, [['report-only', 'Report-only'], ['on', 'On'], ['off', 'Off']].map(([v, l]) => h('option', { value: v, selected: (p?.state ?? 'report-only') === v }, l)));
  const exclusions = new Set(p?.excludeUsers ?? []);
  const candidates: string[] = [...BREAK_GLASS];
  const excl = h('div', { class: 'checks' }, candidates.map((u) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: exclusions.has(u), onChange: (ev: Event) => { if ((ev.target as HTMLInputElement).checked) exclusions.add(u); else exclusions.delete(u); } }), u)));
  const other = h('input', { class: 'input', placeholder: 'Other users to exclude (UPNs, comma separated)', value: [...exclusions].filter((x) => !candidates.includes(x)).join(', '), 'aria-label': 'Other exclusions' });
  return h('div', { class: 'stack narrow' }, link('← Policies', () => ctx.go('/ca')), h('h2', null, p ? `Edit ${p.name}` : 'New Conditional Access policy'),
    field('Name', name), field('Users: include', users), h('fieldset', { class: 'fieldset' }, h('legend', null, 'Users: exclude'), excl, other),
    field('Target resources', apps), field('Conditions', cond), field('Grant', grant), field('Enable policy', state),
    h('div', { class: 'row' },
      button(p ? 'Save' : 'Create', () => {
        const extra = other.value.split(',').map((x) => x.trim()).filter(Boolean);
        if (act((x) => saveCaPolicy(x, { id: p?.id, name: name.value, state: state.value as CaPolicy['state'], includeUsers: users.value, excludeUsers: [...new Set([...exclusions].filter((u) => candidates.includes(u)).concat(extra))], apps: apps.value, condition: cond.value as CaPolicy['condition'], grant: grant.value as CaPolicy['grant'] }), p ? 'Policy saved' : 'Policy created')) ctx.go('/ca');
      }, 'btn primary'),
      p ? button('Delete', () => { if (act((x) => deleteCaPolicy(x, p.id), 'Policy deleted')) ctx.go('/ca'); }, 'btn danger') : null));
}

function pim(): HTMLElement {
  const w = store.world;
  const rows = w.entra.users.filter((e) => !e.deleted).flatMap((e) => e.roles.map((r) => ({ e, r })));
  const who = h('input', { class: 'input', placeholder: 'user@meridianhealth.test', 'aria-label': 'User' });
  const role = h('select', { class: 'input', 'aria-label': 'Role' }, ENTRA_ROLES.map((r) => h('option', { value: r }, r)));
  const type = h('select', { class: 'input', 'aria-label': 'Assignment type' }, h('option', { value: 'eligible' }, 'Eligible'), h('option', { value: 'active' }, 'Active'));
  const why = h('input', { class: 'input', placeholder: 'Justification (ticket number)', 'aria-label': 'Justification' });
  return h('div', null, h('h2', null, 'Privileged Identity Management: role assignments'),
    table(['User', 'Role', 'Assignment', 'Duration', 'Justification', ''], rows.map(({ e, r }) => [
      e.upn, r.role, badge(r.assignment === 'active' ? 'Active' : 'Eligible', r.assignment === 'active' ? 'warn' : 'ok'), r.permanent ? 'Permanent' : `Until ${fmt(r.expires)}`, r.justification,
      h('span', { class: 'row' },
        r.assignment === 'active' ? button('Make eligible', () => act((x) => assignRole(x, e.upn, r.role, 'eligible', { permanent: true, justification: 'Converted to eligible (SEC-STD-007)' }), 'Now eligible'), 'btn slim') : null,
        button('Remove', () => act((x) => removeRole(x, e.upn, r.role), 'Assignment removed'), 'btn slim ghost')),
    ])),
    h('h3', null, 'Add assignment'),
    h('div', { class: 'row wrap' }, who, role, type, why, button('Assign', () => act((x) => assignRole(x, who.value, role.value, type.value as 'active', { permanent: type.value === 'eligible', hours: 8, justification: why.value }), 'Assignment added'), 'btn primary')),
    h('p', { class: 'muted' }, 'Active assignments made here last 8 hours. Eligible assignments grant nothing until activated.'));
}

export const entra: Site = {
  host: 'entra.meridianhealth.test',
  name: 'Microsoft Entra admin center',
  short: 'Entra',
  color: '#1d4fae',
  render(ctx) {
    const w = store.world;
    const nav: [string, string][] = [['Overview', '/'], ['Users', '/users'], ['Groups', '/groups'], ['Enterprise applications', '/apps'], ['Conditional Access', '/ca'], ['Privileged Identity Management', '/pim'], ['Sign-in logs', '/signins'], ['Audit logs', '/audit'], ['Entra Connect', '/connect']];
    let content: HTMLElement;
    const p = ctx.path;
    const um = /^\/users\/(.+)$/.exec(p);
    const cm = /^\/ca\/(.+)$/.exec(p);
    const am = /^\/apps\/(.+)$/.exec(p);
    if (um) {
      const e = w.entra.users.find((x) => x.upn === decodeURIComponent(um[1]!) && !x.deleted);
      content = e ? userDetail(ctx, e) : empty('User not found. If it exists in AD, check the sync scope and run a sync.');
    } else if (p === '/users') content = users(ctx);
    else if (p === '/groups') {
      const groups = [...new Set(w.entra.users.flatMap((e) => e.groups))].sort();
      content = h('div', null, h('h2', null, 'Groups'), table(['Group', 'Members', 'Source'], groups.map((g) => [g, String(w.entra.users.filter((e) => !e.deleted && e.groups.includes(g)).length), w.ad.groups.some((a) => a.name === g) ? 'Windows Server AD' : 'Cloud'])));
    } else if (am) {
      const app = w.entra.apps.find((a) => a.id === am[1]);
      content = !app ? empty('App not found.') : h('div', null, link('← Enterprise applications', () => ctx.go('/apps')), h('h2', null, app.name),
        kv([['Single sign-on', app.sso], ['Assignment required', app.assignmentRequired ? 'Yes' : 'No'], ['Provisioning', app.provisioning === 'SCIM' ? 'Automatic (SCIM), runs after each sync' : 'None'], ['Assigned groups', app.assignedGroups.join(', ') || '—'], ['Direct user assignments', app.assignedUsers.join(', ') || '—']]),
        app.saasId ? h('p', { class: 'muted' }, 'Provisioning logs are in SaaS apps > ', link(app.name, () => ctx.open(`https://apps.meridianhealth.test/${app.saasId}`))) : null);
    } else if (p === '/apps') {
      content = h('div', null, h('h2', null, 'Enterprise applications'), table(['Name', 'SSO', 'Assignment', 'Provisioning'], w.entra.apps.map((a) => [a.name, a.sso, a.assignedGroups.join(', ') || 'All users', a.provisioning]), (i: number) => ctx.go(`/apps/${w.entra.apps[i]!.id}`)),
        h('p', { class: 'muted' }, 'Okta-federated apps (ImageVault, PayrollPro, ExpenseFlow) are managed in the Okta admin console.'));
    } else if (cm) content = caEditor(ctx, cm[1] === 'new' ? null : w.entra.caPolicies.find((c) => c.id === cm[1]) ?? null);
    else if (p === '/ca') {
      content = h('div', null, h('div', { class: 'row-between' }, h('h2', null, 'Conditional Access policies'), button('New policy', () => ctx.go('/ca/new'), 'btn primary')),
        table(['Policy', 'State', 'Users', 'Excluded', 'Grant'], w.entra.caPolicies.map((c) => [c.name, badge(c.state, c.state === 'on' ? 'ok' : c.state === 'off' ? '' : 'warn'), c.includeUsers, c.excludeUsers.join(', ') || badge('none', 'bad'), c.grant]), (i) => ctx.go(`/ca/${w.entra.caPolicies[i]!.id}`)));
    } else if (p === '/pim') content = pim();
    else if (p === '/signins') {
      const q = h('input', { class: 'input', type: 'search', placeholder: 'Filter by user, IP address, location or status', value: signInQuery, 'aria-label': 'Filter sign-ins' });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { signInQuery = q.value; ctx.go('/signins'); } });
      const list = w.entra.signIns.filter((s) => `${s.upn} ${s.ip} ${s.location} ${s.result} ${s.failureReason} ${s.mfa}`.toLowerCase().includes(signInQuery.toLowerCase())).sort((a, b) => b.time.localeCompare(a.time));
      content = h('div', null, h('h2', null, 'Sign-in logs'), h('div', { class: 'row' }, q, button('Apply', () => { signInQuery = q.value; ctx.go('/signins'); })), signInTable(list));
    } else if (p === '/audit') {
      const ev = eventsFor(w, 'Entra ID').slice(0, 200);
      content = h('div', null, h('h2', null, 'Audit logs'), table(['Date', 'Activity', 'Target', 'Initiated by', 'Detail'], ev.map((e) => [fmt(e.time), e.action, e.target, e.actor, e.detail])));
    } else if (p === '/connect') {
      content = h('div', null, h('h2', null, 'Microsoft Entra Connect'),
        kv([['Sync server', 'MHS-SYNC01'], ['Last sync', fmt(w.entra.lastSync)], ['Schedule', 'Delta every 30 minutes'], ['Sync scope', w.entra.syncScope.join(', ')], ['Export errors', String(w.entra.syncErrors.length)]]),
        w.entra.syncErrors.length ? table(['Object', 'UPN', 'Error', 'Detail'], w.entra.syncErrors.map((e) => [e.sam, e.upn, badge(e.error, 'bad'), e.detail])) : h('p', null, badge('Healthy', 'ok'), ' No export errors.'),
        h('p', { class: 'muted' }, 'To sync now, run on the sync server: ', h('code', null, 'Start-ADSyncSyncCycle -PolicyType Delta'), ' (or Invoke-Command -ComputerName MHS-SYNC01 from your workstation).'));
    } else {
      const active = w.entra.users.filter((e) => !e.deleted);
      content = h('div', null, h('h2', null, `${w.company.name}`),
        kv([['Primary domain', w.entra.primaryDomain], ['Users', String(active.length)], ['Synced from AD', String(active.filter((e) => e.source === 'synced').length)], ['Risky users', String(active.filter((e) => e.riskLevel !== 'none').length)], ['Last Entra Connect sync', fmt(w.entra.lastSync)], ['Sync errors', String(w.entra.syncErrors.length)]]));
    }
    return shell(this, nav, ctx, content, `Signed in as ${w.player.sam}@meridianhealth.test`);
  },
};
