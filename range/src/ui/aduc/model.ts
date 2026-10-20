/**
 * ui/consoles/aduc/model.ts — what the snap-in shows, derived from the directory.
 *
 * A fresh Windows domain is not empty: Builtin, Computers, Domain Controllers,
 * ForeignSecurityPrincipals, Managed Service Accounts and Users are there from
 * DCPROMO, and CN=Users and Builtin are full of default accounts and groups
 * (Domain Admins, Domain Users, krbtgt...). They are shown here as the real
 * console shows them, marked built-in, so the tree looks like the one on a new
 * DC. They are read-only: they are not objects the simulated directory manages,
 * and offering to change them would describe work that does nothing.
 *
 * Everything else -- OUs, accounts, groups -- is read live from the directory,
 * so what the console shows is what exists, not a scaffold.
 */
import type { Group, OrganizationalUnit, OuId, User } from './shim/domain';
import type { VmServices } from './shim/session';
import { VM_HOST } from './shim/config';
import type { IconName } from './icons';

export type Dir = VmServices['dir'];

export const DOMAIN = VM_HOST.domain;
export const NETBIOS = VM_HOST.netbiosDomain;
export const DC_FQDN = `${VM_HOST.domainController}.${VM_HOST.domain}`;
export const DOMAIN_DN = DOMAIN.split('.').map((p) => `DC=${p}`).join(',');

export type ObjKind =
  | 'root'
  | 'saved'
  | 'domain'
  | 'container'
  | 'ou'
  | 'user'
  | 'group'
  | 'computer'
  | 'builtin-user'
  | 'builtin-group';

/** One row in the result pane, or one node in the tree. */
export interface AdObj {
  /** Stable key: 'domain', 'c:users', 'ou:<id>', 'user:<id>', 'group:<id>', 'computer:<name>', 'b:<name>'. */
  key: string;
  kind: ObjKind;
  name: string;
  type: string;
  description: string;
  icon: IconName;
  user?: User;
  group?: Group;
  ou?: OrganizationalUnit;
  /** For containers and OUs: the tree node this row opens. */
  nodeKey?: string;
  /** Display-only default objects. */
  builtin?: BuiltinObject;
  computer?: ComputerObject;
}

export interface BuiltinObject {
  name: string;
  kind: 'user' | 'group';
  scope?: 'DomainLocal' | 'Global' | 'Universal';
  description: string;
  disabled?: boolean;
  container: 'users' | 'builtin';
}

export interface ComputerObject {
  name: string;
  description: string;
  os: string;
  osVersion: string;
  role: 'Workstation or server' | 'Domain controller';
  /** 'computers', 'dcs', or 'ou:<path>' for a computer placed in an OU. */
  container: string;
}

// ---------------------------------------------------------------------------
// The containers a domain ships with
// ---------------------------------------------------------------------------

export interface ContainerDef {
  id: string;
  name: string;
  type: string;
  description: string;
  /** Only with View > Advanced Features. */
  advanced?: boolean;
  /** Sorted after everything else, as NTDS Quotas and TPM Devices are. */
  last?: boolean;
  icon: IconName;
}

export const CONTAINERS: readonly ContainerDef[] = [
  { id: 'builtin', name: 'Builtin', type: 'builtinDomain', description: '', icon: 'container' },
  { id: 'computers', name: 'Computers', type: 'Container', description: 'Default container for upgraded computer accounts', icon: 'container' },
  { id: 'dcs', name: 'Domain Controllers', type: 'Organizational Unit', description: 'Default container for domain controllers', icon: 'ou' },
  { id: 'fsp', name: 'ForeignSecurityPrincipals', type: 'Container', description: 'Default container for security identifiers (SIDs) associated with objects from external, trusted domains', icon: 'container' },
  { id: 'keys', name: 'Keys', type: 'Container', description: 'Default container for key credential objects', advanced: true, icon: 'container' },
  { id: 'lostandfound', name: 'LostAndFound', type: 'lostAndFound', description: 'Default container for orphaned objects', advanced: true, icon: 'container' },
  { id: 'msa', name: 'Managed Service Accounts', type: 'Container', description: 'Default container for managed service accounts', icon: 'container' },
  { id: 'programdata', name: 'Program Data', type: 'Container', description: 'Default location for storage of application data.', advanced: true, icon: 'container' },
  { id: 'system', name: 'System', type: 'Container', description: 'Builtin system settings', advanced: true, icon: 'container' },
  { id: 'users', name: 'Users', type: 'Container', description: 'Default container for upgraded user accounts', icon: 'container' },
  { id: 'ntdsquotas', name: 'NTDS Quotas', type: 'msDS-QuotaContainer', description: 'Quota specifications container', advanced: true, last: true, icon: 'container' },
  { id: 'tpm', name: 'TPM Devices', type: 'msTPM-InformationObjectsContainer', description: '', advanced: true, last: true, icon: 'container' },
];

export const containerById = (id: string): ContainerDef | undefined => CONTAINERS.find((c) => c.id === id);

const G = (name: string, scope: BuiltinObject['scope'], description: string, container: BuiltinObject['container'] = 'users'): BuiltinObject =>
  ({ name, kind: 'group', scope, description, container });

/** CN=Users and CN=Builtin on a new Windows Server 2022 domain. */
export const BUILTIN_OBJECTS: readonly BuiltinObject[] = [
  { name: 'Administrator', kind: 'user', description: 'Built-in account for administering the computer/domain', container: 'users' },
  G('Allowed RODC Password Replication Group', 'DomainLocal', 'Members in this group can have their passwords replicated to all read-only domain controllers in the domain'),
  G('Cert Publishers', 'DomainLocal', 'Members of this group are permitted to publish certificates to the directory'),
  G('Cloneable Domain Controllers', 'Global', 'Members of this group that are domain controllers may be cloned.'),
  G('Denied RODC Password Replication Group', 'DomainLocal', 'Members in this group cannot have their passwords replicated to any read-only domain controllers in the domain'),
  G('DnsAdmins', 'DomainLocal', 'DNS Administrators Group'),
  G('DnsUpdateProxy', 'Global', 'DNS clients who are permitted to perform dynamic updates on behalf of some other clients (such as DHCP servers).'),
  G('Domain Admins', 'Global', 'Designated administrators of the domain'),
  G('Domain Computers', 'Global', 'All workstations and servers joined to the domain'),
  G('Domain Controllers', 'Global', 'All domain controllers in the domain'),
  G('Domain Guests', 'Global', 'All domain guests'),
  G('Domain Users', 'Global', 'All domain users'),
  G('Enterprise Admins', 'Universal', 'Designated administrators of the enterprise'),
  G('Enterprise Key Admins', 'Universal', 'Members of this group can perform administrative actions on key objects within the forest.'),
  G('Enterprise Read-only Domain Controllers', 'Universal', 'Members of this group are Read-Only Domain Controllers in the enterprise'),
  G('Group Policy Creator Owners', 'Global', 'Members in this group can modify group policy for the domain'),
  { name: 'Guest', kind: 'user', description: 'Built-in account for guest access to the computer/domain', disabled: true, container: 'users' },
  G('Key Admins', 'Global', 'Members of this group can perform administrative actions on key objects within the domain.'),
  { name: 'krbtgt', kind: 'user', description: 'Key Distribution Center Service Account', disabled: true, container: 'users' },
  G('Protected Users', 'Global', 'Members of this group are afforded additional protections against authentication security threats.'),
  G('RAS and IAS Servers', 'DomainLocal', 'Servers in this group can access remote access properties of users'),
  G('Read-only Domain Controllers', 'Global', 'Members of this group are Read-Only Domain Controllers in the domain'),
  G('Schema Admins', 'Universal', 'Designated administrators of the schema'),

  G('Access Control Assistance Operators', 'DomainLocal', 'Members of this group can remotely query authorization attributes and permissions for resources on this computer.', 'builtin'),
  G('Account Operators', 'DomainLocal', 'Members can administer domain user and group accounts', 'builtin'),
  G('Administrators', 'DomainLocal', 'Administrators have complete and unrestricted access to the computer/domain', 'builtin'),
  G('Backup Operators', 'DomainLocal', 'Backup Operators can override security restrictions for the sole purpose of backing up or restoring files', 'builtin'),
  G('Certificate Service DCOM Access', 'DomainLocal', 'Members of this group are allowed to connect to Certification Authorities in the enterprise', 'builtin'),
  G('Cryptographic Operators', 'DomainLocal', 'Members are authorized to perform cryptographic operations.', 'builtin'),
  G('Distributed COM Users', 'DomainLocal', 'Members are allowed to launch, activate and use Distributed COM objects on this machine.', 'builtin'),
  G('Event Log Readers', 'DomainLocal', 'Members of this group can read event logs from local machine', 'builtin'),
  G('Guests', 'DomainLocal', 'Guests have the same access as members of the Users group by default, except for the Guest account which is further restricted', 'builtin'),
  G('Hyper-V Administrators', 'DomainLocal', 'Members of this group have complete and unrestricted access to all features of Hyper-V.', 'builtin'),
  G('IIS_IUSRS', 'DomainLocal', 'Built-in group used by Internet Information Services.', 'builtin'),
  G('Incoming Forest Trust Builders', 'DomainLocal', 'Members of this group can create incoming, one-way trusts to this forest', 'builtin'),
  G('Network Configuration Operators', 'DomainLocal', 'Members in this group can have some administrative privileges to manage configuration of networking features', 'builtin'),
  G('Performance Log Users', 'DomainLocal', 'Members of this group may schedule logging of performance counters, enable trace providers, and collect event traces both locally and via remote access to this computer', 'builtin'),
  G('Performance Monitor Users', 'DomainLocal', 'Members of this group can access performance counter data locally and remotely', 'builtin'),
  G('Pre-Windows 2000 Compatible Access', 'DomainLocal', 'A backward compatibility group which allows read access on all users and groups in the domain', 'builtin'),
  G('Print Operators', 'DomainLocal', 'Members can administer printers installed on domain controllers', 'builtin'),
  G('Remote Desktop Users', 'DomainLocal', 'Members in this group are granted the right to logon remotely', 'builtin'),
  G('Remote Management Users', 'DomainLocal', 'Members of this group can access WMI resources over management protocols (such as WS-Management via the Windows Remote Management service).', 'builtin'),
  G('Replicator', 'DomainLocal', 'Supports file replication in a domain', 'builtin'),
  G('Server Operators', 'DomainLocal', 'Members can administer domain servers', 'builtin'),
  G('Storage Replica Administrators', 'DomainLocal', 'Members of this group have complete and unrestricted access to all features of Storage Replica.', 'builtin'),
  G('Terminal Server License Servers', 'DomainLocal', 'Members of this group can update user accounts in Active Directory with information about license issuance', 'builtin'),
  G('Users', 'DomainLocal', 'Users are prevented from making accidental or intentional system-wide changes and can run most applications', 'builtin'),
  G('Windows Authorization Access Group', 'DomainLocal', 'Members of this group have access to the computed tokenGroupsGlobalAndUniversal attribute on User objects', 'builtin'),
];

/** Computers are display-only: the directory has no computer object. */
export const COMPUTERS: ComputerObject[] = [];
/** Refreshed from the world each time the console reads it. */
export function setComputers(list: ComputerObject[]): void {
  COMPUTERS.splice(0, COMPUTERS.length, ...list);
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

export function groupTypeLabel(scope: string | undefined, category: string | undefined): string {
  const s = scope === 'DomainLocal' ? 'Domain Local' : scope ?? 'Global';
  return `${category ?? 'Security'} Group - ${s}`;
}

export function userRow(u: User): AdObj {
  return {
    key: `user:${u.id}`,
    kind: 'user',
    name: u.displayName,
    type: 'User',
    description: u.attrs?.description ?? '',
    icon: u.status === 'disabled' ? 'userDisabled' : 'user',
    user: u,
  };
}

export function groupRow(g: Group): AdObj {
  return {
    key: `group:${g.id}`,
    kind: 'group',
    name: g.name,
    type: groupTypeLabel(g.scope, g.category),
    description: g.description,
    icon: 'group',
    group: g,
  };
}

export function ouRow(o: OrganizationalUnit): AdObj {
  return {
    key: `ou:${o.id}`,
    kind: 'ou',
    name: o.name,
    type: 'Organizational Unit',
    description: o.description,
    icon: 'ou',
    ou: o,
    nodeKey: `ou:${o.id}`,
  };
}

export function containerRow(c: ContainerDef): AdObj {
  return { key: `c:${c.id}`, kind: 'container', name: c.name, type: c.type, description: c.description, icon: c.icon, nodeKey: `c:${c.id}` };
}

function builtinRow(b: BuiltinObject): AdObj {
  return {
    key: `b:${b.name}`,
    kind: b.kind === 'user' ? 'builtin-user' : 'builtin-group',
    name: b.name,
    type: b.kind === 'user' ? 'User' : groupTypeLabel(b.scope, 'Security'),
    description: b.description,
    icon: b.kind === 'user' ? (b.disabled ? 'userDisabled' : 'user') : 'group',
    builtin: b,
  };
}

function computerRow(c: ComputerObject): AdObj {
  return { key: `computer:${c.name}`, kind: 'computer', name: c.name, type: 'Computer', description: c.description, icon: 'computer', computer: c };
}

export interface ViewOptions {
  advanced: boolean;
  /** Filter Options: null = show all types. */
  types: Set<'user' | 'group' | 'computer' | 'ou' | 'container'> | null;
}

/** Real objects win over the display-only default of the same name (the seed's admin is the domain Administrator). */
function builtinsIn(container: 'users' | 'builtin', dir: Dir): AdObj[] {
  const taken = new Set([
    ...dir.listUsers().filter((u) => !u.ouId).map((u) => u.displayName.toLowerCase()),
    // A default group made real on first use (Domain Admins...) replaces its placeholder.
    ...dir.listGroups().map((g) => g.name.toLowerCase()),
  ]);
  for (const u of dir.listUsers()) if (u.username.toLowerCase() === 'admin') taken.add('administrator');
  return BUILTIN_OBJECTS.filter((b) => b.container === container && !taken.has(b.name.toLowerCase())).map(builtinRow);
}

/** Sort the way the snap-in does: by name, NTDS Quotas and TPM Devices last. */
function byName(a: AdObj, b: AdObj): number {
  const la = a.kind === 'container' && containerById(a.key.slice(2))?.last ? 1 : 0;
  const lb = b.kind === 'container' && containerById(b.key.slice(2))?.last ? 1 : 0;
  if (la !== lb) return la - lb;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** Children of a node, containers and objects alike. */
export function childrenOf(nodeKey: string, dir: Dir, view: ViewOptions): AdObj[] {
  let rows: AdObj[] = [];
  if (nodeKey === 'root') {
    rows = [
      { key: 'saved', kind: 'saved', name: 'Saved Queries', type: '', description: 'Folder to store your favorite queries', icon: 'savedQueries', nodeKey: 'saved' },
      { key: 'domain', kind: 'domain', name: DOMAIN, type: 'Domain', description: '', icon: 'domain', nodeKey: 'domain' },
    ];
    return rows;
  }
  if (nodeKey === 'saved') return [];
  if (nodeKey === 'domain') {
    rows = [
      ...CONTAINERS.filter((c) => view.advanced || !c.advanced).map(containerRow),
      ...dir.childOus(undefined).map(ouRow),
    ];
  } else if (nodeKey === 'c:users') {
    rows = [...dir.listUsers().filter((u) => !u.ouId).map(userRow), ...dir.listGroups().filter((g) => !g.ouId).map(groupRow), ...builtinsIn('users', dir)];
  } else if (nodeKey === 'c:builtin') {
    rows = builtinsIn('builtin', dir);
  } else if (nodeKey === 'c:computers') {
    rows = COMPUTERS.filter((c) => c.container === 'computers').map(computerRow);
  } else if (nodeKey === 'c:dcs') {
    rows = COMPUTERS.filter((c) => c.container === 'dcs').map(computerRow);
  } else if (nodeKey === 'c:system' && view.advanced) {
    rows = ['AdminSDHolder', 'ComPartitions', 'ComPartitionSets', 'DomainUpdates', 'IP Security', 'Meetings', 'MicrosoftDNS', 'Password Settings Container', 'Policies', 'RAS and IAS Servers Access Check', 'WinsockServices', 'WMIPolicy'].map(
      (n) => ({ key: `sys:${n}`, kind: 'container' as const, name: n, type: 'Container', description: '', icon: 'container' as IconName }),
    );
  } else if (nodeKey.startsWith('ou:')) {
    const id = nodeKey.slice(3) as OuId;
    rows = [
      ...dir.childOus(id).map(ouRow),
      ...dir.listUsers().filter((u) => u.ouId === id).map(userRow),
      ...dir.listGroups().filter((g) => g.ouId === id).map(groupRow),
      ...COMPUTERS.filter((c) => c.container === `ou:${id}`).map(computerRow),
    ];
  }
  if (view.types) {
    const t = view.types;
    rows = rows.filter((r) => {
      if (r.kind === 'user' || r.kind === 'builtin-user') return t.has('user');
      if (r.kind === 'group' || r.kind === 'builtin-group') return t.has('group');
      if (r.kind === 'computer') return t.has('computer');
      if (r.kind === 'ou') return t.has('ou');
      return t.has('container');
    });
  }
  return rows.sort(byName);
}

/** Tree children: only containers and OUs (plus leaf objects when shown as containers). */
export function treeChildren(nodeKey: string, dir: Dir, view: ViewOptions, objectsAsContainers: boolean): AdObj[] {
  const all = childrenOf(nodeKey, dir, { ...view, types: null });
  return all.filter((r) => r.nodeKey || (objectsAsContainers && r.kind !== 'saved'));
}

/** The object behind a key, wherever it lives. */
export function objectByKey(key: string, dir: Dir): AdObj | undefined {
  if (key === 'root') return { key, kind: 'root', name: 'Active Directory Users and Computers', type: '', description: '', icon: 'root', nodeKey: 'root' };
  if (key === 'domain') return { key, kind: 'domain', name: DOMAIN, type: 'Domain', description: '', icon: 'domain', nodeKey: 'domain' };
  if (key === 'saved') return { key, kind: 'saved', name: 'Saved Queries', type: '', description: '', icon: 'savedQueries', nodeKey: 'saved' };
  if (key.startsWith('c:')) {
    const c = containerById(key.slice(2));
    return c ? containerRow(c) : undefined;
  }
  if (key.startsWith('ou:')) {
    const o = dir.getOu(key.slice(3) as OuId);
    return o ? ouRow(o) : undefined;
  }
  if (key.startsWith('user:')) {
    const u = dir.getUser(key.slice(5) as never);
    return u ? userRow(u) : undefined;
  }
  if (key.startsWith('group:')) {
    const g = dir.getGroup(key.slice(6) as never);
    return g ? groupRow(g) : undefined;
  }
  if (key.startsWith('computer:')) {
    const c = COMPUTERS.find((x) => x.name === key.slice(9));
    return c ? computerRow(c) : undefined;
  }
  if (key.startsWith('b:')) {
    const b = BUILTIN_OBJECTS.find((x) => x.name === key.slice(2));
    return b ? builtinRow(b) : undefined;
  }
  return undefined;
}

/** The parent node of a node key, for Up One Level and for revealing a found object. */
export function parentKey(key: string, dir: Dir): string | undefined {
  if (key === 'root') return undefined;
  if (key === 'domain' || key === 'saved') return 'root';
  if (key.startsWith('c:')) return 'domain';
  if (key.startsWith('ou:')) {
    const o = dir.getOu(key.slice(3) as OuId);
    return o?.parentId ? `ou:${o.parentId}` : 'domain';
  }
  if (key.startsWith('user:')) {
    const u = dir.getUser(key.slice(5) as never);
    return u?.ouId ? `ou:${u.ouId}` : 'c:users';
  }
  if (key.startsWith('group:')) {
    const g = dir.getGroup(key.slice(6) as never);
    return g?.ouId ? `ou:${g.ouId}` : 'c:users';
  }
  if (key.startsWith('computer:')) {
    const c = COMPUTERS.find((x) => x.name === key.slice(9));
    return c?.container === 'dcs' ? 'c:dcs' : 'c:computers';
  }
  if (key.startsWith('b:')) return BUILTIN_OBJECTS.find((x) => x.name === key.slice(2))?.container === 'builtin' ? 'c:builtin' : 'c:users';
  return undefined;
}

/** "meridianhealth.test/USA/Users" -- how the snap-in names a location in dialogs. */
export function canonicalOf(nodeKey: string, dir: Dir): string {
  if (nodeKey === 'domain') return DOMAIN;
  if (nodeKey.startsWith('ou:')) return `${DOMAIN}/${dir.ouPath(nodeKey.slice(3) as OuId)}`;
  if (nodeKey.startsWith('c:')) return `${DOMAIN}/${containerById(nodeKey.slice(2))?.name ?? ''}`;
  return DOMAIN;
}

/** The distinguished name of a container node. */
export function dnOf(nodeKey: string, dir: Dir): string {
  if (nodeKey === 'domain') return DOMAIN_DN;
  if (nodeKey.startsWith('ou:')) {
    const parts = dir.ouPath(nodeKey.slice(3) as OuId).split('/').reverse().map((n) => `OU=${n}`);
    return `${parts.join(',')},${DOMAIN_DN}`;
  }
  if (nodeKey.startsWith('c:')) {
    const c = containerById(nodeKey.slice(2));
    const rdn = c?.type === 'Organizational Unit' ? 'OU' : 'CN';
    return `${rdn}=${c?.name ?? ''},${DOMAIN_DN}`;
  }
  return DOMAIN_DN;
}

/** Where an account or group lives, as a container node key. */
export function homeOf(o: { ouId?: OuId }): string {
  return o.ouId ? `ou:${o.ouId}` : 'c:users';
}

/** The -Path value for a node the console can create objects in (undefined = CN=Users / domain root). */
export function pathArgOf(nodeKey: string, dir: Dir): string | undefined {
  return nodeKey.startsWith('ou:') ? dir.ouPath(nodeKey.slice(3) as OuId) : undefined;
}

/**
 * Can New > User / Group be created here? OUs and CN=Users. The domain root is
 * left out: this directory has nowhere to put an account at the root, and a
 * wizard that says "Create in: meridianhealth.test" and files it under Users would be
 * the silent misplacement this console exists to make visible.
 */
export function canCreateObjectsIn(nodeKey: string): boolean {
  return nodeKey === 'c:users' || nodeKey.startsWith('ou:');
}

/** Can New ▸ Organizational Unit be created here? (the domain root and OUs). */
export function canCreateOuIn(nodeKey: string): boolean {
  return nodeKey === 'domain' || nodeKey.startsWith('ou:');
}

// ---------------------------------------------------------------------------
// Columns (View > Add/Remove Columns)
// ---------------------------------------------------------------------------

export interface Column {
  id: string;
  label: string;
  width: number;
  value: (o: AdObj, dir: Dir) => string;
}

const attr = (o: AdObj, k: string): string => o.user?.attrs?.[k] ?? '';

export const ALL_COLUMNS: readonly Column[] = [
  { id: 'name', label: 'Name', width: 220, value: (o) => o.name },
  { id: 'type', label: 'Type', width: 190, value: (o) => o.type },
  { id: 'description', label: 'Description', width: 420, value: (o) => o.description },
  { id: 'givenName', label: 'First Name', width: 110, value: (o) => attr(o, 'givenName') || (o.user ? o.user.displayName.split(' ')[0] ?? '' : '') },
  { id: 'sn', label: 'Last Name', width: 110, value: (o) => attr(o, 'sn') || (o.user ? o.user.displayName.split(' ').slice(1).join(' ') : '') },
  { id: 'displayName', label: 'Display Name', width: 150, value: (o) => o.user?.displayName ?? '' },
  { id: 'upn', label: 'User Logon Name', width: 170, value: (o) => (o.user ? `${o.user.username}@${DOMAIN}` : '') },
  { id: 'sam', label: 'Pre-Windows 2000 Logon Name', width: 170, value: (o) => (o.user ? `${NETBIOS}\\${o.user.username}` : o.group ? `${NETBIOS}\\${o.group.attrs?.sAMAccountName ?? o.group.name}` : '') },
  { id: 'mail', label: 'E-Mail Address', width: 170, value: (o) => o.user?.email ?? o.group?.attrs?.mail ?? '' },
  { id: 'department', label: 'Department', width: 110, value: (o) => o.user?.department ?? '' },
  { id: 'title', label: 'Job Title', width: 130, value: (o) => o.user?.title ?? '' },
  { id: 'office', label: 'Office', width: 100, value: (o) => attr(o, 'physicalDeliveryOfficeName') },
  { id: 'phone', label: 'Telephone Number', width: 120, value: (o) => attr(o, 'telephoneNumber') },
  { id: 'company', label: 'Company', width: 110, value: (o) => attr(o, 'company') },
  { id: 'city', label: 'City', width: 90, value: (o) => attr(o, 'l') },
  { id: 'manager', label: 'Manager', width: 130, value: (o, dir) => {
    const m = attr(o, 'manager') || (o.user?.managerId ? dir.getUser(o.user.managerId)?.username ?? '' : '');
    return m ? dir.getUserByUsername(m)?.displayName ?? m : '';
  } },
  { id: 'status', label: 'Account Status', width: 100, value: (o) => (o.user ? (o.user.status === 'disabled' ? 'Disabled' : o.user.status === 'locked' ? 'Locked out' : 'Enabled') : '') },
  { id: 'created', label: 'Created', width: 140, value: (o) => (o.user ? new Date(o.user.createdAt).toLocaleString() : o.ou ? new Date(o.ou.createdAt).toLocaleString() : '') },
];

export const DEFAULT_COLUMNS = ['name', 'type', 'description'];
