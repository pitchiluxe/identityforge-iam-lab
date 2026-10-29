/**
 * ui/sites/azure/entra.ts — Microsoft Entra ID inside the lab Azure portal:
 * users (cloud, guest, synced), groups, devices, roles, licences, logs and
 * Entra Connect status. Writes run as the signed-in account through world/
 * functions, which enforce Entra's own permission and sync rules.
 */
import type { EntraUser } from '../../../core/types.ts';
import { fmt, nowIso } from '../../../core/time.ts';
import { badge, h, table } from '../../dom.ts';
import { eventsFor } from '../../../world/audit.ts';
import { ENTRA_ROLES, objectIdFor } from '../../../world/cloud.ts';
import { dcHostOf } from '../../../world/directory.ts';
import {
  assignDirectoryRole, assignLicense, cloudGroups, createCloudGroup, createCloudUser, deleteCloudUser, inviteGuest, licensesInUse, resetCloudPassword,
  restoreCloudUser, revokeSessionsAs, rolesOf, setCloudGroupMember, syncedGroupNames, tenantLicenses, updateCloudUser,
} from '../../../world/entraAdmin.ts';
import { blade, cmd, form, info, input, select, type Portal } from './frame.ts';
import { appsPage, enterprisePage } from './apps.ts';
import { activateRole, deactivateRole, pimSettings } from '../../../world/pim.ts';
import { AUTH_METHODS, deleteMethodAs, issueTap, methodPolicy, requireReregisterAs, setMethodPolicy } from '../../../world/authMethods.ts';
import { caPage } from './ca.ts';
import { adminUnitsPage, externalPage, idProtectionPage } from './extras.ts';

let lastTap: { upn: string; code: string; expires: string } | null = null;
import type { EntraPage, UserTab } from './routes.ts';

let userFilter = '';
let groupFilter = '';
let resetFor: string | null = null;
let editFor: string | null = null;

const LOCATIONS: [string, string][] = [['', '(none)'], ['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['DE', 'Germany'], ['IN', 'India'], ['AU', 'Australia']];
const active = (p: Portal): EntraUser[] => p.w.entra.users.filter((e) => !e.deleted);
const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');

function userLink(p: Portal, e: EntraUser): HTMLElement {
  return h('a', { href: '#', onClick: (ev: Event) => { ev.preventDefault(); p.go({ k: 'entraUser', upn: e.upn, tab: 'overview' }); } }, e.displayName);
}

function allGroups(p: Portal): { name: string; source: 'Windows Server AD' | 'Cloud'; type: string }[] {
  return [
    ...syncedGroupNames(p.w).map((name) => ({ name, source: 'Windows Server AD' as const, type: 'Security' })),
    ...cloudGroups(p.w).map((g) => ({ name: g.name, source: 'Cloud' as const, type: g.type })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

export function entraPage(p: Portal, page: EntraPage): HTMLElement {
  const w = p.w;
  switch (page) {
    case 'apps': return appsPage(p);
    case 'enterprise': return enterprisePage(p);
    case 'pim': return pimPage(p);
    case 'ca': return caPage(p);
    case 'idprotection': return idProtectionPage(p);
    case 'adminunits': return adminUnitsPage(p);
    case 'external': return externalPage(p);
    case 'authmethods': {
      const pol = methodPolicy(w);
      return blade('Authentication methods', 'Policies', [],
        table(['Method', 'Enabled', ''], AUTH_METHODS.map((m) => [m, pol[m] ? badge('Yes', 'ok') : 'No',
          h('button', { class: 'btn slim', type: 'button', onClick: () => p.run((x, a) => setMethodPolicy(x, a, m, !pol[m]), `${m} ${pol[m] ? 'disabled' : 'enabled'}`) }, pol[m] ? 'Disable' : 'Enable')])),
        info("Changing the policy needs an Authentication Policy Administrator. Resetting a user's methods needs an Authentication Administrator (Privileged Authentication Administrator for admins)."));
    }
    case 'overview': {
      const users = active(p);
      return blade(w.company.name, 'Microsoft Entra ID | Overview', [],
        h('div', { class: 'az-cards' },
          h('section', { class: 'az-card' }, h('h3', null, 'Basic information'), h('dl', { class: 'kv' },
            ...[['Name', w.company.name], ['Tenant ID', objectIdFor(w.seed, 'tenant')], ['Primary domain', w.entra.primaryDomain], ['On-premises domain', w.ad.domain],
              ['Users', String(users.length)], ['Groups', String(allGroups(p).length)], ['Devices', String(w.entra.devices?.length ?? 0)],
              ['Licence', tenantLicenses(w).map((l) => l.sku).join(', ')]].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]))),
          h('section', { class: 'az-card' }, h('h3', null, 'Microsoft Entra Connect'), h('dl', { class: 'kv' },
            h('dt', null, 'Sync status'), h('dd', null, w.ad.users.length > 1 ? 'Enabled' : 'Not configured'),
            h('dt', null, 'Last sync'), h('dd', null, fmt(w.entra.lastSync)),
            h('dt', null, 'Sync errors'), h('dd', null, String(w.entra.syncErrors.length))))));
    }
    case 'users': {
      const q = input({ type: 'search', placeholder: 'Search by name or user principal name', value: userFilter, 'aria-label': 'Search users' });
      q.addEventListener('input', () => { userFilter = q.value; });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') p.go({ k: 'entra', page: 'users' }); });
      const list = active(p).filter((e) => `${e.displayName} ${e.upn}`.toLowerCase().includes(userFilter.toLowerCase())).sort((a, b) => a.displayName.localeCompare(b.displayName));
      return blade('Users', `${list.length} users found`, [
        cmd('New user', '+', () => p.go({ k: 'entra', page: 'users-new' })),
        cmd('Invite external user', '✉', () => p.go({ k: 'entra', page: 'users-invite' })),
        cmd('Deleted users', '\u{1F5D1}', () => p.go({ k: 'entra', page: 'users-deleted' })),
        cmd('Refresh', '↻', () => p.go({ k: 'entra', page: 'users' })),
      ], q, table(['Display name', 'User principal name', 'User type', 'On-premises sync enabled', 'Account enabled'],
        list.map((e) => [userLink(p, e), e.upn, e.userType ?? 'Member', yesNo(e.source === 'synced'), e.accountEnabled ? 'Yes' : badge('No', 'bad')])));
    }
    case 'users-new': {
      const name = input({ placeholder: 'Display name' });
      const nick = input({ placeholder: 'user name' });
      const pw = input({ value: generatedPassword(w.seed + w.entra.users.length) });
      const force = h('input', { type: 'checkbox', checked: true });
      const title = input({ placeholder: 'Job title' });
      const dept = input({ placeholder: 'Department' });
      const loc = select(LOCATIONS, 'US');
      return blade('Create new user', 'Create a new internal user in your organization (cloud only)', [],
        info('Accounts for staff who exist in HR are created in Active Directory and synced. Create cloud-only users here for service, kiosk or test accounts.'),
        form(['Display name', name], ['User principal name', h('div', { class: 'az-upn-row' }, nick, h('span', { class: 'az-suffix' }, `@${w.entra.primaryDomain}`))],
          ['Password', pw], ['Require password change at next sign-in', force], ['Job title', title], ['Department', dept], ['Usage location', loc]),
        h('div', { class: 'az-actions' },
          h('button', { class: 'btn primary', type: 'button', onClick: () => {
            let upn = '';
            if (p.run((x, a) => { upn = createCloudUser(x, a, { displayName: name.value, mailNickname: nick.value, password: pw.value, forceChange: force.checked, jobTitle: title.value, department: dept.value, usageLocation: loc.value || undefined }).upn; }, 'Successfully created user')) p.go({ k: 'entraUser', upn, tab: 'overview' });
          } }, 'Review + create'),
          h('button', { class: 'btn', type: 'button', onClick: () => p.go({ k: 'entra', page: 'users' }) }, 'Cancel')));
    }
    case 'users-invite': {
      const email = input({ type: 'email', placeholder: 'name@partner.example' });
      const name = input({ placeholder: 'Display name' });
      return blade('Invite external user', 'Invite a guest to collaborate with your organization', [],
        form(['Email', email], ['Display name', name]),
        h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => {
          let upn = '';
          if (p.run((x, a) => { upn = inviteGuest(x, a, email.value, name.value).upn; }, 'Invitation sent')) p.go({ k: 'entraUser', upn, tab: 'overview' });
        } }, 'Invite')));
    }
    case 'users-deleted': {
      const gone = w.entra.users.filter((e) => e.deleted && e.source === 'cloud');
      return blade('Deleted users', 'Cloud users stay here for 30 days', [],
        gone.length ? table(['Display name', 'User principal name', ''], gone.map((e) => [e.displayName, e.upn, h('button', { class: 'btn slim', type: 'button', onClick: () => p.run((x, a) => { restoreCloudUser(x, a, e.upn); }, 'User restored') }, 'Restore user')]))
          : h('p', { class: 'empty' }, 'No deleted users. (Users synced from AD are restored from the AD Recycle Bin, not here.)'));
    }
    case 'groups': {
      const q = input({ type: 'search', placeholder: 'Search groups', value: groupFilter, 'aria-label': 'Search groups' });
      q.addEventListener('input', () => { groupFilter = q.value; });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') p.go({ k: 'entra', page: 'groups' }); });
      const list = allGroups(p).filter((g) => g.name.toLowerCase().includes(groupFilter.toLowerCase()));
      return blade('Groups', `${list.length} groups found`, [cmd('New group', '+', () => p.go({ k: 'entra', page: 'groups-new' })), cmd('Refresh', '↻', () => p.go({ k: 'entra', page: 'groups' }))],
        q, table(['Name', 'Group type', 'Membership type', 'Source', 'Members'], list.map((g) => [
          h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); p.go({ k: 'entraGroup', name: g.name }); } }, g.name), g.type, 'Assigned', g.source,
          String(active(p).filter((e) => e.groups.includes(g.name)).length)])));
    }
    case 'groups-new': {
      const type = select([['Security', 'Security'], ['Microsoft 365', 'Microsoft 365']]);
      const name = input({ placeholder: 'Group name' });
      const desc = input({ placeholder: 'Description' });
      return blade('New Group', null, [], form(['Group type', type], ['Group name', name], ['Group description', desc], ['Membership type', h('span', null, 'Assigned')]),
        h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => {
          if (p.run((x, a) => { createCloudGroup(x, a, { name: name.value, type: type.value as 'Security', description: desc.value, owners: [a] }); }, 'Successfully created group')) p.go({ k: 'entraGroup', name: name.value.trim() });
        } }, 'Create')));
    }
    case 'devices': {
      const devs = w.entra.devices ?? [];
      return blade('Devices', `${devs.length} devices`, [],
        devs.length ? table(['Name', 'Enabled', 'OS', 'Join type', 'Owner', 'Registered'], devs.map((d) => [d.name, d.accountEnabled ? 'Yes' : badge('No', 'bad'), d.os, d.trustType, d.ownerUpn ?? '—', fmt(d.registered)]))
          : h('p', { class: 'empty' }, 'No devices. Workstations appear here after Entra Connect syncs their users.'));
    }
    case 'roles': {
      return blade('Roles and administrators', 'Microsoft Entra built-in roles', [],
        info('Only a Global Administrator or Privileged Role Administrator can assign directory roles. A delegated MSP admin has neither: escalate role requests to the customer.'),
        table(['Role', 'Assignments'], ENTRA_ROLES.map((r) => [h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); p.go({ k: 'entraRole', role: r }); } }, r), String(active(p).filter((e) => e.roles.some((x) => x.role === r)).length)])));
    }
    case 'licenses': {
      return blade('Licenses', 'All products', [],
        table(['Product', 'Total', 'Assigned', 'Available'], tenantLicenses(w).map((l) => { const used = licensesInUse(w, l.sku); return [l.sku, String(l.total), String(used), String(Math.max(0, l.total - used))]; })),
        info('Group-based licences come from the all-staff birthright group. Assign extra products to a user from their Licenses tab (they need a usage location).'));
    }
    case 'signins': {
      const list = [...w.entra.signIns].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 200);
      return blade('Sign-in logs', 'Interactive user sign-ins', [], table(['Date', 'User', 'Application', 'Status', 'IP address', 'Location', 'Failure reason'],
        list.map((s) => [fmt(s.time), s.upn, s.app, s.result === 'Success' ? badge('Success', 'ok') : badge(s.result, 'bad'), s.ip, s.location, s.failureReason || '—'])));
    }
    case 'audit': {
      const ev = [...eventsFor(w, 'Entra ID'), ...eventsFor(w, 'Azure')].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 200);
      return blade('Audit logs', null, [], table(['Date', 'Service', 'Activity', 'Target', 'Initiated by', 'Detail'], ev.map((e) => [fmt(e.time), e.source === 'Azure' ? 'Azure RBAC' : 'Core Directory', e.action, e.target, e.actor, e.detail ?? ''])));
    }
    case 'connect': {
      const p2 = w.profileId;
      return blade('Microsoft Entra Connect', 'Connect Sync', [],
        h('dl', { class: 'kv' }, ...[['Sync server', p2 ? `${dcHostOf(w).replace('-DC01', '-SYNC01')}` : 'MHS-SYNC01'], ['Last sync', fmt(w.entra.lastSync)], ['Schedule', 'Delta every 30 minutes'],
          ['Sync scope (OUs)', w.entra.syncScope.join(', ')], ['Export errors', String(w.entra.syncErrors.length)]].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
        w.entra.syncErrors.length ? table(['Object', 'UPN', 'Error', 'Detail'], w.entra.syncErrors.map((e) => [e.sam, e.upn, badge(e.error, 'bad'), e.detail])) : null,
        info('Synced users and groups are mastered in Active Directory: change them there (ADUC or PowerShell with -Server) and let the next sync bring the change here.'));
    }
  }
}

function pimPage(p: Portal): HTMLElement {
  const w = p.w;
  const me = w.entra.users.find((e) => e.upn === p.upn);
  const now = nowIso();
  const mine = me?.roles ?? [];
  const eligible = mine.filter((r) => r.assignment === 'eligible');
  const activeFor = (role: string) => mine.find((r) => r.role === role && r.assignment === 'active' && r.expires && r.expires > now);
  const all = active(p).flatMap((e) => e.roles.filter((r) => r.assignment === 'eligible' || (r.expires ? r.expires > now : true)).map((r) => ({ e, r })));
  return blade('Privileged Identity Management', 'My roles | Microsoft Entra roles', [],
    h('section', { class: 'az-card' }, h('h3', null, 'Eligible assignments'),
      eligible.length ? table(['Role', 'Maximum duration', 'State', ''], eligible.map((r) => {
        const on = activeFor(r.role);
        const hours = select(Array.from({ length: pimSettings(r.role).maxHours }, (_, i): [string, string] => [String(i + 1), `${i + 1} hour${i ? 's' : ''}`]), '1');
        const why = input({ placeholder: 'Justification (ticket number and reason)', 'aria-label': `Justification for ${r.role}` });
        return [r.role, `${pimSettings(r.role).maxHours} hours`, on ? badge(`Active until ${fmt(on.expires)}`, 'ok') : 'Eligible',
          on ? h('button', { class: 'btn slim', type: 'button', onClick: () => p.run((x, a) => deactivateRole(x, a, r.role), 'Role deactivated') }, 'Deactivate')
            : h('span', { class: 'row' }, hours, why, h('button', { class: 'btn slim primary', type: 'button', onClick: () => p.run((x, a) => activateRole(x, a, r.role, Number(hours.value), why.value), `${r.role} activated`) }, 'Activate'))];
      })) : h('p', { class: 'empty' }, 'You have no eligible role assignments.')),
    h('section', { class: 'az-card' }, h('h3', null, 'Assignments in this tenant'),
      table(['User', 'Role', 'State', 'End time'], all.map(({ e, r }) => [e.upn, r.role, r.assignment === 'eligible' ? 'Eligible' : 'Active', r.permanent ? 'Permanent' : fmt(r.expires)]))),
    info('Activations are time-bound and audited. Only a Privileged Role Administrator can add or remove eligible assignments.'));
}

function generatedPassword(seed: number): string {
  const words = ['Harbor', 'Falcon', 'Cedar', 'Quartz', 'Meadow', 'Copper', 'Summit', 'Lantern'];
  return `${words[seed % words.length]}-${(seed * 7919) % 9000 + 1000}-${words[(seed >> 3) % words.length]}!`;
}

export function entraUserPage(p: Portal, upn: string, tab: UserTab): HTMLElement {
  const w = p.w;
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === upn.toLowerCase() && !x.deleted);
  if (!e) return blade('User not found', null, [], h('p', { class: 'empty' }, `No user ${upn}. If they exist in AD, check the sync scope and run a sync.`));
  const tabs: [UserTab, string][] = [['overview', 'Overview'], ['groups', 'Groups'], ['licenses', 'Licenses'], ['roles', 'Assigned roles'], ['auth', 'Authentication methods'], ['devices', 'Devices'], ['signins', 'Sign-in logs'], ['audit', 'Audit logs']];
  const synced = e.source === 'synced';
  const commands = [
    cmd('Edit properties', '✎', () => { editFor = e.upn; p.go({ k: 'entraUser', upn: e.upn, tab: 'overview' }); }),
    cmd('Reset password', '\u{1F511}', () => { resetFor = e.upn; p.go({ k: 'entraUser', upn: e.upn, tab: 'overview' }); }, synced),
    cmd('Revoke sessions', '⎋', () => p.run((x, a) => { revokeSessionsAs(x, a, e.upn); }, 'Sessions revoked')),
    cmd('Delete', '\u{1F5D1}', () => { if (p.run((x, a) => deleteCloudUser(x, a, e.upn), 'User deleted')) p.go({ k: 'entra', page: 'users' }); }, synced),
  ];
  let body: HTMLElement;
  switch (tab) {
    case 'overview': {
      const parts: (HTMLElement | null)[] = [];
      if (synced) parts.push(info('This user is synced from on-premises Active Directory. Name, job title, department and password are changed in AD.'));
      parts.push(h('dl', { class: 'kv' }, ...[['User principal name', e.upn], ['Object ID', e.id], ['User type', e.userType ?? 'Member'], ['Account enabled', yesNo(e.accountEnabled)],
        ['Job title', e.jobTitle || '—'], ['Department', e.department || '—'], ['Usage location', e.usageLocation ?? '—'], ['On-premises sync enabled', yesNo(synced)],
        ['On-premises SAM account name', e.onPremSam ?? '—'], ['Sessions valid from', fmt(e.sessionsValidFrom)], ['Risk level', e.riskLevel]].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])));
      if (resetFor === e.upn) {
        const pw = input({ value: generatedPassword(w.seed + w.audit.length) });
        const force = h('input', { type: 'checkbox', checked: true });
        parts.push(h('section', { class: 'az-card' }, h('h3', null, 'Reset password'), form(['Temporary password', pw], ['Require change at next sign-in', force]),
          h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => { if (p.run((x, a) => { resetCloudPassword(x, a, e.upn, pw.value, force.checked); }, 'Password reset')) { resetFor = null; p.go({ k: 'entraUser', upn: e.upn, tab: 'overview' }); } } }, 'Reset password'),
            h('button', { class: 'btn', type: 'button', onClick: () => { resetFor = null; p.go({ k: 'entraUser', upn: e.upn, tab: 'overview' }); } }, 'Cancel'))));
      }
      if (editFor === e.upn) {
        const title = input({ value: e.jobTitle });
        const dept = input({ value: e.department });
        const loc = select(LOCATIONS, e.usageLocation ?? '');
        parts.push(h('section', { class: 'az-card' }, h('h3', null, 'Edit properties'), form(['Job title', title], ['Department', dept], ['Usage location', loc]),
          h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => {
            const props = synced ? { usageLocation: loc.value } : { jobTitle: title.value, department: dept.value, usageLocation: loc.value };
            if (p.run((x, a) => { updateCloudUser(x, a, e.upn, props); }, 'Saved')) { editFor = null; p.go({ k: 'entraUser', upn: e.upn, tab: 'overview' }); }
          } }, 'Save'), h('button', { class: 'btn', type: 'button', onClick: () => { editFor = null; p.go({ k: 'entraUser', upn: e.upn, tab: 'overview' }); } }, 'Cancel')),
          synced ? info('Only usage location can be changed in the cloud for a synced user.') : null));
      }
      body = h('div', null, parts);
      break;
    }
    case 'groups': {
      const choices = cloudGroups(w).filter((g) => !e.groups.includes(g.name)).map((g): [string, string] => [g.name, g.name]);
      const pick = select(choices);
      body = h('div', null,
        table(['Name', 'Source', ''], e.groups.map((g) => {
          const cloud = cloudGroups(w).some((x) => x.name === g);
          return [g, cloud ? 'Cloud' : 'Windows Server AD', cloud ? h('button', { class: 'btn slim ghost', type: 'button', onClick: () => p.run((x, a) => setCloudGroupMember(x, a, g, e.upn, false), 'Removed from group') }, 'Remove') : ''];
        })),
        choices.length ? h('div', { class: 'row' }, pick, h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => setCloudGroupMember(x, a, pick.value, e.upn, true), 'Added to group') }, 'Add memberships')) : null,
        info('AD groups are managed in Active Directory; cloud groups here.'));
      break;
    }
    case 'licenses': {
      const skus = tenantLicenses(w).map((l): [string, string] => [l.sku, l.sku]);
      const pick = select(skus);
      body = h('div', null,
        table(['Product', 'Assignment path', ''], e.licenses.map((l) => {
          const direct = (e.directLicenses ?? []).includes(l);
          return [l, direct ? 'Direct' : 'Inherited (group)', direct ? h('button', { class: 'btn slim ghost', type: 'button', onClick: () => p.run((x, a) => { assignLicense(x, a, e.upn, l, false); }, 'Licence removed') }, 'Remove') : ''];
        })),
        h('div', { class: 'row' }, pick, h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => { assignLicense(x, a, e.upn, pick.value, true); }, 'Licence assigned') }, '+ Assignments')));
      break;
    }
    case 'roles': {
      const pick = select(ENTRA_ROLES.filter((r) => !e.roles.some((x) => x.role === r)).map((r): [string, string] => [r, r]));
      body = h('div', null,
        table(['Role', 'Assignment', 'Duration', ''], e.roles.map((r) => [r.role, r.assignment === 'active' ? 'Active' : 'Eligible', r.permanent ? 'Permanent' : `Until ${fmt(r.expires)}`,
          h('button', { class: 'btn slim ghost', type: 'button', onClick: () => p.run((x, a) => { assignDirectoryRole(x, a, e.upn, r.role, false); }, 'Role removed') }, 'Remove')])),
        h('div', { class: 'row' }, pick, h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => { assignDirectoryRole(x, a, e.upn, pick.value, true); }, 'Role assigned') }, '+ Add assignments')),
        info(`You are signed in as ${p.upn} (${rolesOf(w, p.upn ?? '').join(', ') || 'no directory roles'}).`));
      break;
    }
    case 'auth': {
      const minutes = select([['60', '1 hour'], ['120', '2 hours'], ['240', '4 hours'], ['480', '8 hours']], '60');
      const once = h('input', { type: 'checkbox', checked: true });
      body = h('div', null,
        table(['Method', 'Detail', 'Added', ''], e.mfaMethods.map((m, i) => [m.type, m.detail, fmt(m.added), h('button', { class: 'btn slim ghost', type: 'button', onClick: () => p.run((x, a) => { deleteMethodAs(x, a, e.upn, i); }, 'Method deleted') }, 'Delete')])),
        e.mfaMethods.length ? null : h('p', { class: 'empty' }, 'No methods registered. The user will be asked to register at next sign-in.'),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => { requireReregisterAs(x, a, e.upn); }, 'User must re-register MFA') }, 'Require re-register multifactor authentication')),
        h('section', { class: 'az-card' }, h('h3', null, 'Temporary Access Pass'), form(['Lifetime', minutes], ['One-time use', once]),
          h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => {
            let issued: { code: string; expires: string } | null = null;
            if (p.run((x, a) => { issued = issueTap(x, a, e.upn, Number(minutes.value), once.checked); }, 'Temporary Access Pass created') && issued) { lastTap = { upn: e.upn, ...(issued as { code: string; expires: string }) }; p.go({ k: 'entraUser', upn: e.upn, tab: 'auth' }); }
          } }, 'Add Temporary Access Pass')),
          lastTap && lastTap.upn === e.upn ? h('div', { class: 'az-info' }, h('strong', null, `Temporary Access Pass: ${lastTap.code}`), h('span', null, ` Valid until ${fmt(lastTap.expires)}. Give it to the user over a verified channel; it is not shown again.`)) : null),
        info('An MFA reset or Temporary Access Pass needs Authentication Administrator. Activate it in Privileged Identity Management first, with the ticket number as justification.'));
      break;
    }
    case 'devices': {
      const devs = (w.entra.devices ?? []).filter((d) => d.ownerUpn === e.upn);
      body = devs.length ? table(['Name', 'Enabled', 'OS', 'Join type'], devs.map((d) => [d.name, yesNo(d.accountEnabled), d.os, d.trustType])) : h('p', { class: 'empty' }, 'No devices.');
      break;
    }
    case 'signins': {
      const list = w.entra.signIns.filter((s) => s.upn.toLowerCase() === e.upn.toLowerCase()).sort((a, b) => b.time.localeCompare(a.time));
      body = list.length ? table(['Date', 'Application', 'Status', 'IP address', 'Location'], list.map((s) => [fmt(s.time), s.app, s.result, s.ip, s.location])) : h('p', { class: 'empty' }, 'No sign-ins.');
      break;
    }
    case 'audit': {
      const ev = w.audit.filter((a) => (a.source === 'Entra ID' || a.source === 'Azure') && (a.target === e.upn || (a.detail ?? '').includes(e.upn))).reverse();
      body = ev.length ? table(['Date', 'Activity', 'Initiated by', 'Detail'], ev.map((a) => [fmt(a.time), a.action, a.actor, a.detail ?? ''])) : h('p', { class: 'empty' }, 'No audit events.');
      break;
    }
  }
  return blade(e.displayName, `User | ${e.upn}`, commands,
    h('div', { class: 'az-tabs', role: 'tablist' }, tabs.map(([t, label]) => h('button', { class: t === tab ? 'on' : '', type: 'button', role: 'tab', onClick: () => p.go({ k: 'entraUser', upn: e.upn, tab: t }) }, label))),
    body);
}

export function entraGroupPage(p: Portal, name: string): HTMLElement {
  const w = p.w;
  const cloud = cloudGroups(w).find((g) => g.name === name);
  const synced = syncedGroupNames(w).includes(name);
  if (!cloud && !synced) return blade('Group not found', null, [], h('p', { class: 'empty' }, `No group named ${name}.`));
  const members = active(p).filter((e) => e.groups.includes(name));
  const add = input({ placeholder: 'user@domain', list: 'az-users', 'aria-label': 'User to add' });
  return blade(name, 'Group', [],
    h('dl', { class: 'kv' }, ...[['Group type', cloud?.type ?? 'Security'], ['Source', synced ? 'Windows Server AD' : 'Cloud'], ['Description', cloud?.description || '—'], ['Owners', cloud?.owners.join(', ') || '—'], ['Members', String(members.length)]].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    synced ? info('This group is synced from Active Directory. Change its members in AD.') : h('div', { class: 'row' }, add,
      h('datalist', { id: 'az-users' }, active(p).filter((e) => !e.groups.includes(name)).map((e) => h('option', { value: e.upn }, e.displayName))),
      h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => setCloudGroupMember(x, a, name, add.value.trim(), true), 'Member added') }, '+ Add members')),
    table(['Name', 'User principal name', ''], members.map((e) => [e.displayName, e.upn, cloud ? h('button', { class: 'btn slim ghost', type: 'button', onClick: () => p.run((x, a) => setCloudGroupMember(x, a, name, e.upn, false), 'Member removed') }, 'Remove') : ''])));
}

export function entraRolePage(p: Portal, role: string): HTMLElement {
  const holders = active(p).filter((e) => e.roles.some((r) => r.role === role));
  const add = input({ placeholder: 'user@domain', list: 'az-role-users', 'aria-label': 'User to assign' });
  return blade(role, 'Assignments', [],
    h('div', { class: 'row' }, add, h('datalist', { id: 'az-role-users' }, active(p).map((e) => h('option', { value: e.upn }, e.displayName))),
      h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => { assignDirectoryRole(x, a, add.value.trim(), role, true); }, 'Role assigned') }, '+ Add assignments')),
    holders.length ? table(['Name', 'User principal name', 'Assignment'], holders.map((e) => [e.displayName, e.upn, e.roles.find((r) => r.role === role)!.assignment])) : h('p', { class: 'empty' }, 'No assignments.'));
}
