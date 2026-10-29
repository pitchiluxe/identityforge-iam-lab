/**
 * world/portalAccounts.ts — "Create account" on the lab Azure portal.
 *
 * A learner can make their own lab admin account in a tenant instead of using
 * msp-admin. It gets the same delegated rights the MSP holds (User and Groups
 * Administrator in Entra; Contributor and User Access Administrator on the
 * subscriptions) and never Global Administrator. Only lab tenants exist here;
 * no real Microsoft account is involved.
 */
import type { EntraUser, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { audit } from './audit.ts';
import { objectIdFor } from './cloud.ts';
import { ensureAzure, scopeOf } from './azure.ts';

const ACTOR = 'Lab account sign-up';

export function createLabAccount(w: World, input: { displayName: string; nickname: string; password: string }): EntraUser {
  const nick = input.nickname.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(nick)) throw new Error('Use 2-40 letters, numbers, periods, hyphens or underscores for the user name.');
  if (!input.displayName.trim()) throw new Error('Enter your name.');
  if (input.password.length < 12 || [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(input.password)).length < 3) {
    throw new Error('Use at least 12 characters with three of: upper case, lower case, numbers, symbols.');
  }
  const upn = `${nick}@${w.entra.primaryDomain}`;
  if (w.entra.users.some((e) => e.upn.toLowerCase() === upn)) throw new Error('Another object with the same value for property userPrincipalName already exists.');
  const t = nowIso();
  const e: EntraUser = {
    id: objectIdFor(w.seed, upn), upn, displayName: input.displayName.trim(), source: 'cloud', userType: 'Member', onPremSam: null, accountEnabled: true,
    department: 'Managed service provider', jobTitle: 'MSP engineer (lab account)', groups: [], mfaMethods: [{ type: 'Microsoft Authenticator', detail: 'Registered at sign-up', added: t }], mfaResetAt: null, sessionsValidFrom: t, sessions: [],
    roles: ['User Administrator', 'Groups Administrator'].map((role) => ({ role, assignment: 'active' as const, permanent: true, expires: null, justification: 'MSP delegated admin relationship (lab account)' })),
    licenses: [], riskLevel: 'none', deleted: false, labPassword: input.password, usageLocation: 'US',
  };
  w.entra.users.push(e);
  audit(w, { source: 'Entra ID', action: 'Add user', target: upn, actor: ACTOR, detail: 'Lab admin account created from the portal sign-up page' });
  const a = ensureAzure(w);
  for (const s of a.subscriptions) for (const role of ['Contributor', 'User Access Administrator']) {
    const scope = scopeOf({ subscription: s.id });
    a.assignments.push({ id: objectIdFor(w.seed, `ra:${upn}:${role}:${scope}`), principal: upn, principalType: 'User', role, scope, created: t, createdBy: ACTOR });
    audit(w, { source: 'Azure', action: 'Create role assignment', target: scope, actor: ACTOR, detail: `${role} to user ${upn}` });
  }
  return e;
}
