/**
 * world/identityExtras.ts — Identity Protection actions, administrative units
 * and external collaboration settings, authorised as Entra does it.
 *
 *  - Dismiss / confirm compromised: Security Operator or Security Administrator.
 *  - Administrative units and scoped roles: Privileged Role Administrator.
 *  - External collaboration settings: Global Administrator (strictest real setting).
 */
import type { AdminUnit, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { audit } from './audit.ts';
import { objectIdFor, setRisk } from './cloud.ts';
import { rolesOf } from './entraAdmin.ts';

const NO_RIGHTS = 'Insufficient privileges to complete the operation.';

function need(w: World, actor: string, any: string[]): void {
  const mine = rolesOf(w, actor);
  if (!mine.includes('Global Administrator') && !any.some((r) => mine.includes(r))) throw new Error(NO_RIGHTS);
}

export function setUserRisk(w: World, actorUpn: string, upn: string, action: 'dismiss' | 'compromised'): void {
  need(w, actorUpn, ['Security Operator', 'Security Administrator']);
  setRisk(w, upn, action === 'dismiss' ? 'none' : 'high', actorUpn);
}

export function adminUnits(w: World): AdminUnit[] {
  return (w.entra.adminUnits ??= []);
}

export function createAdminUnit(w: World, actorUpn: string, name: string, description: string): AdminUnit {
  need(w, actorUpn, ['Privileged Role Administrator']);
  if (!name.trim()) throw new Error('Name is required.');
  if (adminUnits(w).some((a) => a.name.toLowerCase() === name.trim().toLowerCase())) throw new Error(`An administrative unit named '${name.trim()}' already exists.`);
  const au: AdminUnit = { id: objectIdFor(w.seed, `au:${name.trim()}`), name: name.trim(), description: description.trim(), members: [], scopedRoles: [], created: nowIso() };
  adminUnits(w).push(au);
  audit(w, { source: 'Entra ID', action: 'Add administrative unit', target: au.name, actor: actorUpn, detail: au.description });
  return au;
}

function au(w: World, id: string): AdminUnit {
  const a = adminUnits(w).find((x) => x.id === id);
  if (!a) throw new Error('Administrative unit not found.');
  return a;
}

export function addAuMember(w: World, actorUpn: string, id: string, upn: string): void {
  need(w, actorUpn, ['Privileged Role Administrator']);
  const a = au(w, id);
  if (!w.entra.users.some((e) => e.upn.toLowerCase() === upn.toLowerCase() && !e.deleted)) throw new Error(`User '${upn}' was not found.`);
  if (a.members.includes(upn)) throw new Error(`${upn} is already a member of ${a.name}.`);
  a.members.push(upn);
  audit(w, { source: 'Entra ID', action: 'Add member to administrative unit', target: a.name, actor: actorUpn, detail: upn });
}

export function assignScopedRole(w: World, actorUpn: string, id: string, upn: string, role: string): void {
  need(w, actorUpn, ['Privileged Role Administrator']);
  const a = au(w, id);
  if (a.scopedRoles.some((r) => r.upn === upn && r.role === role)) throw new Error('The role assignment already exists.');
  a.scopedRoles.push({ upn, role });
  audit(w, { source: 'Entra ID', action: 'Add scoped member to role', target: a.name, actor: actorUpn, detail: `${role} to ${upn}` });
}

export interface ExternalSettings { guestInviteRestrictions: 'everyone' | 'members' | 'admins' | 'none'; allowDomains: string[]; denyDomains: string[] }

export function externalSettings(w: World): ExternalSettings {
  return (w.entra.externalSettings ??= { guestInviteRestrictions: 'admins', allowDomains: [], denyDomains: [] });
}

export function setExternalSettings(w: World, actorUpn: string, changes: Partial<ExternalSettings>): void {
  need(w, actorUpn, []);
  Object.assign(externalSettings(w), changes);
  audit(w, { source: 'Entra ID', action: 'Update external collaboration settings', target: w.entra.primaryDomain, actor: actorUpn, detail: JSON.stringify(changes) });
}

/** Called by inviteGuest: refuses invitations the collaboration settings block. */
export function checkInvite(w: World, actorUpn: string, domain: string): void {
  const s = externalSettings(w);
  if (s.guestInviteRestrictions === 'none') throw new Error('Guest invitations are turned off for this organization.');
  const d = domain.toLowerCase();
  if (s.denyDomains.some((x) => x.toLowerCase() === d) || (s.allowDomains.length && !s.allowDomains.some((x) => x.toLowerCase() === d))) {
    throw new Error('The invitation is blocked because the domain is not allowed by the collaboration restrictions.');
  }
  if (s.guestInviteRestrictions === 'admins') need(w, actorUpn, ['User Administrator', 'Guest Inviter']);
  else if (s.guestInviteRestrictions === 'members' && !w.entra.users.some((e) => e.upn.toLowerCase() === actorUpn.toLowerCase() && e.userType !== 'Guest')) throw new Error(NO_RIGHTS);
}
