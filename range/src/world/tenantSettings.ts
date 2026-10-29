/**
 * world/tenantSettings.ts — Conditional Access, named locations and the
 * break-glass account for an MSP company tenant, plus the What If tool.
 *
 * Each company gets the baseline real tenants run: block legacy
 * authentication, MFA for administrators, and a report-only high-risk block,
 * with an emergency-access (break-glass) account excluded from all of them.
 * Policies are changed only by Conditional Access or Security Administrators.
 */
import type { CaPolicy, EntraUser, World } from '../core/types.ts';
import { daysAgo } from '../core/time.ts';
import { audit } from './audit.ts';
import { addSignIn, deleteCaPolicy, objectIdFor, saveCaPolicy } from './cloud.ts';
import { rolesOf } from './entraAdmin.ts';
import { profileById } from './profiles.ts';

const NO_RIGHTS = 'Insufficient privileges to complete the operation.';
const CA_ADMINS = ['Global Administrator', 'Conditional Access Administrator', 'Security Administrator'];

function needCaAdmin(w: World, actor: string): void {
  if (!rolesOf(w, actor).some((r) => CA_ADMINS.includes(r))) throw new Error(NO_RIGHTS);
}

/** Lazily give a company its break-glass account, baseline CA policies and office named locations. */
export function ensureTenantSecurity(w: World): void {
  const p = w.profileId ? profileById(w.profileId) : undefined;
  // Applied once per tenant: what an admin later deletes stays deleted.
  if (!p || w.entra.securityBaseline) return;
  w.entra.securityBaseline = true;
  const bgUpn = `bg-emergency01@${p.tenant}`;
  if (!w.entra.users.some((e) => e.upn === bgUpn)) {
    const bg: EntraUser = {
      id: objectIdFor(w.seed, bgUpn), upn: bgUpn, displayName: 'Break Glass 01', source: 'cloud', userType: 'Member', onPremSam: null, accountEnabled: true,
      department: '', jobTitle: 'Emergency access', groups: [], mfaMethods: [{ type: 'FIDO2 security key', detail: 'Sealed envelope, CEO safe', added: daysAgo(300) }],
      mfaResetAt: null, sessionsValidFrom: daysAgo(30), sessions: [], licenses: [], riskLevel: 'none', deleted: false,
      roles: [{ role: 'Global Administrator', assignment: 'active', permanent: true, expires: null, justification: 'Emergency access account' }],
    };
    w.entra.users.push(bg);
    if (['research', 'frontline', 'merger'].includes(p.reality)) {
      const staff = w.entra.users.filter((e) => e.source === 'synced' && e.accountEnabled && !e.roles.length);
      const victim = staff[(p.seed >> 2) % Math.max(1, staff.length)];
      if (victim) {
        victim.riskLevel = p.reality === 'merger' ? 'high' : 'medium';
        addSignIn(w, { time: daysAgo(1), upn: victim.upn, app: 'Office 365', ip: '185.220.101.47', location: 'Unfamiliar location (anonymous IP)', device: 'Linux · Firefox', result: 'Success', failureReason: '', mfa: 'Satisfied', ca: 'Not applied', risk: victim.riskLevel });
      }
    }
  }
  if (!w.entra.namedLocations) {
    const octet = 16 + (p.seed % 200);
    w.entra.namedLocations = p.locations.filter((l) => !/^Remote/.test(l)).map((name, i) => ({ name, ips: [`203.0.${octet}.${i * 16}/28`], trusted: true }));
  }
  if (!w.entra.caPolicies.length) {
    const ex = [bgUpn];
    const base = { excludeUsers: ex, apps: 'All cloud apps' as const, created: daysAgo(200) };
    w.entra.caPolicies.push(
      { id: 'ca-001', name: 'CA001 - Block legacy authentication', state: 'on', includeUsers: 'All users', condition: 'legacy-auth', grant: 'block', ...base },
      { id: 'ca-002', name: 'CA002 - Require MFA for administrators', state: 'on', includeUsers: 'Directory roles', condition: 'none', grant: 'require-mfa', ...base },
      { id: 'ca-003', name: 'CA003 - Block high sign-in risk', state: 'report-only', includeUsers: 'All users', condition: 'sign-in-risk-high', grant: 'block', ...base },
    );
  }
}

export function saveCaPolicyAs(w: World, actorUpn: string, p: Omit<CaPolicy, 'id' | 'created'> & { id?: string }): CaPolicy {
  needCaAdmin(w, actorUpn);
  return saveCaPolicy(w, p, actorUpn);
}

export function deleteCaPolicyAs(w: World, actorUpn: string, id: string): void {
  needCaAdmin(w, actorUpn);
  deleteCaPolicy(w, id, actorUpn);
}

export function addNamedLocation(w: World, actorUpn: string, name: string, ips: string[], trusted: boolean): void {
  needCaAdmin(w, actorUpn);
  if (!name.trim()) throw new Error('Name is required.');
  for (const ip of ips) if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(ip)) throw new Error(`'${ip}' is not a valid IPv4 range in CIDR notation.`);
  (w.entra.namedLocations ??= []).push({ name: name.trim(), ips, trusted });
  audit(w, { source: 'Entra ID', action: 'Add named location', target: name.trim(), actor: actorUpn, detail: `${ips.join(', ')}; trusted ${trusted ? 'Yes' : 'No'}` });
}

function ipNum(ip: string): number {
  return ip.split('.').reduce((n, o) => (n * 256 + Number(o)) >>> 0, 0);
}

export function inRange(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipNum(ip) & mask) === (ipNum(base!) & mask);
}

export interface WhatIfResult { policy: string; state: CaPolicy['state']; applies: boolean; grant: CaPolicy['grant']; reason: string }

/** Which Conditional Access policies would apply to a sign-in, and why (the portal's What If tool). */
export function whatIf(w: World, s: { upn: string; app: string; ip: string; risk: 'none' | 'low' | 'medium' | 'high'; legacyAuth: boolean }): WhatIfResult[] {
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === s.upn.toLowerCase());
  const groups = new Set(e?.groups ?? []);
  const trusted = (w.entra.namedLocations ?? []).filter((n) => n.trusted).some((n) => n.ips.some((c) => inRange(s.ip, c)));
  return w.entra.caPolicies.map((p) => {
    const res = (applies: boolean, reason: string): WhatIfResult => ({ policy: p.name, state: p.state, applies, grant: p.grant, reason });
    if (p.state === 'off') return res(false, 'Policy is off.');
    if (p.excludeUsers.some((x) => x.toLowerCase() === s.upn.toLowerCase() || groups.has(x))) return res(false, 'User is excluded.');
    const included = p.includeUsers === 'All users' || (p.includeUsers === 'Directory roles' ? rolesOf(w, s.upn).length > 0 : p.includeUsers.toLowerCase() === s.upn.toLowerCase() || groups.has(p.includeUsers));
    if (!included) return res(false, p.includeUsers === 'Directory roles' ? 'User holds no active directory role.' : 'User is not included.');
    if (p.apps !== 'All cloud apps' && p.apps !== s.app) return res(false, `Application '${s.app}' is not targeted.`);
    if (p.condition === 'legacy-auth' && !s.legacyAuth) return res(false, 'Client app is not legacy authentication.');
    if (p.condition === 'sign-in-risk-high' && s.risk !== 'high') return res(false, 'Sign-in risk is not high.');
    if (p.condition === 'outside-trusted-locations' && trusted) return res(false, 'Sign-in is from a trusted named location.');
    return res(true, p.state === 'report-only' ? 'Would apply (report-only: not enforced).' : 'Applies.');
  });
}

export interface CaOutcome { allowed: boolean; message: string; policy: string | null; mfa: 'Satisfied' | 'Not required'; ca: 'Success' | 'Failure' | 'Not applied' }

/**
 * Conditional Access at sign-in (lab portal): the enforced ("on") policies that
 * apply decide. Report-only policies are logged, never enforced.
 */
export function caOutcome(w: World, upn: string, s: { ip: string; legacyAuth: boolean; usedTap?: boolean }): CaOutcome {
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === upn.toLowerCase());
  const applied = whatIf(w, { upn, app: 'Azure Portal', ip: s.ip, risk: e?.riskLevel ?? 'none', legacyAuth: s.legacyAuth }).filter((r) => r.applies && r.state === 'on');
  const block = applied.find((r) => r.grant === 'block');
  if (block) return { allowed: false, message: 'AADSTS53003: Access has been blocked by Conditional Access policies. The access policy does not allow token issuance.', policy: block.policy, mfa: 'Not required', ca: 'Failure' };
  const device = applied.find((r) => r.grant === 'require-compliant-device');
  if (device) return { allowed: false, message: 'AADSTS53000: Device is not in required device state: compliant. Conditional Access policy requires a compliant device, and the device is not compliant.', policy: device.policy, mfa: 'Not required', ca: 'Failure' };
  const mfa = applied.find((r) => r.grant === 'require-mfa');
  if (mfa && !s.usedTap && !(e?.mfaMethods.length)) return { allowed: false, message: 'AADSTS50079: Due to a configuration change made by your administrator, or because you moved to a new location, you must enroll in multi-factor authentication to access this resource.', policy: mfa.policy, mfa: 'Not required', ca: 'Failure' };
  return { allowed: true, message: '', policy: mfa?.policy ?? null, mfa: mfa ? 'Satisfied' : 'Not required', ca: applied.length ? 'Success' : 'Not applied' };
}
