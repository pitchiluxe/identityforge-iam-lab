/**
 * world/workstations.ts — every person at an MSP company has a computer.
 *
 * createUser calls assignWorkstation for company worlds, so a machine appears
 * however the person was created (seed, ADUC, PowerShell, a portal). Remote
 * Desktop lists these machines by company so the learner can help a user on
 * their own computer or sign in as them to prove a fix. Meridian keeps its
 * own laptops from world/seed.ts and is not touched here.
 */
import type { AdComputer, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { profileById } from './profiles.ts';

const FIRST_NUMBER = 1001;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export function workstationOf(w: World, sam: string): AdComputer | undefined {
  return w.ad.computers.find((c) => c.primaryUser === sam && /-WKS-\d{4}$/.test(c.name));
}

/**
 * Company worlds saved before workstations existed: give everyone who has none
 * their machine on load, as ensureLabPasswords does for passwords.
 */
export function ensureWorkstations(w: World): World {
  if (w.profileId) for (const u of w.ad.users) if (u.kind === 'user' && !workstationOf(w, u.sam)) assignWorkstation(w, u.sam);
  return w;
}

/** The person's workstation, created on first call (company worlds only). */
export function assignWorkstation(w: World, sam: string): AdComputer {
  const existing = workstationOf(w, sam);
  if (existing) return existing;
  const p = w.profileId ? profileById(w.profileId) : undefined;
  if (!p) throw new Error(`Workstations are assigned in MSP company worlds only (${w.ad.domain}).`);
  const used = w.ad.computers.map((c) => new RegExp(`^${p.prefix}-WKS-(\\d{4})$`).exec(c.name)).filter((m) => m).map((m) => Number(m![1]));
  const n = used.length ? Math.max(...used) + 1 : FIRST_NUMBER;
  const name = `${p.prefix}-WKS-${n}`;
  const h = hash(`${w.ad.domain}/${name}`);
  const user = w.ad.users.find((u) => u.sam === sam);
  const pc: AdComputer = {
    name,
    ou: w.ad.ous.includes(p.computersOu) ? p.computersOu : 'Computers',
    os: 'Windows 11 Enterprise',
    enabled: true,
    lastLogon: user?.lastLogon ?? nowIso(),
    primaryUser: sam,
    ip: `10.50.${20 + (h % 40)}.${10 + ((h >>> 8) % 240)}`,
  };
  w.ad.computers.push(pc);
  return pc;
}
