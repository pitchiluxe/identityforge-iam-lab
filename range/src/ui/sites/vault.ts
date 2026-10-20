/**
 * Privileged Access Vault (simulated; modelled on CyberArk's Password Vault
 * Web Access): accounts and safes, access requests with dual control,
 * recorded sessions, password changes, usages, discovered accounts, audit.
 */
import type { PamAccount } from '../../core/types.ts';
import { fmt } from '../../core/time.ts';
import { addUsage, connect, endSession, ensurePam, getSafe, onboard, requestAccess, rolesIn, rotate, setManaged, showPassword, syncUsages, usageHealth } from '../../world/pam.ts';
import { badge, button, field, h, table, toast } from '../dom.ts';
import { act, store } from '../store.ts';
import { type Site, type SiteCtx, empty, kv, link, shell } from './common.ts';

let revealed: { id: string; value: string } | null = null;

const me = (): string => store.world.player.adminSam;
const nextDue = (a: PamAccount): string => new Date(Date.parse(a.lastRotated) + a.rotationDays * 86_400_000).toISOString();

function health(a: PamAccount): HTMLElement {
  const u = usageHealth(store.world, a.id);
  if (!u.length) return h('span', { class: 'muted' }, '—');
  const bad = u.filter((x) => !x.ok).length;
  return bad ? badge(`${bad} usage(s) failing`, 'bad') : badge('In sync', 'ok');
}

function accounts(ctx: SiteCtx): HTMLElement {
  const pam = ensurePam(store.world);
  return h('div', null, h('h2', null, 'Accounts'),
    table(['Username', 'Address', 'Safe', 'Platform', 'Management', 'Last changed', 'Usages'], pam.accounts.map((a) => [
      a.userName, a.address, a.safe, a.platform, a.managed ? badge('Automatic', 'ok') : badge('Manual', 'warn'), fmt(a.lastRotated), health(a),
    ]), (i) => { revealed = null; ctx.go(`/accounts/${pam.accounts[i]!.id}`); }));
}

function accountDetail(ctx: SiteCtx, id: string): HTMLElement {
  const w = store.world;
  const pam = ensurePam(w);
  const a = pam.accounts.find((x) => x.id === id);
  if (!a) return empty('Account not found.');
  const safe = getSafe(w, a.safe);
  const roles = rolesIn(w, safe, me());
  const open = pam.sessions.find((s) => s.accountId === a.id && !s.end && s.user === me());
  const redraw = (): void => ctx.go(`/accounts/${a.id}`);
  const reason = h('input', { class: 'input', placeholder: 'Reason', 'aria-label': 'Reason' });
  const ticket = h('input', { class: 'input', placeholder: 'Ticket, e.g. CHG0010412', 'aria-label': 'Ticket number', style: 'width:180px' });
  const target = h('input', { class: 'input', value: a.platform === 'Entra ID Cloud Account' ? 'Entra admin center' : 'MHS-DC01', 'aria-label': 'Target system', style: 'width:180px' });
  const uType = h('select', { class: 'input', 'aria-label': 'Usage type' }, ...['Windows Service', 'Scheduled Task', 'IIS Application Pool'].map((t) => h('option', { value: t }, t)));
  const uHost = h('input', { class: 'input', placeholder: 'Server, e.g. MHS-SQL01', 'aria-label': 'Usage server', style: 'width:170px' });
  const uName = h('input', { class: 'input', placeholder: 'Service or task name', 'aria-label': 'Usage name', style: 'width:200px' });
  const reqs = pam.requests.filter((r) => r.accountId === a.id).slice(0, 5);
  return h('div', null, link('← Accounts', () => ctx.go('/accounts')),
    h('div', { class: 'row-between' }, h('h2', null, a.userName), h('span', null, a.managed ? badge('Automatic management', 'ok') : badge('Manual management', 'warn'))),
    kv([['Address', a.address], ['Safe', `${a.safe}${safe.dualControl ? ' (dual control)' : ''}${safe.requireTicket ? ', ticket required' : ''}`], ['Platform', a.platform], ['Last changed', fmt(a.lastRotated)], ['Next change due', fmt(nextDue(a))], ['Change after use', safe.rotateOnCheckin ? 'Yes, at session end' : 'No'], ['Your permissions on this safe', roles.join(', ') || 'None']]),
    h('h3', null, 'Use this account'),
    open
      ? h('div', { class: 'vault-session' }, h('div', null, badge('Recording', 'bad'), ` Session ${open.id}: connected to ${open.target} as ${a.userName} since ${fmt(open.start)}${open.ticket ? ` for ${open.ticket}` : ''}.`),
          h('pre', { class: 'vault-term' }, `PSM> Connected to ${open.target} through the session manager. Credentials were injected; you never see them.\nPSM> This session is isolated and recorded.\n${a.userName}@${open.target}> _`),
          button('End session (check in)', () => { if (act((x) => { endSession(x, open.id); }, safe.rotateOnCheckin ? 'Session ended; the CPM changed the password' : 'Session ended')) redraw(); }, 'btn primary'))
      : h('div', null,
          (safe.requireTicket || safe.dualControl) ? h('div', { class: 'row wrap' }, reason, ticket, button('Request access', () => { let st = ''; if (act((x) => { st = requestAccess(x, a.id, reason.value, ticket.value).decision; })) { toast(st, st.includes('rejected') ? 'err' : 'ok'); redraw(); } }, 'btn')) : null,
          h('div', { class: 'row wrap', style: 'margin-top:8px' }, target,
            button('Connect', () => { if (act((x) => { connect(x, a.id, target.value); }, 'Connected through a recorded session')) redraw(); }, 'btn primary'),
            button('Show password', () => { let v = ''; if (act((x) => { v = showPassword(x, a.id, reason.value || 'break-fix'); })) { revealed = { id: a.id, value: v }; redraw(); } }, 'btn'))),
    revealed?.id === a.id ? h('div', { class: 'vault-secret' }, h('strong', null, 'Password: '), h('code', null, revealed.value), h('span', { class: 'muted' }, ' This retrieval is recorded in the vault audit.')) : null,
    reqs.length ? h('div', null, h('h3', null, 'Recent requests'), table(['Request', 'State', 'Ticket', 'Approver', 'Decision', 'Time'], reqs.map((r) => [r.id, badge(r.state, r.state === 'Approved' ? 'ok' : r.state === 'Rejected' ? 'bad' : 'warn'), r.ticket || '—', r.approver ?? '—', r.decision, fmt(r.time)]))) : null,
    h('h3', null, 'Password management (CPM)'),
    h('div', { class: 'row wrap' },
      button('Change password now', () => act((x) => { rotate(x, a.id); }, 'Password changed; registered usages updated'), 'btn'),
      button('Sync usages', () => act((x) => { syncUsages(x, a.id); }, 'Current password pushed to every registered usage'), 'btn'),
      button(a.managed ? 'Disable automatic management' : 'Enable automatic management', () => act((x) => { setManaged(x, a.id, !a.managed); }, 'Updated'), 'btn ghost')),
    h('h3', null, 'Usages (where this password is stored)'),
    a.dependencies.length ? table(['Type', 'Server', 'Name', 'Status'], a.dependencies.map((d) => [d.type, d.host, d.name, d.syncedVersion === a.passwordVersion ? badge('Current password', 'ok') : badge('Old password: will fail', 'bad')])) : empty('No usages registered. Every place this account runs must be registered before its password is changed.'),
    h('div', { class: 'row wrap' }, uType, uHost, uName, button('Add usage', () => act((x) => { addUsage(x, a.id, { type: uType.value as 'Windows Service', host: uHost.value, name: uName.value }); }, 'Usage registered'), 'btn')));
}

function discovered(): HTMLElement {
  const w = store.world;
  const pam = ensurePam(w);
  return h('div', null, h('h2', null, 'Discovered accounts (pending)'),
    h('p', { class: 'muted' }, 'Privileged accounts found by Accounts Discovery that no safe holds yet.'),
    pam.discovered.length ? h('div', null, ...pam.discovered.map((d) => {
      const safe = h('select', { class: 'input', 'aria-label': 'Safe' }, ...pam.safes.map((s) => h('option', { value: s.name, selected: s.name === 'SVC-Windows' }, s.name)));
      const days = h('input', { class: 'input', type: 'number', value: '30', min: '1', max: '365', 'aria-label': 'Change every (days)', style: 'width:90px' });
      const found = pam.usages[d.userName] ?? [];
      return h('div', { class: 'vault-card' }, h('h3', null, d.userName), h('p', null, d.reason),
        found.length ? h('p', null, h('strong', null, 'Running as this account: '), found.map((u) => `${u.type} ${u.name} on ${u.host}`).join('; ')) : null,
        h('div', { class: 'row wrap' }, field('Safe', safe), field('Change password every (days)', days),
          button('Onboard', () => act((x) => { onboard(x, d.userName, safe.value, Number(days.value)); }, `${d.userName} onboarded; register its usages before the first change`), 'btn primary')));
    })) : empty('Nothing pending.'));
}

export const vault: Site = {
  host: 'vault.meridianhealth.test',
  name: 'Privileged Access Vault',
  short: 'Vault',
  color: '#1f2a44',
  render(ctx) {
    const w = store.world;
    const pam = ensurePam(w);
    const nav: [string, string][] = [['Accounts', '/accounts'], ['Safes', '/safes'], ['Requests', '/requests'], ['Sessions', '/sessions'], ['Discovered accounts', '/discovered'], ['Audit', '/audit']];
    const p = ctx.path;
    const am = /^\/accounts\/(.+)$/.exec(p);
    let content: HTMLElement;
    if (am) content = accountDetail(ctx, am[1]!);
    else if (p === '/safes') {
      content = h('div', null, h('h2', null, 'Safes'), ...pam.safes.map((s) => h('div', { class: 'vault-card' },
        h('div', { class: 'row-between' }, h('h3', null, s.name), h('span', null, s.dualControl ? badge('Dual control', 'warn') : null, s.requireTicket ? badge('Ticket required', 'info') : null, s.rotateOnCheckin ? badge('Change after use', 'ok') : null)),
        h('p', { class: 'muted' }, s.description),
        table(['Member', 'Permission'], s.members.map((m) => [m.member, m.role])),
        h('p', null, 'Your permissions: ', rolesIn(w, s, me()).join(', ') || 'none'))));
    } else if (p === '/requests') {
      content = h('div', null, h('h2', null, 'Access requests'), pam.requests.length ? table(['Request', 'Account', 'Requester', 'Ticket', 'State', 'Decision', 'Time'], pam.requests.map((r) => [r.id, r.accountId, r.requester, r.ticket || '—', badge(r.state, r.state === 'Approved' ? 'ok' : 'bad'), r.decision, fmt(r.time)])) : empty('No requests.'));
    } else if (p === '/sessions') {
      content = h('div', null, h('h2', null, 'Privileged sessions (PSM)'), pam.sessions.length ? table(['Session', 'Account', 'User', 'Target', 'Ticket', 'Started', 'Ended', ''], pam.sessions.map((s) => [s.id, s.accountId, s.user, s.target, s.ticket || '—', fmt(s.start), s.end ? fmt(s.end) : badge('Active', 'warn'),
        s.end ? h('span', { class: 'muted' }, 'Recording available') : button('End', () => act((x) => { endSession(x, s.id); }, 'Session ended'), 'btn slim')])) : empty('No sessions yet.'));
    } else if (p === '/discovered') content = discovered();
    else if (p === '/audit') {
      content = h('div', null, h('h2', null, 'Vault audit'), pam.events.length ? table(['Time', 'User', 'Action', 'Account', 'Detail'], pam.events.slice(0, 300).map((e) => [fmt(e.time), e.user, e.action === 'Show password' ? badge(e.action, 'warn') : e.action, e.accountId, e.detail])) : empty('No activity yet.'));
    } else content = accounts(ctx);
    return shell(this, nav, ctx, content, `Modelled on CyberArk PAM. Signed in as ${me()}`);
  },
};
