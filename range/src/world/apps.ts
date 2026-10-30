/**
 * world/apps.ts — app registrations and enterprise applications in an MSP
 * company's tenant.
 *
 * Permissions follow Entra: members may register apps (and own them); owners
 * and Application / Cloud Application Administrators manage registrations;
 * admin consent for delegated permissions needs a Cloud Application
 * Administrator, and for application permissions to Microsoft Graph a
 * Privileged Role Administrator. Each company starts with the SaaS apps its
 * industry uses, some with client secrets about to expire.
 */
import type { AppRegistration, EntraApp, World } from '../core/types.ts';
import { daysFromNow, nowIso } from '../core/time.ts';
import { audit } from './audit.ts';
import { objectIdFor } from './cloud.ts';
import { rolesOf } from './entraAdmin.ts';
import { profileById } from './profiles.ts';

const NO_RIGHTS = 'Insufficient privileges to complete the operation.';
const APP_ADMINS = ['Application Administrator', 'Cloud Application Administrator'];

/** Industry SaaS each company signs in to with Entra (name, SSO protocol). */
const CATALOGUE: Record<string, [string, 'SAML' | 'OIDC'][]> = {
  harborline: [['Samsara Fleet', 'SAML'], ['Freightview', 'OIDC']],
  brightwater: [['NetDocuments', 'SAML'], ['Clio Manage', 'OIDC'], ['Relativity', 'SAML']],
  kestrel: [['SAP Concur', 'SAML'], ['Plex MES', 'SAML'], ['Autodesk Vault', 'OIDC']],
  aldervalley: [['Canvas LMS', 'SAML'], ['Banner Student', 'SAML'], ['Zoom', 'OIDC']],
  summitridge: [['Jack Henry SilverLake', 'SAML'], ['nCino', 'SAML']],
  pinecrest: [['Shopify POS', 'OIDC'], ['UKG Workforce', 'SAML'], ['Salesforce', 'SAML']],
  lumen: [['Benchling', 'SAML'], ['Veeva Vault', 'SAML']],
  cobalt: [['GitHub Enterprise', 'SAML'], ['Atlassian Cloud', 'SAML'], ['Datadog', 'OIDC']],
  riverside: [['Granicus', 'SAML'], ['Tyler Munis', 'SAML']],
  atlas: [['Quorum Energy', 'SAML'], ['Enverus', 'OIDC'], ['ServiceNow', 'SAML']],
};

function owns(reg: AppRegistration, upn: string): boolean {
  return reg.owners.some((o) => o.toLowerCase() === upn.toLowerCase());
}

function canManage(w: World, actor: string, reg: AppRegistration): boolean {
  if (!w.entra.users.some((u) => u.upn.toLowerCase() === actor.toLowerCase() && !u.deleted && u.accountEnabled)) return false;
  const mine = rolesOf(w, actor);
  return mine.includes('Global Administrator') || APP_ADMINS.some((r) => mine.includes(r)) || owns(reg, actor);
}

function reg(w: World, appId: string): AppRegistration {
  const r = ensureApps(w).find((x) => x.appId === appId);
  if (!r) throw new Error(`Application with identifier '${appId}' was not found in the directory '${w.entra.primaryDomain}'.`);
  return r;
}

export function ensureApps(w: World): AppRegistration[] {
  if (w.entra.appRegistrations) return w.entra.appRegistrations;
  const list: AppRegistration[] = [];
  const p = w.profileId ? profileById(w.profileId) : undefined;
  (p ? CATALOGUE[p.id] ?? [] : []).forEach(([name, sso], i) => {
    const appId = objectIdFor(w.seed, `app:${name}`);
    list.push({
      appId, objectId: objectIdFor(w.seed, `appobj:${name}`), name, owners: [], redirectUris: [`https://${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example.test/sso`],
      // The first app's secret is about to expire: the classic "SSO broke overnight" ticket waiting to happen.
      secrets: [{ id: objectIdFor(w.seed, `secret:${name}`), description: 'Integration', created: w.created, expires: daysFromNow(i === 0 ? 12 : 200 + i * 40) }],
      permissions: [{ api: 'Microsoft Graph', name: 'User.Read', type: 'Delegated', consented: true }],
      created: w.created,
    });
    const access = p!.baseAccess[0];
    const ent: EntraApp = { id: `ent-${appId}`, name, sso, assignmentRequired: true, assignedGroups: access ? [access] : [], assignedUsers: [], provisioning: 'None', saasId: null, owners: [] };
    w.entra.apps.push(ent);
  });
  w.entra.appRegistrations = list;
  return list;
}

export function registerApp(w: World, actorUpn: string, input: { name: string; redirectUris: string[] }): AppRegistration {
  const regs = ensureApps(w);
  const actor = w.entra.users.find((e) => e.upn.toLowerCase() === actorUpn.toLowerCase() && !e.deleted && e.accountEnabled);
  if (!actor || actor.userType === 'Guest') throw new Error(NO_RIGHTS);
  const name = input.name.trim();
  if (!name) throw new Error('Enter a name for the application.');
  const t = nowIso();
  const r: AppRegistration = { appId: objectIdFor(w.seed, `app:${name}:${t}`), objectId: objectIdFor(w.seed, `appobj:${name}:${t}`), name, owners: [actor.upn], redirectUris: input.redirectUris, secrets: [], permissions: [{ api: 'Microsoft Graph', name: 'User.Read', type: 'Delegated', consented: false }], created: t };
  regs.push(r);
  w.entra.apps.push({ id: `ent-${r.appId}`, name, sso: 'OIDC', assignmentRequired: false, assignedGroups: [], assignedUsers: [], provisioning: 'None', saasId: null, owners: [actor.upn] });
  audit(w, { source: 'Entra ID', action: 'Add application', target: name, actor: actorUpn, detail: `Application (client) ID ${r.appId}` });
  return r;
}

export function addSecret(w: World, actorUpn: string, appId: string, description: string, months: 6 | 12 | 24): AppRegistration['secrets'][number] {
  const r = reg(w, appId);
  if (!canManage(w, actorUpn, r)) throw new Error(NO_RIGHTS);
  const s = { id: objectIdFor(w.seed, `secret:${appId}:${nowIso()}`), description: description.trim() || 'Client secret', created: nowIso(), expires: daysFromNow(Math.round(months * 30.4)) };
  r.secrets.push(s);
  audit(w, { source: 'Entra ID', action: 'Update application - Certificates and secrets management', target: r.name, actor: actorUpn, detail: `Added client secret '${s.description}' expiring ${s.expires.slice(0, 10)}` });
  return s;
}

export function removeSecret(w: World, actorUpn: string, appId: string, secretId: string): void {
  const r = reg(w, appId);
  if (!canManage(w, actorUpn, r)) throw new Error(NO_RIGHTS);
  const s = r.secrets.find((x) => x.id === secretId);
  if (!s) throw new Error('The client secret was not found.');
  r.secrets = r.secrets.filter((x) => x !== s);
  audit(w, { source: 'Entra ID', action: 'Update application - Certificates and secrets management', target: r.name, actor: actorUpn, detail: `Removed client secret '${s.description}'` });
}

export function addApiPermission(w: World, actorUpn: string, appId: string, perm: { api: string; name: string; type: 'Delegated' | 'Application' }): void {
  const r = reg(w, appId);
  if (!canManage(w, actorUpn, r)) throw new Error(NO_RIGHTS);
  if (r.permissions.some((x) => x.api === perm.api && x.name === perm.name && x.type === perm.type)) throw new Error(`${perm.name} is already configured.`);
  r.permissions.push({ ...perm, consented: false });
  audit(w, { source: 'Entra ID', action: 'Update application', target: r.name, actor: actorUpn, detail: `Added ${perm.type} permission ${perm.api} ${perm.name} (not yet consented)` });
}

export function grantAdminConsent(w: World, actorUpn: string, appId: string): void {
  const r = reg(w, appId);
  const mine = rolesOf(w, actorUpn);
  const ga = mine.includes('Global Administrator');
  const pra = ga || mine.includes('Privileged Role Administrator');
  const cloudApp = ga || APP_ADMINS.some((x) => mine.includes(x));
  const pending = r.permissions.filter((p) => !p.consented);
  // Application permissions to Microsoft Graph can only be consented by a Privileged Role Administrator.
  if (pending.some((p) => p.type === 'Application' && p.api === 'Microsoft Graph') ? !pra : !(cloudApp || pra)) throw new Error(NO_RIGHTS);
  for (const p of pending) p.consented = true;
  audit(w, { source: 'Entra ID', action: 'Consent to application', target: r.name, actor: actorUpn, detail: `Admin consent for ${pending.map((p) => `${p.type} ${p.name}`).join(', ') || 'no pending permissions'}` });
}

export function secretsExpiringWithin(w: World, days: number): { app: string; secret: string; expires: string }[] {
  const limit = daysFromNow(days);
  return ensureApps(w).flatMap((r) => r.secrets.filter((s) => s.expires <= limit).map((s) => ({ app: r.name, secret: s.description, expires: s.expires })));
}

export function setAppOwner(w: World, actor: string, appId: string, upn: string, add: boolean): void {
  const r = reg(w, appId);
  if (!canManage(w, actor, r)) throw new Error(NO_RIGHTS);
  const e = w.entra.users.find((u) => u.upn.toLowerCase() === upn.trim().toLowerCase() && !u.deleted);
  if (!e) throw new Error(`User '${upn}' was not found in this directory.`);
  const exists = owns(r, e.upn);
  if (exists === add) throw new Error(add ? 'This user is already an owner.' : 'This user is not an owner.');
  r.owners = add ? [...r.owners, e.upn] : r.owners.filter((o) => o.toLowerCase() !== e.upn.toLowerCase());
  audit(w, { source: 'Entra ID', action: add ? 'Add owner to application' : 'Remove owner from application', target: r.name, actor, detail: e.upn });
}

export function setAppRedirectUris(w: World, actor: string, appId: string, uris: string[]): void {
  const r = reg(w, appId);
  if (!canManage(w, actor, r)) throw new Error(NO_RIGHTS);
  const seen = new Set<string>();
  const validated = uris.map((value) => {
    const uri = value.trim();
    if (!/^https?:\/\//i.test(uri) || /[\s\\]/.test(uri)) throw new Error('Invalid redirect URI: use a complete HTTP or HTTPS URL without whitespace or backslashes.');
    let url: URL;
    try { url = new URL(uri); } catch { throw new Error(`Invalid redirect URI: '${uri}'.`); }
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) || !url.hostname || url.hash || url.username || url.password || uri.includes('*') || uri.includes('#') || uri.length > 256) throw new Error('Redirect URIs must use HTTPS (HTTP is allowed for localhost), without wildcards, credentials or fragments.');
    if (seen.has(url.href)) throw new Error('Duplicate redirect URI.');
    seen.add(url.href);
    return uri;
  });
  r.redirectUris = validated;
  audit(w, { source: 'Entra ID', action: 'Update application', target: r.name, actor, detail: `Redirect URIs: ${validated.join(', ') || '(none)'}` });
}

function ent(w: World, id: string): EntraApp {
  ensureApps(w);
  const a = w.entra.apps.find((x) => x.id === id);
  if (!a) throw new Error(`Enterprise application '${id}' was not found.`);
  return a;
}

function canManageEnt(w: World, actor: string, a: EntraApp): boolean {
  const mine = rolesOf(w, actor);
  return mine.includes('Global Administrator') || APP_ADMINS.some((r) => mine.includes(r)) || (a.owners ?? []).some((o) => o.toLowerCase() === actor.toLowerCase());
}

/** Assign or unassign a user (by UPN) or group (by name) to an enterprise app. */
export function assignApp(w: World, actorUpn: string, appId: string, principal: string, assign: boolean): void {
  const a = ent(w, appId);
  if (!canManageEnt(w, actorUpn, a)) throw new Error(NO_RIGHTS);
  const isUser = principal.includes('@');
  const list = isUser ? a.assignedUsers : a.assignedGroups;
  const has = list.includes(principal);
  if (assign === has) throw new Error(assign ? 'The user or group is already assigned to this application.' : 'The user or group is not assigned to this application.');
  if (isUser) a.assignedUsers = assign ? [...list, principal] : list.filter((x) => x !== principal);
  else a.assignedGroups = assign ? [...list, principal] : list.filter((x) => x !== principal);
  audit(w, { source: 'Entra ID', action: assign ? 'Add app role assignment grant to user' : 'Remove app role assignment from user', target: a.name, actor: actorUpn, detail: principal });
}

export function setAssignmentRequired(w: World, actorUpn: string, appId: string, required: boolean): void {
  const a = ent(w, appId);
  if (!canManageEnt(w, actorUpn, a)) throw new Error(NO_RIGHTS);
  a.assignmentRequired = required;
  audit(w, { source: 'Entra ID', action: 'Update service principal', target: a.name, actor: actorUpn, detail: `Assignment required: ${required ? 'Yes' : 'No'}` });
}
