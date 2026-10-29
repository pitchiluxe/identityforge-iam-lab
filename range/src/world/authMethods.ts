/**
 * world/authMethods.ts — authentication methods administration and Temporary
 * Access Passes, authorised as Entra does it.
 *
 * Non-admin users: Authentication Administrator (or Privileged Authentication
 * Administrator / Global Administrator). Anyone holding a directory role:
 * Privileged Authentication Administrator or Global Administrator only. The
 * tenant's methods policy is changed by an Authentication Policy Administrator.
 */
import type { EntraUser, World } from '../core/types.ts';
import { nowIso, nowMs } from '../core/time.ts';
import { audit } from './audit.ts';
import { deleteMfaMethod, requireMfaReregistration } from './cloud.ts';
import { rolesOf } from './entraAdmin.ts';

const NO_RIGHTS = 'Insufficient privileges to complete the operation.';
export const AUTH_METHODS = ['Microsoft Authenticator', 'FIDO2 security key', 'SMS', 'Voice call', 'Temporary Access Pass', 'Email OTP'] as const;
export type AuthMethod = typeof AUTH_METHODS[number];

function person(w: World, upn: string): EntraUser {
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === upn.toLowerCase() && !x.deleted);
  if (!e) throw new Error(`Resource '${upn}' does not exist or one of its queried reference-property objects are not present.`);
  return e;
}

function canManageMethods(w: World, actor: string, target: EntraUser): void {
  const mine = rolesOf(w, actor);
  const top = mine.includes('Global Administrator') || mine.includes('Privileged Authentication Administrator');
  if (top) return;
  if (target.roles.length || !mine.includes('Authentication Administrator')) throw new Error(NO_RIGHTS);
}

export function methodPolicy(w: World): Record<AuthMethod, boolean> {
  return (w.entra.authMethodsPolicy ??= { 'Microsoft Authenticator': true, 'FIDO2 security key': true, SMS: true, 'Voice call': false, 'Temporary Access Pass': true, 'Email OTP': true });
}

export function setMethodPolicy(w: World, actorUpn: string, method: AuthMethod, enabled: boolean): void {
  const mine = rolesOf(w, actorUpn);
  if (!mine.includes('Global Administrator') && !mine.includes('Authentication Policy Administrator')) throw new Error(NO_RIGHTS);
  methodPolicy(w)[method] = enabled;
  audit(w, { source: 'Entra ID', action: 'Update authentication methods policy', target: method, actor: actorUpn, detail: enabled ? 'Enabled' : 'Disabled' });
}

export function requireReregisterAs(w: World, actorUpn: string, upn: string): EntraUser {
  canManageMethods(w, actorUpn, person(w, upn));
  return requireMfaReregistration(w, upn, actorUpn);
}

export function deleteMethodAs(w: World, actorUpn: string, upn: string, index: number): EntraUser {
  canManageMethods(w, actorUpn, person(w, upn));
  return deleteMfaMethod(w, upn, index, actorUpn);
}

/** Issue a Temporary Access Pass (60-480 minutes; one-time or multi-use). Returns the pass, shown once. */
export function issueTap(w: World, actorUpn: string, upn: string, minutes: number, oneTime: boolean): { code: string; expires: string } {
  const e = person(w, upn);
  canManageMethods(w, actorUpn, e);
  if (!methodPolicy(w)['Temporary Access Pass']) throw new Error('Temporary Access Pass is not enabled in the authentication methods policy.');
  if (!(minutes >= 60 && minutes <= 480)) throw new Error('The lifetime must be between 60 and 480 minutes (tenant policy).');
  // Deterministic for the lab (no Math.random in world code): derived from the seed, user and time.
  let h = ((w.seed ^ 0x9e3779b9) >>> 0) || 1;
  for (const ch of `${e.upn}|${nowIso()}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    // xorshift32: every character comes from freshly mixed bits.
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    code += alphabet[h % alphabet.length];
  }
  const expires = new Date(nowMs() + minutes * 60_000).toISOString();
  e.tap = { code, expires, oneTime, used: false };
  audit(w, { source: 'Entra ID', action: 'Create Temporary Access Pass', target: e.upn, actor: actorUpn, detail: `${oneTime ? 'One-time' : 'Multi-use'}, valid ${minutes} minutes, until ${expires}` });
  return { code, expires };
}

/** Sign in with a Temporary Access Pass: true if accepted (a one-time pass is then spent). */
export function redeemTap(w: World, upn: string, code: string): boolean {
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === upn.toLowerCase() && !x.deleted);
  const tap = e?.tap;
  if (!e || !e.accountEnabled || !tap || tap.code !== code || tap.expires <= nowIso() || (tap.oneTime && tap.used)) return false;
  tap.used = true;
  audit(w, { source: 'Entra ID', action: 'Sign-in with Temporary Access Pass', target: e.upn, actor: e.upn, detail: tap.oneTime ? 'One-time pass used' : 'Multi-use pass used' });
  return true;
}
