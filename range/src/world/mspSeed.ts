/**
 * world/mspSeed.ts — builds an MSP customer company (world/profiles.ts) on day one.
 *
 * Each company is a full World, so every world function, ADUC, the PowerShell
 * engine and the grader work on it unchanged. The learner is the MSP engineer:
 * a delegated admin account in each company (msp-admin in AD, msp-admin@tenant
 * in Entra with User and Groups Administrator), never Tier 0 or Global
 * Administrator, the way a real MSP is granted access.
 *
 * The starting reality differs per company: Harborline is an empty domain the
 * learner builds, Kestrel carries years of drift, Alder Valley has term churn
 * queued in HR, Lumen has guests, Riverside has sponsored contractors, Summit
 * Ridge holds admin roles through PIM only, and Atlas is mid-merger with a
 * second naming convention.
 */
import type { AdUser, EntraUser, World } from '../core/types.ts';
import { createRng, type Rng } from '../core/rng.ts';
import { daysAgo, daysFromNow, minutesAgo, nowIso } from '../core/time.ts';
import type { CompanyProfile, ProfileRole } from './profiles.ts';
import { addMember, createOu, createUser, findUser } from './directory.ts';
import { objectIdFor, runEntraSync, runOktaImport } from './cloud.ts';
import { WORLD_VERSION } from './seed.ts';
import { ensureLabPasswords } from './labaccounts.ts';
import { ensurePimDefaults } from './pim.ts';
import { ensureTenantSecurity } from './tenantSettings.ts';

/** The learner's delegated admin account in every MSP company. */
export const MSP_ADMIN = 'msp-admin';
const MSP_GROUP = 'MSP Delegated Admins';
/**
 * Default containers of a new domain that hold users and groups (path form).
 * Computers and Domain Controllers are containers too, but ADUC draws them
 * itself; computers name them in AdComputer.ou.
 */
const DEFAULT_CONTAINERS = ['Users'];
const BUILTIN = 'Users';

const FIRST = [
  'Aaliyah', 'Ben', 'Carmen', 'Darius', 'Elif', 'Farah', 'Gabriel', 'Hiro', 'Imani', 'Jonah', 'Keira', 'Luis', 'Mira', 'Nikhil', 'Olga',
  'Pedro', 'Quinn', 'Rania', 'Stefan', 'Tamsin', 'Uma', 'Vikram', 'Wen', 'Ximena', 'Yusuf', 'Zainab', 'Aidan', 'Bianca', 'Chidi', 'Dana',
  'Emeka', 'Fiona', 'Goran', 'Hannah', 'Ismael', 'Jade', 'Kofi', 'Leila', 'Malik', 'Nadia', 'Orla', 'Paolo', 'Reza', 'Selin', 'Tobias',
  'Valeria', 'Wyatt', 'Yara', 'Zoltan', 'Anika', 'Bruno', 'Celine', 'Dmitri', 'Esme', 'Femi', 'Greta', 'Harun', 'Ingrid', 'Jasper', 'Kalani',
];
const LAST = [
  'Abara', 'Bergstrom', 'Calloway', 'Delgado', 'Eriksen', 'Fontaine', 'Gutierrez', 'Hollis', 'Iwasaki', 'Jovanovic', 'Kaplan', 'Lindahl',
  'Mbeki', 'Navarro', 'Oyelaran', 'Pellegrini', 'Quintero', 'Rasmussen', 'Szabo', 'Thorne', 'Ueda', 'Vasquez', 'Whitfield', 'Xu', 'Yilmaz',
  'Zielinski', 'Achterberg', 'Brannigan', 'Castellanos', 'Doherty', 'Ekwueme', 'Falk', 'Grigoryan', 'Halvorsen', 'Ibarra', 'Jaramillo',
  'Kowalczyk', 'Laurent', 'Moreno', 'Nakashima', 'Okonkwo', 'Petrovic', 'Rourke', 'Sandoval', 'Tanaka', 'Underwood', 'Varga', 'Winslow',
];

function samOf(format: CompanyProfile['samFormat'], first: string, last: string, taken: (s: string) => boolean): string {
  const clean = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = (format === 'first.last' ? `${clean(first)}.${clean(last)}` : format === 'flast' ? `${clean(first)[0]}${clean(last)}` : `${clean(first)}${clean(last)[0]}`).slice(0, 18);
  if (!taken(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken(`${base}${n}`)) return `${base}${n}`;
  throw new Error('Naming standard exhausted');
}

function emptyCompanyWorld(p: CompanyProfile, seed: number): World {
  return {
    version: WORLD_VERSION,
    profileId: p.id,
    seed,
    created: nowIso(),
    player: { displayName: 'Admin', sam: MSP_ADMIN, adminSam: MSP_ADMIN },
    company: { name: p.name, domain: p.domain },
    ad: { domain: p.domain, netbios: p.netbios, ous: [...DEFAULT_CONTAINERS], users: [], groups: [], computers: [] },
    entra: { tenantName: p.name, primaryDomain: p.tenant, users: [], groups: [], apps: [], caPolicies: [], signIns: [], syncScope: [...p.syncScope], lastSync: nowIso(), syncErrors: [] },
    okta: { orgUrl: p.hasOkta ? `https://${p.id}.okta.test` : '', users: [], apps: [], lastImport: nowIso() },
    saas: [],
    hr: { workers: [], transactions: [] },
    tickets: [],
    mail: [],
    files: [],
    audit: [],
    scenarios: [],
    counters: { ticket: 0, audit: 0, mail: 0, scenario: 0, signIn: 0 },
  };
}

function cloudUser(seed: number, upn: string, displayName: string, extra: Partial<EntraUser> = {}): EntraUser {
  return {
    id: objectIdFor(seed, upn), upn, displayName, source: 'cloud', onPremSam: null, accountEnabled: true, department: '', jobTitle: '',
    groups: [], mfaMethods: [], mfaResetAt: null, sessionsValidFrom: daysAgo(30), sessions: [], roles: [], licenses: [], riskLevel: 'none', deleted: false,
    ...extra,
  };
}

/** Spread headcount across departments; every department gets a lead first. */
function headcount(p: CompanyProfile, rng: Rng): string[] {
  const out: string[] = [];
  if (!p.staff) return out;
  for (const d of p.departments) out.push(d);
  while (out.length < p.staff) out.push(rng.pick(p.departments));
  return out.slice(0, p.staff);
}

export function createCompanyWorld(p: CompanyProfile, seed = p.seed): World {
  const rng = createRng(seed);
  const w = emptyCompanyWorld(p, seed);
  const actor = `${p.netbios}\\svc-provisioning`;
  const taken = (s: string): boolean => !!findUser(w, s);

  for (const name of ['Domain Admins', 'Enterprise Admins', 'Account Operators']) {
    w.ad.groups.push({ name, ou: BUILTIN, scope: 'Global', category: 'Security', description: `Built-in: ${name}`, managedBy: null, privileged: true });
  }
  w.ad.groups.push(
    { name: 'Domain Users', ou: BUILTIN, scope: 'Global', category: 'Security', description: 'All domain users', managedBy: null, privileged: false },
    { name: MSP_GROUP, ou: BUILTIN, scope: 'Global', category: 'Security', description: 'Managed service provider: delegated user and group administration (not Tier 0)', managedBy: null, privileged: true },
  );

  if (p.reality !== 'greenfield') {
    for (const ou of p.ous) {
      const i = ou.lastIndexOf('/');
      createOu(w, i < 0 ? ou : ou.slice(i + 1), i < 0 ? null : ou.slice(0, i), {}, actor);
    }
    for (const g of p.groups) w.ad.groups.push({ name: g.name, ou: p.groupsOu, scope: 'Global', category: 'Security', description: g.description, managedBy: null, privileged: !!g.privileged });
  }

  // The learner: delegated MSP admin, in the default Users container on a new domain.
  const msp = createUser(w, { sam: MSP_ADMIN, givenName: 'MSP', surname: 'Engineer', displayName: 'MSP Engineer (Admin)', ou: p.reality === 'greenfield' ? BUILTIN : p.adminsOu, title: 'Managed service provider administrator', description: 'Delegated admin account for the MSP (GDAP-style)', enabled: true, passwordSet: true, mustChangePassword: false, kind: 'admin' }, actor);
  msp.created = daysAgo(p.reality === 'greenfield' ? 1 : rng.int(30, 400));
  addMember(w, MSP_GROUP, MSP_ADMIN, actor);

  // Employees
  let emp = 200000 + (seed % 100) * 1000;
  const leads = new Map<string, { sam: string; id: string }>();
  const plan = headcount(p, rng);
  const used = new Set<string>();
  const merger = p.reality === 'merger';
  plan.forEach((dept, i) => {
    let first: string, last: string;
    do { first = rng.pick(FIRST); last = rng.pick(LAST); } while (used.has(`${first} ${last}`));
    used.add(`${first} ${last}`);
    const isLead = !leads.has(dept);
    const role = p.roles.find((r) => r.department === dept && r.lead === isLead) as ProfileRole;
    // Atlas: roughly one in four people came from the acquired company and kept its first-initial naming standard.
    const legacy = merger && !isLead && i % 4 === 3;
    const location = isLead ? p.locations[0] : legacy ? p.locations[p.locations.length - 1] : rng.pick(p.locations);
    const employeeId = `${p.prefix}${++emp}`;
    const contractor = p.reality === 'government' && !isLead && i % 9 === 4;
    const sam = samOf(legacy ? 'flast' : p.samFormat, first, last, taken);
    const lead = leads.get(dept) ?? null;
    const u = createUser(w, {
      sam, givenName: first, surname: last, ou: `${p.usersOu}/${dept}`, department: dept, title: role.title, manager: lead?.sam ?? null,
      employeeId, office: location, enabled: true, passwordSet: true, mustChangePassword: false,
      description: contractor ? `Contractor. Sponsor: ${lead ? findUser(w, lead.sam)!.displayName : 'department head'}` : '',
    }, actor);
    u.created = daysAgo(rng.int(60, 6 * 365));
    u.whenChanged = daysAgo(rng.int(1, 40));
    u.pwdLastSet = daysAgo(rng.int(2, 85));
    u.lastLogon = minutesAgo(rng.int(20, 60 * 50));
    const termDate = contractor ? daysFromNow(rng.int(20, 120)) : null;
    if (contractor) u.accountExpires = termDate;
    for (const g of [...p.baseAccess, role.roleGroup, ...p.roleAccess[role.roleGroup]]) addMember(w, g, sam, actor);
    if (legacy) for (const g of p.groups.filter((x) => /^[A-Z]+_/.test(x.name)).map((x) => x.name)) addMember(w, g, sam, actor);
    w.hr.workers.push({
      employeeId, first, last, department: dept, title: role.title, managerId: lead?.id ?? null, location, status: 'Active',
      hireDate: u.created, termDate, termType: null, phoneLast4: String(rng.int(1000, 9999)), workerType: contractor ? 'Contractor' : 'Employee',
    });
    if (isLead) leads.set(dept, { sam, id: employeeId });
  });

  // Group owners: the lead of the department the group serves, else the IT lead.
  const itLead = leads.get('IT')?.sam ?? [...leads.values()][0]?.sam ?? null;
  for (const g of w.ad.groups.filter((x) => x.ou === p.groupsOu)) {
    const role = p.roles.find((r) => r.roleGroup === g.name || p.roleAccess[r.roleGroup]?.includes(g.name));
    g.managedBy = role ? leads.get(role.department)?.sam ?? itLead : itLead;
  }

  realities(p, w, rng, actor);

  w.ad.computers.push({ name: `${p.prefix}-DC01`, ou: 'Domain Controllers', os: 'Windows Server 2022 Datacenter', enabled: true, lastLogon: minutesAgo(3), primaryUser: null, ip: '10.50.0.10' });
  if (p.reality !== 'greenfield') w.ad.computers.push({ name: `${p.prefix}-SYNC01`, ou: 'Computers', os: 'Windows Server 2022 (Entra Connect)', enabled: true, lastLogon: minutesAgo(5), primaryUser: null, ip: '10.50.0.20' });

  w.entra.users.push(cloudUser(seed, `${MSP_ADMIN}@${p.tenant}`, 'MSP Engineer (Admin)', {
    jobTitle: 'Managed service provider administrator',
    mfaMethods: [{ type: 'Microsoft Authenticator', detail: 'MSP phone', added: daysAgo(90) }],
    roles: [
      { role: 'User Administrator', assignment: 'active', permanent: true, expires: null, justification: 'MSP delegated admin relationship' },
      { role: 'Groups Administrator', assignment: 'active', permanent: true, expires: null, justification: 'MSP delegated admin relationship' },
    ],
  }));
  if (p.reality === 'research') {
    for (let i = 0; i < 7; i++) {
      const first = rng.pick(FIRST), last = rng.pick(LAST);
      const ext = `${first.toLowerCase()}.${last.toLowerCase()}_${rng.pick(['uni-heidelberg.test', 'karolinska.test', 'partnerpharma.test'])}#EXT#@${p.tenant}`;
      w.entra.users.push(cloudUser(seed, ext, `${first} ${last} (Guest)`, { userType: 'Guest', jobTitle: 'External collaborator', sessionsValidFrom: daysAgo(rng.int(10, 300)) }));
    }
  }

  if (p.staff) {
    runEntraSync(w, 'Microsoft Entra Connect');
    if (p.hasOkta) runOktaImport(w, `Okta AD Agent (${p.prefix}-DC01)`);
  }
  if (p.reality === 'regulated') {
    for (const lead of [leads.get('IT'), leads.get('Compliance')]) {
      const e = lead && w.entra.users.find((x) => x.onPremSam === lead.sam);
      e?.roles.push({ role: lead === leads.get('IT') ? 'Security Administrator' : 'Compliance Administrator', assignment: 'eligible', permanent: true, expires: null, justification: 'PIM eligible only (SRCU-SEC-04)' });
    }
  }

  // Start the log clean: the seed's own creation events are setup noise.
  w.audit = [];
  w.counters.audit = 0;
  ensureTenantSecurity(w);
  return ensurePimDefaults(ensureLabPasswords(w));
}

/** The drift, churn and history that make each company's day one different. */
function realities(p: CompanyProfile, w: World, rng: Rng, actor: string): void {
  const people = (): AdUser[] => w.ad.users.filter((u) => u.kind === 'user');
  if (p.reality === 'messy') {
    // Accounts nobody has used in months, two of them for people HR already terminated.
    const stale = rng.shuffle(people().filter((u) => !u.title.includes('Manager') && !u.title.includes('Supervisor') && !u.title.includes('Controller'))).slice(0, 7);
    stale.forEach((u, i) => {
      u.lastLogon = daysAgo(rng.int(120, 420));
      if (i < 2) {
        const wk = w.hr.workers.find((x) => x.employeeId === u.employeeId)!;
        wk.status = 'Terminated';
        wk.termDate = daysAgo(rng.int(100, 300));
        wk.termType = 'Voluntary';
      }
    });
    // Groups that lost their owners when people left, and shop-floor shared logins.
    for (const g of rng.shuffle(w.ad.groups.filter((x) => x.ou === p.groupsOu && !x.privileged)).slice(0, 4)) g.managedBy = null;
    for (const n of ['shopfloor01', 'shopfloor02']) {
      const u = createUser(w, { sam: n, givenName: n, surname: '', displayName: n, ou: `${p.usersOu}/Production`, description: 'Shared shop-floor kiosk login (password on the kiosk)', enabled: true, passwordSet: true, mustChangePassword: false, kind: 'service' }, actor);
      u.passwordNeverExpires = true;
      u.pwdLastSet = daysAgo(900);
    }
  }
  if (p.reality === 'churn') {
    // End of term: contracts ending and new starters queued in HR for the next month.
    const leaving = rng.shuffle(w.hr.workers.filter((x) => x.department === 'Faculty' || x.department === 'Research')).slice(0, 6);
    for (const wk of leaving) {
      const when = daysFromNow(rng.int(3, 28));
      w.hr.transactions.push({ time: nowIso(), employeeId: wk.employeeId, type: 'Termination', detail: 'End of fixed-term contract (term end)', effective: when });
    }
    for (let i = 0; i < 6; i++) {
      const id = `${p.prefix}${900 + i}`;
      const dept = rng.pick(['Faculty', 'Research', 'Student Services']);
      const role = p.roles.find((r) => r.department === dept && !r.lead)!;
      const lead = w.hr.workers.find((x) => x.department === dept && p.roles.some((r) => r.title === x.title && r.lead));
      const start = daysFromNow(rng.int(5, 29));
      w.hr.workers.push({ employeeId: id, first: rng.pick(FIRST), last: rng.pick(LAST), department: dept, title: role.title, managerId: lead?.employeeId ?? null, location: rng.pick(p.locations), status: 'Pending Hire', hireDate: start, termDate: null, termType: null, phoneLast4: String(rng.int(1000, 9999)), workerType: 'Employee' });
      w.hr.transactions.push({ time: nowIso(), employeeId: id, type: 'Hire', detail: `New hire: ${role.title}, ${dept}`, effective: start });
    }
  }
}
