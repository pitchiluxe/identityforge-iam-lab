/**
 * ui/sites/azure/arm.ts — subscriptions, resource groups, resources and the
 * Access control (IAM) blade every one of them has. Identity is what the lab
 * goes deep on; the resources themselves are deliberately light (list, create,
 * delete) so RBAC work has real targets.
 */
import { fmt } from '../../../core/time.ts';
import { badge, h, table, toast } from '../../dom.ts';
import {
  AZURE_ROLES, LIGHT_SERVICES, addRoleAssignment, canReadSecret, createResource, createResourceGroup, deleteResource, effectiveRoles, ensureAzure, removeRoleAssignment, scopeOf,
  setAccessPolicy, setSystemIdentity, setVaultModel, vaultOf,
} from '../../../world/azure.ts';
import type { AzureResource } from '../../../core/types.ts';
import { cloudGroups, syncedGroupNames } from '../../../world/entraAdmin.ts';
import { blade, cmd, form, info, input, resourceMenu, select, type Portal } from './frame.ts';
import type { Blade } from './routes.ts';

const REGIONS: [string, string][] = [['eastus', 'East US'], ['eastus2', 'East US 2'], ['westus2', 'West US 2'], ['centralus', 'Central US'], ['uksouth', 'UK South'], ['westeurope', 'West Europe']];
const label = (type: string): string => LIGHT_SERVICES.find((s) => s.type === type)?.label ?? type;
let checkFor = '';

function subName(p: Portal, id: string): string {
  return ensureAzure(p.w).subscriptions.find((s) => s.id === id)?.name ?? id;
}

export function subscriptionsPage(p: Portal): HTMLElement {
  const a = ensureAzure(p.w);
  return blade('Subscriptions', p.w.company.name, [], table(['Subscription name', 'Subscription ID', 'My role', 'Resource groups'], a.subscriptions.map((s) => [
    h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); p.go({ k: 'subscription', id: s.id, blade: 'overview' }); } }, s.name), s.id,
    [...new Set(effectiveRoles(p.w, p.upn ?? '', scopeOf({ subscription: s.id })).map((r) => r.role))].join(', ') || '—',
    String(a.resourceGroups.filter((g) => g.subscription === s.id).length)])));
}

export function subscriptionPage(p: Portal, id: string, b: Blade): HTMLElement {
  const a = ensureAzure(p.w);
  const s = a.subscriptions.find((x) => x.id === id);
  if (!s) return blade('Subscription not found', null, [], h('p', { class: 'empty' }, id));
  const scope = scopeOf({ subscription: id });
  const menu = resourceMenu([['Overview', b === 'overview', () => p.go({ k: 'subscription', id, blade: 'overview' })], ['Access control (IAM)', b === 'iam', () => p.go({ k: 'subscription', id, blade: 'iam' })]]);
  const body = b === 'iam' ? iamBlade(p, scope) : h('div', null,
    h('dl', { class: 'kv' }, ...[['Subscription ID', s.id], ['Directory', p.w.entra.primaryDomain], ['Status', 'Active'], ['Offer', 'Pay-As-You-Go (lab)']].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('h3', null, 'Resource groups'), rgTable(p, a.resourceGroups.filter((g) => g.subscription === id)));
  return blade(s.name, 'Subscription', [], h('div', { class: 'az-split' }, menu, body));
}

function rgTable(p: Portal, list: { name: string; subscription: string; location: string }[]): HTMLElement {
  const a = ensureAzure(p.w);
  return table(['Name', 'Subscription', 'Location', 'Resources'], list.map((g) => [
    h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); p.go({ k: 'resourcegroup', sub: g.subscription, rg: g.name, blade: 'overview' }); } }, g.name),
    subName(p, g.subscription), g.location, String(a.resources.filter((r) => r.rg === g.name && r.subscription === g.subscription).length)]));
}

export function resourceGroupsPage(p: Portal): HTMLElement {
  const a = ensureAzure(p.w);
  const sub = select(a.subscriptions.map((s): [string, string] => [s.id, s.name]));
  const name = input({ placeholder: 'rg-name' });
  const region = select(REGIONS, 'eastus');
  return blade('Resource groups', p.w.company.name, [], rgTable(p, a.resourceGroups),
    h('section', { class: 'az-card' }, h('h3', null, 'Create a resource group'), form(['Subscription', sub], ['Resource group', name], ['Region', region]),
      h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => {
        if (p.run((x, actor) => createResourceGroup(x, actor, sub.value, name.value.trim(), region.value), 'Resource group created')) p.go({ k: 'resourcegroup', sub: sub.value, rg: name.value.trim(), blade: 'overview' });
      } }, 'Review + create'))));
}

function resourceTable(p: Portal, list: ReturnType<typeof ensureAzure>['resources']): HTMLElement {
  return list.length ? table(['Name', 'Type', 'Resource group', 'Location', 'Subscription'], list.map((r) => [
    h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); p.go({ k: 'resource', id: r.id, blade: 'overview' }); } }, r.name), label(r.type), r.rg, r.location, subName(p, r.subscription)]))
    : h('p', { class: 'empty' }, 'No resources to display.');
}

export function resourceGroupPage(p: Portal, sub: string, rg: string, b: Blade): HTMLElement {
  const a = ensureAzure(p.w);
  const g = a.resourceGroups.find((x) => x.subscription === sub && x.name === rg);
  if (!g) return blade('Resource group not found', null, [], h('p', { class: 'empty' }, `Resource group '${rg}' could not be found.`));
  const scope = scopeOf({ subscription: sub, rg });
  const menu = resourceMenu([['Overview', b === 'overview', () => p.go({ k: 'resourcegroup', sub, rg, blade: 'overview' })], ['Access control (IAM)', b === 'iam', () => p.go({ k: 'resourcegroup', sub, rg, blade: 'iam' })]]);
  const create = select(LIGHT_SERVICES.map((s): [string, string] => [s.type, s.label]));
  const body = b === 'iam' ? iamBlade(p, scope) : h('div', null,
    h('dl', { class: 'kv' }, ...[['Subscription', subName(p, sub)], ['Location', g.location]].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('div', { class: 'row' }, create, h('button', { class: 'btn', type: 'button', onClick: () => p.go({ k: 'create', type: create.value }) }, '+ Create')),
    resourceTable(p, a.resources.filter((r) => r.subscription === sub && r.rg === rg)));
  return blade(rg, 'Resource group', [], h('div', { class: 'az-split' }, menu, body));
}

export function resourcesPage(p: Portal, type?: string): HTMLElement {
  const a = ensureAzure(p.w);
  const svc = type ? LIGHT_SERVICES.find((s) => s.type === type) : undefined;
  return blade(svc?.plural ?? 'All resources', p.w.company.name, type ? [cmd('Create', '+', () => p.go({ k: 'create', type }))] : [],
    resourceTable(p, a.resources.filter((r) => !type || r.type === type)));
}

export function resourcePage(p: Portal, id: string, b: Blade): HTMLElement {
  const r = ensureAzure(p.w).resources.find((x) => x.id === id);
  if (!r) return blade('Resource not found', null, [], h('p', { class: 'empty' }, `The resource '${id}' was not found.`));
  const menu = resourceMenu([['Overview', b === 'overview', () => p.go({ k: 'resource', id, blade: 'overview' })], ['Access control (IAM)', b === 'iam', () => p.go({ k: 'resource', id, blade: 'iam' })]]);
  const body = b === 'iam' ? iamBlade(p, id) : h('div', null,
    h('dl', { class: 'kv' }, ...[['Resource group', r.rg], ['Location', r.location], ['Subscription', subName(p, r.subscription)], ['Type', r.type], ['Resource ID', r.id], ['Created', fmt(r.created)]].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    r.type === 'Microsoft.KeyVault/vaults' ? vaultSection(p, r) : null,
    r.type === 'Microsoft.Compute/virtualMachines' || r.type === 'Microsoft.Web/sites' ? h('section', { class: 'az-card' }, h('h3', null, 'Identity'),
      h('p', null, `System assigned managed identity: ${r.identity ? 'On' : 'Off'}`),
      h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => setSystemIdentity(x, a, id, !r.identity), 'Identity updated') }, r.identity ? 'Turn off' : 'Turn on'),
      info(`When on, the ${r.type.endsWith('sites') ? 'app' : 'VM'} signs in to Azure as '${r.name}': grant it roles in Access control (IAM) instead of storing credentials.`)) : null,
    r.type === 'Microsoft.ManagedIdentity/userAssignedIdentities' ? info(`Assign roles to '${r.name}' in any resource's Access control (IAM). Deleting this identity removes its role assignments.`) : null);
  return blade(r.name, label(r.type), [cmd('Delete', '\u{1F5D1}', () => { if (p.run((x, a) => deleteResource(x, a, id), `Deleted ${r.name}`)) p.go({ k: 'resourcegroup', sub: r.subscription, rg: r.rg, blade: 'overview' }); })],
    h('div', { class: 'az-split' }, menu, body));
}

function vaultSection(p: Portal, r: AzureResource): HTMLElement {
  const v = vaultOf(p.w, r.id);
  const who = input({ placeholder: 'User, group or managed identity', list: 'az-kv-principals', 'aria-label': 'Access policy principal' });
  const perms = select([['get,list', 'Get, List'], ['get,list,set', 'Get, List, Set'], ['get,list,set,delete', 'All secret permissions'], ['', 'Remove policy']]);
  const me = p.upn ?? '';
  return h('section', { class: 'az-card' }, h('h3', null, 'Key vault'),
    h('p', null, `Permission model: ${v.model === 'rbac' ? 'Azure role-based access control (recommended)' : 'Vault access policy'}`),
    h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => setVaultModel(x, a, r.id, v.model === 'rbac' ? 'accessPolicy' : 'rbac'), 'Access configuration saved') }, v.model === 'rbac' ? 'Switch to vault access policy' : 'Switch to Azure RBAC'),
    h('h3', null, 'Secrets'),
    canReadSecret(p.w, me, r.id) ? table(['Name', 'Status', 'Expiration'], v.secrets.map((s) => [s.name, s.enabled ? 'Enabled' : 'Disabled', s.expires ? fmt(s.expires) : '\u2014']))
      : info(`You are unauthorized to view these contents. ${v.model === 'rbac' ? 'Owner and Contributor are management roles: reading secrets needs a data role such as Key Vault Secrets User.' : 'Reading secrets needs an access policy with Get.'}`),
    v.model === 'accessPolicy' ? h('div', null, h('h3', null, 'Access policies'),
      h('datalist', { id: 'az-kv-principals' }, [...p.w.entra.users.filter((e) => !e.deleted).map((e) => e.upn), ...ensureAzure(p.w).resources.filter((x) => x.type === 'Microsoft.ManagedIdentity/userAssignedIdentities' || x.identity).map((x) => x.name)].map((x) => h('option', { value: x }))),
      table(['Principal', 'Secret permissions'], v.accessPolicies.map((a) => [a.principal, a.secrets.join(', ')])),
      h('div', { class: 'row' }, who, perms, h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => setAccessPolicy(x, a, r.id, who.value.trim(), (perms.value ? perms.value.split(',') : []) as ('get' | 'list')[]), 'Access policy saved') }, 'Save access policy'))) : null);
}

export function createPage(p: Portal, type: string): HTMLElement {
  const svc = LIGHT_SERVICES.find((s) => s.type === type);
  if (!svc) return blade('Create a resource', null, [], info(`${type} is not part of this lab.`));
  const a = ensureAzure(p.w);
  const rg = select(a.resourceGroups.map((g): [string, string] => [`${g.subscription}|${g.name}`, `${g.name} (${subName(p, g.subscription)})`]));
  const name = input({ placeholder: `${svc.label.toLowerCase().replace(/\s+/g, '-')}-name` });
  const region = select(REGIONS, 'eastus');
  return blade(`Create ${svc.label.toLowerCase()}`, 'Basics', [],
    info('The lab models resources lightly: they exist so you can practise access control on them.'),
    form(['Resource group', rg], ['Name', name], ['Region', region]),
    h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => {
      const [s, g] = rg.value.split('|');
      let id = '';
      if (p.run((x, actor) => { id = createResource(x, actor, { type, name: name.value.trim(), rg: g!, subscription: s!, location: region.value }).id; }, 'Deployment succeeded')) p.go({ k: 'resource', id, blade: 'overview' });
    } }, 'Review + create')));
}

export function servicePage(p: Portal, name: string): HTMLElement {
  return blade(name, p.w.company.name, [cmd('Create', '+', () => toast(`${name} is not part of this lab. Practise access control on the lab services instead (All services > Lab services).`, 'info'))],
    h('p', { class: 'empty' }, `No ${name.toLowerCase()} to display.`),
    info(`${name} is a real Azure service that this lab does not model. Identity, access and the core resources (virtual machines, storage, networking, App Service, SQL, Key Vault) are where the lab goes deep.`));
}

/** Access control (IAM) for any scope: Check access, role assignments (with inheritance), roles, and adding a role assignment. */
function iamBlade(p: Portal, scope: string): HTMLElement {
  const a = ensureAzure(p.w);
  const principals = [...p.w.entra.users.filter((e) => !e.deleted).map((e) => e.upn), ...syncedGroupNames(p.w), ...cloudGroups(p.w).map((g) => g.name)];
  const here = a.assignments.filter((r) => scope === r.scope || scope.startsWith(`${r.scope}/`));
  const who = input({ placeholder: 'User or group', list: 'az-principals', value: checkFor, 'aria-label': 'Check access for' });
  const roles = checkFor ? effectiveRoles(p.w, checkFor, scope) : [];
  const role = select(AZURE_ROLES.map((r): [string, string] => [r.name, r.name]), 'Reader');
  const member = input({ placeholder: 'User principal name or group name', list: 'az-principals', 'aria-label': 'Member' });
  return h('div', null,
    h('datalist', { id: 'az-principals' }, principals.map((x) => h('option', { value: x }))),
    h('section', { class: 'az-card' }, h('h3', null, 'Check access'),
      h('div', { class: 'row' }, who, h('button', { class: 'btn', type: 'button', onClick: () => { checkFor = who.value.trim(); p.ctx.go(p.ctx.path); } }, 'Check access')),
      checkFor ? (roles.length ? table(['Role', 'Scope', 'Assigned through'], roles.map((r) => [r.role, r.scope === scope ? 'This resource' : `${r.scope} (Inherited)`, r.via])) : h('p', { class: 'empty' }, `${checkFor} has no role assignments at this scope.`)) : null),
    h('section', { class: 'az-card' }, h('h3', null, 'Add role assignment'), form(['Role', role], ['Members', member]),
      h('div', { class: 'az-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => p.run((x, actor) => { addRoleAssignment(x, actor, member.value.trim(), role.value, scope); }, 'Added role assignment') }, 'Review + assign'))),
    h('section', { class: 'az-card' }, h('h3', null, `Role assignments (${here.length})`),
      table(['Name', 'Type', 'Role', 'Scope', ''], here.map((r) => [r.principal, r.principalType, r.role, r.scope === scope ? 'This resource' : badge('Inherited', ''),
        r.scope === scope ? h('button', { class: 'btn slim ghost', type: 'button', onClick: () => p.run((x, actor) => removeRoleAssignment(x, actor, r.id), 'Removed role assignment') }, 'Remove') : '']))),
    h('section', { class: 'az-card' }, h('h3', null, 'Roles'), table(['Name', 'Description'], AZURE_ROLES.map((r) => [r.name, r.description]))));
}
