/**
 * world/entraAdmin.ts — cloud-side identity administration, as the Azure portal
 * (and Microsoft Graph) does it: cloud-only users and guests, cloud groups,
 * licences and directory role assignments.
 *
 * Every operation is checked against the acting account's active directory
 * roles, the way Entra checks them, and objects mastered in on-premises AD are
 * read-only in the cloud. Errors use the portal's own wording.
 */
import type { CloudGroup, EntraUser, TenantLicense, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { audit } from './audit.ts';
import { groupsOuOf, objectIdFor, revokeSessions, setCloudAccountEnabled } from './cloud.ts';
import { profileById } from './profiles.ts';
import { checkInvite } from './identityExtras.ts';

export const PRIVILEGED_ROLES: readonly string[] = [
  'Global Administrator', 'Privileged Role Administrator', 'Privileged Authentication Administrator', 'Security Administrator',
  'Exchange Administrator', 'SharePoint Administrator', 'Conditional Access Administrator', 'Application Administrator',
];

export type { CloudGroup, TenantLicense };

const NO_RIGHTS = 'Insufficient privileges to complete the operation.';
const ON_PREM = 'Unable to update the specified properties for on-premises mastered Directory Sync objects or objects currently undergoing migration.';
export const P2 = 'Microsoft Entra ID P2';

/** Active directory roles the account holds right now. */
export function rolesOf(w: World, upn: string): string[] {
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === upn.toLowerCase() && !x.deleted);
  if (!e || !e.accountEnabled) return [];
  const now = nowIso();
  return e.roles.filter((r) => r.assignment === 'active' && (!r.expires || r.expires > now)).map((r) => r.role);
}

/**
 * Roles the actor holds over a target: tenant-wide roles plus roles scoped to an
 * administrative unit the target belongs to.
 */
export function rolesOn(w: World, actor: string, target?: string): string[] {
  const mine = rolesOf(w, actor);
  if (!target || !mine.length && !w.entra.adminUnits?.length) return mine;
  const scoped = (w.entra.adminUnits ?? []).filter((a) => a.members.some((m) => m.toLowerCase() === target.toLowerCase()))
    .flatMap((a) => a.scopedRoles.filter((r) => r.upn.toLowerCase() === actor.toLowerCase()).map((r) => r.role));
  return [...new Set([...mine, ...scoped])];
}

function needRole(w: World, actor: string, any: string[], target?: string): void {
  const mine = rolesOn(w, actor, target);
  if (!mine.includes('Global Administrator') && !any.some((r) => mine.includes(r))) throw new Error(NO_RIGHTS);
}

/** Roles a User Administrator may still manage on a target (Entra's "who can reset passwords" matrix). */
const LIMITED_ADMIN_ROLES = ['Helpdesk Administrator', 'User Administrator', 'Groups Administrator', 'License Administrator', 'Password Administrator', 'Directory Readers', 'Guest Inviter', 'Reports Reader', 'Message Center Reader', 'Usage Summary Reports Reader'];

/**
 * Acting on another admin: anyone holding a role (active or eligible) needs
 * Global or Privileged Authentication Administrator, except that a User
 * Administrator may manage holders of the limited admin roles. Without this a
 * delegated admin could reset a Global Administrator's password and become one.
 */
function needTarget(w: World, actor: string, e: EntraUser): void {
  const theirs = e.roles.map((r) => r.role);
  if (!theirs.length) return;
  const mine = rolesOf(w, actor);
  if (mine.includes('Global Administrator') || mine.includes('Privileged Authentication Administrator')) return;
  if (mine.includes('User Administrator') && theirs.every((r) => LIMITED_ADMIN_ROLES.includes(r))) return;
  throw new Error(NO_RIGHTS);
}

/** Directory roles are assigned by Global and Privileged Role Administrators only, as in Entra. */
export function canManageRole(w: World, actorUpn: string, _role: string): boolean {
  const mine = rolesOf(w, actorUpn);
  return mine.includes('Global Administrator') || mine.includes('Privileged Role Administrator');
}

function user(w: World, upn: string): EntraUser {
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === upn.toLowerCase());
  if (!e) throw new Error(`Resource '${upn}' does not exist or one of its queried reference-property objects are not present.`);
  return e;
}

function cloudOnly(e: EntraUser): void {
  if (e.source === 'synced') throw new Error(ON_PREM);
}

function blank(w: World, upn: string, displayName: string, extra: Partial<EntraUser>): EntraUser {
  return {
    id: objectIdFor(w.seed, upn), upn, displayName, source: 'cloud', onPremSam: null, accountEnabled: true, department: '', jobTitle: '',
    groups: [], mfaMethods: [], mfaResetAt: null, sessionsValidFrom: nowIso(), sessions: [], roles: [], licenses: [], riskLevel: 'none', deleted: false,
    ...extra,
  };
}

export function createCloudUser(w: World, actorUpn: string, input: { displayName: string; mailNickname: string; password: string; forceChange: boolean; jobTitle?: string; department?: string; usageLocation?: string }): EntraUser {
  needRole(w, actorUpn, ['User Administrator']);
  const nick = input.mailNickname.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(nick)) throw new Error('The user name can only contain letters, numbers, periods, hyphens and underscores.');
  if (!input.displayName.trim()) throw new Error('Display name is required.');
  const upn = `${nick}@${w.entra.primaryDomain}`.toLowerCase();
  if (w.entra.users.some((e) => e.upn.toLowerCase() === upn)) throw new Error('Another object with the same value for property userPrincipalName already exists.');
  if (input.password.length < 8) throw new Error('The password does not comply with the password complexity requirements.');
  const e = blank(w, upn, input.displayName.trim(), { jobTitle: input.jobTitle ?? '', department: input.department ?? '', usageLocation: input.usageLocation, labPassword: input.password, mustChangePassword: input.forceChange, userType: 'Member' });
  w.entra.users.push(e);
  audit(w, { source: 'Entra ID', action: 'Add user', target: upn, actor: actorUpn, detail: `Cloud-only user. Force password change: ${input.forceChange ? 'Yes' : 'No'}` });
  return e;
}

export function inviteGuest(w: World, actorUpn: string, email: string, displayName: string): EntraUser {
  const m = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(email.trim().toLowerCase());
  if (!m) throw new Error('Enter a valid email address.');
  checkInvite(w, actorUpn, m[2]!);
  const upn = `${m[1]}_${m[2]}#EXT#@${w.entra.primaryDomain}`;
  if (w.entra.users.some((e) => e.upn.toLowerCase() === upn)) throw new Error('Another object with the same value for property userPrincipalName already exists.');
  const e = blank(w, upn, displayName.trim() || m[1]!, { userType: 'Guest', jobTitle: 'Guest' });
  w.entra.users.push(e);
  audit(w, { source: 'Entra ID', action: 'Invite external user', target: upn, actor: actorUpn, detail: `Invitation sent to ${email.trim()}` });
  return e;
}

export function updateCloudUser(w: World, actorUpn: string, upn: string, props: { displayName?: string; jobTitle?: string; department?: string; usageLocation?: string }): EntraUser {
  needRole(w, actorUpn, ['User Administrator'], upn);
  const e = user(w, upn);
  needTarget(w, actorUpn, e);
  // Usage location lives only in the cloud, so it can be set even on synced users.
  const cloudProps = Object.keys(props).filter((k) => k !== 'usageLocation' && props[k as keyof typeof props] !== undefined);
  if (cloudProps.length) cloudOnly(e);
  if (props.displayName !== undefined) e.displayName = props.displayName;
  if (props.jobTitle !== undefined) e.jobTitle = props.jobTitle;
  if (props.department !== undefined) e.department = props.department;
  if (props.usageLocation !== undefined) e.usageLocation = props.usageLocation || undefined;
  audit(w, { source: 'Entra ID', action: 'Update user', target: e.upn, actor: actorUpn, detail: Object.keys(props).join(', ') });
  return e;
}

export function resetCloudPassword(w: World, actorUpn: string, upn: string, password: string, forceChange: boolean): EntraUser {
  needRole(w, actorUpn, ['User Administrator', 'Helpdesk Administrator', 'Password Administrator'], upn);
  const e = user(w, upn);
  cloudOnly(e);
  needTarget(w, actorUpn, e);
  if (password.length < 8) throw new Error('The password does not comply with the password complexity requirements.');
  e.labPassword = password;
  e.mustChangePassword = forceChange;
  e.sessionsValidFrom = nowIso();
  audit(w, { source: 'Entra ID', action: 'Reset user password', target: e.upn, actor: actorUpn, detail: `Force change at next sign-in: ${forceChange ? 'Yes' : 'No'}` });
  return e;
}

export function deleteCloudUser(w: World, actorUpn: string, upn: string): void {
  needRole(w, actorUpn, ['User Administrator']);
  const e = user(w, upn);
  cloudOnly(e);
  needTarget(w, actorUpn, e);
  if (e.upn.toLowerCase() === actorUpn.toLowerCase()) throw new Error('You cannot delete your own account.');
  e.deleted = true;
  e.accountEnabled = false;
  audit(w, { source: 'Entra ID', action: 'Delete user', target: e.upn, actor: actorUpn, detail: 'Soft-deleted. Restorable from Deleted users for 30 days.' });
}

export function restoreCloudUser(w: World, actorUpn: string, upn: string): EntraUser {
  needRole(w, actorUpn, ['User Administrator']);
  const e = user(w, upn);
  if (!e.deleted) throw new Error(`'${upn}' is not in Deleted users.`);
  e.deleted = false;
  e.accountEnabled = true;
  audit(w, { source: 'Entra ID', action: 'Restore user', target: e.upn, actor: actorUpn, detail: 'Restored from Deleted users' });
  return e;
}

/** Revoke sessions from the portal: an admin role, and the target rule above. */
export function revokeSessionsAs(w: World, actorUpn: string, upn: string): EntraUser {
  needRole(w, actorUpn, ['User Administrator', 'Helpdesk Administrator', 'Password Administrator', 'Privileged Authentication Administrator'], upn);
  needTarget(w, actorUpn, user(w, upn));
  return revokeSessions(w, upn, actorUpn);
}

/** Block or allow sign-in for a cloud user (Graph Update-MgUser -AccountEnabled, portal). */
export function setAccountEnabledAs(w: World, actorUpn: string, upn: string, enabled: boolean): EntraUser {
  needRole(w, actorUpn, ['User Administrator'], upn);
  const e = user(w, upn);
  cloudOnly(e);
  needTarget(w, actorUpn, e);
  return setCloudAccountEnabled(w, e.upn, enabled, actorUpn);
}

export function cloudGroups(w: World): CloudGroup[] {
  return (w.entra.cloudGroups ??= []);
}

/** Groups synced from AD (read-only here). */
export function syncedGroupNames(w: World): string[] {
  return w.ad.groups.filter((g) => g.ou === groupsOuOf(w)).map((g) => g.name);
}

export function createCloudGroup(w: World, actorUpn: string, input: { name: string; type: CloudGroup['type']; description: string; owners: string[] }): CloudGroup {
  needRole(w, actorUpn, ['Groups Administrator', 'User Administrator']);
  const name = input.name.trim();
  if (!name) throw new Error('Group name is required.');
  if (cloudGroups(w).some((g) => g.name.toLowerCase() === name.toLowerCase()) || syncedGroupNames(w).some((g) => g.toLowerCase() === name.toLowerCase())) {
    throw new Error(`A group named '${name}' already exists in this directory.`);
  }
  const g: CloudGroup = { id: objectIdFor(w.seed, `group:${name}`), name, type: input.type, description: input.description.trim(), owners: [...input.owners], created: nowIso() };
  cloudGroups(w).push(g);
  audit(w, { source: 'Entra ID', action: 'Add group', target: name, actor: actorUpn, detail: `${input.type} group, membership type Assigned` });
  return g;
}

export function setCloudGroupMember(w: World, actorUpn: string, group: string, upn: string, member: boolean): void {
  needRole(w, actorUpn, ['Groups Administrator', 'User Administrator']);
  if (syncedGroupNames(w).includes(group)) throw new Error(ON_PREM);
  const g = cloudGroups(w).find((x) => x.name === group);
  if (!g) throw new Error(`Group '${group}' was not found.`);
  const e = user(w, upn);
  const has = e.groups.includes(g.name);
  if (member === has) throw new Error(member ? 'One or more added object references already exist for the following modified properties: \'members\'.' : `'${e.upn}' is not a member of '${g.name}'.`);
  e.groups = member ? [...e.groups, g.name].sort() : e.groups.filter((x) => x !== g.name);
  audit(w, { source: 'Entra ID', action: member ? 'Add member to group' : 'Remove member from group', target: g.name, actor: actorUpn, detail: e.upn });
}

function managedCloudGroup(w: World, actor: string, name: string): CloudGroup {
  const e = w.entra.users.find((u) => u.upn.toLowerCase() === actor.toLowerCase() && !u.deleted && u.accountEnabled);
  const g = (w.entra.cloudGroups ?? []).find((x) => x.name === name);
  const mine = rolesOf(w, actor);
  if (!e || !(mine.some((r) => ['Global Administrator', 'Groups Administrator', 'User Administrator'].includes(r)) || g?.owners.some((o) => o.toLowerCase() === actor.toLowerCase()))) throw new Error(NO_RIGHTS);
  if (syncedGroupNames(w).includes(name)) throw new Error(ON_PREM);
  if (!g) throw new Error(`Group '${name}' was not found.`);
  return g;
}

/** Keep the group's stable name: memberships, licence rules and assignments reference it. */
export function updateCloudGroup(w: World, actor: string, name: string, changes: { description: string }): void {
  const g = managedCloudGroup(w, actor, name);
  g.description = changes.description.trim();
  audit(w, { source: 'Entra ID', action: 'Update group', target: g.name, actor, detail: `Description: ${g.description}` });
}

export function setCloudGroupOwner(w: World, actor: string, name: string, upn: string, add: boolean): void {
  const g = managedCloudGroup(w, actor, name);
  const e = w.entra.users.find((u) => u.upn.toLowerCase() === upn.trim().toLowerCase() && !u.deleted);
  if (!e) throw new Error(`User '${upn}' was not found in this directory.`);
  const exists = g.owners.some((o) => o.toLowerCase() === e.upn.toLowerCase());
  if (exists === add) throw new Error(add ? 'This user is already an owner.' : 'This user is not an owner.');
  g.owners = add ? [...g.owners, e.upn] : g.owners.filter((o) => o.toLowerCase() !== e.upn.toLowerCase());
  audit(w, { source: 'Entra ID', action: add ? 'Add owner to group' : 'Remove owner from group', target: g.name, actor, detail: e.upn });
}

export function tenantLicenses(w: World): TenantLicense[] {
  if (!w.entra.licenses) {
    const p = w.profileId ? profileById(w.profileId) : undefined;
    const staff = w.ad.users.filter((u) => u.kind === 'user').length;
    w.entra.licenses = [{ sku: p ? 'Microsoft 365 Business Premium' : 'Microsoft 365 E3', total: staff + 10 }, { sku: P2, total: 25 }];
  }
  return w.entra.licenses;
}

export function licensesInUse(w: World, sku: string): number {
  return w.entra.users.filter((e) => !e.deleted && e.licenses.includes(sku)).length;
}

export function assignLicense(w: World, actorUpn: string, upn: string, sku: string, assign: boolean): EntraUser {
  needRole(w, actorUpn, ['User Administrator', 'License Administrator']);
  const lic = tenantLicenses(w).find((l) => l.sku === sku);
  if (!lic) throw new Error(`The tenant has no subscription for '${sku}'.`);
  const e = user(w, upn);
  const direct = (e.directLicenses ??= []);
  if (assign) {
    if (!e.usageLocation) throw new Error('License assignment cannot be done for user with invalid usage location.');
    if (direct.includes(sku)) throw new Error(`'${sku}' is already assigned directly to this user.`);
    if (!e.licenses.includes(sku) && licensesInUse(w, sku) >= lic.total) throw new Error('License assignment failed because the subscription has no available licenses.');
    direct.push(sku);
    if (!e.licenses.includes(sku)) e.licenses = [...e.licenses, sku];
  } else {
    if (!direct.includes(sku)) throw new Error(`'${sku}' is not assigned directly. If it comes from a group, remove the user from that group instead.`);
    e.directLicenses = direct.filter((x) => x !== sku);
    e.licenses = e.licenses.filter((x) => x !== sku);
  }
  audit(w, { source: 'Entra ID', action: 'Change user license', target: e.upn, actor: actorUpn, detail: `${assign ? 'Assigned' : 'Removed'} ${sku}` });
  return e;
}

export function assignDirectoryRole(w: World, actorUpn: string, upn: string, role: string, assign: boolean): EntraUser {
  if (!canManageRole(w, actorUpn, role)) throw new Error(NO_RIGHTS);
  const e = user(w, upn);
  const has = e.roles.some((r) => r.role === role);
  if (assign) {
    if (has) throw new Error(`'${e.upn}' already holds ${role}.`);
    e.roles.push({ role, assignment: 'active', permanent: true, expires: null, justification: `Assigned in the Azure portal by ${actorUpn}` });
  } else {
    if (!has) throw new Error(`'${e.upn}' does not hold ${role}.`);
    e.roles = e.roles.filter((r) => r.role !== role);
  }
  audit(w, { source: 'Entra ID', action: assign ? 'Add member to role' : 'Remove member from role', target: e.upn, actor: actorUpn, detail: role });
  return e;
}
