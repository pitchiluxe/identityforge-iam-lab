/**
 * world/labaccounts.ts — the passwords the range knows, for the learner's
 * reference sheet in IAM Coach.
 *
 * Real AD keeps only a hash and no administrator ever reads a password. The
 * range is a lab: to test a sign-in as a user (Remote Desktop, verify-a-fix)
 * the learner needs a password that works, so every seeded employee gets one,
 * derived from the world seed and the account name so it is stable across
 * reloads. Synced accounts sign in to Entra ID with the same password
 * (password hash sync). Admin, service and break-glass credentials are not on
 * the sheet: they live in the PAM vault, and checking them out is the lab.
 */
import type { AdUser, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';

const WORDS = ['Cedar', 'Harbor', 'Maple', 'Summit', 'Willow', 'Falcon', 'Meadow', 'Granite', 'Lantern', 'Orchard', 'Beacon', 'Juniper'];
const MARKS = ['!', '#', '$', '%', '?', '*'];

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** A password that meets the domain policy (12+ characters, 3+ classes). */
export function seedPassword(seed: number, sam: string): string {
  const h = hash(`${seed}:${sam.toLowerCase()}`);
  const a = WORDS[h % WORDS.length]!;
  const b = WORDS[(h >>> 8) % WORDS.length]!;
  return `${a}-${b}-${String(1000 + ((h >>> 12) % 9000))}${MARKS[(h >>> 4) % MARKS.length]}`;
}

/** Accounts that appear on the sheet: people, not the learner's own or privileged ones. */
export function onSheet(w: World, u: AdUser): boolean {
  return u.kind === 'user' && u.sam !== w.player.sam;
}

/**
 * Gives every employee still on the password they had when the company was
 * seeded a known one. Once the audit log shows a reset (4724) or a change
 * (4723), the range only knows what was typed; a reset through Read-Host
 * stays unknown, as it would to any administrator. Works on saved worlds too.
 */
export function ensureLabPasswords(w: World): World {
  const changed = new Set(w.audit.filter((e) => e.eventId === 4724 || e.eventId === 4723).map((e) => e.target));
  for (const u of w.ad.users) if (onSheet(w, u) && !u.labPassword && !changed.has(u.sam) && u.pwdLastSet) u.labPassword = seedPassword(w.seed, u.sam);
  return w;
}

export interface LabAccountRow {
  name: string;
  sam: string;
  upn: string;
  department: string;
  ou: string;
  password: string | null;
  status: string;
  inEntra: boolean;
}

export function labAccounts(w: World): LabAccountRow[] {
  return w.ad.users.filter((u) => onSheet(w, u)).map((u) => ({
    name: u.displayName,
    sam: u.sam,
    upn: u.upn,
    department: u.department,
    ou: u.ou,
    password: u.labPassword ?? null,
    status: [!u.enabled && 'Disabled', u.lockedOut && 'Locked out', u.mustChangePassword && 'Must change password', u.accountExpires && u.accountExpires <= nowIso() && 'Expired'].filter(Boolean).join(', ') || 'Active',
    inEntra: w.entra.users.some((e) => e.onPremSam === u.sam && !e.deleted),
  })).sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
}

export interface CloudLabAccountRow {
  name: string;
  upn: string;
  password: string | null;
  note: string;
  status: string;
}

/**
 * Cloud-only accounts that sign in to the lab Azure portal: users created there
 * (New user, Create account), each with the password set for them, and the MSP
 * admin, whose password is the workstation sign-in password. Break-glass and
 * other accounts with no lab password are not listed.
 */
export function cloudLabAccounts(w: World): CloudLabAccountRow[] {
  return w.entra.users.filter((e) => e.source === 'cloud' && !e.deleted && (e.labPassword || e.upn.startsWith('msp-admin@')))
    .map((e) => ({
      name: e.displayName,
      upn: e.upn,
      password: e.upn.startsWith('msp-admin@') ? null : e.labPassword ?? null,
      note: e.upn.startsWith('msp-admin@') ? 'Your workstation sign-in password' : e.userType === 'Guest' ? 'Guest' : e.mustChangePassword ? 'Must change at next sign-in' : '',
      status: e.accountEnabled ? 'Active' : 'Blocked',
    }))
    .sort((a, b) => Number(!a.upn.startsWith('msp-admin@')) - Number(!b.upn.startsWith('msp-admin@')) || a.name.localeCompare(b.name));
}

/**
 * Accounts a lab's backdrop created with a password nobody typed in the range
 * (the service desk "set one") get a known one too, so the learner can test
 * them. Accounts the learner creates keep exactly what the learner set.
 */
export function issueBackdropPasswords(w: World, existing: ReadonlySet<string>): void {
  for (const u of w.ad.users) if (!existing.has(u.sam) && onSheet(w, u) && !u.labPassword && u.pwdLastSet) u.labPassword = seedPassword(w.seed, u.sam);
}
