/**
 * ui/companies.ts — the MSP customer companies, alongside Meridian.
 *
 * Meridian is the workstation's own world (store.world). Each MSP company is a
 * World of its own, generated from its profile seed the first time anything
 * opens it, and saved under its own key only once it differs from that seed.
 * Ten worlds that nobody has opened cost nothing in localStorage.
 *
 * Nothing here touches the DOM, so it is tested directly in node.
 */
import type { World } from '../core/types.ts';
import { fmtDate, nowIso } from '../core/time.ts';
import { MSP_COMPANIES, profileById } from '../world/profiles.ts';
import { createCompanyWorld } from '../world/mspSeed.ts';
import { ensureWorkstations } from '../world/workstations.ts';
import { ensurePimDefaults } from '../world/pim.ts';
import { ensureTenantSecurity } from '../world/tenantSettings.ts';
import { objectIdFor, runEntraSync, runOktaImport } from '../world/cloud.ts';
import { WORLD_VERSION } from '../world/seed.ts';

const KEY = (id: string): string => `identityforge-range-company-${id}`;

const worlds = new Map<string, World>();
/** Companies read (HR export) but not opened: no scheduler, no save. Opening one moves it to `worlds`. */
const peeked = new Map<string, World>();
/** What each world looked like when last saved or seeded; a save happens only when it changes. */
const lastSaved = new Map<string, string>();
/** Characters each company currently occupies in localStorage. */
const stored = new Map<string, number>();
/**
 * localStorage holds about 5 MB per origin and Meridian's own world must
 * always fit, so the companies together get a fixed share of it.
 */
export const COMPANY_STORAGE_BUDGET = 2_000_000;
let meridian: () => World = () => { throw new Error('Meridian world not bound'); };

/** store.ts tells this module where Meridian's world lives (it can be replaced by a reset). */
export function bindMeridian(get: () => World): void {
  meridian = get;
}

function storage(): Storage | null {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
}

export function companyWorld(id: string): World {
  const cached = worlds.get(id);
  if (cached) return cached;
  const w = peeked.get(id) ?? savedOrSeed(id);
  peeked.delete(id);
  worlds.set(id, w);
  return w;
}

/**
 * Read a company without opening it (lists such as Remote Desktop's): no
 * scheduler, no save. companyWorld() later opens this same object.
 */
export function peekCompany(id: string): World {
  let w = worlds.get(id) ?? peeked.get(id);
  if (!w) { w = savedOrSeed(id); peeked.set(id, w); }
  return w;
}

/** A company's saved world, or a fresh one from its seed; does not open it. */
function savedOrSeed(id: string): World {
  const p = profileById(id);
  if (!p) throw new Error(`Unknown company '${id}'`);
  let w: World | null = null;
  try {
    const raw = storage()?.getItem(KEY(id));
    const saved = raw ? (JSON.parse(raw) as World) : null;
    if (saved && saved.version === WORLD_VERSION && saved.profileId === id) { w = ensurePimDefaults(ensureWorkstations(saved)); ensureTenantSecurity(w); lastSaved.set(id, raw!); stored.set(id, raw!.length); }
  } catch { /* unreadable save: start from the seed */ }
  if (!w) { w = createCompanyWorld(p); lastSaved.set(id, JSON.stringify(w)); }
  return w;
}

/** Companies opened in this session (only these run schedulers and get saved). */
export function materialisedWorlds(): World[] {
  return [...worlds.values()];
}

export function allDomains(): { id: string; domain: string; name: string; netbios: string }[] {
  const m = meridian();
  return [
    { id: 'meridian', domain: m.ad.domain, name: m.company.name, netbios: m.ad.netbios },
    ...MSP_COMPANIES.map((p) => ({ id: p.id, domain: p.domain, name: p.name, netbios: p.netbios })),
  ];
}

/**
 * The world behind a tenant as Connect-MgGraph -TenantId accepts it: tenant id,
 * onmicrosoft domain, AD domain or NetBIOS name. Only the match is opened.
 */
export function tenantLookup(tenant: string): World | undefined {
  const t = tenant.trim().toLowerCase();
  const p = MSP_COMPANIES.find((x) => [x.tenant, x.domain, x.netbios, objectIdFor(x.seed, `tenant:${x.name}`)].some((v) => v.toLowerCase() === t));
  if (p) return companyWorld(p.id);
  const m = meridian();
  return [m.entra.primaryDomain, m.ad.domain, m.ad.netbios, objectIdFor(m.seed, `tenant:${m.entra.tenantName}`)].some((v) => v.toLowerCase() === t) ? m : undefined;
}

/** The world behind a domain, by DNS or NetBIOS name, as -Server and Change Domain accept it. */
export function worldByDomain(domain: string): World | undefined {
  const d = domain.trim().toLowerCase();
  const hit = allDomains().find((x) => x.domain.toLowerCase() === d || x.netbios.toLowerCase() === d);
  if (!hit) return undefined;
  return hit.id === 'meridian' ? meridian() : companyWorld(hit.id);
}

/**
 * Save companies that changed since they were last saved or seeded, while the
 * companies together stay within their budget. A company that does not fit
 * (or a storage error) is reported in `skipped` and keeps working in memory.
 */
export function persistCompanies(budget = COMPANY_STORAGE_BUDGET): { saved: string[]; skipped: string[] } {
  const saved: string[] = [], skipped: string[] = [];
  for (const [id, w] of worlds) {
    const json = JSON.stringify(w);
    if (json === lastSaved.get(id)) continue;
    const others = [...stored].reduce((n, [k, v]) => (k === id ? n : n + v), 0);
    if (others + json.length > budget) { skipped.push(id); continue; }
    try {
      storage()?.setItem(KEY(id), json);
      lastSaved.set(id, json);
      stored.set(id, json.length);
      saved.push(id);
    } catch {
      skipped.push(id);
    }
  }
  return { saved, skipped };
}

/** Tests only: forget the in-memory worlds, as a page reload would. */
export function resetCompanyCache(): void {
  worlds.clear();
  peeked.clear();
  lastSaved.clear();
  stored.clear();
}

/**
 * One scheduler tick: Entra Connect every 30 minutes, Okta import hourly, for
 * every world given (Meridian and every opened company). Returns the worlds
 * that changed.
 */
export function syncDue(list: World[], now: number): World[] {
  const changed: World[] = [];
  for (const w of list) {
    let did = false;
    if (now - Date.parse(w.entra.lastSync) > 30 * 60_000) { runEntraSync(w, 'Microsoft Entra Connect (scheduler)'); did = true; }
    if (w.okta.orgUrl && now - Date.parse(w.okta.lastImport) > 60 * 60_000) { runOktaImport(w, 'Okta AD Agent (scheduled import)'); did = true; }
    if (did) changed.push(w);
  }
  return changed;
}

const csv = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Write each company's HR feed to the workstation as C:\MSP\<Company>\hr-feed.csv,
 * the export a learner's own JML script reads. Replaces the previous export.
 */
export function exportHrFeeds(workstation: World): void {
  const t = nowIso();
  for (const p of MSP_COMPANIES) {
    // A company nobody has opened is read from its seed without opening it: no scheduler, no save.
    const w = peekCompany(p.id);
    const byId = new Map(w.hr.workers.map((x) => [x.employeeId, x]));
    const rows = w.hr.workers.map((x) => {
      const m = x.managerId ? byId.get(x.managerId) : undefined;
      return [x.employeeId, x.first, x.last, x.department, x.title, m ? `${m.first} ${m.last}` : '', x.location, fmtDate(x.hireDate), x.termDate ? fmtDate(x.termDate) : '', x.status].map(csv).join(',');
    });
    const content = ['EmployeeId,FirstName,LastName,Department,Title,Manager,Location,StartDate,EndDate,Status', ...rows].join('\n') + '\n';
    const path = `C:\\MSP\\${p.name}\\hr-feed.csv`;
    const f = workstation.files.find((x) => x.path.toLowerCase() === path.toLowerCase());
    if (f) { if (f.content !== content) { f.content = content; f.modified = t; } }
    else workstation.files.push({ path, content, modified: t, readOnly: true });
  }
}
