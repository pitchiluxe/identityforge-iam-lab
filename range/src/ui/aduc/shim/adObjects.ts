/** Distinguished names, GUIDs and SIDs, as IAM Range's terminal/adObjects computes them. */
import type { Group, OrganizationalUnit, OuId, User } from './domain';
import type { Dir } from './session';
import { COMPANY } from '../../../world/company.ts';

const DOMAIN_DN = COMPANY.domain.split('.').map((p) => `DC=${p}`).join(',');
export const USERS_CONTAINER_DN = `CN=Users,${DOMAIN_DN}`;
const escRdn = (v: string): string => v.replace(/([,+"\\<>;=])/g, '\\$1');

export function ouChain(dir: Dir, ouId: OuId | undefined): OrganizationalUnit[] {
  const out: OrganizationalUnit[] = [];
  let cur = ouId ? dir.getOu(ouId) : undefined;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? dir.getOu(cur.parentId) : undefined;
  }
  return out;
}

export function ouDn(dir: Dir, ouId: OuId): string {
  return `${ouChain(dir, ouId).map((o) => `OU=${escRdn(o.name)}`).join(',')},${DOMAIN_DN}`;
}

export function containerDn(dir: Dir, ouId: OuId | undefined): string {
  return ouId && dir.getOu(ouId) ? ouDn(dir, ouId) : USERS_CONTAINER_DN;
}

export const userDn = (dir: Dir, u: User): string => `CN=${escRdn(u.displayName)},${containerDn(dir, u.ouId)}`;
export const groupDn = (dir: Dir, g: Group): string => `CN=${escRdn(g.name)},${containerDn(dir, g.ouId)}`;

function hash(s: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
const hex = (n: number, len: number): string => (n >>> 0).toString(16).padStart(8, '0').slice(-len);

export function guidFor(id: string): string {
  const a = hash(id, 1), b = hash(id, 2), c = hash(id, 3), d = hash(id, 4);
  return `${hex(a, 8)}-${hex(b, 4)}-4${hex(b >>> 16, 3)}-${hex(8 + (c & 3), 1)}${hex(c >>> 4, 3)}-${hex(d, 8)}${hex(c >>> 16, 4)}`;
}

const DOMAIN_SID = `S-1-5-21-${hash(COMPANY.domain, 11) % 4000000000}-${hash(COMPANY.domain, 12) % 4000000000}-${hash(COMPANY.domain, 13) % 4000000000}`;
const WELL_KNOWN_RID: Record<string, number> = { administrator: 500, guest: 501, krbtgt: 502 };

export function sidFor(id: string, samAccountName: string): string {
  const rid = WELL_KNOWN_RID[samAccountName.toLowerCase()] ?? 1100 + (hash(id, 7) % 800000);
  return `${DOMAIN_SID}-${rid}`;
}
