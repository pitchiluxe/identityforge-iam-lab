/**
 * world/pim.ts — Privileged Identity Management for Entra directory roles.
 *
 * An eligible assignment grants nothing until its holder activates it, with a
 * justification, for no longer than the role's maximum. The activation is a
 * time-bound active entry next to the eligible one; rolesOf() and activeRole()
 * stop counting it when it expires. Only a Privileged Role Administrator (or
 * Global Administrator) manages eligibility.
 */
import type { World } from '../core/types.ts';
import { nowIso, nowMs } from '../core/time.ts';
import { audit } from './audit.ts';
import { PRIVILEGED_ROLES, rolesOf } from './entraAdmin.ts';
import { MSP_ADMIN } from './mspSeed.ts';

const NO_RIGHTS = 'Insufficient privileges to complete the operation.';

export function pimSettings(role: string): { maxHours: number; requireJustification: boolean } {
  return { maxHours: PRIVILEGED_ROLES.includes(role) ? 4 : 8, requireJustification: true };
}

function person(w: World, upn: string) {
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === upn.toLowerCase() && !x.deleted);
  if (!e) throw new Error(`Resource '${upn}' does not exist or one of its queried reference-property objects are not present.`);
  return e;
}

const live = (r: { assignment: string; expires: string | null }): boolean => r.assignment === 'active' && !!r.expires && r.expires > nowIso();

export function activateRole(w: World, actorUpn: string, role: string, hours: number, justification: string): void {
  const e = person(w, actorUpn);
  const elig = e.roles.find((r) => r.role === role && r.assignment === 'eligible' && (!r.expires || r.expires > nowIso()));
  if (!elig) throw new Error(`You are not eligible for the role '${role}'.`);
  if (!justification.trim()) throw new Error('Justification is required to activate this role.');
  const { maxHours } = pimSettings(role);
  if (!(hours >= 1 && hours <= maxHours)) throw new Error(`The activation duration must be between 1 and at most ${maxHours} hours for ${role}.`);
  if (e.roles.some((r) => r.role === role && live(r))) throw new Error(`The role '${role}' is already active.`);
  // An activation never outlives the eligibility it came from.
  const wanted = new Date(nowMs() + hours * 3_600_000).toISOString();
  const expires = elig.expires && elig.expires < wanted ? elig.expires : wanted;
  e.roles.push({ role, assignment: 'active', permanent: false, expires, justification: justification.trim() });
  audit(w, { source: 'Entra ID', action: 'Add member to role completed (PIM activation)', target: e.upn, actor: actorUpn, detail: `${role} for ${hours}h; ${justification.trim()}` });
}

export function deactivateRole(w: World, actorUpn: string, role: string): void {
  const e = person(w, actorUpn);
  const a = e.roles.find((r) => r.role === role && live(r));
  if (!a) throw new Error(`The role '${role}' is not active.`);
  e.roles = e.roles.filter((r) => r !== a);
  audit(w, { source: 'Entra ID', action: 'Remove member from role completed (PIM deactivate)', target: e.upn, actor: actorUpn, detail: role });
}

export function addEligible(w: World, actorUpn: string, upn: string, role: string, months: number): void {
  const mine = rolesOf(w, actorUpn);
  if (!mine.includes('Global Administrator') && !mine.includes('Privileged Role Administrator')) throw new Error(NO_RIGHTS);
  const e = person(w, upn);
  if (e.roles.some((r) => r.role === role && r.assignment === 'eligible')) throw new Error(`${e.upn} is already eligible for ${role}.`);
  const expires = new Date(nowMs() + months * 30.4 * 86_400_000).toISOString();
  e.roles.push({ role, assignment: 'eligible', permanent: false, expires, justification: `Eligible assignment by ${actorUpn}` });
  audit(w, { source: 'Entra ID', action: 'Add eligible member to role in PIM completed', target: e.upn, actor: actorUpn, detail: `${role}; ${months} months` });
}

export function removeEligible(w: World, actorUpn: string, upn: string, role: string): void {
  const mine = rolesOf(w, actorUpn);
  if (!mine.includes('Global Administrator') && !mine.includes('Privileged Role Administrator')) throw new Error(NO_RIGHTS);
  const e = person(w, upn);
  const before = e.roles.length;
  e.roles = e.roles.filter((r) => !(r.role === role && r.assignment === 'eligible'));
  if (e.roles.length === before) throw new Error(`${e.upn} is not eligible for ${role}.`);
  audit(w, { source: 'Entra ID', action: 'Remove eligible member from role in PIM completed', target: e.upn, actor: actorUpn, detail: role });
}

/**
 * The MSP's standing PIM eligibility in every company: Authentication
 * Administrator, activated per ticket for MFA resets and Temporary Access Passes.
 * Idempotent, so it also upgrades worlds saved before it existed.
 */
export function ensurePimDefaults(w: World): World {
  if (!w.profileId || w.entra.pimDefaults) return w;
  w.entra.pimDefaults = true;
  const e = w.entra.users.find((x) => x.upn === `${MSP_ADMIN}@${w.entra.primaryDomain}`);
  if (e && !e.roles.some((r) => r.role === 'Authentication Administrator')) {
    e.roles.push({ role: 'Authentication Administrator', assignment: 'eligible', permanent: true, expires: null, justification: 'MSP delegated admin relationship (PIM eligible)' });
  }
  return w;
}
