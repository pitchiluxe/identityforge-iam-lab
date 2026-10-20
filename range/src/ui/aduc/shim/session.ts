/**
 * The adapter between IAM Range's ADUC console and this range's world.
 *
 * `Dir` presents the world through IAM Range's MockDirectory interface, read
 * live on every call. `runCapability` performs the console's changes through
 * the same world/directory.ts functions the PowerShell cmdlets use, so the
 * GUI, the shell and the grader can never disagree.
 */
import type { AdGroup, AdUser, World } from '../../../core/types.ts';
import {
  AdError, addMember, createGroup, createOu, createUser, delegate as delegateWorld, deleteGroup, deleteOu, deleteUser,
  extra, findGroup, findUser, getUser, moveUser, ouInfo, parseOu, removeMember, renameGroup, renameOu, renameUserSam,
  resetPassword, setEnabled, setExpiration, setGroupOwner, setGroupProps, setPasswordFlags, setUser, setUserExtraAttrs, unlock,
} from '../../../world/directory.ts';
import { BUILTIN_OU } from '../../../world/company.ts';
import { USER_ATTR_PARAMS } from './adAttributes.ts';
import type { Delegation, Group, OrganizationalUnit, OuId, User } from './domain';

const ms = (iso: string | null | undefined): number | undefined => (iso ? Date.parse(iso) : undefined);

/** The calendar date ADUC shows: local time, as the console on the DC would. */
export function localYmd(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function userView(w: World, u: AdUser): User {
  const bag = extra(w).userAttrs[u.sam] ?? {};
  const attrs: Record<string, string> = {
    ...bag,
    givenName: u.givenName,
    sn: u.surname,
    displayName: u.displayName,
    company: bag.company ?? w.company.name,
    mail: bag.mail ?? u.mail,
  };
  if (u.description) attrs.description = u.description;
  if (u.office) attrs.physicalDeliveryOfficeName = u.office;
  if (u.employeeId) attrs.employeeID = u.employeeId;
  if (u.manager) attrs.manager = u.manager;
  if (u.accountExpires) attrs.accountExpires = localYmd(u.accountExpires);
  if (u.passwordNeverExpires) attrs.PasswordNeverExpires = 'TRUE';
  return {
    id: u.sam,
    username: u.sam,
    displayName: u.displayName,
    email: u.mail,
    department: u.department,
    title: u.title,
    managerId: u.manager ?? undefined,
    status: !u.enabled ? 'disabled' : u.lockedOut ? 'locked' : 'active',
    mfa: 'none',
    groupIds: [...u.memberOf],
    lastSignInAt: ms(u.lastLogon),
    createdAt: ms(u.created) ?? Date.now(),
    mustChangePassword: u.mustChangePassword,
    ouId: u.ou === BUILTIN_OU ? undefined : u.ou,
    attrs,
  };
}

function groupView(w: World, g: AdGroup): Group {
  const members = g.name === 'Domain Users' ? w.ad.users : w.ad.users.filter((u) => u.memberOf.includes(g.name));
  return {
    id: g.name,
    name: g.name,
    description: g.description,
    memberIds: members.map((u) => u.sam),
    ouId: g.ou === BUILTIN_OU ? undefined : g.ou,
    scope: g.scope,
    category: g.category,
    attrs: { ...(extra(w).groupAttrs[g.name] ?? {}), ...(g.managedBy ? { managedBy: g.managedBy } : {}) },
  };
}

function ouView(w: World, path: string): OrganizationalUnit {
  const info = ouInfo(w, path);
  const parts = path.split('/');
  return {
    id: path,
    name: parts.at(-1)!,
    parentId: parts.length > 1 ? parts.slice(0, -1).join('/') : undefined,
    description: info.description,
    createdAt: Date.parse(info.created) || Date.now(),
    protectedFromDeletion: info.protected,
    attrs: { ...info.attrs, ...(info.protected ? { ProtectedFromAccidentalDeletion: 'TRUE' } : {}) },
  };
}

export class Dir {
  private get: () => World;
  constructor(get: () => World) {
    this.get = get;
  }
  private get w(): World {
    return this.get();
  }
  listOus(): OrganizationalUnit[] {
    return this.w.ad.ous.filter((o) => o !== BUILTIN_OU).map((o) => ouView(this.w, o));
  }
  getOu(id: OuId): OrganizationalUnit | undefined {
    return this.w.ad.ous.includes(id) && id !== BUILTIN_OU ? ouView(this.w, id) : undefined;
  }
  childOus(parentId?: OuId): OrganizationalUnit[] {
    return this.listOus().filter((o) => o.parentId === parentId);
  }
  ouPath(id: OuId): string {
    return id;
  }
  resolveOuRef(ref: string): { ou?: OrganizationalUnit; error?: string; matches?: OrganizationalUnit[] } {
    const raw = ref.trim().replace(/\\/g, '/').replace(new RegExp(`^${this.w.ad.domain}/`, 'i'), '');
    if (!raw) return { error: 'An OU name is required.' };
    try {
      const p = parseOu(this.w, raw);
      return { ou: ouView(this.w, p) };
    } catch {
      const matches = this.listOus().filter((o) => o.name.toLowerCase() === raw.toLowerCase());
      if (matches.length === 1) return { ou: matches[0] };
      if (matches.length > 1) return { error: `More than one OU is named '${raw}'. Use its path.`, matches };
      return { error: `Cannot find an OU at '${ref}'.` };
    }
  }
  listDelegations(): Delegation[] {
    return extra(this.w).delegations.map((d) => ({ ...(d.ou ? { ouId: d.ou } : {}), trustee: d.trustee, tasks: [...d.tasks], at: Date.parse(d.at) }));
  }
  listUsers(filter?: { department?: string; status?: User['status'] }): User[] {
    const all = this.w.ad.users.map((u) => userView(this.w, u));
    if (!filter) return all;
    return all.filter((u) => (!filter.department || u.department === filter.department) && (!filter.status || u.status === filter.status));
  }
  getUser(id: string): User | undefined {
    const u = findUser(this.w, id);
    return u ? userView(this.w, u) : undefined;
  }
  getUserByUsername(username: string): User | undefined {
    const u = this.w.ad.users.find((x) => x.sam.toLowerCase() === username.toLowerCase());
    return u ? userView(this.w, u) : undefined;
  }
  listGroups(): Group[] {
    return this.w.ad.groups.map((g) => groupView(this.w, g));
  }
  getGroup(id: string): Group | undefined {
    return this.getGroupByName(id);
  }
  getGroupByName(name: string): Group | undefined {
    const g = findGroup(this.w, name);
    return g ? groupView(this.w, g) : undefined;
  }
}

export interface VmServices {
  dir: Dir;
  idp: { validatePassword(p: string): { ok: boolean; reason?: string } };
  audit: unknown;
  cloud: unknown;
  pim: unknown;
  tickets: unknown;
  /** Called after every successful change, so the store saves and other windows redraw. */
  changed(): void;
  /** Subscribe to changes made anywhere (PowerShell, portals, scenarios). */
  onWorldChange(fn: () => void): () => void;
  world(): World;
}

export function validatePassword(p: string): { ok: boolean; reason?: string } {
  if (p.length < 12) return { ok: false, reason: 'Minimum password length is 12 characters.' };
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (classes < 3) return { ok: false, reason: 'The password must contain characters from three of: upper case, lower case, digits, symbols.' };
  return { ok: true };
}

const bool = (v: string | undefined): boolean => /^(\$?true|1|yes)$/i.test((v ?? '').trim());

function parsePairs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let body = raw.trim();
  const m = /^@\{([\s\S]*)\}$/.exec(body);
  if (m) body = m[1]!;
  for (const part of body.split(/[;\n]/)) {
    const t = part.trim();
    const eq = t.indexOf('=');
    if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/** LDAP attributes this range keeps on the user object itself. */
const CORE_LDAP: Record<string, 'givenName' | 'surname' | 'displayName' | 'description' | 'office' | 'title' | 'department' | 'employeeId'> = {
  givenname: 'givenName', sn: 'surname', displayname: 'displayName', description: 'description',
  physicaldeliveryofficename: 'office', title: 'title', department: 'department', employeeid: 'employeeId',
};

function updateUser(w: World, a: Record<string, string>): string {
  let id = getUser(w, a.Identity ?? '').sam;
  if (a.SamAccountName && a.SamAccountName !== id) id = renameUserSam(w, id, a.SamAccountName).sam;
  const core: Parameters<typeof setUser>[2] = {};
  const extraAttrs: Record<string, string | null> = {};
  const direct: Record<string, keyof typeof core> = { DisplayName: 'displayName', GivenName: 'givenName', Surname: 'surname', Description: 'description', Office: 'office', Title: 'title', Department: 'department', EmployeeID: 'employeeId', UserPrincipalName: 'upn' };
  for (const [k, v] of Object.entries(a)) {
    if (['Identity', 'SamAccountName', 'Replace', 'Clear', 'ChangePasswordAtLogon', 'AccountExpirationDate', 'Manager', 'EmailAddress'].includes(k)) continue;
    if (direct[k]) { (core as Record<string, string>)[direct[k]!] = v; continue; }
    if (k === 'PasswordNeverExpires') { setPasswordFlags(w, id, { neverExpires: bool(v) }); continue; }
    if (USER_ATTR_PARAMS[k]) { extraAttrs[USER_ATTR_PARAMS[k]!] = v; continue; }
    extraAttrs[k] = bool(v) ? 'TRUE' : v === 'false' ? null : v;
  }
  if (a.UserPrincipalName && !a.UserPrincipalName.includes('@')) core.upn = `${a.UserPrincipalName}@${w.ad.domain}`;
  if (a.Manager !== undefined) core.manager = a.Manager ? getUser(w, a.Manager).sam : null;
  if (a.EmailAddress !== undefined) extraAttrs.mail = a.EmailAddress || null;
  if (a.Replace) {
    for (const [k, v] of Object.entries(parsePairs(a.Replace))) {
      const c = CORE_LDAP[k.toLowerCase()];
      if (c) (core as Record<string, string>)[c] = v;
      else if (k.toLowerCase() === 'manager') core.manager = v ? getUser(w, v.replace(/^CN=([^,]+),.*$/, '$1')).sam : null;
      else if (k === 'ProtectedFromAccidentalDeletion') continue;
      else extraAttrs[k] = v;
    }
  }
  if (a.Clear) {
    for (const k of a.Clear.split(',').map((x) => x.trim()).filter(Boolean)) {
      const c = CORE_LDAP[k.toLowerCase()];
      if (k.toLowerCase() === 'manager') core.manager = null;
      else if (c) (core as Record<string, string>)[c] = '';
      else extraAttrs[k] = null;
    }
  }
  setUser(w, id, core);
  if (Object.keys(extraAttrs).length) setUserExtraAttrs(w, id, extraAttrs);
  if (a.ChangePasswordAtLogon !== undefined) setPasswordFlags(w, id, { mustChange: bool(a.ChangePasswordAtLogon) });
  if (a.AccountExpirationDate !== undefined) setExpiration(w, id, a.AccountExpirationDate ? new Date(`${a.AccountExpirationDate.slice(0, 10)}T23:59:59`).toISOString() : null);
  return `Updated ${id}`;
}

/** Perform one console capability. Throws AdError with the text the snap-in shows. */
export function runCapability(w: World, capId: string, a: Record<string, string>): string {
  const ou = (ref: string | undefined): string | null => (ref ? parseOu(w, ref.replace(/\\/g, '/').replace(new RegExp(`^${w.ad.domain}/`, 'i'), '')) : null);
  switch (capId) {
    case 'user.create': {
      const [first, ...rest] = (a.Name ?? '').trim().split(/\s+/);
      createUser(w, {
        sam: a.SamAccountName ?? '', givenName: a.GivenName ?? first ?? '', surname: a.Surname ?? rest.join(' '), displayName: a.Name,
        ou: ou(a.Path) ?? BUILTIN_OU, department: a.Department, title: a.Title,
        enabled: false, passwordSet: !!a.AccountPassword, mustChangePassword: a.ChangePasswordAtLogon === undefined ? true : bool(a.ChangePasswordAtLogon),
      });
      // The New Object - User wizard enables the account unless "Account is disabled" was ticked.
      if (a.AccountPassword) setEnabled(w, a.SamAccountName!, true);
      return `Created ${a.SamAccountName}`;
    }
    case 'user.update': return updateUser(w, a);
    case 'user.disable': setEnabled(w, a.Identity!, false); return 'Disabled';
    case 'user.enable': setEnabled(w, a.Identity!, true); return 'Enabled';
    case 'user.delete': deleteUser(w, a.Identity!); return 'Deleted';
    case 'user.move': {
      const target = a.TargetPath ? ou(a.TargetPath) : null;
      if (target) moveUser(w, a.Identity!, target);
      else if (a.TargetPath !== undefined && !a.TargetDepartment) moveUser(w, a.Identity!, BUILTIN_OU);
      if (a.TargetDepartment) setUser(w, a.Identity!, { department: a.TargetDepartment });
      return 'Moved';
    }
    case 'account.unlock': unlock(w, a.Identity!); return 'Unlocked';
    case 'password.reset': {
      const v = validatePassword(a.NewPassword ?? '');
      if (!v.ok) throw new AdError(`The password does not meet the length, complexity, or history requirement of the domain. ${v.reason}`);
      resetPassword(w, a.Identity!, { mustChange: a.ChangePasswordAtLogon === undefined ? true : bool(a.ChangePasswordAtLogon) });
      return 'Password reset';
    }
    case 'group.addMember': addMember(w, a.Group!, a.Identity!); return 'Added';
    case 'group.removeMember': removeMember(w, a.Group!, a.Identity!); return 'Removed';
    case 'group.create': {
      const g = createGroup(w, a.Name!.trim(), ou(a.Path) ?? BUILTIN_OU, a.Description ?? '');
      setGroupProps(w, g.name, { scope: (a.GroupScope as AdGroup['scope']) || 'Global', category: (a.GroupCategory as AdGroup['category']) || 'Security' });
      return `Created ${g.name}`;
    }
    case 'group.update': {
      const name = findGroup(w, a.Identity!)?.name ?? a.Identity!;
      setGroupProps(w, name, { description: a.Description, scope: a.GroupScope as AdGroup['scope'] | undefined, category: a.GroupCategory as AdGroup['category'] | undefined });
      if (a.ManagedBy !== undefined) setGroupOwner(w, name, a.ManagedBy || null);
      const bag = (extra(w).groupAttrs[name] ??= {});
      if (a.Replace) for (const [k, v] of Object.entries(parsePairs(a.Replace))) { if (k.toLowerCase() === 'managedby') setGroupOwner(w, name, v || null); else bag[k] = v; }
      if (a.Clear) for (const k of a.Clear.split(',').map((x) => x.trim())) { if (k.toLowerCase() === 'managedby') setGroupOwner(w, name, null); else delete bag[k]; }
      return 'Updated';
    }
    case 'group.delete': deleteGroup(w, a.Name ?? a.Identity!); return 'Deleted';
    case 'ou.create': {
      createOu(w, a.Name!, ou(a.Path), { description: a.Description, protected: a.ProtectedFromAccidentalDeletion === undefined ? true : bool(a.ProtectedFromAccidentalDeletion) });
      return 'Created';
    }
    case 'ou.update': {
      const p = ou(a.Identity)!;
      const info = ouInfo(w, p);
      if (a.Description !== undefined) info.description = a.Description;
      if (a.ProtectedFromAccidentalDeletion !== undefined) info.protected = bool(a.ProtectedFromAccidentalDeletion);
      for (const k of ['StreetAddress', 'City', 'State', 'PostalCode', 'Country', 'ManagedBy']) if (a[k] !== undefined) info.attrs[k] = a[k]!;
      if (a.Clear) for (const k of a.Clear.split(',').map((x) => x.trim())) { if (/protected/i.test(k)) info.protected = false; else delete info.attrs[k]; }
      return 'Updated';
    }
    case 'ou.delete': deleteOu(w, a.Name!); return 'Deleted';
    case 'ou.delegate': {
      const tasks = (a.Tasks ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean);
      delegateWorld(w, a.Path ? ou(a.Path) : null, a.Trustee!, tasks);
      return 'Delegated';
    }
    case 'object.rename': {
      const id = a.Identity!.replace(/^(user|group|ou):/, '');
      if (findUser(w, id)) { setUser(w, id, { displayName: a.NewName! }); return 'Renamed'; }
      if (findGroup(w, id)) { renameGroup(w, id, a.NewName!); return 'Renamed'; }
      renameOu(w, ou(id)!, a.NewName!);
      return 'Renamed';
    }
    default:
      throw new AdError(`The operation ${capId} is not available on this domain controller.`);
  }
}
