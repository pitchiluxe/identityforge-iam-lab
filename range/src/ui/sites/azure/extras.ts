/**
 * ui/sites/azure/extras.ts — Identity Protection, Administrative units and
 * External collaboration settings blades.
 */
import { fmt } from '../../../core/time.ts';
import { badge, h, table } from '../../dom.ts';
import { addAuMember, adminUnits, assignScopedRole, createAdminUnit, externalSettings, setExternalSettings, setUserRisk, type ExternalSettings } from '../../../world/identityExtras.ts';
import { blade, form, info, input, select, type Portal } from './frame.ts';

export function idProtectionPage(p: Portal): HTMLElement {
  const w = p.w;
  const risky = w.entra.users.filter((e) => !e.deleted && e.riskLevel !== 'none');
  const signIns = w.entra.signIns.filter((s) => s.risk !== 'none').sort((a, b) => b.time.localeCompare(a.time));
  return blade('Identity Protection', 'Risky users and risky sign-ins', [],
    h('section', { class: 'az-card' }, h('h3', null, `Risky users (${risky.length})`),
      risky.length ? table(['User', 'Risk level', 'Account enabled', ''], risky.map((e) => [e.upn, badge(e.riskLevel, e.riskLevel === 'high' ? 'bad' : 'warn'), e.accountEnabled ? 'Yes' : 'No',
        h('span', { class: 'row' },
          h('button', { class: 'btn slim', type: 'button', onClick: () => p.run((x, a) => setUserRisk(x, a, e.upn, 'dismiss'), 'User risk dismissed') }, 'Dismiss user risk'),
          h('button', { class: 'btn slim ghost', type: 'button', onClick: () => p.run((x, a) => setUserRisk(x, a, e.upn, 'compromised'), 'User confirmed compromised') }, 'Confirm user compromised'))]))
        : h('p', { class: 'empty' }, 'No risky users.')),
    h('section', { class: 'az-card' }, h('h3', null, 'Risky sign-ins'),
      signIns.length ? table(['Date', 'User', 'IP address', 'Location', 'Risk'], signIns.map((s) => [fmt(s.time), s.upn, s.ip, s.location, badge(s.risk, s.risk === 'high' ? 'bad' : 'warn')])) : h('p', { class: 'empty' }, 'No risky sign-ins.')),
    info('Investigate before dismissing: check the sign-in, revoke sessions and reset credentials if it was not the user. Dismiss and confirm need a Security Operator or Security Administrator.'));
}

export function adminUnitsPage(p: Portal): HTMLElement {
  const name = input({ placeholder: 'Name' });
  const desc = input({ placeholder: 'Description' });
  return blade('Administrative units', null, [],
    h('section', { class: 'az-card' }, h('h3', null, 'Add administrative unit'), form(['Name', name], ['Description', desc]),
      h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => p.run((x, a) => { createAdminUnit(x, a, name.value, desc.value); }, 'Administrative unit created') }, 'Create'))),
    ...adminUnits(p.w).map((au) => {
      const member = input({ placeholder: 'user@domain', list: 'az-au-users', 'aria-label': `Add member to ${au.name}` });
      const who = input({ placeholder: 'user@domain', list: 'az-au-users', 'aria-label': `Role holder for ${au.name}` });
      const role = select([['Helpdesk Administrator', 'Helpdesk Administrator'], ['User Administrator', 'User Administrator'], ['Authentication Administrator', 'Authentication Administrator'], ['Groups Administrator', 'Groups Administrator']]);
      return h('section', { class: 'az-card' }, h('h3', null, au.name), h('p', { class: 'muted' }, au.description || '—'),
        h('datalist', { id: 'az-au-users' }, p.w.entra.users.filter((e) => !e.deleted).map((e) => h('option', { value: e.upn }))),
        table(['Members'], au.members.map((m) => [m])),
        h('div', { class: 'row' }, member, h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => addAuMember(x, a, au.id, member.value.trim()), 'Member added') }, '+ Add member')),
        table(['Role', 'Assigned to'], au.scopedRoles.map((r) => [r.role, r.upn])),
        h('div', { class: 'row' }, who, role, h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => assignScopedRole(x, a, au.id, who.value.trim(), role.value), 'Scoped role assigned') }, '+ Assign scoped role')));
    }),
    info('Administrative units let a helpdesk manage only part of the directory. Creating them and assigning scoped roles needs a Privileged Role Administrator.'));
}

export function externalPage(p: Portal): HTMLElement {
  const s = externalSettings(p.w);
  const restr = select([['everyone', 'Anyone in the organization, including guests'], ['members', 'Member users and admins'], ['admins', 'Only admins and Guest Inviters'], ['none', 'No one']], s.guestInviteRestrictions);
  const allow = input({ value: s.allowDomains.join(', '), placeholder: 'Allowed domains (empty = any not denied)' });
  const deny = input({ value: s.denyDomains.join(', '), placeholder: 'Denied domains' });
  const list = (v: string): string[] => v.split(',').map((x) => x.trim()).filter(Boolean);
  return blade('External collaboration settings', 'External Identities', [],
    form(['Guest invite restrictions', restr], ['Allow invitations only to', allow], ['Deny invitations to', deny]),
    h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => p.run((x, a) => setExternalSettings(x, a, { guestInviteRestrictions: restr.value as ExternalSettings['guestInviteRestrictions'], allowDomains: list(allow.value), denyDomains: list(deny.value) }), 'Settings saved') }, 'Save')),
    h('section', { class: 'az-card' }, h('h3', null, 'Guests'), table(['Display name', 'User principal name'], p.w.entra.users.filter((e) => e.userType === 'Guest' && !e.deleted).map((e) => [e.displayName, e.upn]))),
    info('Changing collaboration settings needs a Global Administrator in this lab. Review guests regularly: remove anyone whose collaboration has ended.'));
}
