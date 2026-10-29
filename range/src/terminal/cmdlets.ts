/**
 * terminal/cmdlets.ts — the cmdlets the range understands.
 *
 * Active Directory cmdlets call the same functions ADUC does, so the console
 * and the GUI can never disagree. Output objects use the property names the
 * real module returns, so scripts written here work on a real DC too.
 */
import type { AdComputer, AdGroup, AdUser, World } from '../core/types.ts';
import { nowMs } from '../core/time.ts';
import { AD_EVENT_NAMES } from '../world/audit.ts';
import {
  addMember, createGroup, createUser, deleteUser, dnOf, getGroup, getUser, groupDn, membersOf, moveUser,
  ouToDn, parseOu, principalGroups, removeMember, resetPassword, setEnabled, setExpiration, setGroupOwner,
  setPasswordFlags, setUser, unlock, type UserAttr, dcHostOf, domainDn } from '../world/directory.ts';
import { portalAdminUpn } from '../world/azure.ts';
import { revokeSessionsAs } from '../world/entraAdmin.ts';
import { asGraph } from './graphAuth.ts';
import { getEntraUser, objectIdFor, revokeSessions, runEntraSync } from '../world/cloud.ts';
import { EXTRA_CMDLETS } from './cmdlets2.ts';
import { iamCmdlets } from './cmdlets-iam.ts';
import { GUI_PROGRAMS, HELP, paramType } from './helpdocs.ts';
import { readFile, writeFile } from '../world/docs.ts';
import {
  type CmdletCtx, type CmdletDef, Formatted, MissingParamError, PsError, ScriptBlock, SecureStringValue, cell, commandNotFound, formatDate, formatObjects,
  getProp, refOf, toStr, truthy, withRef,
} from './shell.ts';


function sidOf(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return `S-1-5-21-3623811015-3361044348-30300820-${1100 + (h % 8000)}`;
}

function guidOf(seed: string): string {
  let a = 0x12345, b = 0x6789;
  for (const ch of seed) { a = Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0; b = Math.imul(b ^ ch.charCodeAt(0), 1597334677) >>> 0; }
  const hx = (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0') + ((a ^ b) >>> 0).toString(16).padStart(8, '0') + (Math.imul(a, 7) >>> 0).toString(16).padStart(8, '0')).slice(0, 32);
  return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20, 32)}`;
}

const toDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

export function userObject(w: World, u: AdUser, props: string[] | '*' = []): Record<string, unknown> {
  const full: Record<string, unknown> = {
    AccountExpirationDate: toDate(u.accountExpires),
    BadLogonCount: u.badPwdCount,
    Created: toDate(u.created),
    Department: u.department || null,
    Description: u.description || null,
    DisplayName: u.displayName,
    DistinguishedName: dnOf(u, w),
    EmailAddress: u.mail,
    EmployeeID: u.employeeId || null,
    Enabled: u.enabled,
    GivenName: u.givenName,
    LastLogonDate: toDate(u.lastLogon),
    LockedOut: u.lockedOut,
    Manager: u.manager ? dnOf(getUser(w, u.manager), w) : null,
    MemberOf: u.memberOf.map((g) => groupDn(getGroup(w, g), w)),
    Name: u.displayName,
    ObjectClass: 'user',
    ObjectGUID: guidOf(u.sam),
    Office: u.office || null,
    PasswordLastSet: toDate(u.pwdLastSet),
    PasswordNeverExpires: u.passwordNeverExpires,
    SamAccountName: u.sam,
    SID: sidOf(u.sam),
    Surname: u.surname || null,
    Title: u.title || null,
    UserPrincipalName: u.upn,
    whenChanged: toDate(u.whenChanged),
  };
  const base = ['DistinguishedName', 'Enabled', 'GivenName', 'Name', 'ObjectClass', 'ObjectGUID', 'SamAccountName', 'SID', 'Surname', 'UserPrincipalName'];
  const want = props === '*' ? Object.keys(full) : [...base, ...props.map((p) => Object.keys(full).find((k) => k.toLowerCase() === p.toLowerCase()) ?? p)];
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(full).sort()) if (want.includes(k)) o[k] = full[k];
  return withRef(o, { type: 'user', key: u.sam });
}

function groupObject(w: World, g: AdGroup, props: string[] | '*' = []): Record<string, unknown> {
  const full: Record<string, unknown> = {
    Description: g.description,
    DistinguishedName: groupDn(g, w),
    GroupCategory: g.category,
    GroupScope: g.scope,
    ManagedBy: g.managedBy ? dnOf(getUser(w, g.managedBy), w) : null,
    Members: membersOf(w, g.name).map((m) => dnOf(m, w)),
    Name: g.name,
    ObjectClass: 'group',
    ObjectGUID: guidOf(`g:${g.name}`),
    SamAccountName: g.name,
    SID: sidOf(`g:${g.name}`),
  };
  const base = ['DistinguishedName', 'GroupCategory', 'GroupScope', 'Name', 'ObjectClass', 'ObjectGUID', 'SamAccountName', 'SID'];
  const want = props === '*' ? Object.keys(full) : [...base, ...props.map((p) => Object.keys(full).find((k) => k.toLowerCase() === p.toLowerCase()) ?? p)];
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(full)) if (want.includes(k)) o[k] = full[k];
  return withRef(o, { type: 'group', key: g.name });
}

function computerObject(c: AdComputer, w?: World): Record<string, unknown> {
  return withRef({
    DistinguishedName: `CN=${c.name},${ouToDn(c.ou, w)}`,
    DNSHostName: `${c.name.toLowerCase()}.${w?.ad.domain ?? 'meridianhealth.test'}`,
    Enabled: c.enabled,
    IPv4Address: c.ip,
    LastLogonDate: new Date(c.lastLogon),
    Name: c.name,
    OperatingSystem: c.os,
    SamAccountName: `${c.name}$`,
  }, { type: 'computer', key: c.name });
}

function props(c: CmdletCtx): string[] | '*' {
  const p = c.named.Properties;
  if (p === undefined) return [];
  if (p === '*' || (Array.isArray(p) && p.includes('*'))) return '*';
  return (Array.isArray(p) ? p : toStr(p).split(',')).map((x) => toStr(x).trim()).filter(Boolean);
}

function idList(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap((x) => {
    const r = refOf(x);
    if (r) return [r.key];
    const s = toStr(x);
    return s.split(',').map((t) => t.trim()).filter(Boolean);
  });
}

function identity(c: CmdletCtx, param = 'Identity'): string {
  const v = c.named[param];
  if (v === undefined || v === null || v === '') throw new MissingParamError(param);
  const r = refOf(v);
  if (r) return r.key;
  const s = toStr(v);
  // A DN or path works as an identity too.
  return s;
}

function searchBaseFilter(c: CmdletCtx): (ou: string) => boolean {
  if (c.named.SearchBase === undefined) return () => true;
  const base = parseOu(c.w, toStr(c.named.SearchBase));
  const one = /onelevel|base/i.test(toStr(c.named.SearchScope ?? ''));
  return (ou) => ou === base || (!one && ou.startsWith(`${base}/`));
}

function whatIf(c: CmdletCtx, op: string, target: string): boolean {
  if (!c.whatIf) return false;
  c.shell.host(`What if: Performing the operation "${op}" on target "${target}".`);
  return true;
}

function parseTimeSpanDays(v: unknown): number {
  if (v === undefined || v === null) return 15;
  if (typeof v === 'number') return v;
  const o = v as { Days?: number; TotalDays?: number };
  if (typeof o === 'object' && typeof o.TotalDays === 'number') return o.TotalDays;
  const s = toStr(v);
  const m = /^(\d+)(?:\.(\d{1,2}):(\d{2}):(\d{2}))?$/.exec(s);
  if (!m) throw new PsError(`Cannot convert "${s}" to "System.TimeSpan". Use the d.hh:mm:ss format, e.g. 90.00:00:00.`);
  return Number(m[1]) + (Number(m[2] ?? 0) / 24);
}

function asDate(v: unknown): Date {
  const d = v instanceof Date ? v : new Date(toStr(v));
  if (Number.isNaN(d.getTime())) throw new PsError(`Cannot convert value "${toStr(v)}" to type "System.DateTime".`);
  return d;
}

function eventObject(w: World, id: number): Record<string, unknown> | null {
  const e = w.audit.find((x) => x.id === id);
  if (!e) return null;
  const msg = `${AD_EVENT_NAMES[e.eventId ?? 0] ?? e.action}.\n\nSubject:\n  Account Name: ${e.actor}\n  Account Domain: MERIDIAN\n\nTarget Account:\n  Account Name: ${e.target}\n\nAdditional Information:\n  ${e.eventId === 4740 ? e.detail : `Workstation / Client: ${e.origin}`}${e.detail && e.eventId !== 4740 ? `\n  Detail: ${e.detail}` : ''}`;
  return withRef({ TimeCreated: new Date(e.time), Id: e.eventId ?? 0, LevelDisplayName: e.eventId === 4625 || e.eventId === 4771 ? 'Information' : 'Information', Message: msg }, { type: 'event', key: String(e.id) });
}

function selectProps(objs: unknown[], spec: unknown, c: CmdletCtx): Record<string, unknown>[] {
  const list = (Array.isArray(spec) ? spec : [spec]).filter((x) => x !== undefined && x !== null);
  return objs.map((o) => {
    const out: Record<string, unknown> = {};
    for (const p of list) {
      if (p && typeof p === 'object' && !(p instanceof ScriptBlock) && !refOf(p)) {
        const h = p as Record<string, unknown>;
        const name = toStr(h.Name ?? h.n ?? h.Label ?? h.l);
        const ex = h.Expression ?? h.e;
        out[name] = ex instanceof ScriptBlock ? (c.shell.each(ex, o)[0] ?? null) : getProp(o, toStr(ex));
        continue;
      }
      const name = toStr(p);
      if (name === '*') { Object.assign(out, o as object); continue; }
      const key = o && typeof o === 'object' ? Object.keys(o as object).find((k) => k.toLowerCase() === name.toLowerCase()) : undefined;
      out[key ?? name] = getProp(o, name);
    }
    const r = refOf(o);
    return r ? withRef(out, r) : out;
  });
}

function csvLine(vals: string[]): string {
  return vals.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some((x) => x !== '')) rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

function requireGraph(c: CmdletCtx): void {
  if (!c.shell.graphConnected) throw new PsError('Authentication needed. Please call Connect-MgGraph.', 'AuthenticationError', { exception: 'AuthenticationException' });
}

const USER_PARAMS: Record<string, UserAttr | 'manager'> = {
  Title: 'title', Department: 'department', Description: 'description', Office: 'office', EmployeeID: 'employeeId',
  GivenName: 'givenName', Surname: 'surname', DisplayName: 'displayName', UserPrincipalName: 'upn', Manager: 'manager',
};

export const CMDLETS: CmdletDef[] = [
  // ------------------------------------------------------------------ AD read
  {
    name: 'Get-ADUser', module: 'ActiveDirectory', params: ['Identity', 'Filter', 'SearchBase', 'SearchScope', 'Properties', 'LDAPFilter', 'ResultSetSize'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Gets one or more Active Directory users.', example: "Get-ADUser -Filter \"Department -eq 'Finance'\" -Properties Title,Manager",
    run(c) {
      const p = props(c);
      if (c.named.Identity !== undefined) return userObject(c.w, getUser(c.w, identity(c)), p);
      if (c.named.Filter === undefined) throw new MissingParamError('Filter');
      const inBase = searchBaseFilter(c);
      return c.w.ad.users.filter((u) => inBase(u.ou)).map((u) => userObject(c.w, u, '*')).filter((o) => c.shell.matches(c.named.Filter, o)).map((o) => userObject(c.w, getUser(c.w, refOf(o)!.key), p));
    },
  },
  {
    name: 'Get-ADGroup', module: 'ActiveDirectory', params: ['Identity', 'Filter', 'SearchBase', 'Properties'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Gets one or more Active Directory groups.', example: 'Get-ADGroup -Identity grp-finance-analysts -Properties ManagedBy,Members',
    run(c) {
      const p = props(c);
      if (c.named.Identity !== undefined) return groupObject(c.w, getGroup(c.w, identity(c)), p);
      if (c.named.Filter === undefined) throw new MissingParamError('Filter');
      return c.w.ad.groups.map((g) => groupObject(c.w, g, '*')).filter((o) => c.shell.matches(c.named.Filter, o)).map((o) => groupObject(c.w, getGroup(c.w, refOf(o)!.key), p));
    },
  },
  {
    name: 'Get-ADGroupMember', module: 'ActiveDirectory', params: ['Identity'], switches: ['Recursive'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Gets the members of an Active Directory group.', example: 'Get-ADGroupMember -Identity "Domain Admins"',
    run(c) {
      const g = getGroup(c.w, identity(c));
      return membersOf(c.w, g.name).map((u) => withRef({ distinguishedName: dnOf(u, c.w), name: u.displayName, objectClass: 'user', SamAccountName: u.sam }, { type: 'user', key: u.sam }));
    },
  },
  {
    name: 'Get-ADPrincipalGroupMembership', module: 'ActiveDirectory', params: ['Identity'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Gets the groups a user is a member of, including Domain Users.', example: 'Get-ADPrincipalGroupMembership -Identity vhale | Select-Object Name',
    run(c) {
      const u = getUser(c.w, identity(c));
      return principalGroups(u).map((n) => { const g = getGroup(c.w, n); return withRef({ distinguishedName: groupDn(g, c.w), GroupCategory: g.category, GroupScope: g.scope, name: g.name, objectClass: 'group', SamAccountName: g.name }, { type: 'group', key: g.name }); });
    },
  },
  {
    name: 'Get-ADOrganizationalUnit', module: 'ActiveDirectory', params: ['Identity', 'Filter', 'SearchBase'], positional: ['Identity'],
    synopsis: 'Gets organizational units.', example: 'Get-ADOrganizationalUnit -Filter * | Select-Object Name,DistinguishedName',
    run(c) {
      const list = c.w.ad.ous.filter((o) => o !== 'Users').map((o) => withRef({ DistinguishedName: ouToDn(o, c.w), Name: o.split('/').pop()!, ObjectClass: 'organizationalUnit' }, { type: 'ou', key: o }));
      if (c.named.Identity !== undefined) { const ou = parseOu(c.w, identity(c)); return list.find((x) => refOf(x)!.key === ou); }
      return list.filter((o) => c.shell.matches(c.named.Filter ?? '*', o));
    },
  },
  {
    name: 'Get-ADComputer', module: 'ActiveDirectory', params: ['Identity', 'Filter', 'Properties', 'SearchBase'], positional: ['Identity'],
    synopsis: 'Gets computer accounts.', example: "Get-ADComputer -Filter \"Enabled -eq 'False'\"",
    run(c) {
      if (c.named.Identity !== undefined) {
        const id = identity(c).replace(/\$$/, '').toLowerCase();
        const comp = c.w.ad.computers.find((x) => x.name.toLowerCase() === id);
        if (!comp) throw new PsError(`Cannot find an object with identity: '${identity(c)}' under: '${domainDn(c.w)}'.`, 'ObjectNotFound');
        return computerObject(comp, c.w);
      }
      return c.w.ad.computers.map((m) => computerObject(m, c.w)).filter((o) => c.shell.matches(c.named.Filter ?? '*', o));
    },
  },
  {
    name: 'Get-ADDomain', module: 'ActiveDirectory', params: ['Identity'],
    synopsis: 'Gets the domain.', run: (c) => ({ DistinguishedName: domainDn(c.w), DNSRoot: c.w.ad.domain, NetBIOSName: c.w.ad.netbios, DomainMode: 'Windows2016Domain', PDCEmulator: `${dcHostOf(c.w)}.${c.w.ad.domain}`, UsersContainer: `CN=Users,${domainDn(c.w)}` }),
  },
  {
    name: 'Search-ADAccount', module: 'ActiveDirectory', params: ['TimeSpan', 'SearchBase', 'DateTime'], switches: ['LockedOut', 'AccountDisabled', 'AccountInactive', 'AccountExpired', 'AccountExpiring', 'PasswordNeverExpires', 'PasswordExpired', 'UsersOnly', 'ComputersOnly'],
    synopsis: 'Finds locked, disabled, inactive or expired accounts.', example: 'Search-ADAccount -AccountInactive -TimeSpan 90.00:00:00 -UsersOnly',
    run(c) {
      const inBase = searchBaseFilter(c);
      const now = nowMs();
      let users = c.w.ad.users.filter((u) => inBase(u.ou));
      if (c.has('LockedOut')) users = users.filter((u) => u.lockedOut);
      if (c.has('AccountDisabled')) users = users.filter((u) => !u.enabled);
      if (c.has('PasswordNeverExpires')) users = users.filter((u) => u.passwordNeverExpires);
      if (c.has('AccountExpired')) users = users.filter((u) => u.accountExpires && Date.parse(u.accountExpires) <= now);
      if (c.has('AccountInactive')) {
        const days = parseTimeSpanDays(c.named.TimeSpan);
        users = users.filter((u) => !u.lastLogon || now - Date.parse(u.lastLogon) > days * 86_400_000);
      }
      if (!['LockedOut', 'AccountDisabled', 'PasswordNeverExpires', 'AccountExpired', 'AccountInactive', 'AccountExpiring', 'PasswordExpired'].some((s) => c.has(s))) {
        throw new PsError('Parameter set cannot be resolved using the specified named parameters. Use one of -LockedOut, -AccountDisabled, -AccountInactive, -AccountExpired, -PasswordNeverExpires.');
      }
      if (c.has('ComputersOnly')) return [];
      return users.map((u) => withRef({ AccountExpirationDate: toDate(u.accountExpires), DistinguishedName: dnOf(u, c.w), Enabled: u.enabled, LastLogonDate: toDate(u.lastLogon), LockedOut: u.lockedOut, Name: u.displayName, ObjectClass: 'user', PasswordNeverExpires: u.passwordNeverExpires, SamAccountName: u.sam, UserPrincipalName: u.upn }, { type: 'user', key: u.sam }));
    },
  },
  // ------------------------------------------------------------------ AD write
  {
    name: 'New-ADUser', module: 'ActiveDirectory', mutates: true, positional: ['Name'],
    params: ['Name', 'GivenName', 'Surname', 'SamAccountName', 'UserPrincipalName', 'Path', 'Department', 'Title', 'Manager', 'EmployeeID', 'Office', 'Description', 'DisplayName', 'AccountPassword', 'Enabled', 'ChangePasswordAtLogon', 'EmailAddress', 'Company'],
    synopsis: 'Creates a user.', example: "New-ADUser -Name 'Maya Okafor' -GivenName Maya -Surname Okafor -SamAccountName mokafor -Path 'OU=Finance,OU=Users,OU=Corp,DC=meridianhealth,DC=test' -Enabled $false",
    run(c) {
      const name = c.str('Name', true);
      const sam = c.str('SamAccountName') || name;
      const path = c.named.Path === undefined ? `CN=Users,${domainDn(c.w)}` : c.str('Path');
      if (whatIf(c, 'New', `CN=${name},${path}`)) return;
      const enabled = c.named.Enabled !== undefined && truthy(c.named.Enabled);
      const u = createUser(c.w, {
        sam, givenName: c.str('GivenName'), surname: c.str('Surname'), displayName: c.str('DisplayName') || name, upn: c.str('UserPrincipalName') || undefined, ou: path,
        department: c.str('Department'), title: c.str('Title'), manager: c.str('Manager') || null, employeeId: c.str('EmployeeID'), office: c.str('Office'),
        description: c.str('Description'), enabled, passwordSet: c.named.AccountPassword instanceof SecureStringValue, password: c.named.AccountPassword instanceof SecureStringValue ? c.named.AccountPassword.plain ?? undefined : undefined,
        mustChangePassword: c.named.ChangePasswordAtLogon === undefined ? true : truthy(c.named.ChangePasswordAtLogon),
      });
      if (c.has('PassThru')) return userObject(c.w, u);
    },
  },
  {
    name: 'Set-ADUser', module: 'ActiveDirectory', mutates: true, positional: ['Identity'], pipe: 'each', pipeParam: 'Identity',
    params: ['Identity', ...Object.keys(USER_PARAMS), 'Enabled', 'ChangePasswordAtLogon', 'PasswordNeverExpires', 'Replace', 'Clear', 'EmailAddress'],
    synopsis: 'Modifies user attributes.', example: "Set-ADUser -Identity vhale -Title 'Financial Controller' -Manager hkovacs",
    run(c) {
      const id = identity(c);
      const u = getUser(c.w, id);
      if (whatIf(c, 'Set', dnOf(u, c.w))) return;
      const changes: Partial<Record<UserAttr, string>> & { manager?: string | null } = {};
      for (const [param, attr] of Object.entries(USER_PARAMS)) {
        if (c.named[param] === undefined) continue;
        if (attr === 'manager') changes.manager = c.named[param] === null ? null : c.str(param);
        else changes[attr] = c.str(param);
      }
      if (c.named.Replace && typeof c.named.Replace === 'object') {
        for (const [k, v] of Object.entries(c.named.Replace as Record<string, unknown>)) {
          const map: Record<string, UserAttr> = { title: 'title', department: 'department', description: 'description', employeeid: 'employeeId', physicaldeliveryofficename: 'office', displayname: 'displayName' };
          const attr = map[k.toLowerCase()];
          if (!attr) throw new PsError(`The attribute '${k}' is not supported by -Replace in this range. Use the named parameter instead.`);
          changes[attr] = toStr(v);
        }
      }
      if (c.named.Clear !== undefined) {
        for (const k of idList(c.named.Clear)) {
          const map: Record<string, UserAttr | 'manager'> = { description: 'description', title: 'title', department: 'department', manager: 'manager', physicaldeliveryofficename: 'office' };
          const attr = map[k.toLowerCase()];
          if (!attr) throw new PsError(`The attribute '${k}' cannot be cleared here.`);
          if (attr === 'manager') changes.manager = null;
          else changes[attr] = '';
        }
      }
      setUser(c.w, u.sam, changes);
      if (c.named.Enabled !== undefined) setEnabled(c.w, u.sam, truthy(c.named.Enabled));
      if (c.named.ChangePasswordAtLogon !== undefined || c.named.PasswordNeverExpires !== undefined) {
        setPasswordFlags(c.w, u.sam, { mustChange: c.named.ChangePasswordAtLogon === undefined ? undefined : truthy(c.named.ChangePasswordAtLogon), neverExpires: c.named.PasswordNeverExpires === undefined ? undefined : truthy(c.named.PasswordNeverExpires) });
      }
      if (c.has('PassThru')) return userObject(c.w, u);
    },
  },
  ...(['Enable', 'Disable', 'Unlock'] as const).map((verb): CmdletDef => ({
    name: `${verb}-ADAccount`, module: 'ActiveDirectory', mutates: true, params: ['Identity'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity',
    synopsis: `${verb}s an Active Directory account.`, example: `${verb}-ADAccount -Identity vhale`,
    run(c) {
      const u = getUser(c.w, identity(c));
      if (whatIf(c, verb === 'Unlock' ? 'Set' : verb, dnOf(u, c.w))) return;
      if (verb === 'Unlock') unlock(c.w, u.sam);
      else setEnabled(c.w, u.sam, verb === 'Enable');
      if (c.has('PassThru')) return userObject(c.w, u);
    },
  })),
  {
    name: 'Set-ADAccountPassword', module: 'ActiveDirectory', mutates: true, params: ['Identity', 'NewPassword', 'OldPassword'], switches: ['Reset'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Resets a password. Pair it with Set-ADUser -ChangePasswordAtLogon $true.', example: "Set-ADAccountPassword -Identity vhale -Reset -NewPassword (Read-Host -AsSecureString 'New password')",
    run(c) {
      const u = getUser(c.w, identity(c));
      if (!c.has('Reset')) throw new PsError('The old password is required unless -Reset is used. Administrators reset with -Reset.');
      if (!(c.named.NewPassword instanceof SecureStringValue)) throw new PsError('Cannot bind parameter \'NewPassword\'. Cannot convert the value to type "System.Security.SecureString". Use (Read-Host -AsSecureString) or ConvertTo-SecureString.');
      if (whatIf(c, 'Set-ADAccountPassword', dnOf(u, c.w))) return;
      resetPassword(c.w, u.sam, { mustChange: u.mustChangePassword, password: (c.named.NewPassword as SecureStringValue).plain });
      c.shell.warn('Password reset. Remember: Set-ADUser -ChangePasswordAtLogon $true so IAM never knows the user\'s working password.');
    },
  },
  {
    name: 'Set-ADAccountExpiration', module: 'ActiveDirectory', mutates: true, params: ['Identity', 'DateTime', 'TimeSpan'], positional: ['Identity', 'DateTime'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Sets when an account expires.', example: "Set-ADAccountExpiration -Identity rdoyle -DateTime '2026-12-31'",
    run(c) {
      const u = getUser(c.w, identity(c));
      const when = c.named.DateTime !== undefined ? asDate(c.named.DateTime) : new Date(nowMs() + parseTimeSpanDays(c.named.TimeSpan) * 86_400_000);
      if (whatIf(c, 'Set', dnOf(u, c.w))) return;
      setExpiration(c.w, u.sam, when.toISOString());
    },
  },
  {
    name: 'Clear-ADAccountExpiration', module: 'ActiveDirectory', mutates: true, params: ['Identity'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Removes an account expiration date.', run(c) { const u = getUser(c.w, identity(c)); if (!whatIf(c, 'Set', dnOf(u, c.w))) setExpiration(c.w, u.sam, null); },
  },
  {
    name: 'Move-ADObject', module: 'ActiveDirectory', mutates: true, params: ['Identity', 'TargetPath'], positional: ['Identity', 'TargetPath'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Moves an object to another OU.', example: "Move-ADObject -Identity (Get-ADUser vhale).DistinguishedName -TargetPath 'OU=Disabled Users,OU=Corp,DC=meridianhealth,DC=test'",
    run(c) {
      const u = getUser(c.w, identity(c));
      const target = c.str('TargetPath', true);
      if (whatIf(c, 'Move', dnOf(u, c.w))) return;
      moveUser(c.w, u.sam, target);
    },
  },
  {
    name: 'Remove-ADUser', module: 'ActiveDirectory', mutates: true, params: ['Identity'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Deletes a user. Leavers are disabled, not deleted, for 30 days.',
    run(c) {
      const u = getUser(c.w, identity(c));
      if (whatIf(c, 'Remove', dnOf(u, c.w))) return;
      deleteUser(c.w, u.sam);
      c.shell.warn('Object deleted. The JML SOP keeps leavers for 30 days; deletion destroys audit evidence.');
    },
  },
  {
    name: 'Add-ADGroupMember', module: 'ActiveDirectory', mutates: true, params: ['Identity', 'Members'], positional: ['Identity', 'Members'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Adds members to a group.', example: 'Add-ADGroupMember -Identity app-imagevault -Members mokafor',
    run(c) {
      const g = getGroup(c.w, identity(c));
      const members = idList(c.named.Members);
      if (!members.length) throw new MissingParamError('Members');
      if (whatIf(c, 'Set', groupDn(g, c.w))) return;
      for (const m of members) addMember(c.w, g.name, m);
    },
  },
  {
    name: 'Remove-ADGroupMember', module: 'ActiveDirectory', mutates: true, params: ['Identity', 'Members'], positional: ['Identity', 'Members'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Removes members from a group.', example: 'Remove-ADGroupMember -Identity grp-sec-ops -Members vhale -Confirm:$false',
    run(c) {
      const g = getGroup(c.w, identity(c));
      const members = idList(c.named.Members);
      if (!members.length) throw new MissingParamError('Members');
      if (whatIf(c, 'Set', groupDn(g, c.w))) return;
      for (const m of members) removeMember(c.w, g.name, m);
    },
  },
  {
    name: 'Add-ADPrincipalGroupMembership', module: 'ActiveDirectory', mutates: true, params: ['Identity', 'MemberOf'], positional: ['Identity', 'MemberOf'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Adds a user to several groups.', example: 'Add-ADPrincipalGroupMembership -Identity mokafor -MemberOf grp-all-staff,app-expenseflow',
    run(c) {
      const u = getUser(c.w, identity(c));
      if (whatIf(c, 'Set', dnOf(u, c.w))) return;
      for (const g of idList(c.named.MemberOf)) addMember(c.w, g, u.sam);
    },
  },
  {
    name: 'Remove-ADPrincipalGroupMembership', module: 'ActiveDirectory', mutates: true, params: ['Identity', 'MemberOf'], positional: ['Identity', 'MemberOf'], pipe: 'each', pipeParam: 'Identity',
    synopsis: 'Removes a user from several groups.', example: 'Remove-ADPrincipalGroupMembership -Identity mokafor -MemberOf grp-sec-ops -Confirm:$false',
    run(c) {
      const u = getUser(c.w, identity(c));
      if (whatIf(c, 'Set', dnOf(u, c.w))) return;
      for (const g of idList(c.named.MemberOf)) removeMember(c.w, g, u.sam);
    },
  },
  {
    name: 'New-ADGroup', module: 'ActiveDirectory', mutates: true, params: ['Name', 'Path', 'GroupScope', 'GroupCategory', 'Description'], positional: ['Name'],
    synopsis: 'Creates a group.', run(c) { const n = c.str('Name', true); if (!whatIf(c, 'New', n)) createGroup(c.w, n, c.named.Path === undefined ? 'Corp/Groups' : c.str('Path'), c.str('Description')); },
  },
  {
    name: 'Set-ADGroup', module: 'ActiveDirectory', mutates: true, params: ['Identity', 'ManagedBy', 'Description'], positional: ['Identity'],
    synopsis: 'Sets a group owner (ManagedBy).', example: 'Set-ADGroup -Identity app-carechart -ManagedBy ichandra',
    run(c) {
      const g = getGroup(c.w, identity(c));
      if (whatIf(c, 'Set', groupDn(g, c.w))) return;
      if (c.named.ManagedBy !== undefined) setGroupOwner(c.w, g.name, c.named.ManagedBy === null ? null : c.str('ManagedBy'));
      if (c.named.Description !== undefined) g.description = c.str('Description');
    },
  },
  // ------------------------------------------------------------------ events
  {
    name: 'Get-WinEvent', module: 'Core', params: ['FilterHashtable', 'LogName', 'MaxEvents', 'ComputerName'],
    synopsis: 'Reads the domain controller Security log.', example: "Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4740} -MaxEvents 20",
    run(c) {
      const fh = (c.named.FilterHashtable ?? {}) as Record<string, unknown>;
      const log = toStr(getProp(fh, 'LogName') ?? c.named.LogName ?? '');
      if (!/security/i.test(log)) throw new PsError("Only the Security log is collected in this range. Use -FilterHashtable @{LogName='Security'; Id=4740}.");
      const ids = getProp(fh, 'Id');
      const want = ids === null ? null : (Array.isArray(ids) ? ids : [ids]).map(Number);
      const start = getProp(fh, 'StartTime');
      const max = c.named.MaxEvents === undefined ? 200 : Number(c.named.MaxEvents);
      const events = c.w.audit.filter((e) => e.source === 'AD' && e.eventId && (!want || want.includes(e.eventId)) && (!start || Date.parse(e.time) >= asDate(start).getTime()))
        .sort((a, b) => b.time.localeCompare(a.time) || b.id - a.id).slice(0, max).map((e) => eventObject(c.w, e.id)!);
      if (!events.length) throw new PsError('No events were found that match the specified selection criteria.', 'ObjectNotFound');
      return events;
    },
  },
  // ------------------------------------------------------------------ sync and Graph
  {
    name: 'Start-ADSyncSyncCycle', module: 'ADSync', params: ['PolicyType'], positional: ['PolicyType'],
    synopsis: 'Runs an Entra Connect sync cycle (normally on MHS-SYNC01).', example: 'Start-ADSyncSyncCycle -PolicyType Delta',
    run(c) {
      const type = c.str('PolicyType');
      if (!/^(delta|initial)$/i.test(type)) throw new PsError('Cannot validate argument on parameter \'PolicyType\'. Specify Delta or Initial.', 'InvalidArgument');
      const r = runEntraSync(c.w);
      c.shell.host(`Sync cycle complete: ${r.created} added, ${r.updated} updated, ${r.deleted} deleted, ${r.errors} export error(s).`, r.errors ? 'yellow' : 'green');
      return { Result: 'Success' };
    },
  },
  {
    name: 'Get-ADSyncScheduler', module: 'ADSync', synopsis: 'Shows Entra Connect scheduler state.',
    run: (c) => ({ AllowedSyncCycleInterval: '00:30:00', CurrentlyEffectiveSyncCycleInterval: '00:30:00', LastSyncCycleTime: new Date(c.w.entra.lastSync), NextSyncCyclePolicyType: 'Delta', NextSyncCycleStartTimeInUTC: new Date(Date.parse(c.w.entra.lastSync) + 1_800_000), SyncCycleEnabled: true, StagingModeEnabled: false, ExportErrors: c.w.entra.syncErrors.length }),
  },
  {
    name: 'Invoke-Command', module: 'Core', params: ['ComputerName', 'ScriptBlock'], positional: ['ScriptBlock'],
    synopsis: 'Runs a script block on a server (MHS-SYNC01 for Entra Connect).', example: 'Invoke-Command -ComputerName MHS-SYNC01 -ScriptBlock { Start-ADSyncSyncCycle -PolicyType Delta }',
    run(c) {
      const sb = c.named.ScriptBlock;
      if (!(sb instanceof ScriptBlock)) throw new PsError('Missing -ScriptBlock { ... }.', 'InvalidArgument');
      return c.shell.execBlock(sb.body, null);
    },
  },
  {
    name: 'Connect-MgGraph', module: 'Microsoft.Graph', params: ['Scopes', 'TenantId'], switches: ['NoWelcome'],
    synopsis: 'Signs in to Microsoft Graph.', example: 'Connect-MgGraph -Scopes "User.ReadWrite.All","AuditLog.Read.All"',
    run(c) {
      // -TenantId picks the tenant (an MSP works in many); without it, the shell's own.
      let tenant = c.shell.w;
      if (c.named.TenantId !== undefined) {
        const t = c.str('TenantId').trim();
        const own = c.shell.w;
        const isOwn = [own.entra.primaryDomain, own.ad.domain, own.ad.netbios, objectIdFor(own.seed, `tenant:${own.entra.tenantName}`)].some((x) => x.toLowerCase() === t.toLowerCase());
        const found = isOwn ? own : c.shell.resolveTenant?.(t);
        if (!found) throw new PsError(`AADSTS90002: Tenant '${t}' not found. Check to make sure you have the correct tenant ID and are signing into the correct cloud. Check with your subscription administrator, this may happen if there are no active subscriptions for the tenant.`, 'AuthenticationError', { exception: 'AuthenticationFailedException', errorId: 'Microsoft.Graph.PowerShell.Authentication.Cmdlets.ConnectMgGraph' });
        tenant = found;
      }
      c.shell.graphWorld = tenant === c.shell.w ? null : tenant;
      c.shell.graphConnected = true;
      c.shell.graphScopes = c.named.Scopes === undefined ? ['openid', 'profile', 'User.Read', 'email'] : [...new Set([...idList(c.named.Scopes), 'openid', 'profile', 'email'])];
      if (!c.has('NoWelcome')) c.shell.host(`Welcome to Microsoft Graph! Connected as ${portalAdminUpn(tenant)} to tenant ${tenant.company.name}.`, 'green');
    },
  },
  {
    name: 'Get-MgUser', module: 'Microsoft.Graph', params: ['UserId', 'Filter', 'Property', 'Top'], switches: ['All'], positional: ['UserId'],
    synopsis: 'Gets Entra ID users.', example: 'Get-MgUser -UserId vhale@meridianhealth.test -Property DisplayName,AccountEnabled,OnPremisesSyncEnabled',
    run(c) {
      requireGraph(c);
      const shape = (e: ReturnType<typeof getEntraUser>): Record<string, unknown> => {
        const base: Record<string, unknown> = { DisplayName: e.displayName, Id: e.id, Mail: e.upn, UserPrincipalName: e.upn };
        const extra: Record<string, unknown> = { AccountEnabled: e.accountEnabled, Department: e.department, JobTitle: e.jobTitle, OnPremisesSyncEnabled: e.source === 'synced', OnPremisesSamAccountName: e.onPremSam, SignInSessionsValidFromDateTime: new Date(e.sessionsValidFrom) };
        for (const p of idList(c.named.Property ?? [])) { const k = Object.keys(extra).find((x) => x.toLowerCase() === p.toLowerCase()); if (k) base[k] = extra[k]; }
        return withRef(base, { type: 'cloud', key: e.upn });
      };
      if (c.named.UserId !== undefined) return shape(getEntraUser(c.w, identity(c, 'UserId')));
      const list = c.w.entra.users.filter((e) => !e.deleted);
      return (c.named.Top ? list.slice(0, Number(c.named.Top)) : list).map(shape);
    },
  },
  {
    name: 'Revoke-MgUserSignInSession', module: 'Microsoft.Graph', mutates: true, params: ['UserId'], positional: ['UserId'], pipe: 'each', pipeParam: 'UserId',
    synopsis: 'Invalidates all refresh tokens and sessions for a user.', example: 'Revoke-MgUserSignInSession -UserId vhale@meridianhealth.test',
    run(c) {
      requireGraph(c);
      const e = getEntraUser(c.w, identity(c, 'UserId'));
      if (whatIf(c, 'Revoke sessions', e.upn)) return;
      if (c.w.profileId) { const actor = portalAdminUpn(c.w); asGraph(() => revokeSessionsAs(c.w, actor, e.upn)); return { Value: true }; }
      revokeSessions(c.w, e.upn);
      return { Value: true };
    },
  },
  {
    name: 'Get-MgUserAuthenticationMethod', module: 'Microsoft.Graph', params: ['UserId'], positional: ['UserId'],
    synopsis: 'Lists a user\'s registered MFA methods.',
    run(c) {
      requireGraph(c);
      const e = getEntraUser(c.w, identity(c, 'UserId'));
      return e.mfaMethods.map((m, i) => ({ Id: `${i + 1}`.padStart(8, '0'), Method: m.type, Detail: m.detail, Added: new Date(m.added) }));
    },
  },
  {
    name: 'Get-MgAuditLogSignIn', module: 'Microsoft.Graph', params: ['Filter', 'Top'], switches: ['All'],
    synopsis: 'Reads Entra ID sign-in logs.', example: "Get-MgAuditLogSignIn -Filter \"userPrincipalName eq 'vhale@meridianhealth.test'\" -Top 10",
    run(c) {
      requireGraph(c);
      const f = c.str('Filter');
      const upn = /userPrincipalName\s+eq\s+'([^']+)'/i.exec(f)?.[1];
      const ip = /ipAddress\s+eq\s+'([^']+)'/i.exec(f)?.[1];
      let list = [...c.w.entra.signIns].sort((a, b) => b.time.localeCompare(a.time));
      if (upn) list = list.filter((s) => s.upn.toLowerCase() === upn.toLowerCase());
      if (ip) list = list.filter((s) => s.ip === ip);
      if (c.named.Top !== undefined) list = list.slice(0, Number(c.named.Top));
      return list.map((s) => ({ CreatedDateTime: new Date(s.time), UserPrincipalName: s.upn, AppDisplayName: s.app, IpAddress: s.ip, Location: s.location, Status: s.result === 'Success' ? 'Success' : `${s.result}: ${s.failureReason}`, MfaResult: s.mfa, RiskLevel: s.risk }));
    },
  },
  // ------------------------------------------------------------------ core
  {
    name: 'Where-Object', aliases: ['where', '?'], module: 'Core', params: ['FilterScript', 'Property', 'Value', 'EQ', 'NE', 'Like', 'NotLike', 'Match', 'GT', 'LT'], positional: ['FilterScript'], pipe: 'all',
    synopsis: 'Filters objects.', example: "Get-ADUser -Filter * -Properties Department | Where-Object { $_.Department -eq 'Finance' }",
    run(c) {
      const fs = c.named.FilterScript;
      if (fs instanceof ScriptBlock) return (c.input ?? []).filter((o) => truthy(c.shell.each(fs, o).pop()));
      const prop = toStr(fs);
      const ops: [string, (a: unknown, b: unknown) => boolean][] = [
        ['EQ', (a, b) => toStr(a).toLowerCase() === toStr(b).toLowerCase()], ['NE', (a, b) => toStr(a).toLowerCase() !== toStr(b).toLowerCase()],
        ['Like', (a, b) => new RegExp(`^${toStr(b).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i').test(toStr(a))],
        ['Match', (a, b) => new RegExp(toStr(b), 'i').test(toStr(a))], ['GT', (a, b) => Number(a) > Number(b)], ['LT', (a, b) => Number(a) < Number(b)],
      ];
      const op = ops.find(([k]) => c.named[k] !== undefined);
      if (!op) return (c.input ?? []).filter((o) => truthy(getProp(o, prop)));
      return (c.input ?? []).filter((o) => op[1](getProp(o, prop), c.named[op[0]]));
    },
  },
  {
    name: 'ForEach-Object', aliases: ['foreach', '%'], module: 'Core', params: ['Process', 'MemberName'], positional: ['Process'], pipe: 'all',
    synopsis: 'Runs a script block for each object ($_).', example: 'Search-ADAccount -LockedOut | ForEach-Object { Unlock-ADAccount -Identity $_.SamAccountName -WhatIf }',
    run(c) {
      const sb = c.named.Process;
      if (sb instanceof ScriptBlock) return (c.input ?? []).flatMap((o) => c.shell.each(sb, o));
      return (c.input ?? []).map((o) => getProp(o, toStr(sb)));
    },
  },
  {
    name: 'Select-Object', aliases: ['select'], module: 'Core', params: ['Property', 'First', 'Last', 'ExpandProperty', 'Skip'], switches: ['Unique'], positional: ['Property'], pipe: 'all',
    synopsis: 'Selects properties or the first/last N objects.', example: 'Get-ADUser -Filter * | Select-Object SamAccountName,Enabled -First 5',
    run(c) {
      let list = c.input ?? [];
      if (c.named.Skip !== undefined) list = list.slice(Number(c.named.Skip));
      if (c.named.First !== undefined) list = list.slice(0, Number(c.named.First));
      if (c.named.Last !== undefined) list = list.slice(-Number(c.named.Last));
      if (c.named.ExpandProperty !== undefined) return list.flatMap((o) => { const v = getProp(o, toStr(c.named.ExpandProperty)); return Array.isArray(v) ? v : [v]; });
      if (c.named.Property === undefined) return list;
      const out = selectProps(list, c.named.Property, c);
      return c.has('Unique') ? out.filter((o, i) => out.findIndex((x) => JSON.stringify(x) === JSON.stringify(o)) === i) : out;
    },
  },
  {
    name: 'Sort-Object', aliases: ['sort'], module: 'Core', params: ['Property'], switches: ['Descending', 'Unique'], positional: ['Property'], pipe: 'all',
    synopsis: 'Sorts objects.', run(c) {
      const p = c.named.Property === undefined ? null : toStr(Array.isArray(c.named.Property) ? c.named.Property[0] : c.named.Property);
      const list = [...(c.input ?? [])].sort((a, b) => {
        const x = p ? getProp(a, p) : a, y = p ? getProp(b, p) : b;
        const xd = x instanceof Date ? x.getTime() : x, yd = y instanceof Date ? y.getTime() : y;
        return typeof xd === 'number' && typeof yd === 'number' ? xd - yd : toStr(xd).localeCompare(toStr(yd));
      });
      return c.has('Descending') ? list.reverse() : list;
    },
  },
  {
    name: 'Measure-Object', aliases: ['measure'], module: 'Core', pipe: 'all', synopsis: 'Counts objects.', run: (c) => ({ Count: (c.input ?? []).length }),
  },
  {
    name: 'Format-Table', aliases: ['ft'], module: 'Core', params: ['Property'], switches: ['AutoSize', 'Wrap'], positional: ['Property'], pipe: 'all',
    synopsis: 'Shows objects as a table.', run(c) {
      const objs = (c.input ?? []).filter((o) => o && typeof o === 'object') as Record<string, unknown>[];
      const p = c.named.Property === undefined ? undefined : idList(c.named.Property);
      return new Formatted(formatObjects(p ? selectProps(objs, p, c) : objs, 'table'));
    },
  },
  {
    name: 'Format-List', aliases: ['fl'], module: 'Core', params: ['Property'], positional: ['Property'], pipe: 'all',
    synopsis: 'Shows every property of each object.', run(c) {
      const objs = (c.input ?? []).filter((o) => o && typeof o === 'object') as Record<string, unknown>[];
      const p = c.named.Property === undefined ? undefined : idList(c.named.Property);
      return new Formatted(formatObjects(p && !p.includes('*') ? selectProps(objs, p, c) : objs, 'list'));
    },
  },
  { name: 'Out-Null', module: 'Core', pipe: 'all', synopsis: 'Discards output.', run: () => undefined },
  { name: 'Out-Host', module: 'Core', pipe: 'all', synopsis: 'Writes to the console.', run: (c) => c.input },
  {
    name: 'Write-Host', module: 'Core', params: ['Object', 'ForegroundColor', 'BackgroundColor'], switches: ['NoNewline'], positional: ['Object'],
    synopsis: 'Writes text to the console.', run(c) { c.shell.host([toStr(c.named.Object), ...c.pos.map(toStr)].join(' '), c.named.ForegroundColor ? toStr(c.named.ForegroundColor).toLowerCase() : undefined); },
  },
  { name: 'Write-Output', aliases: ['echo'], module: 'Core', params: ['InputObject'], positional: ['InputObject'], synopsis: 'Sends objects down the pipeline.', run: (c) => [c.named.InputObject, ...c.pos] },
  { name: 'Write-Warning', module: 'Core', params: ['Message'], positional: ['Message'], synopsis: 'Writes a warning.', run(c) { c.shell.warn(toStr(c.named.Message)); } },
  {
    name: 'Get-Date', module: 'Core', params: ['Format', 'Date'], positional: ['Date'], synopsis: 'Gets the current date and time.',
    run(c) { const d = c.named.Date !== undefined ? asDate(c.named.Date) : new Date(nowMs()); return c.named.Format !== undefined ? formatDate(d, toStr(c.named.Format)) : d; },
  },
  {
    name: 'New-TimeSpan', module: 'Core', params: ['Days', 'Hours'], synopsis: 'Creates a time span.',
    run: (c) => ({ Days: Number(c.named.Days ?? 0), Hours: Number(c.named.Hours ?? 0), TotalDays: Number(c.named.Days ?? 0) + Number(c.named.Hours ?? 0) / 24 }),
  },
  {
    name: 'ConvertTo-SecureString', module: 'Core', params: ['String'], switches: ['AsPlainText', 'Force'], positional: ['String'],
    synopsis: 'Creates a SecureString.', run(c) {
      if (!c.has('AsPlainText')) throw new PsError('Use -AsPlainText -Force, or better, Read-Host -AsSecureString so the password never appears in history.');
      c.shell.warn('Plain-text passwords stay in command history. Prefer Read-Host -AsSecureString.');
      return new SecureStringValue(c.str('String'));
    },
  },
  {
    name: 'Read-Host', module: 'Core', params: ['Prompt'], switches: ['AsSecureString'], positional: ['Prompt'],
    synopsis: 'Prompts for input.', run(c) {
      c.shell.host(`${toStr(c.named.Prompt) || 'Input'}: ************`);
      return c.has('AsSecureString') ? new SecureStringValue() : '';
    },
  },
  {
    name: 'Import-Csv', module: 'Core', params: ['Path'], positional: ['Path'], synopsis: 'Reads a CSV file into objects.', example: '$rows = Import-Csv .\\Documents\\Exports\\file.csv',
    run: (c) => parseCsv(readFile(c.w, c.shell.resolvePath(c.str('Path', true)))),
  },
  {
    name: 'Export-Csv', module: 'Core', params: ['Path'], switches: ['NoTypeInformation', 'Append'], positional: ['Path'], pipe: 'all',
    synopsis: 'Writes objects to a CSV file.', example: 'Search-ADAccount -LockedOut | Export-Csv .\\Documents\\Evidence\\locked.csv -NoTypeInformation',
    run(c) {
      const objs = (c.input ?? []).filter((o) => o && typeof o === 'object') as Record<string, unknown>[];
      if (!objs.length) throw new PsError('Nothing to export.');
      const keys = Object.keys(objs[0]!);
      const text = [csvLine(keys), ...objs.map((o) => csvLine(keys.map((k) => cell(o[k]))))].join('\n') + '\n';
      const path = c.shell.resolvePath(c.str('Path', true));
      writeFile(c.w, path, text);
      c.shell.host(`Exported ${objs.length} rows to ${path}`, 'gray');
    },
  },
  {
    name: 'Get-Content', aliases: ['cat', 'type', 'gc'], module: 'Core', params: ['Path'], positional: ['Path'], synopsis: 'Reads a file.',
    run: (c) => readFile(c.w, c.shell.resolvePath(c.str('Path', true))).replace(/\n$/, '').split('\n'),
  },
  {
    name: 'Set-Content', aliases: ['Out-File'], module: 'Core', params: ['Path', 'Value', 'FilePath'], positional: ['Path', 'Value'], pipe: 'all',
    synopsis: 'Writes a file.', run(c) {
      const path = c.shell.resolvePath(c.str(c.named.Path !== undefined ? 'Path' : 'FilePath', true));
      const value = c.named.Value !== undefined ? toStr(c.named.Value) : (c.input ?? []).map(toStr).join('\n');
      writeFile(c.w, path, value + '\n');
    },
  },
  {
    name: 'Add-Content', module: 'Core', params: ['Path', 'Value'], positional: ['Path', 'Value'], synopsis: 'Appends to a file.',
    run(c) { const path = c.shell.resolvePath(c.str('Path', true)); let cur = ''; try { cur = readFile(c.w, path); } catch { cur = ''; } writeFile(c.w, path, cur + toStr(c.named.Value) + '\n'); },
  },
  {
    name: 'Test-Path', module: 'Core', params: ['Path'], positional: ['Path'], synopsis: 'Checks whether a path exists.',
    run(c) { const p = c.shell.resolvePath(c.str('Path', true)).toLowerCase(); return c.w.files.some((f) => f.path.toLowerCase() === p || f.path.toLowerCase().startsWith(p + '\\')); },
  },
  {
    name: 'Get-ChildItem', aliases: ['ls', 'dir', 'gci'], module: 'Core', params: ['Path', 'Filter'], switches: ['Recurse'], positional: ['Path'], synopsis: 'Lists a folder.',
    run(c) {
      const base = c.named.Path === undefined ? c.shell.cwd : c.shell.resolvePath(c.str('Path'));
      const prefix = base.toLowerCase() + '\\';
      const seen = new Map<string, Record<string, unknown>>();
      for (const f of c.w.files) {
        if (!f.path.toLowerCase().startsWith(prefix)) continue;
        const rest = f.path.slice(prefix.length);
        const [first, ...more] = rest.split('\\');
        if (more.length && !c.has('Recurse')) {
          if (!seen.has(first!)) seen.set(first!, { Mode: 'd-----', LastWriteTime: new Date(f.modified), Length: '', Name: first });
        } else seen.set(rest, { Mode: f.readOnly ? '-a-r--' : '-a----', LastWriteTime: new Date(f.modified), Length: f.content.length, Name: c.has('Recurse') ? rest : first });
      }
      if (!seen.size && !c.w.files.some((f) => f.path.toLowerCase() === base.toLowerCase())) throw new PsError(`Cannot find path '${base}' because it does not exist.`, 'ObjectNotFound');
      return [...seen.values()].filter((o) => !c.named.Filter || new RegExp(`^${toStr(c.named.Filter).replace(/\./g, '\\.').replace(/\*/g, '.*')}$`, 'i').test(toStr(o.Name)));
    },
  },
  {
    name: 'Set-Location', aliases: ['cd', 'sl'], module: 'Core', params: ['Path'], positional: ['Path'], synopsis: 'Changes folder.',
    run(c) {
      const p = c.named.Path === undefined ? `C:\\Users\\${c.w.player.sam}` : c.shell.resolvePath(c.str('Path'));
      if (!c.w.files.some((f) => f.path.toLowerCase().startsWith(p.toLowerCase() + '\\')) && !/^C:\\Users\\[^\\]+$/i.test(p) && p.toLowerCase() !== 'c:') throw new PsError(`Cannot find path '${p}' because it does not exist.`, 'ObjectNotFound');
      c.shell.cwd = p;
    },
  },
  { name: 'Get-Location', aliases: ['pwd'], module: 'Core', synopsis: 'Shows the current folder.', run: (c) => ({ Path: c.shell.cwd }) },
  { name: 'Clear-Host', aliases: ['cls', 'clear'], module: 'Core', synopsis: 'Clears the screen.', run(c) { c.shell.host('\u0000CLEAR'); } },
  { name: 'Import-Module', aliases: ['ipmo'], module: 'Core', params: ['Name'], positional: ['Name'], synopsis: 'Loads a module (ActiveDirectory and Microsoft.Graph are preloaded).', run: () => undefined },
  { name: 'Start-Sleep', module: 'Core', params: ['Seconds'], positional: ['Seconds'], synopsis: 'Waits (instant in the range).', run: () => undefined },
  {
    name: 'Get-Command', aliases: ['gcm'], module: 'Core', params: ['Name', 'Module', 'CommandType'], positional: ['Name'], synopsis: 'Lists the commands you can run: cmdlets, aliases and programs.',
    example: 'Get-Command -Module ActiveDirectory',
    run(c) {
      const mod = c.named.Module === undefined ? null : toStr(c.named.Module).toLowerCase();
      const type = c.named.CommandType === undefined ? null : toStr(c.named.CommandType).toLowerCase();
      const name = c.named.Name === undefined ? null : toStr(c.named.Name);
      const like = (n: string): boolean => !name || new RegExp(`^${name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i').test(n);
      const rows: Record<string, unknown>[] = [];
      for (const d of CMDLETS) {
        if (mod && d.module.toLowerCase() !== mod) continue;
        if (d.native) {
          const exe = d.name.includes('.') ? d.name : `${d.name}.${d.name === 'tree' ? 'com' : 'exe'}`;
          if (like(d.name) || like(exe)) rows.push({ CommandType: 'Application', Name: exe, Version: '10.0.22621.1', Source: `C:\\Windows\\system32\\${exe}` });
          continue;
        }
        for (const al of d.aliases ?? []) if (!mod && /\w/.test(al) && like(al)) rows.push({ CommandType: 'Alias', Name: `${al} -> ${d.name}`, Version: '', Source: '' });
        if (like(d.name)) rows.push({ CommandType: 'Cmdlet', Name: d.name, Version: VERSIONS[d.module], Source: d.module === 'Core' ? 'Microsoft.PowerShell.Management' : d.module });
      }
      for (const f of c.shell.functions.values()) if (!mod && like(f.name)) rows.push({ CommandType: 'Function', Name: f.name, Version: '', Source: '' });
      const order = ['Alias', 'Function', 'Cmdlet', 'Application'];
      const out = rows.filter((r) => !type || toStr(r.CommandType).toLowerCase() === type).sort((x, y) => order.indexOf(toStr(x.CommandType)) - order.indexOf(toStr(y.CommandType)) || toStr(x.Name).localeCompare(toStr(y.Name)));
      if (!out.length && name && !/[*?]/.test(name)) throw commandNotFound(name);
      return out;
    },
  },
  {
    name: 'Get-Help', aliases: ['help', 'man'], module: 'Core', params: ['Name'], switches: ['Examples', 'Full', 'Detailed'], positional: ['Name'], synopsis: 'Shows what a command does, its parameters and an example.',
    example: 'Get-Help Get-ADUser -Examples',
    run(c) {
      const n = c.str('Name');
      if (!n) return new Formatted(helpCatalogue());
      if (/[*?]/.test(n)) {
        const re = new RegExp(`^${n.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
        const hits = CMDLETS.filter((d) => re.test(d.name) || d.aliases?.some((al) => re.test(al)));
        if (!hits.length) throw new PsError(`Get-Help could not find ${n} in a help file in this session.`, 'ResourceUnavailable', { exception: 'HelpNotFoundException', errorId: 'HelpNotFound' });
        const w = Math.max(4, ...hits.map((d) => d.name.length));
        return new Formatted(['', `${'Name'.padEnd(w)} ${'Category'.padEnd(11)} ${'Module'.padEnd(31)} Synopsis`, `${'----'.padEnd(w)} ${'--------'.padEnd(11)} ${'------'.padEnd(31)} --------`,
          ...hits.map((d) => `${d.name.padEnd(w)} ${(d.native ? 'Application' : 'Cmdlet').padEnd(11)} ${(d.native ? '' : d.module === 'Core' ? 'Microsoft.PowerShell.Management' : d.module).padEnd(31)} ${d.synopsis}`), '']);
      }
      const d = CMDLETS.find((x) => x.name.toLowerCase() === n.toLowerCase() || x.aliases?.some((al) => al.toLowerCase() === n.toLowerCase()));
      if (!d) throw new PsError(`Get-Help could not find ${n} in a help file in this session. To download updated help topics type: "Update-Help". To get help online, search for the help topic in the TechNet library at https://go.microsoft.com/fwlink/?LinkID=107116.`, 'ResourceUnavailable', { exception: 'HelpNotFoundException', errorId: 'HelpNotFound' });
      return new Formatted(helpFor(d, c.has('Examples')));
    },
  },
];


CMDLETS.push(...EXTRA_CMDLETS);
CMDLETS.push(...iamCmdlets({ userObject, groupObject, identity, idList, whatIf, requireGraph, guidOf }));

// Get-Help speaks Microsoft's words: the official synopsis, with Meridian practice as NOTES.
for (const d of CMDLETS) {
  const doc = HELP[d.name];
  if (doc) { d.synopsis = doc.synopsis; d.notes = doc.notes; }
}

const VERSIONS: Record<CmdletDef['module'], string> = { ActiveDirectory: '1.0.1.0', ADSync: '1.0.0.0', 'Microsoft.Graph': '2.25.0', Core: '3.1.0.0' };

const isProgram = (d: CmdletDef): boolean => !!d.native || GUI_PROGRAMS.has(d.name);

const SECTIONS: [string, (d: CmdletDef) => boolean][] = [
  ['ACTIVE DIRECTORY (module ActiveDirectory)', (d) => d.module === 'ActiveDirectory'],
  ['ENTRA CONNECT (module ADSync, runs on MHS-SYNC01 through Invoke-Command)', (d) => d.module === 'ADSync'],
  ['MICROSOFT ENTRA ID (Microsoft Graph PowerShell SDK; run Connect-MgGraph first)', (d) => d.module === 'Microsoft.Graph'],
  ['POWERSHELL: FILES, PIPELINE AND SESSION', (d) => d.module === 'Core' && !isProgram(d)],
  ['WINDOWS PROGRAMS', isProgram],
];

/** `help` with no topic: every command this workstation has, grouped, one line each. */
function helpCatalogue(): string[] {
  const label = (d: CmdletDef): string => {
    const short = (d.aliases ?? []).filter((al) => /^[a-z%?]/.test(al) && !al.includes('.')).slice(0, 3);
    return short.length ? `${d.name} (${short.join(', ')})` : d.name;
  };
  const width = Math.min(46, Math.max(...CMDLETS.map((d) => label(d).length)));
  const fit = (t: string): string => (t.length > 96 ? `${t.slice(0, 93).replace(/\s+\S*$/, '')}...` : t);
  const lines = ['', 'TOPIC', '    Commands on MHS-IAM-WKS01, the Meridian Health IAM Operations workstation.', ''];
  for (const [title, pick] of SECTIONS) {
    const list = CMDLETS.filter(pick).sort((x, y) => x.name.localeCompare(y.name));
    if (!list.length) continue;
    lines.push(title);
    for (const d of list) lines.push(`    ${label(d).padEnd(width)}  ${fit(d.synopsis)}`);
    lines.push('');
  }
  lines.push('MORE HELP',
    `    ${'Get-Help <command>'.padEnd(width)}  Syntax, parameters, notes and an example for one command`,
    `    ${'Get-Help <command> -Examples'.padEnd(width)}  Only the example`,
    `    ${'Get-Help *user*'.padEnd(width)}  Commands whose name matches`,
    `    ${'Get-Command -Module ActiveDirectory'.padEnd(width)}  Every command in one module`,
    `    ${'<command> | Get-Member'.padEnd(width)}  The properties the output objects have`,
    '');
  return lines;
}

/** Get-Help <name>, in the layout of Windows PowerShell's help, with the real parameter types. */
function helpFor(d: CmdletDef, examplesOnly: boolean): string[] {
  const example = d.example ? ['EXAMPLE', `    PS C:\\> ${d.example}`, ''] : [];
  if (examplesOnly) return ['', 'NAME', `    ${d.name}`, '', 'SYNOPSIS', `    ${d.synopsis}`, '', ...(example.length ? example : ['EXAMPLE', '    (No example for this command.)', ''])];
  const positional = d.positional ?? [];
  const t = (p: string): string => paramType(d.name, p);
  const syntax = isProgram(d)
    ? `${d.name} [arguments]`
    : [d.name, ...(d.params ?? []).map((p) => positional.includes(p) ? `[[-${p}] <${t(p)}>]` : `[-${p} <${t(p)}>]`), ...(d.switches ?? []).map((sw) => `[-${sw}]`), '[<CommonParameters>]'].join(' ');
  const params = isProgram(d) ? ['    Arguments are passed to the program as typed, as in Command Prompt.', '']
    : [...(d.params ?? []).flatMap((p) => [`    -${p} <${t(p)}>`, `        Position?                    ${positional.includes(p) ? positional.indexOf(p) : 'named'}`, `        Accept pipeline input?       ${d.pipeParam === p ? 'True (ByValue)' : 'False'}`, '']),
      ...(d.switches ?? []).flatMap((sw) => [`    -${sw} [<SwitchParameter>]`, '']),
      '    <CommonParameters>', '        This cmdlet supports the common parameters: Verbose, Debug, ErrorAction, ErrorVariable, WarningAction,', '        WarningVariable, OutBuffer, PipelineVariable, and OutVariable.', ''];
  return [
    '', 'NAME', `    ${d.name}`, '', 'SYNOPSIS', `    ${d.synopsis}`, '', 'SYNTAX', `    ${syntax}`, '',
    'PARAMETERS', ...params,
    ...(d.aliases?.length ? ['ALIASES', `    ${d.aliases.join(', ')}`, ''] : []),
    ...(d.notes ? ['NOTES', `    Meridian practice: ${d.notes}`, ''] : []),
    ...example,
    'REMARKS', `    To see the examples, type: "get-help ${d.name} -examples".`, '',
  ];
}
