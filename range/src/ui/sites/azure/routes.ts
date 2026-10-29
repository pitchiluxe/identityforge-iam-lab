/**
 * ui/sites/azure/routes.ts — the lab Azure portal's URL map and global search.
 * Pure, so routing and search are tested without the DOM.
 */
import type { World } from '../../../core/types.ts';
import { LIGHT_SERVICES } from '../../../world/azure.ts';
import { cloudGroups, syncedGroupNames } from '../../../world/entraAdmin.ts';

export type EntraPage = 'overview' | 'users' | 'users-new' | 'users-invite' | 'users-deleted' | 'groups' | 'groups-new' | 'devices' | 'roles' | 'licenses' | 'signins' | 'audit' | 'connect' | 'apps' | 'enterprise' | 'pim' | 'authmethods' | 'ca' | 'idprotection' | 'adminunits' | 'external';
export type UserTab = 'overview' | 'groups' | 'licenses' | 'roles' | 'auth' | 'devices' | 'signins' | 'audit';
export type Blade = 'overview' | 'iam';

export type Route =
  | { k: 'home' } | { k: 'signin' } | { k: 'signup' } | { k: 'allservices' }
  | { k: 'entra'; page: EntraPage }
  | { k: 'entraUser'; upn: string; tab: UserTab }
  | { k: 'entraGroup'; name: string }
  | { k: 'entraRole'; role: string }
  | { k: 'appReg'; appId: string }
  | { k: 'entApp'; id: string }
  | { k: 'subscriptions' } | { k: 'subscription'; id: string; blade: Blade }
  | { k: 'resourcegroups' } | { k: 'resourcegroup'; sub: string; rg: string; blade: Blade }
  | { k: 'resources'; type?: string } | { k: 'resource'; id: string; blade: Blade }
  | { k: 'create'; type: string }
  | { k: 'service'; name: string }
  | { k: 'notfound' };

const ENTRA_PAGES: Record<string, EntraPage> = {
  '': 'overview', users: 'users', 'users/new': 'users-new', 'users/invite': 'users-invite', 'users/deleted': 'users-deleted', groups: 'groups',
  'groups/new': 'groups-new', devices: 'devices', roles: 'roles', licenses: 'licenses', signins: 'signins', audit: 'audit', connect: 'connect',
  apps: 'apps', enterprise: 'enterprise', pim: 'pim', authmethods: 'authmethods', ca: 'ca', idprotection: 'idprotection', adminunits: 'adminunits', external: 'external',
};
const USER_TABS: UserTab[] = ['overview', 'groups', 'licenses', 'roles', 'auth', 'devices', 'signins', 'audit'];

const dec = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };
const enc = encodeURIComponent;
const blade = (s: string | undefined): Blade | null => (s === undefined ? 'overview' : s === 'iam' ? 'iam' : null);

export function parseRoute(path: string): Route {
  const p = path.split('?')[0]!.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/home') return { k: 'home' };
  if (p === '/signin') return { k: 'signin' };
  if (p === '/signup') return { k: 'signup' };
  if (p === '/allservices') return { k: 'allservices' };
  const s = p.slice(1).split('/');
  if (s[0] === 'entra') {
    const rest = s.slice(1).join('/');
    if (rest in ENTRA_PAGES) return { k: 'entra', page: ENTRA_PAGES[rest]! };
    if (s[1] === 'users' && s[2] && s.length <= 4) {
      const tab = (s[3] ?? 'overview') as UserTab;
      return USER_TABS.includes(tab) ? { k: 'entraUser', upn: dec(s[2]), tab } : { k: 'notfound' };
    }
    if (s[1] === 'groups' && s[2] && s.length === 3) return { k: 'entraGroup', name: dec(s[2]) };
    if (s[1] === 'roles' && s[2] && s.length === 3) return { k: 'entraRole', role: dec(s[2]) };
    if (s[1] === 'apps' && s[2] && s.length === 3) return { k: 'appReg', appId: dec(s[2]) };
    if (s[1] === 'enterprise' && s[2] && s.length === 3) return { k: 'entApp', id: dec(s[2]) };
    return { k: 'notfound' };
  }
  if (s[0] === 'subscriptions') {
    if (s.length === 1) return { k: 'subscriptions' };
    const b = blade(s[2]);
    return s.length <= 3 && b ? { k: 'subscription', id: dec(s[1]!), blade: b } : { k: 'notfound' };
  }
  if (s[0] === 'resourcegroups') {
    if (s.length === 1) return { k: 'resourcegroups' };
    const b = blade(s[3]);
    return s.length >= 3 && s.length <= 4 && b ? { k: 'resourcegroup', sub: dec(s[1]!), rg: dec(s[2]!), blade: b } : { k: 'notfound' };
  }
  if (s[0] === 'resources') {
    if (s.length === 1) return { k: 'resources' };
    return s[1] === 'type' && s[2] && s.length === 3 ? { k: 'resources', type: dec(s[2]) } : { k: 'notfound' };
  }
  if (s[0] === 'resource' && s[1]) {
    const b = blade(s[2]);
    return s.length <= 3 && b ? { k: 'resource', id: dec(s[1]), blade: b } : { k: 'notfound' };
  }
  if (s[0] === 'create' && s[1] && s.length === 2) return { k: 'create', type: dec(s[1]) };
  if (s[0] === 'service' && s[1] && s.length === 2) return { k: 'service', name: dec(s[1]) };
  return { k: 'notfound' };
}

export function routePath(r: Route): string {
  switch (r.k) {
    case 'home': return '/';
    case 'signin': case 'signup': case 'allservices': case 'subscriptions': case 'resourcegroups': return `/${r.k}`;
    case 'entra': { const key = Object.entries(ENTRA_PAGES).find(([, v]) => v === r.page)![0]; return key ? `/entra/${key}` : '/entra'; }
    case 'entraUser': return `/entra/users/${enc(r.upn)}${r.tab === 'overview' ? '' : `/${r.tab}`}`;
    case 'entraGroup': return `/entra/groups/${enc(r.name)}`;
    case 'entraRole': return `/entra/roles/${enc(r.role)}`;
    case 'appReg': return `/entra/apps/${enc(r.appId)}`;
    case 'entApp': return `/entra/enterprise/${enc(r.id)}`;
    case 'subscription': return `/subscriptions/${enc(r.id)}${r.blade === 'iam' ? '/iam' : ''}`;
    case 'resourcegroup': return `/resourcegroups/${enc(r.sub)}/${enc(r.rg)}${r.blade === 'iam' ? '/iam' : ''}`;
    case 'resources': return r.type ? `/resources/type/${enc(r.type)}` : '/resources';
    case 'resource': return `/resource/${enc(r.id)}${r.blade === 'iam' ? '/iam' : ''}`;
    case 'create': return `/create/${enc(r.type)}`;
    case 'service': return `/service/${enc(r.name)}`;
    case 'notfound': return '/';
  }
}

/** Real Azure services the lab does not model: they open an honest empty list. */
export const ALL_SERVICES: readonly string[] = [
  'Azure Monitor', 'Log Analytics workspaces', 'Microsoft Defender for Cloud', 'Microsoft Sentinel', 'Azure Policy', 'Cost Management + Billing',
  'Advisor', 'Azure Backup', 'Recovery Services vaults', 'Load balancers', 'Application gateways', 'Azure Firewall', 'Network security groups',
  'Public IP addresses', 'DNS zones', 'Private DNS zones', 'VPN gateways', 'ExpressRoute circuits', 'Azure Front Door', 'Azure Kubernetes Service',
  'Container registries', 'Container instances', 'Function App', 'Logic apps', 'API Management services', 'Service Bus', 'Event Hubs',
  'Azure Cosmos DB', 'Azure Database for PostgreSQL', 'Azure Database for MySQL', 'Azure Cache for Redis', 'Azure Data Factory', 'Azure Synapse Analytics',
  'Azure Databricks', 'Azure OpenAI', 'Azure AI services', 'Azure Virtual Desktop', 'Bastions', 'Automation Accounts', 'Azure Arc', 'Disks', 'Snapshots',
];

/** Entra pages offered by search (label → path). */
const ENTRA_SEARCH: [string, string][] = [
  ['Microsoft Entra ID', '/entra'], ['Users', '/entra/users'], ['Groups', '/entra/groups'], ['Devices', '/entra/devices'],
  ['Roles and administrators', '/entra/roles'], ['Licenses', '/entra/licenses'], ['Sign-in logs', '/entra/signins'], ['Audit logs', '/entra/audit'],
  ['Microsoft Entra Connect', '/entra/connect'], ['App registrations', '/entra/apps'], ['Enterprise applications', '/entra/enterprise'], ['Privileged Identity Management', '/entra/pim'], ['Authentication methods', '/entra/authmethods'], ['Conditional Access', '/entra/ca'], ['What If', '/entra/ca'], ['Named locations', '/entra/ca'], ['Identity Protection', '/entra/idprotection'], ['Risky users', '/entra/idprotection'], ['Administrative units', '/entra/adminunits'], ['External Identities', '/entra/external'], ['Deleted users', '/entra/users/deleted'], ['Subscriptions', '/subscriptions'],
  ['Resource groups', '/resourcegroups'], ['All resources', '/resources'],
];

export interface SearchHit { label: string; kind: 'User' | 'Group' | 'Resource' | 'Resource group' | 'Service'; path: string }

export function portalSearch(w: World, q: string): SearchHit[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const hits: SearchHit[] = [];
  const has = (x: string): boolean => x.toLowerCase().includes(s);
  for (const [label, path] of ENTRA_SEARCH) if (has(label)) hits.push({ label, kind: 'Service', path });
  for (const svc of LIGHT_SERVICES) if (has(svc.plural)) hits.push({ label: svc.plural, kind: 'Service', path: routePath({ k: 'resources', type: svc.type }) });
  for (const name of ALL_SERVICES) if (has(name)) hits.push({ label: name, kind: 'Service', path: routePath({ k: 'service', name }) });
  for (const e of w.entra.users) if (!e.deleted && (has(e.displayName) || has(e.upn))) hits.push({ label: `${e.displayName} (${e.upn})`, kind: 'User', path: routePath({ k: 'entraUser', upn: e.upn, tab: 'overview' }) });
  for (const g of [...syncedGroupNames(w), ...cloudGroups(w).map((x) => x.name)]) if (has(g)) hits.push({ label: g, kind: 'Group', path: routePath({ k: 'entraGroup', name: g }) });
  for (const g of w.azure?.resourceGroups ?? []) if (has(g.name)) hits.push({ label: g.name, kind: 'Resource group', path: routePath({ k: 'resourcegroup', sub: g.subscription, rg: g.name, blade: 'overview' }) });
  for (const r of w.azure?.resources ?? []) if (has(r.name)) hits.push({ label: r.name, kind: 'Resource', path: routePath({ k: 'resource', id: r.id, blade: 'overview' }) });
  return hits.slice(0, 25);
}
