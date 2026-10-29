/**
 * ui/azureSession.ts — signing in to the lab Azure portal.
 *
 * Only lab tenants exist: an address whose domain is not one of the eleven
 * tenants (or their AD domains) never resolves, so a real Microsoft account
 * cannot be used here. Pure and read-only; tested in node.
 */
import type { World } from '../core/types.ts';
import { MSP_ADMIN } from '../world/mspSeed.ts';
import { MSP_COMPANIES } from '../world/profiles.ts';
import { portalAdminUpn } from '../world/azure.ts';

export interface PortalSession {
  tenant: string;
  upn: string;
}

const NO_USER = 'This username may be incorrect. Make sure you typed it correctly. Otherwise, contact your admin.';
const BAD_PASSWORD = "Your account or password is incorrect. If you don't remember your password, reset it now.";
const LOCKED = 'Your account has been locked. Contact your support person to unlock it, then try again.';

/** Every lab tenant, from the profiles: listing them never opens a company world. */
export function labTenants(meridian: { domain: string; tenant: string }): { domain: string; tenant: string }[] {
  return [meridian, ...MSP_COMPANIES.map((p) => ({ domain: p.domain, tenant: p.tenant }))];
}

/** A portal session stays valid while its account exists, is enabled, and has not had its sessions revoked since. */
export function sessionValid(w: World, upn: string, since: string): boolean {
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === upn.toLowerCase());
  return !!e && !e.deleted && e.accountEnabled && e.sessionsValidFrom <= since;
}

/** Which lab domain an address belongs to (by tenant or AD domain), or null for anything outside the lab. */
export function tenantForUpn(upn: string, tenants: { domain: string; tenant: string }[]): string | null {
  const at = upn.trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return null;
  const d = upn.trim().toLowerCase().slice(at + 1);
  return tenants.find((t) => t.domain.toLowerCase() === d || t.tenant.toLowerCase() === d)?.domain ?? null;
}

/**
 * Check a sign-in against a tenant. The learner's own admin account (msp-admin
 * in a company, the IAM engineer in Meridian) uses the workstation sign-in
 * password; other cloud accounts their lab password; synced users their AD one.
 */
export function authenticate(w: World, upn: string, password: string, workstationPassword: string): { ok: true; upn: string } | { ok: false; message: string } {
  const e = w.entra.users.find((x) => x.upn.toLowerCase() === upn.trim().toLowerCase() && !x.deleted);
  if (!e) return { ok: false, message: NO_USER };
  if (!e.accountEnabled) return { ok: false, message: LOCKED };
  const own = e.upn.toLowerCase() === portalAdminUpn(w).toLowerCase() || e.upn.toLowerCase().startsWith(`${MSP_ADMIN}@`);
  const expected = own ? workstationPassword : e.source === 'synced' ? w.ad.users.find((u) => u.sam === e.onPremSam)?.labPassword ?? null : e.labPassword ?? null;
  if (!expected || password !== expected) return { ok: false, message: BAD_PASSWORD };
  return { ok: true, upn: e.upn };
}
