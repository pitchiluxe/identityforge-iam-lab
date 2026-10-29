/**
 * world/azure.ts — Azure subscriptions, resource groups, resources and role-based
 * access control (Azure RBAC), for the Azure portal.
 *
 * Created lazily per world (ensureAzure), so saved worlds load unchanged. Role
 * assignments inherit downwards (subscription → resource group → resource) and
 * through group membership, and every write is authorised the way Azure
 * Resource Manager does it, with ARM's own error text.
 */
import type { AzureEstate, AzureResource, AzureRoleAssignment, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { audit } from './audit.ts';
import { objectIdFor } from './cloud.ts';
import { cloudGroups, syncedGroupNames } from './entraAdmin.ts';
import { profileById } from './profiles.ts';

export const AZURE_ROLES: readonly { name: string; description: string }[] = [
  { name: 'Owner', description: 'Grants full access to manage all resources, including the ability to assign roles in Azure RBAC.' },
  { name: 'Contributor', description: 'Grants full access to manage all resources, but does not allow you to assign roles in Azure RBAC.' },
  { name: 'Reader', description: 'View all resources, but does not allow you to make any changes.' },
  { name: 'User Access Administrator', description: 'Lets you manage user access to Azure resources.' },
  { name: 'Role Based Access Control Administrator', description: 'Manage access to Azure resources by assigning roles using Azure RBAC. Does not allow other management.' },
  { name: 'Virtual Machine Contributor', description: 'Create and manage virtual machines, but not access to them or the network they connect to.' },
  { name: 'Storage Blob Data Reader', description: 'Read and list Azure Storage containers and blobs.' },
  { name: 'Storage Blob Data Contributor', description: 'Read, write, and delete Azure Storage containers and blobs.' },
  { name: 'Key Vault Secrets User', description: 'Read secret contents.' },
  { name: 'Key Vault Administrator', description: 'Perform all data plane operations on a key vault and all objects in it.' },
  { name: 'Website Contributor', description: 'Lets you manage websites (not web plans), but not access to them.' },
  { name: 'SQL DB Contributor', description: 'Lets you manage SQL databases, but not access to them.' },
];

/** Services the lab models lightly: list, create, delete, and Access control (IAM). */
export const LIGHT_SERVICES: readonly { type: string; label: string; plural: string }[] = [
  { type: 'Microsoft.Compute/virtualMachines', label: 'Virtual machine', plural: 'Virtual machines' },
  { type: 'Microsoft.Storage/storageAccounts', label: 'Storage account', plural: 'Storage accounts' },
  { type: 'Microsoft.Network/virtualNetworks', label: 'Virtual network', plural: 'Virtual networks' },
  { type: 'Microsoft.Web/sites', label: 'App Service', plural: 'App Services' },
  { type: 'Microsoft.Sql/servers', label: 'SQL server', plural: 'SQL servers' },
  { type: 'Microsoft.KeyVault/vaults', label: 'Key vault', plural: 'Key vaults' },
  { type: 'Microsoft.ManagedIdentity/userAssignedIdentities', label: 'Managed identity', plural: 'Managed Identities' },
];

const ASSIGN = ['Owner', 'User Access Administrator', 'Role Based Access Control Administrator'];
const WRITE = ['Owner', 'Contributor'];

export function scopeOf(r: { subscription: string; rg?: string; resource?: string }): string {
  let s = `/subscriptions/${r.subscription}`;
  if (r.rg) s += `/resourceGroups/${r.rg}`;
  if (r.rg && r.resource) s += `/providers/${r.resource}`;
  return s;
}

/** The account the learner works as in this world's tenant. */
export function portalAdminUpn(w: World): string {
  if (w.profileId) return `${w.player.adminSam}@${w.entra.primaryDomain}`;
  return w.entra.users.find((e) => e.onPremSam === w.player.sam)?.upn ?? `${w.player.sam}@${w.ad.domain}`;
}

export function ensureAzure(w: World): AzureEstate {
  if (w.azure) return w.azure;
  const p = w.profileId ? profileById(w.profileId) : undefined;
  const id = p?.id ?? 'meridian';
  const name = w.company.name;
  const sub = (env: string): { id: string; name: string } => ({ id: objectIdFor(w.seed, `subscription:${env}`), name: `${name} - ${env}` });
  const prod = sub('Production'), dev = sub('Development');
  const t = w.created;
  const rgs = [
    { name: `rg-${id}-prod-core`, subscription: prod.id, location: 'eastus' },
    { name: `rg-${id}-prod-apps`, subscription: prod.id, location: 'eastus' },
    { name: `rg-${id}-dev-sandbox`, subscription: dev.id, location: 'westus2' },
  ];
  const res = (type: string, nm: string, rg: string, subscription: string): AzureResource => ({ id: scopeOf({ subscription, rg, resource: `${type}/${nm}` }), name: nm, type, rg, subscription, location: rgs.find((r) => r.name === rg)!.location, created: t });
  const short = id.replace(/[^a-z0-9]/g, '').slice(0, 10);
  const resources = [
    res('Microsoft.Network/virtualNetworks', `vnet-${id}-prod`, rgs[0]!.name, prod.id),
    res('Microsoft.Storage/storageAccounts', `st${short}prod01`, rgs[0]!.name, prod.id),
    res('Microsoft.KeyVault/vaults', `kv-${id}-prod`, rgs[0]!.name, prod.id),
    res('Microsoft.Web/sites', `app-${id}-portal`, rgs[1]!.name, prod.id),
    res('Microsoft.Sql/servers', `sql-${id}-prod`, rgs[1]!.name, prod.id),
    res('Microsoft.Compute/virtualMachines', `vm-${id}-dev01`, rgs[2]!.name, dev.id),
  ];
  const assignments: AzureRoleAssignment[] = [];
  const grant = (principal: string, principalType: AzureRoleAssignment['principalType'], role: string, scope: string): void => {
    assignments.push({ id: objectIdFor(w.seed, `ra:${principal}:${role}:${scope}`), principal, principalType, role, scope, created: t, createdBy: 'Subscription setup' });
  };
  const me = portalAdminUpn(w);
  for (const s of [prod, dev]) for (const role of ['Contributor', 'User Access Administrator']) grant(me, 'User', role, scopeOf({ subscription: s.id }));
  // The company's own IT lead owns production; an engineering group (if the company has one) builds in development.
  const itLead = w.entra.users.find((e) => e.source === 'synced' && /Manager|Director|Officer|Head of IT|CIO|Chief Information/.test(e.jobTitle) && w.ad.users.find((u) => u.sam === e.onPremSam)?.department === 'IT');
  if (itLead) grant(itLead.upn, 'User', 'Owner', scopeOf({ subscription: prod.id }));
  const devGroup = syncedGroupNames(w).find((g) => /azure-dev|engineering|role-engineering/i.test(g));
  if (devGroup) grant(devGroup, 'Group', 'Contributor', scopeOf({ subscription: dev.id }));
  w.azure = { subscriptions: [prod, dev], resourceGroups: rgs, resources, assignments };
  return w.azure;
}

function within(scope: string, parent: string): boolean {
  return scope === parent || scope.startsWith(`${parent}/`);
}

/** Roles a user holds at a scope, inherited from parent scopes and through groups. */
export function effectiveRoles(w: World, upn: string, scope: string): { role: string; scope: string; via: string; id: string }[] {
  const a = ensureAzure(w);
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === upn.toLowerCase() && !x.deleted);
  const groups = new Set(e?.groups ?? []);
  return a.assignments.filter((r) => within(scope, r.scope) && (((r.principalType === 'User' || r.principalType === 'ServicePrincipal') && r.principal.toLowerCase() === upn.toLowerCase()) || (r.principalType === 'Group' && groups.has(r.principal))))
    .map((r) => ({ role: r.role, scope: r.scope, via: r.principalType === 'Group' ? `Group: ${r.principal}` : 'Direct', id: r.id }));
}

function authorise(w: World, actor: string, roles: string[], action: string, scope: string): void {
  // A deleted or disabled account holds no rights, whatever assignments still name it.
  const live = w.entra.users.some((e) => e.upn.toLowerCase() === actor.toLowerCase() && !e.deleted && e.accountEnabled);
  if (live && effectiveRoles(w, actor, scope).some((r) => roles.includes(r.role))) return;
  const oid = w.entra.users.find((e) => e.upn.toLowerCase() === actor.toLowerCase())?.id ?? '00000000-0000-0000-0000-000000000000';
  throw new Error(`The client '${actor}' with object id '${oid}' does not have authorization to perform action '${action}' over scope '${scope}' or the scope is invalid. If access was recently granted, please refresh your credentials.`);
}

/** A managed identity takes its resource's name, which must not already name a user, group or another identity. */
function principalNameFree(w: World, name: string): void {
  const taken = w.entra.users.some((e) => e.upn.toLowerCase() === name.toLowerCase()) || cloudGroups(w).some((g) => g.name.toLowerCase() === name.toLowerCase())
    || syncedGroupNames(w).some((g) => g.toLowerCase() === name.toLowerCase()) || isServicePrincipal(w, name);
  if (taken) throw new Error(`A principal named '${name}' already exists in the directory. Choose another name.`);
}

/** Managed identities (user-assigned, or system-assigned on a VM / App Service) are service principals named after their resource. */
function isServicePrincipal(w: World, name: string): boolean {
  return ensureAzure(w).resources.some((r) => r.name === name && (r.type === 'Microsoft.ManagedIdentity/userAssignedIdentities' || r.identity));
}

function principalType(w: World, principal: string): AzureRoleAssignment['principalType'] {
  if (w.entra.users.some((e) => e.upn.toLowerCase() === principal.toLowerCase() && !e.deleted)) return 'User';
  if (cloudGroups(w).some((g) => g.name === principal) || syncedGroupNames(w).includes(principal)) return 'Group';
  if (isServicePrincipal(w, principal)) return 'ServicePrincipal';
  throw new Error(`Principal ${principal} does not exist in the directory ${w.entra.primaryDomain}.`);
}

function scopeExists(w: World, scope: string): boolean {
  const a = ensureAzure(w);
  return a.subscriptions.some((s) => scopeOf({ subscription: s.id }) === scope)
    || a.resourceGroups.some((g) => scopeOf({ subscription: g.subscription, rg: g.name }) === scope)
    || a.resources.some((r) => r.id === scope);
}

export function addRoleAssignment(w: World, actorUpn: string, principal: string, role: string, scope: string): AzureRoleAssignment {
  const a = ensureAzure(w);
  if (!scopeExists(w, scope)) throw new Error(`The scope '${scope}' is invalid.`);
  if (!AZURE_ROLES.some((r) => r.name === role)) throw new Error(`The role definition '${role}' could not be found.`);
  authorise(w, actorUpn, ASSIGN, 'Microsoft.Authorization/roleAssignments/write', scope);
  const type = principalType(w, principal);
  if (a.assignments.some((r) => r.principal.toLowerCase() === principal.toLowerCase() && r.role === role && r.scope === scope)) throw new Error('The role assignment already exists.');
  const ra: AzureRoleAssignment = { id: objectIdFor(w.seed, `ra:${principal}:${role}:${scope}:${nowIso()}`), principal, principalType: type, role, scope, created: nowIso(), createdBy: actorUpn };
  a.assignments.push(ra);
  audit(w, { source: 'Azure', action: 'Create role assignment', target: scope, actor: actorUpn, detail: `${role} to ${type.toLowerCase()} ${principal}` });
  return ra;
}

export function removeRoleAssignment(w: World, actorUpn: string, id: string): void {
  const a = ensureAzure(w);
  const ra = a.assignments.find((r) => r.id === id);
  if (!ra) throw new Error('The role assignment was not found.');
  authorise(w, actorUpn, ASSIGN, 'Microsoft.Authorization/roleAssignments/delete', ra.scope);
  a.assignments = a.assignments.filter((r) => r !== ra);
  // Never leave the acting admin unable to manage access where they just were.
  if (!effectiveRoles(w, actorUpn, ra.scope).some((r) => ASSIGN.includes(r.role))) {
    a.assignments.push(ra);
    throw new Error('You cannot remove your own access to manage role assignments at this scope.');
  }
  audit(w, { source: 'Azure', action: 'Delete role assignment', target: ra.scope, actor: actorUpn, detail: `${ra.role} from ${ra.principalType.toLowerCase()} ${ra.principal}` });
}

export function createResourceGroup(w: World, actorUpn: string, subscription: string, name: string, location: string): void {
  const a = ensureAzure(w);
  if (!a.subscriptions.some((s) => s.id === subscription)) throw new Error(`The subscription '${subscription}' could not be found.`);
  if (!/^[\w.()-]{1,90}$/.test(name) || name.endsWith('.')) throw new Error('Resource group names only allow alphanumeric characters, periods, underscores, hyphens and parenthesis and cannot end in a period.');
  authorise(w, actorUpn, WRITE, 'Microsoft.Resources/subscriptions/resourceGroups/write', scopeOf({ subscription }));
  if (a.resourceGroups.some((g) => g.subscription === subscription && g.name.toLowerCase() === name.toLowerCase())) throw new Error(`Resource group '${name}' already exists.`);
  a.resourceGroups.push({ name, subscription, location });
  audit(w, { source: 'Azure', action: 'Create or update resource group', target: scopeOf({ subscription, rg: name }), actor: actorUpn, detail: location });
}

export function createResource(w: World, actorUpn: string, input: { type: string; name: string; rg: string; subscription: string; location: string }): AzureResource {
  const a = ensureAzure(w);
  if (!a.resourceGroups.some((g) => g.subscription === input.subscription && g.name === input.rg)) throw new Error(`Resource group '${input.rg}' could not be found.`);
  if (!LIGHT_SERVICES.some((s) => s.type === input.type)) throw new Error(`The resource type '${input.type}' is not part of this lab.`);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/i.test(input.name)) throw new Error('The name must be 2-63 characters: letters, numbers and hyphens, starting with a letter or number.');
  const id = scopeOf({ subscription: input.subscription, rg: input.rg, resource: `${input.type}/${input.name}` });
  authorise(w, actorUpn, WRITE, `${input.type}/write`, id);
  if (input.type === 'Microsoft.ManagedIdentity/userAssignedIdentities') principalNameFree(w, input.name);
  if (a.resources.some((r) => r.id.toLowerCase() === id.toLowerCase())) throw new Error(`A resource named '${input.name}' already exists in '${input.rg}'.`);
  const r: AzureResource = { id, name: input.name, type: input.type, rg: input.rg, subscription: input.subscription, location: input.location, created: nowIso() };
  a.resources.push(r);
  audit(w, { source: 'Azure', action: 'Create or update resource', target: id, actor: actorUpn, detail: input.type });
  return r;
}

export function deleteResource(w: World, actorUpn: string, id: string): void {
  const a = ensureAzure(w);
  const r = a.resources.find((x) => x.id === id);
  if (!r) throw new Error(`The resource '${id}' was not found.`);
  authorise(w, actorUpn, WRITE, `${r.type}/delete`, id);
  a.resources = a.resources.filter((x) => x !== r);
  // Assignments on the resource go with it, and so do those held by its managed identity.
  const sp = r.type === 'Microsoft.ManagedIdentity/userAssignedIdentities' || r.identity ? r.name : null;
  a.assignments = a.assignments.filter((x) => !within(x.scope, id) && !(x.principalType === 'ServicePrincipal' && x.principal === sp));
  audit(w, { source: 'Azure', action: 'Delete resource', target: id, actor: actorUpn, detail: r.type });
}

// ------------------------------------------------------------------ Key Vault and managed identities

const KV_READ = ['Key Vault Secrets User', 'Key Vault Administrator'];

/** A vault's data, created on first use: older companies still use access policies, newer ones Azure RBAC. */
export function vaultOf(w: World, id: string): NonNullable<AzureResource['vault']> {
  const r = ensureAzure(w).resources.find((x) => x.id === id && x.type === 'Microsoft.KeyVault/vaults');
  if (!r) throw new Error(`The vault '${id}' was not found.`);
  if (!r.vault) {
    const legacy = ['kestrel', 'atlas', 'riverside'].includes(w.profileId ?? '');
    r.vault = { model: legacy ? 'accessPolicy' : 'rbac', accessPolicies: [], secrets: [{ name: 'sql-admin-password', enabled: true, expires: null }, { name: 'payroll-api-key', enabled: true, expires: null }, { name: 'smtp-relay-password', enabled: false, expires: null }] };
  }
  return r.vault;
}

/** Whether a user, group member or managed identity can read secrets (data plane). Owner/Contributor do not grant this. */
export function canReadSecret(w: World, principal: string, id: string): boolean {
  const v = vaultOf(w, id);
  if (v.model === 'rbac') return effectiveRoles(w, principal, id).some((r) => KV_READ.includes(r.role));
  const groups = new Set(w.entra.users.find((e) => e.upn.toLowerCase() === principal.toLowerCase())?.groups ?? []);
  return v.accessPolicies.some((p) => (p.principal.toLowerCase() === principal.toLowerCase() || groups.has(p.principal)) && p.secrets.includes('get'));
}

export function setAccessPolicy(w: World, actorUpn: string, id: string, principal: string, secrets: ('get' | 'list' | 'set' | 'delete')[]): void {
  const v = vaultOf(w, id);
  if (v.model === 'rbac') throw new Error('This key vault uses Azure role-based access control. Access policies are not used; assign a Key Vault data role in Access control (IAM) instead.');
  authorise(w, actorUpn, WRITE, 'Microsoft.KeyVault/vaults/accessPolicies/write', id);
  principalType(w, principal);
  v.accessPolicies = v.accessPolicies.filter((p) => p.principal.toLowerCase() !== principal.toLowerCase());
  if (secrets.length) v.accessPolicies.push({ principal, secrets });
  audit(w, { source: 'Azure', action: 'Update key vault access policy', target: id, actor: actorUpn, detail: `${principal}: secrets ${secrets.join(', ') || '(removed)'}` });
}

/** Switching the permission model changes who can read secrets, so it needs rights to manage access. */
export function setVaultModel(w: World, actorUpn: string, id: string, model: 'rbac' | 'accessPolicy'): void {
  const v = vaultOf(w, id);
  authorise(w, actorUpn, ASSIGN, 'Microsoft.Authorization/roleAssignments/write', id);
  v.model = model;
  audit(w, { source: 'Azure', action: 'Update key vault permission model', target: id, actor: actorUpn, detail: model === 'rbac' ? 'Azure role-based access control' : 'Vault access policy' });
}

export function setSystemIdentity(w: World, actorUpn: string, id: string, on: boolean): void {
  const a = ensureAzure(w);
  const r = a.resources.find((x) => x.id === id);
  if (!r || !['Microsoft.Compute/virtualMachines', 'Microsoft.Web/sites'].includes(r.type)) throw new Error('System-assigned identities are available on virtual machines and App Services.');
  authorise(w, actorUpn, WRITE, `${r.type}/write`, id);
  if (on && !r.identity) principalNameFree(w, r.name);
  r.identity = on;
  if (!on) a.assignments = a.assignments.filter((x) => !(x.principalType === 'ServicePrincipal' && x.principal === r.name));
  audit(w, { source: 'Azure', action: 'Update resource identity', target: id, actor: actorUpn, detail: `System assigned managed identity ${on ? 'On' : 'Off'}` });
}
