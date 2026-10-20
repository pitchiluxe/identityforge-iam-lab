/**
 * world/audit.ts — the one place every system writes its log.
 *
 * Event Viewer, the Entra audit/sign-in blades and the Okta System Log are
 * views over this list filtered by source, the same way a SIEM would see it.
 */
import type { AuditEvent, AuditSource, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';

export const AD_EVENT_NAMES: Record<number, string> = {
  4624: 'An account was successfully logged on',
  4625: 'An account failed to log on',
  4634: 'An account was logged off',
  4723: "An attempt was made to change an account's password",
  4720: 'A user account was created',
  4722: 'A user account was enabled',
  4724: "An attempt was made to reset an account's password",
  4725: 'A user account was disabled',
  4726: 'A user account was deleted',
  4727: 'A security-enabled global group was created',
  4728: 'A member was added to a security-enabled global group',
  4729: 'A member was removed from a security-enabled global group',
  4732: 'A member was added to a security-enabled local group',
  4733: 'A member was removed from a security-enabled local group',
  4730: 'A security-enabled global group was deleted',
  4737: 'A security-enabled global group was changed',
  4738: 'A user account was changed',
  4781: 'The name of an account was changed',
  5137: 'A directory service object was created',
  5141: 'A directory service object was deleted',
  4740: 'A user account was locked out',
  4767: 'A user account was unlocked',
  4771: 'Kerberos pre-authentication failed',
  5136: 'A directory service object was modified',
  5139: 'A directory service object was moved',
};

export interface AuditInput {
  source: AuditSource;
  action: string;
  target: string;
  actor?: string;
  detail?: string;
  eventId?: number | null;
  origin?: string;
  time?: string;
}

export function audit(w: World, e: AuditInput): AuditEvent {
  const ev: AuditEvent = {
    id: ++w.counters.audit,
    time: e.time ?? nowIso(),
    source: e.source,
    eventId: e.eventId ?? null,
    actor: e.actor ?? w.player.adminSam,
    action: e.action,
    target: e.target,
    detail: e.detail ?? '',
    origin: e.origin ?? 'MHS-IAM-WKS01',
  };
  w.audit.push(ev);
  // Keep the log bounded; a real SIEM retains far more, but the browser does not need to.
  if (w.audit.length > 4000) w.audit.splice(0, w.audit.length - 4000);
  return ev;
}

export function eventsFor(w: World, source: AuditSource): AuditEvent[] {
  return w.audit.filter((e) => e.source === source).sort((a, b) => b.time.localeCompare(a.time) || b.id - a.id);
}
