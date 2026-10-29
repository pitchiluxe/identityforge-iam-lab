/**
 * scenarios/msp/common.ts — helpers MSP templates share. Everything is read from
 * the company's profile (world/profiles.ts), so one template works for every
 * customer: its departments, naming standard, birthright and tenant.
 */
import type { AdUser, Worker, World } from '../../core/types.ts';
import { profileById, type CompanyProfile, type ProfileRole } from '../../world/profiles.ts';
import { MSP_ADMIN } from '../../world/mspSeed.ts';
import { findUser } from '../../world/directory.ts';
import { busySams, type BuildCtx } from '../template.ts';

export function profileOf(w: World): CompanyProfile {
  const p = w.profileId ? profileById(w.profileId) : undefined;
  if (!p) throw new Error('This lab runs in an MSP customer company.');
  return p;
}

/** The MSP engineer's cloud admin account in this tenant. */
export const mspUpn = (w: World): string => `${MSP_ADMIN}@${w.entra.primaryDomain}`;

export function roleOfTitle(p: CompanyProfile, title: string): ProfileRole | undefined {
  return p.roles.find((r) => r.title === title);
}

export function birthrightOf(p: CompanyProfile, role: ProfileRole): string[] {
  return [...new Set([...p.baseAccess, role.roleGroup, ...(p.roleAccess[role.roleGroup] ?? [])])];
}

const hrOf = (w: World, u: AdUser): Worker | undefined => w.hr.workers.find((x) => x.employeeId === u.employeeId);

/** Active, enabled staff with an HR record and a profile job role, not used by another open lab. */
/** Every value an open lab recorded (sam, UPN, email...): a person named there is busy. */
function busySubjects(w: World): Set<string> {
  const out = new Set<string>(busySams(w));
  for (const s of w.scenarios) if (s.status === 'active') for (const v of Object.values(s.params)) for (const x of v.split(/[|,]/)) out.add(x.toLowerCase());
  return out;
}

export function staff(ctx: BuildCtx, pred: (u: AdUser, role: ProfileRole) => boolean = () => true): AdUser[] {
  const p = profileOf(ctx.w);
  const busy = busySubjects(ctx.w);
  return ctx.w.ad.users.filter((u) => {
    if (u.kind !== 'user' || !u.enabled || busy.has(u.sam) || busy.has(u.sam.toLowerCase()) || busy.has(u.upn.toLowerCase())) return false;
    const role = roleOfTitle(p, u.title);
    return !!role && hrOf(ctx.w, u)?.status === 'Active' && pred(u, role);
  });
}

export function pickStaff(ctx: BuildCtx, pred?: (u: AdUser, role: ProfileRole) => boolean): AdUser {
  const pool = staff(ctx, pred);
  if (!pool.length) throw new Error('No suitable person is free in this company for this ticket.');
  return ctx.rng.pick(pool);
}

export function leadOf(w: World, dept: string): AdUser | undefined {
  const p = profileOf(w);
  const r = p.roles.find((x) => x.department === dept && x.lead);
  return w.ad.users.find((u) => u.kind === 'user' && u.enabled && u.title === r?.title);
}

/** Who raises HR-driven tickets: someone in HR, else the first department lead. */
export function hrContact(w: World): AdUser {
  const p = profileOf(w);
  return leadOf(w, 'HR') ?? leadOf(w, p.departments[0]!)!;
}

/** A senior person the company would recognise as an executive (first department's lead). */
export function executive(w: World): AdUser {
  const p = profileOf(w);
  return leadOf(w, p.departments[0]!)!;
}

const FIRST = ['Maya', 'Liam', 'Chloe', 'Ethan', 'Aisha', 'Mateo', 'Freya', 'Ravi', 'Elena', 'Jamal', 'Sara', 'Diego', 'Nora', 'Kai', 'Lucia', 'Owen', 'Amara', 'Hugo'];
const LAST = ['Okafor', 'Petrov', 'Nakamura', 'Varga', 'Haddad', 'Silva', 'Holm', 'Kapoor', 'Popescu', 'Wright', 'Lindgren', 'Castillo', 'Fitzgerald', 'Yamamoto', 'Romano', 'Gallagher', 'Diallo', 'Lefevre'];

/** A new hire nobody in the company has yet, with the logon name the naming standard gives them. */
export function newHire(ctx: BuildCtx): { first: string; last: string; sam: string } {
  const p = profileOf(ctx.w);
  const clean = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');
  for (let i = 0; i < 200; i++) {
    const first = ctx.rng.pick(FIRST), last = ctx.rng.pick(LAST);
    if (ctx.w.hr.workers.some((x) => x.first === first && x.last === last)) continue;
    const sam = p.samFormat === 'first.last' ? `${clean(first)}.${clean(last)}` : p.samFormat === 'flast' ? `${clean(first)[0]}${clean(last)}` : `${clean(first)}${clean(last)[0]}`;
    if (!findUser(ctx.w, sam) && !busySams(ctx.w).has(sam)) return { first, last, sam };
  }
  throw new Error('No free new-hire name.');
}

export const hasStaff = (w: World): boolean => !!w.profileId && w.ad.users.some((u) => u.kind === 'user' && u.enabled);
