/**
 * world/cloud.ts — Entra ID, Okta and the SaaS estate behind them.
 *
 * The behaviours that catch people out in real life are kept on purpose:
 *   - AD changes reach Entra only when Entra Connect runs (Start-ADSyncSyncCycle).
 *   - Synced attributes cannot be edited in the cloud.
 *   - Disabling an account does not revoke sessions that already exist.
 *   - Soft match is blocked for cloud accounts that hold admin roles.
 *   - Objects outside the sync scope (Staging, ServiceAccounts) never reach Entra.
 *   - SCIM keeps connected apps in step; PayrollPro has no connector, so a
 *     leaver keeps a PayrollPro account until someone removes it by hand.
 */
import type { AdUser, CaPolicy, EntraUser, OktaUser, SaasAccount, SignIn, World } from '../core/types.ts';
import { nowIso, nowMs } from '../core/time.ts';
import { audit } from './audit.ts';
import { GROUPS_OU, SYNC_SCOPE } from './company.ts';

export class CloudError extends Error {}

export const ENTRA_ROLES = [
  'Global Administrator',
  'Privileged Role Administrator',
  'User Administrator',
  'Helpdesk Administrator',
  'Security Administrator',
  'Security Reader',
  'Exchange Administrator',
  'Application Administrator',
] as const;

export function inSyncScope(u: AdUser): boolean {
  return u.kind !== 'service' && SYNC_SCOPE.some((s) => u.ou === s || u.ou.startsWith(`${s}/`));
}

function syncedGroupsOf(w: World, u: AdUser): string[] {
  const syncedGroupNames = new Set(w.ad.groups.filter((g) => g.ou === GROUPS_OU).map((g) => g.name));
  return u.memberOf.filter((g) => syncedGroupNames.has(g));
}

function adEffectivelyEnabled(u: AdUser): boolean {
  return u.enabled && !(u.accountExpires && Date.parse(u.accountExpires) <= nowMs());
}

export function findEntraUser(w: World, upnOrId: string): EntraUser | undefined {
  const k = upnOrId.trim().toLowerCase();
  return w.entra.users.find((u) => !u.deleted && (u.upn.toLowerCase() === k || u.id === k || u.onPremSam?.toLowerCase() === k));
}

export function getEntraUser(w: World, upnOrId: string): EntraUser {
  const u = findEntraUser(w, upnOrId);
  if (!u) throw new CloudError(`Resource '${upnOrId}' does not exist or one of its queried reference-property objects are not present.`);
  return u;
}

/** A stable GUID-shaped object ID derived from the UPN, like Entra's objectId. */
export function objectIdFor(seed: number, upn: string): string {
  let h1 = 0x811c9dc5 ^ seed, h2 = 0x01000193 ^ (seed >>> 3);
  for (const ch of upn.toLowerCase()) {
    h1 = Math.imul(h1 ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ch.charCodeAt(0), 0x5bd1e995) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + (h1 ^ h2).toString(16).padStart(8, '0') + Math.imul(h1, 31).toString(16).padStart(8, '0')).replace(/-/g, '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function newId(w: World, upn: string): string {
  return objectIdFor(w.seed, upn);
}

function licensesFor(groups: string[]): string[] {
  return groups.includes('grp-all-staff') ? ['Microsoft 365 E3'] : [];
}

/** Entra Connect delta cycle, then the Entra provisioning cycle for SCIM apps. */
export function runEntraSync(w: World, actor = 'Microsoft Entra Connect'): { created: number; updated: number; deleted: number; errors: number } {
  let created = 0, updated = 0, deleted = 0;
  w.entra.syncErrors = [];
  const seen = new Set<string>();
  for (const u of w.ad.users) {
    if (!inSyncScope(u)) continue;
    let e = w.entra.users.find((x) => !x.deleted && x.onPremSam === u.sam);
    if (!e) {
      const sameUpn = w.entra.users.find((x) => !x.deleted && x.upn.toLowerCase() === u.upn.toLowerCase());
      if (sameUpn && sameUpn.source === 'cloud') {
        if (sameUpn.roles.length) {
          w.entra.syncErrors.push({ sam: u.sam, upn: u.upn, error: 'InvalidSoftMatch', detail: `Soft match to cloud account ${sameUpn.upn} was blocked because it holds an administrator role. Remove the role or hard-match with the immutable ID.` });
          continue;
        }
        sameUpn.source = 'synced';
        sameUpn.onPremSam = u.sam;
        e = sameUpn;
        audit(w, { source: 'Sync', action: 'Soft match: cloud user joined to on-premises object', target: u.upn, actor });
      } else if (sameUpn) {
        w.entra.syncErrors.push({ sam: u.sam, upn: u.upn, error: 'AttributeValueMustBeUnique', detail: `UserPrincipalName ${u.upn} is already used by synced object ${sameUpn.onPremSam}.` });
        continue;
      } else {
        e = {
          id: newId(w, u.upn), upn: u.upn, displayName: u.displayName, source: 'synced', onPremSam: u.sam, accountEnabled: true,
          department: u.department, jobTitle: u.title, groups: [], mfaMethods: [], mfaResetAt: null, sessionsValidFrom: nowIso(),
          sessions: [], roles: [], licenses: [], riskLevel: 'none', deleted: false,
        };
        w.entra.users.push(e);
        created++;
        audit(w, { source: 'Entra ID', action: 'Add user', target: u.upn, actor, detail: 'Synchronized from on-premises Active Directory' });
      }
    }
    seen.add(e.id);
    const cloudOnlyGroups = e.groups.filter((g) => !w.ad.groups.some((ag) => ag.name === g));
    const groups = [...syncedGroupsOf(w, u), ...cloudOnlyGroups].sort();
    const next = { upn: u.upn, displayName: u.displayName, department: u.department, jobTitle: u.title, accountEnabled: adEffectivelyEnabled(u), groups, licenses: licensesFor(groups) };
    const before = JSON.stringify([e.upn, e.displayName, e.department, e.jobTitle, e.accountEnabled, e.groups, e.licenses]);
    Object.assign(e, next);
    if (JSON.stringify([e.upn, e.displayName, e.department, e.jobTitle, e.accountEnabled, e.groups, e.licenses]) !== before) {
      updated++;
      audit(w, { source: 'Entra ID', action: 'Update user', target: e.upn, actor, detail: `accountEnabled=${e.accountEnabled}; groups=${e.groups.length}` });
    }
  }
  for (const e of w.entra.users) {
    if (e.source === 'synced' && !e.deleted && !seen.has(e.id)) {
      e.deleted = true;
      e.accountEnabled = false;
      deleted++;
      audit(w, { source: 'Entra ID', action: 'Delete user', target: e.upn, actor, detail: 'Source object deleted or moved out of sync scope. Soft-deleted for 30 days.' });
    }
  }
  w.entra.lastSync = nowIso();
  audit(w, { source: 'Sync', action: 'Delta synchronization completed', target: 'meridianhealth.test', actor, detail: `adds=${created} updates=${updated} deletes=${deleted} errors=${w.entra.syncErrors.length}` });
  provisionEntraApps(w);
  return { created, updated, deleted, errors: w.entra.syncErrors.length };
}

function upsertAccount(w: World, appId: string, login: string, displayName: string, active: boolean, source: string): void {
  const app = w.saas.find((a) => a.id === appId);
  if (!app) return;
  let acct = app.accounts.find((a) => a.login.toLowerCase() === login.toLowerCase());
  if (!acct && active) {
    acct = { login, displayName, role: app.roles[0]!, active: true, lastLogin: null, managedBy: app.provisioning };
    app.accounts.push(acct);
    audit(w, { source: 'SaaS', action: `${app.name}: account created`, target: login, actor: source });
    return;
  }
  if (acct && acct.active !== active) {
    acct.active = active;
    audit(w, { source: 'SaaS', action: `${app.name}: account ${active ? 'reactivated' : 'deactivated'}`, target: login, actor: source });
  }
}

function provisionEntraApps(w: World): void {
  for (const app of w.entra.apps) {
    if (app.provisioning !== 'SCIM' || !app.saasId) continue;
    for (const e of w.entra.users) {
      const assigned = app.assignedUsers.includes(e.upn) || e.groups.some((g) => app.assignedGroups.includes(g));
      const existing = w.saas.find((s) => s.id === app.saasId)?.accounts.find((a) => a.login.toLowerCase() === e.upn.toLowerCase());
      if (!assigned && !existing) continue;
      upsertAccount(w, app.saasId, e.upn, e.displayName, assigned && e.accountEnabled && !e.deleted, 'Entra provisioning service');
    }
  }
}

// ------------------------------------------------------------------- Entra operations

export function revokeSessions(w: World, upn: string, actor = w.player.adminSam): EntraUser {
  const e = getEntraUser(w, upn);
  e.sessionsValidFrom = nowIso();
  e.sessions = [];
  audit(w, { source: 'Entra ID', action: 'Revoke sign-in sessions', target: e.upn, actor, detail: 'All refresh tokens and session cookies invalidated.' });
  return e;
}

export function requireMfaReregistration(w: World, upn: string, actor = w.player.adminSam): EntraUser {
  const e = getEntraUser(w, upn);
  const removed = e.mfaMethods.map((m) => m.type).join(', ') || 'none';
  e.mfaMethods = [];
  e.mfaResetAt = nowIso();
  audit(w, { source: 'Entra ID', action: 'Admin deleted security info', target: e.upn, actor, detail: `Removed: ${removed}. User must register MFA again at next sign-in.` });
  return e;
}

export function deleteMfaMethod(w: World, upn: string, index: number, actor = w.player.adminSam): EntraUser {
  const e = getEntraUser(w, upn);
  const m = e.mfaMethods[index];
  if (!m) throw new CloudError('Authentication method not found.');
  e.mfaMethods.splice(index, 1);
  if (!e.mfaMethods.length) e.mfaResetAt = nowIso();
  audit(w, { source: 'Entra ID', action: 'Admin deleted security info', target: e.upn, actor, detail: `${m.type} (${m.detail})` });
  return e;
}

export function setCloudAccountEnabled(w: World, upn: string, enabled: boolean, actor = w.player.adminSam): EntraUser {
  const e = getEntraUser(w, upn);
  if (e.source === 'synced') throw new CloudError("This user is synchronized from on-premises Active Directory. Make the change in AD and run a sync cycle; you can't edit this attribute in the cloud.");
  e.accountEnabled = enabled;
  audit(w, { source: 'Entra ID', action: 'Update user', target: e.upn, actor, detail: `accountEnabled=${enabled}` });
  return e;
}

export function assignRole(w: World, upn: string, role: string, assignment: 'active' | 'eligible', opts: { permanent: boolean; hours?: number; justification: string }, actor = w.player.adminSam): EntraUser {
  const e = getEntraUser(w, upn);
  if (!opts.justification.trim()) throw new CloudError('A justification is required for role assignments.');
  e.roles = e.roles.filter((r) => r.role !== role);
  const expires = opts.permanent ? null : new Date(nowMs() + (opts.hours ?? 8) * 3_600_000).toISOString();
  e.roles.push({ role, assignment, permanent: opts.permanent, expires, justification: opts.justification.trim() });
  audit(w, { source: 'Entra ID', action: assignment === 'eligible' ? 'Add eligible member to role in PIM completed' : 'Add member to role in PIM completed', target: e.upn, actor, detail: `${role}; ${opts.permanent ? 'permanent' : `expires ${expires}`}; ${opts.justification}` });
  return e;
}

export function removeRole(w: World, upn: string, role: string, actor = w.player.adminSam): EntraUser {
  const e = getEntraUser(w, upn);
  const before = e.roles.length;
  e.roles = e.roles.filter((r) => r.role !== role);
  if (before === e.roles.length) throw new CloudError(`${e.upn} has no assignment for ${role}.`);
  audit(w, { source: 'Entra ID', action: 'Remove member from role in PIM completed', target: e.upn, actor, detail: role });
  return e;
}

export function activeRole(e: EntraUser, role: string): 'active' | 'eligible' | 'none' {
  const r = e.roles.find((x) => x.role === role && (!x.expires || Date.parse(x.expires) > nowMs()));
  return r ? r.assignment : 'none';
}

export function saveCaPolicy(w: World, p: Omit<CaPolicy, 'id' | 'created'> & { id?: string }, actor = w.player.adminSam): CaPolicy {
  if (!p.name.trim()) throw new CloudError('Policy name is required.');
  const existing = p.id ? w.entra.caPolicies.find((c) => c.id === p.id) : undefined;
  if (existing) {
    Object.assign(existing, { ...p, id: existing.id, created: existing.created });
    audit(w, { source: 'Entra ID', action: 'Update conditional access policy', target: existing.name, actor, detail: `${existing.state}; grant=${existing.grant}; exclude=${existing.excludeUsers.join(', ') || 'none'}` });
    return existing;
  }
  const created: CaPolicy = { ...p, id: `ca-${w.entra.caPolicies.length + 1}-${nowMs().toString(36)}`, created: nowIso() };
  w.entra.caPolicies.push(created);
  audit(w, { source: 'Entra ID', action: 'Add conditional access policy', target: created.name, actor, detail: `${created.state}; grant=${created.grant}; include=${created.includeUsers}; exclude=${created.excludeUsers.join(', ') || 'none'}` });
  return created;
}

export function deleteCaPolicy(w: World, id: string, actor = w.player.adminSam): void {
  const p = w.entra.caPolicies.find((c) => c.id === id);
  if (!p) throw new CloudError('Policy not found.');
  w.entra.caPolicies = w.entra.caPolicies.filter((c) => c !== p);
  audit(w, { source: 'Entra ID', action: 'Delete conditional access policy', target: p.name, actor });
}

export function setRisk(w: World, upn: string, level: EntraUser['riskLevel'], actor = w.player.adminSam): EntraUser {
  const e = getEntraUser(w, upn);
  e.riskLevel = level;
  audit(w, { source: 'Entra ID', action: level === 'none' ? 'Dismiss user risk' : 'Confirm user compromised', target: e.upn, actor });
  return e;
}

export function addSignIn(w: World, s: Omit<SignIn, 'id'>): SignIn {
  const full: SignIn = { ...s, id: `si-${++w.counters.signIn}` };
  w.entra.signIns.push(full);
  return full;
}

// ------------------------------------------------------------------- Okta

export function findOktaUser(w: World, login: string): OktaUser | undefined {
  const k = login.trim().toLowerCase();
  return w.okta.users.find((u) => u.login.toLowerCase() === k || u.onPremSam?.toLowerCase() === k);
}

export function getOktaUser(w: World, login: string): OktaUser {
  const u = findOktaUser(w, login);
  if (!u) throw new CloudError(`Not found: Resource not found: ${login} (User)`);
  return u;
}

export function oktaHasApp(w: World, u: OktaUser, appId: string): boolean {
  const app = w.okta.apps.find((a) => a.id === appId);
  if (!app) return false;
  return app.assignedUsers.includes(u.login) || u.groups.some((g) => app.assignedGroups.includes(g));
}

/** Okta AD agent import, followed by SCIM push to connected apps. */
export function runOktaImport(w: World, actor = 'Okta AD Agent (MHS-DC01)'): { created: number; updated: number } {
  let created = 0, updated = 0;
  for (const u of w.ad.users) {
    if (!inSyncScope(u)) continue;
    let o = w.okta.users.find((x) => x.onPremSam === u.sam);
    const groups = syncedGroupsOf(w, u).sort();
    if (!o) {
      if (!u.enabled) continue;
      o = { login: u.upn, displayName: u.displayName, status: 'ACTIVE', source: 'Active Directory', onPremSam: u.sam, groups, factors: [], factorsResetAt: null, sessions: 0, sessionsClearedAt: null, lastLogin: null };
      w.okta.users.push(o);
      created++;
      audit(w, { source: 'Okta', action: 'user.lifecycle.create', target: o.login, actor, detail: 'Imported from Active Directory' });
      continue;
    }
    const before = JSON.stringify([o.login, o.displayName, o.status, o.groups]);
    o.login = u.upn;
    o.displayName = u.displayName;
    o.groups = groups;
    if (!adEffectivelyEnabled(u) && o.status !== 'DEPROVISIONED') {
      o.status = 'DEPROVISIONED';
      audit(w, { source: 'Okta', action: 'user.lifecycle.deactivate', target: o.login, actor, detail: 'Source AD account is disabled' });
    } else if (adEffectivelyEnabled(u) && o.status === 'DEPROVISIONED') {
      o.status = 'ACTIVE';
      audit(w, { source: 'Okta', action: 'user.lifecycle.reactivate', target: o.login, actor, detail: 'Source AD account is enabled' });
    }
    if (JSON.stringify([o.login, o.displayName, o.status, o.groups]) !== before) updated++;
  }
  w.okta.lastImport = nowIso();
  audit(w, { source: 'Okta', action: 'system.import.complete', target: 'Active Directory (meridianhealth.test)', actor, detail: `created=${created} updated=${updated}` });
  pushOktaApps(w);
  return { created, updated };
}

export function pushOktaApps(w: World): void {
  for (const app of w.okta.apps) {
    if (app.provisioning !== 'SCIM' || !app.saasId) continue;
    for (const o of w.okta.users) {
      const access = oktaHasApp(w, o, app.id);
      const existing = w.saas.find((s) => s.id === app.saasId)?.accounts.find((a) => a.login.toLowerCase() === o.login.toLowerCase());
      if (!access && !existing) continue;
      upsertAccount(w, app.saasId, o.login, o.displayName, access && o.status === 'ACTIVE', 'Okta provisioning (SCIM)');
    }
  }
}

export function oktaLifecycle(w: World, login: string, action: 'suspend' | 'unsuspend' | 'deactivate' | 'reactivate' | 'unlock', actor = w.player.adminSam): OktaUser {
  const o = getOktaUser(w, login);
  const next: Record<typeof action, OktaUser['status']> = { suspend: 'SUSPENDED', unsuspend: 'ACTIVE', deactivate: 'DEPROVISIONED', reactivate: 'ACTIVE', unlock: 'ACTIVE' };
  if (action === 'unsuspend' && o.status !== 'SUSPENDED') throw new CloudError('User is not suspended.');
  if (action === 'unlock' && o.status !== 'LOCKED_OUT') throw new CloudError('User is not locked out.');
  o.status = next[action];
  if (action === 'deactivate' || action === 'suspend') { o.sessions = 0; o.sessionsClearedAt = nowIso(); }
  audit(w, { source: 'Okta', action: `user.lifecycle.${action}`, target: o.login, actor });
  pushOktaApps(w);
  return o;
}

export function oktaClearSessions(w: World, login: string, actor = w.player.adminSam): OktaUser {
  const o = getOktaUser(w, login);
  o.sessions = 0;
  o.sessionsClearedAt = nowIso();
  audit(w, { source: 'Okta', action: 'user.session.clear', target: o.login, actor, detail: 'Cleared all sessions and revoked OAuth tokens' });
  return o;
}

export function oktaResetFactors(w: World, login: string, actor = w.player.adminSam): OktaUser {
  const o = getOktaUser(w, login);
  o.factors = [];
  o.factorsResetAt = nowIso();
  audit(w, { source: 'Okta', action: 'user.mfa.factor.reset_all', target: o.login, actor });
  return o;
}

export function oktaAssignApp(w: World, appId: string, login: string, assign: boolean, actor = w.player.adminSam): void {
  const app = w.okta.apps.find((a) => a.id === appId);
  if (!app) throw new CloudError('Application not found.');
  const o = getOktaUser(w, login);
  if (assign) {
    if (!app.assignedUsers.includes(o.login)) app.assignedUsers.push(o.login);
  } else {
    app.assignedUsers = app.assignedUsers.filter((l) => l !== o.login);
  }
  audit(w, { source: 'Okta', action: assign ? 'application.user_membership.add' : 'application.user_membership.remove', target: o.login, actor, detail: app.name });
  pushOktaApps(w);
}

// ------------------------------------------------------------------- SaaS admin

export function setSaasAccount(w: World, appId: string, login: string, active: boolean, actor = w.player.adminSam): SaasAccount {
  const app = w.saas.find((a) => a.id === appId);
  if (!app) throw new CloudError('Application not found.');
  const acct = app.accounts.find((a) => a.login.toLowerCase() === login.toLowerCase());
  if (!acct) throw new CloudError('Account not found.');
  if (acct.managedBy !== 'Manual') {
    throw new CloudError(`This account is managed by ${acct.managedBy}. Change the assignment in the identity provider instead; a manual change here would be overwritten on the next provisioning cycle.`);
  }
  acct.active = active;
  audit(w, { source: 'SaaS', action: `${app.name}: account ${active ? 'reactivated' : 'deactivated'} by administrator`, target: acct.login, actor });
  return acct;
}

export function setSaasRole(w: World, appId: string, login: string, role: string, actor = w.player.adminSam): SaasAccount {
  const app = w.saas.find((a) => a.id === appId);
  if (!app) throw new CloudError('Application not found.');
  const acct = app.accounts.find((a) => a.login.toLowerCase() === login.toLowerCase());
  if (!acct) throw new CloudError('Account not found.');
  if (!app.roles.includes(role)) throw new CloudError('Unknown role.');
  acct.role = role;
  audit(w, { source: 'SaaS', action: `${app.name}: role changed`, target: acct.login, actor, detail: role });
  return acct;
}
