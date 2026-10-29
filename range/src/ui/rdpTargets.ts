/**
 * ui/rdpTargets.ts — what Remote Desktop offers to connect to, by company.
 *
 * One folder per company (Meridian first), each person with the computer they
 * use and their account state as AD shows it, plus machines reclaimed from
 * people who were deleted. Pure, so it is tested without the DOM.
 */
import type { World } from '../core/types.ts';
import { isAfter, nowIso } from '../core/time.ts';

export type RdpAccountState = 'ok' | 'disabled' | 'locked' | 'expired';

export interface RdpPerson {
  sam: string;
  displayName: string;
  machine: string;
  state: RdpAccountState;
}

export interface RdpFolder {
  id: string;
  name: string;
  domain: string;
  people: RdpPerson[];
  reclaimed: string[];
}

export function rdpFolders(worlds: { id: string; w: World }[]): RdpFolder[] {
  const now = nowIso();
  return worlds.map(({ id, w }) => {
    const people: RdpPerson[] = [];
    // One row per enabled computer a person uses (a second laptop is its own row); disabled machines are not offered.
    for (const u of w.ad.users.filter((x) => x.kind === 'user')) {
      const state: RdpAccountState = !u.enabled ? 'disabled' : u.lockedOut ? 'locked' : u.accountExpires && !isAfter(u.accountExpires, now) ? 'expired' : 'ok';
      for (const pc of w.ad.computers.filter((c) => c.primaryUser === u.sam && c.enabled)) people.push({ sam: u.sam, displayName: u.displayName, machine: pc.name, state });
    }
    people.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.machine.localeCompare(b.machine));
    const reclaimed = w.ad.computers.filter((c) => !c.primaryUser && c.description?.startsWith('Reclaimed')).map((c) => c.name);
    return { id, name: w.company.name, domain: w.ad.domain, people, reclaimed };
  });
}
