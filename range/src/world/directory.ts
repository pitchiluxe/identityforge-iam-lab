/**
 * world/directory.ts — Active Directory for meridianhealth.test.
 *
 * Every change goes through these functions, which validate the way AD does,
 * raise the error text an administrator would actually see, and write the
 * matching Windows Security event. ADUC, the PowerShell cmdlets and the
 * scenario setup all call the same functions, so they can never disagree.
 */
import type { AdGroup, AdUser, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { audit } from './audit.ts';
import { BUILTIN_OU, COMPANY } from './company.ts';

export class AdError extends Error {}

/** Groups the IAM operations delegation cannot add members to (Tier 0). */
export const TIER0_GROUPS = ['Domain Admins', 'Enterprise Admins', 'Account Operators'];
export const LOCKOUT_THRESHOLD = 5;

const DC = COMPANY.domain.split('.').map((p) => `DC=${p}`).join(',');

export function ouToDn(ou: string): string {
  if (ou === BUILTIN_OU) return `CN=Users,${DC}`;
  return ou.split('/').reverse().map((p) => `OU=${p}`).join(',') + ',' + DC;
}

/** Accepts a DN ("OU=Finance,OU=Users,OU=Corp,DC=meridianhealth,DC=test") or a path ("Corp/Users/Finance"). */
export function parseOu(w: World, input: string): string {
  const raw = input.trim();
  if (w.ad.ous.includes(raw)) return raw;
  if (/^(OU|CN)=/i.test(raw)) {
    const parts = raw.split(',').map((p) => p.trim());
    const ouParts = parts.filter((p) => /^(OU|CN)=/i.test(p)).map((p) => p.replace(/^(OU|CN)=/i, ''));
    const path = ouParts.reverse().join('/');
    const found = w.ad.ous.find((o) => o.toLowerCase() === path.toLowerCase());
    if (found) return found;
  }
  const byPath = w.ad.ous.find((o) => o.toLowerCase() === raw.toLowerCase().replace(/\\/g, '/'));
  if (byPath) return byPath;
  throw new AdError(`Directory object not found: '${input}'. Check the OU distinguished name.`);
}

export function dnOf(u: AdUser): string {
  return `CN=${u.displayName},${ouToDn(u.ou)}`;
}

export function groupDn(g: AdGroup): string {
  return `CN=${g.name},${ouToDn(g.ou)}`;
}

export function findUser(w: World, identity: string): AdUser | undefined {
  const id = identity.trim().toLowerCase();
  if (!id) return undefined;
  return w.ad.users.find(
    (u) => u.sam.toLowerCase() === id || u.upn.toLowerCase() === id || dnOf(u).toLowerCase() === id || u.displayName.toLowerCase() === id,
  );
}

export function getUser(w: World, identity: string): AdUser {
  const u = findUser(w, identity);
  if (!u) throw new AdError(`Cannot find an object with identity: '${identity}' under: '${DC}'.`);
  return u;
}

export function findGroup(w: World, identity: string): AdGroup | undefined {
  const id = identity.trim().toLowerCase();
  return w.ad.groups.find((g) => g.name.toLowerCase() === id || groupDn(g).toLowerCase() === id);
}

export function getGroup(w: World, identity: string): AdGroup {
  const g = findGroup(w, identity);
  if (!g) throw new AdError(`Cannot find an object with identity: '${identity}' under: '${DC}'.`);
  return g;
}

export function membersOf(w: World, group: string): AdUser[] {
  const key = group.toLowerCase();
  if (key === 'domain users') return [...w.ad.users];
  return w.ad.users.filter((u) => u.memberOf.some((m) => m.toLowerCase() === key));
}

function touch(u: AdUser): void {
  u.whenChanged = nowIso();
}

export interface NewUserInput {
  sam: string;
  givenName: string;
  surname: string;
  displayName?: string;
  upn?: string;
  ou: string;
  department?: string;
  title?: string;
  manager?: string | null;
  employeeId?: string;
  description?: string;
  office?: string;
  enabled?: boolean;
  passwordSet?: boolean;
  mustChangePassword?: boolean;
  kind?: AdUser['kind'];
}

export function createUser(w: World, input: NewUserInput, actor = w.player.adminSam): AdUser {
  const sam = input.sam.trim();
  if (!/^[A-Za-z0-9._-]{1,20}$/.test(sam)) throw new AdError('The SamAccountName must be 1-20 characters without spaces or special characters.');
  if (findUser(w, sam)) throw new AdError('The specified account already exists');
  const upn = (input.upn ?? `${sam}@${COMPANY.domain}`).trim();
  if (w.ad.users.some((u) => u.upn.toLowerCase() === upn.toLowerCase())) throw new AdError('The operation failed because UPN value provided for addition/modification is not unique forest-wide');
  const ou = parseOu(w, input.ou);
  const displayName = input.displayName?.trim() || `${input.givenName} ${input.surname}`.trim();
  if (w.ad.users.some((u) => u.ou === ou && u.displayName.toLowerCase() === displayName.toLowerCase())) {
    throw new AdError('An attempt was made to add an object to the directory with a name that is already in use');
  }
  if (input.enabled && !input.passwordSet) {
    throw new AdError('The password does not meet the length, complexity, or history requirement of the domain. (An enabled account needs a password.)');
  }
  const managerSam = input.manager ? getUser(w, input.manager).sam : null;
  const t = nowIso();
  const user: AdUser = {
    sam,
    upn,
    mail: upn,
    employeeId: input.employeeId?.trim() ?? '',
    givenName: input.givenName.trim(),
    surname: input.surname.trim(),
    displayName,
    department: input.department?.trim() ?? '',
    title: input.title?.trim() ?? '',
    manager: managerSam,
    ou,
    enabled: !!input.enabled,
    lockedOut: false,
    badPwdCount: 0,
    pwdLastSet: input.passwordSet ? t : '',
    mustChangePassword: input.mustChangePassword ?? true,
    passwordNeverExpires: false,
    lastLogon: null,
    accountExpires: null,
    description: input.description?.trim() ?? '',
    office: input.office?.trim() ?? '',
    memberOf: [],
    kind: input.kind ?? 'user',
    created: t,
    whenChanged: t,
  };
  w.ad.users.push(user);
  audit(w, { source: 'AD', eventId: 4720, action: 'User account created', target: sam, actor, detail: `${dnOf(user)}` });
  if (user.enabled) audit(w, { source: 'AD', eventId: 4722, action: 'User account enabled', target: sam, actor });
  return user;
}

export type UserAttr = 'givenName' | 'surname' | 'displayName' | 'title' | 'department' | 'description' | 'office' | 'employeeId' | 'upn';

export function setUser(w: World, identity: string, changes: Partial<Record<UserAttr, string>> & { manager?: string | null }, actor = w.player.adminSam): AdUser {
  const u = getUser(w, identity);
  const changed: string[] = [];
  for (const [k, v] of Object.entries(changes) as [string, string | null | undefined][]) {
    if (v === undefined) continue;
    if (k === 'manager') {
      const m = v ? getUser(w, v).sam : null;
      if (m === u.sam) throw new AdError('A user cannot be their own manager.');
      if (u.manager !== m) { u.manager = m; changed.push(`manager=${m ?? '<cleared>'}`); }
      continue;
    }
    if (k === 'upn') {
      const upn = String(v).trim();
      if (w.ad.users.some((o) => o !== u && o.upn.toLowerCase() === upn.toLowerCase())) throw new AdError('The operation failed because UPN value provided for addition/modification is not unique forest-wide');
      if (u.upn !== upn) { u.upn = upn; u.mail = upn; changed.push(`userPrincipalName=${upn}`); }
      continue;
    }
    const key = k as Exclude<UserAttr, 'upn'>;
    const val = String(v ?? '').trim();
    if (u[key] !== val) { u[key] = val; changed.push(`${key}=${val || '<cleared>'}`); }
  }
  if (changed.length) {
    touch(u);
    audit(w, { source: 'AD', eventId: 4738, action: 'User account changed', target: u.sam, actor, detail: changed.join('; ') });
  }
  return u;
}

export function setEnabled(w: World, identity: string, enabled: boolean, actor = w.player.adminSam): AdUser {
  const u = getUser(w, identity);
  if (enabled && !u.pwdLastSet) throw new AdError('Unable to update the password. The value provided for the new password does not meet the length, complexity, or history requirements of the domain. (Set a password before enabling.)');
  if (u.enabled === enabled) return u;
  u.enabled = enabled;
  touch(u);
  audit(w, { source: 'AD', eventId: enabled ? 4722 : 4725, action: enabled ? 'User account enabled' : 'User account disabled', target: u.sam, actor });
  return u;
}

export function unlock(w: World, identity: string, actor = w.player.adminSam): AdUser {
  const u = getUser(w, identity);
  if (!u.lockedOut) return u;
  u.lockedOut = false;
  u.badPwdCount = 0;
  touch(u);
  audit(w, { source: 'AD', eventId: 4767, action: 'User account unlocked', target: u.sam, actor });
  return u;
}

export function resetPassword(w: World, identity: string, opts: { mustChange: boolean; unlock?: boolean }, actor = w.player.adminSam): AdUser {
  const u = getUser(w, identity);
  u.pwdLastSet = nowIso();
  u.mustChangePassword = opts.mustChange;
  u.badPwdCount = 0;
  touch(u);
  audit(w, { source: 'AD', eventId: 4724, action: 'Password reset', target: u.sam, actor, detail: opts.mustChange ? 'User must change password at next logon' : 'Password does not need to change at next logon' });
  if (opts.unlock) unlock(w, u.sam, actor);
  return u;
}

export function setPasswordFlags(w: World, identity: string, flags: { mustChange?: boolean; neverExpires?: boolean }, actor = w.player.adminSam): AdUser {
  const u = getUser(w, identity);
  const parts: string[] = [];
  if (flags.mustChange !== undefined && u.mustChangePassword !== flags.mustChange) { u.mustChangePassword = flags.mustChange; parts.push(`mustChangePassword=${flags.mustChange}`); }
  if (flags.neverExpires !== undefined && u.passwordNeverExpires !== flags.neverExpires) { u.passwordNeverExpires = flags.neverExpires; parts.push(`passwordNeverExpires=${flags.neverExpires}`); }
  if (parts.length) { touch(u); audit(w, { source: 'AD', eventId: 4738, action: 'User account changed', target: u.sam, actor, detail: parts.join('; ') }); }
  return u;
}

export function setExpiration(w: World, identity: string, when: string | null, actor = w.player.adminSam): AdUser {
  const u = getUser(w, identity);
  if (when !== null && Number.isNaN(Date.parse(when))) throw new AdError(`Cannot convert '${when}' to type DateTime.`);
  u.accountExpires = when === null ? null : new Date(when).toISOString();
  touch(u);
  audit(w, { source: 'AD', eventId: 4738, action: 'User account changed', target: u.sam, actor, detail: `accountExpires=${u.accountExpires ?? 'Never'}` });
  return u;
}

export function moveUser(w: World, identity: string, target: string, actor = w.player.adminSam): AdUser {
  const u = getUser(w, identity);
  const ou = parseOu(w, target);
  if (u.ou === ou) return u;
  if (w.ad.users.some((o) => o !== u && o.ou === ou && o.displayName.toLowerCase() === u.displayName.toLowerCase())) {
    throw new AdError('An attempt was made to add an object to the directory with a name that is already in use');
  }
  const from = u.ou;
  u.ou = ou;
  touch(u);
  audit(w, { source: 'AD', eventId: 5139, action: 'Object moved', target: u.sam, actor, detail: `${ouToDn(from)} -> ${ouToDn(ou)}` });
  return u;
}

function memberEvent(g: AdGroup, add: boolean): number {
  if (g.scope === 'DomainLocal') return add ? 4732 : 4733;
  return add ? 4728 : 4729;
}

export function addMember(w: World, group: string, identity: string, actor = w.player.adminSam): boolean {
  const g = getGroup(w, group);
  const u = getUser(w, identity);
  if (g.name === 'Domain Users') return false;
  if (TIER0_GROUPS.includes(g.name) && actor === w.player.adminSam) {
    throw new AdError('Insufficient access rights to perform the operation. (Tier 0 groups are changed only through an approved CHG by the Domain Admin team.)');
  }
  if (u.memberOf.some((m) => m.toLowerCase() === g.name.toLowerCase())) {
    throw new AdError(`The specified account name is already a member of the group (${u.sam} in ${g.name}).`);
  }
  u.memberOf.push(g.name);
  touch(u);
  audit(w, { source: 'AD', eventId: memberEvent(g, true), action: 'Member added to group', target: u.sam, actor, detail: g.name });
  return true;
}

export function removeMember(w: World, group: string, identity: string, actor = w.player.adminSam): boolean {
  const g = getGroup(w, group);
  const u = getUser(w, identity);
  if (g.name === 'Domain Users') throw new AdError('The primary group cannot be removed. (Domain Users is the primary group.)');
  const i = u.memberOf.findIndex((m) => m.toLowerCase() === g.name.toLowerCase());
  if (i < 0) throw new AdError(`The specified account name is not a member of the group (${u.sam} in ${g.name}).`);
  u.memberOf.splice(i, 1);
  touch(u);
  audit(w, { source: 'AD', eventId: memberEvent(g, false), action: 'Member removed from group', target: u.sam, actor, detail: g.name });
  return true;
}

export function deleteUser(w: World, identity: string, actor = w.player.adminSam): void {
  const u = getUser(w, identity);
  w.ad.users = w.ad.users.filter((o) => o !== u);
  for (const o of w.ad.users) if (o.manager === u.sam) o.manager = null;
  audit(w, { source: 'AD', eventId: 4726, action: 'User account deleted', target: u.sam, actor, detail: 'Deleted objects are not recoverable without the AD Recycle Bin and lose their SID history in downstream systems.' });
}

export function setGroupOwner(w: World, group: string, owner: string | null, actor = w.player.adminSam): AdGroup {
  const g = getGroup(w, group);
  g.managedBy = owner ? getUser(w, owner).sam : null;
  audit(w, { source: 'AD', eventId: 5136, action: 'Group changed', target: g.name, actor, detail: `managedBy=${g.managedBy ?? '<cleared>'}` });
  return g;
}

export function createGroup(w: World, name: string, ou: string, description: string, actor = w.player.adminSam): AdGroup {
  if (findGroup(w, name)) throw new AdError('The specified group already exists.');
  const g: AdGroup = { name, ou: parseOu(w, ou), scope: 'Global', category: 'Security', description, managedBy: null, privileged: false };
  w.ad.groups.push(g);
  audit(w, { source: 'AD', eventId: 4727, action: 'Security-enabled global group created', target: name, actor });
  return g;
}

/**
 * Failed sign-ins against the DC, as the domain records them: a 4625/4771 per
 * attempt from the given workstation, and a 4740 naming that caller computer
 * once the threshold is crossed.
 */
export function failLogons(w: World, identity: string, count: number, origin: string, time?: string): AdUser {
  const u = getUser(w, identity);
  for (let i = 0; i < count; i++) {
    u.badPwdCount++;
    audit(w, { source: 'AD', eventId: 4771, action: 'Kerberos pre-authentication failed', target: u.sam, actor: u.sam, origin, detail: `Failure code 0x18 (bad password). Client address: ${origin}`, time });
    if (u.badPwdCount >= LOCKOUT_THRESHOLD && !u.lockedOut) {
      u.lockedOut = true;
      audit(w, { source: 'AD', eventId: 4740, action: 'User account locked out', target: u.sam, actor: 'SYSTEM', origin: 'MHS-DC01', detail: `Caller Computer Name: ${origin}`, time });
    }
  }
  return u;
}

/** Effective groups as Get-ADPrincipalGroupMembership reports them. */
export function principalGroups(u: AdUser): string[] {
  return ['Domain Users', ...u.memberOf];
}

// ------------------------------------------------------------------- OU and group administration (ADUC)

export function extra(w: World): NonNullable<World['ad']['extra']> {
  if (!w.ad.extra) w.ad.extra = { userAttrs: {}, groupAttrs: {}, ouInfo: {}, delegations: [] };
  return w.ad.extra;
}

export function ouInfo(w: World, path: string): { description: string; protected: boolean; attrs: Record<string, string>; created: string } {
  const x = extra(w);
  if (!x.ouInfo[path]) x.ouInfo[path] = { description: '', protected: true, attrs: {}, created: w.created };
  return x.ouInfo[path]!;
}

export function createOu(w: World, name: string, parent: string | null, opts: { description?: string; protected?: boolean } = {}, actor = w.player.adminSam): string {
  const n = name.trim();
  if (!n) throw new AdError('The name of the organizational unit is required.');
  if (/[\\/,+"<>;=#]/.test(n)) throw new AdError('The name contains characters that are not valid for an organizational unit.');
  const parentPath = parent ? parseOu(w, parent) : null;
  if (parentPath === BUILTIN_OU) throw new AdError('An organizational unit cannot be created in a container.');
  const path = parentPath ? `${parentPath}/${n}` : n;
  if (w.ad.ous.some((o) => o.toLowerCase() === path.toLowerCase())) throw new AdError('An attempt was made to add an object to the directory with a name that is already in use.');
  w.ad.ous.push(path);
  const info = ouInfo(w, path);
  info.description = opts.description ?? '';
  info.protected = opts.protected ?? true;
  info.created = nowIso();
  audit(w, { source: 'AD', eventId: 5137, action: 'Organizational unit created', target: path, actor, detail: ouToDn(path) });
  return path;
}

export function deleteOu(w: World, path: string, actor = w.player.adminSam): void {
  const p = parseOu(w, path);
  if (p === BUILTIN_OU) throw new AdError('Access is denied. (System containers cannot be deleted.)');
  if (ouInfo(w, p).protected) throw new AdError(`You do not have sufficient privileges to delete ${p.split('/').pop()}, or this object is protected from accidental deletion.`);
  const busy = w.ad.ous.some((o) => o.startsWith(`${p}/`)) || w.ad.users.some((u) => u.ou === p) || w.ad.groups.some((g) => g.ou === p) || w.ad.computers.some((c) => c.ou === p);
  if (busy) throw new AdError('The operation cannot be performed because child objects exist. This operation can only be performed on a leaf object.');
  w.ad.ous = w.ad.ous.filter((o) => o !== p);
  delete extra(w).ouInfo[p];
  audit(w, { source: 'AD', eventId: 5141, action: 'Organizational unit deleted', target: p, actor });
}

/** Rename an OU; everything inside moves with it, as in AD. */
export function renameOu(w: World, path: string, newName: string, actor = w.player.adminSam): string {
  const p = parseOu(w, path);
  const n = newName.trim();
  if (!n || /[\\/,+"<>;=#]/.test(n)) throw new AdError('The name is not valid.');
  const next = [...p.split('/').slice(0, -1), n].join('/');
  if (next === p) return p;
  if (w.ad.ous.some((o) => o.toLowerCase() === next.toLowerCase())) throw new AdError('An attempt was made to add an object to the directory with a name that is already in use.');
  const swap = (o: string): string => (o === p ? next : o.startsWith(`${p}/`) ? next + o.slice(p.length) : o);
  w.ad.ous = w.ad.ous.map(swap);
  for (const u of w.ad.users) u.ou = swap(u.ou);
  for (const g of w.ad.groups) g.ou = swap(g.ou);
  for (const c of w.ad.computers) c.ou = swap(c.ou);
  const x = extra(w);
  for (const k of Object.keys(x.ouInfo)) {
    const nk = swap(k);
    if (nk !== k) { x.ouInfo[nk] = x.ouInfo[k]!; delete x.ouInfo[k]; }
  }
  audit(w, { source: 'AD', eventId: 5139, action: 'Organizational unit renamed', target: next, actor, detail: `${ouToDn(p)} -> ${ouToDn(next)}` });
  return next;
}

export function renameGroup(w: World, group: string, newName: string, actor = w.player.adminSam): AdGroup {
  const g = getGroup(w, group);
  const n = newName.trim();
  if (!n) throw new AdError('The name is not valid.');
  if (n.toLowerCase() !== g.name.toLowerCase() && findGroup(w, n)) throw new AdError('The specified group already exists.');
  const old = g.name;
  for (const u of w.ad.users) u.memberOf = u.memberOf.map((m) => (m === old ? n : m));
  const x = extra(w);
  if (x.groupAttrs[old]) { x.groupAttrs[n] = x.groupAttrs[old]!; delete x.groupAttrs[old]; }
  g.name = n;
  audit(w, { source: 'AD', eventId: 4737, action: 'Security-enabled global group changed', target: n, actor, detail: `renamed from ${old}` });
  return g;
}

export function deleteGroup(w: World, group: string, actor = w.player.adminSam): void {
  const g = getGroup(w, group);
  if (g.ou === BUILTIN_OU || g.privileged) throw new AdError('Access is denied. (Built-in and Tier 0 groups cannot be deleted by IAM Operations.)');
  for (const u of w.ad.users) u.memberOf = u.memberOf.filter((m) => m !== g.name);
  w.ad.groups = w.ad.groups.filter((x) => x !== g);
  delete extra(w).groupAttrs[g.name];
  audit(w, { source: 'AD', eventId: 4730, action: 'Security-enabled global group deleted', target: g.name, actor });
}

export function setGroupProps(w: World, group: string, changes: { description?: string; scope?: AdGroup['scope']; category?: AdGroup['category']; ou?: string }, actor = w.player.adminSam): AdGroup {
  const g = getGroup(w, group);
  const parts: string[] = [];
  if (changes.description !== undefined && changes.description !== g.description) { g.description = changes.description; parts.push('description'); }
  if (changes.scope && changes.scope !== g.scope) { g.scope = changes.scope; parts.push(`scope=${changes.scope}`); }
  if (changes.category && changes.category !== g.category) { g.category = changes.category; parts.push(`category=${changes.category}`); }
  if (changes.ou) {
    const ou = parseOu(w, changes.ou);
    if (ou !== g.ou) { g.ou = ou; parts.push(`moved to ${ou}`); }
  }
  if (parts.length) audit(w, { source: 'AD', eventId: 4737, action: 'Security-enabled global group changed', target: g.name, actor, detail: parts.join('; ') });
  return g;
}

/** Attributes ADUC edits that the lab stores but does not grade (address, phones, profile). */
export function setUserExtraAttrs(w: World, identity: string, attrs: Record<string, string | null>, actor = w.player.adminSam): void {
  const u = getUser(w, identity);
  const all = extra(w).userAttrs;
  const bag = all[u.sam] ?? (all[u.sam] = {});
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === '') {
      if (k in bag) { delete bag[k]; parts.push(`${k}=<cleared>`); }
    } else if (bag[k] !== v) { bag[k] = v; parts.push(`${k}=${v}`); }
  }
  if (parts.length) { touch(u); audit(w, { source: 'AD', eventId: 4738, action: 'User account changed', target: u.sam, actor, detail: parts.join('; ') }); }
}

export function renameUserSam(w: World, identity: string, newSam: string, actor = w.player.adminSam): AdUser {
  const u = getUser(w, identity);
  const n = newSam.trim();
  if (n === u.sam) return u;
  if (!/^[A-Za-z0-9._-]{1,20}$/.test(n)) throw new AdError('The SamAccountName must be 1-20 characters without spaces or special characters.');
  if (findUser(w, n)) throw new AdError('The specified account already exists');
  const old = u.sam;
  for (const o of w.ad.users) if (o.manager === old) o.manager = n;
  for (const g of w.ad.groups) if (g.managedBy === old) g.managedBy = n;
  const x = extra(w);
  if (x.userAttrs[old]) { x.userAttrs[n] = x.userAttrs[old]!; delete x.userAttrs[old]; }
  u.sam = n;
  touch(u);
  audit(w, { source: 'AD', eventId: 4781, action: 'The name of an account was changed', target: n, actor, detail: `${old} -> ${n}` });
  return u;
}

export function delegate(w: World, ou: string | null, trustee: string, tasks: string[], actor = w.player.adminSam): void {
  const p = ou ? parseOu(w, ou) : null;
  if (!findGroup(w, trustee) && !findUser(w, trustee)) throw new AdError(`Cannot find an object with identity: '${trustee}'.`);
  extra(w).delegations.push({ ou: p, trustee, tasks: [...tasks], at: nowIso() });
  audit(w, { source: 'AD', eventId: 5136, action: 'Delegation of control', target: p ?? w.ad.domain, actor, detail: `${trustee}: ${tasks.join('; ')}` });
}
