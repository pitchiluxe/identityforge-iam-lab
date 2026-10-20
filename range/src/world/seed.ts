/**
 * world/seed.ts — builds Meridian Health System on day one.
 *
 * 35 employees across 7 departments (the IAM Range hiring plan), the IAM
 * engineer you play, admin and service accounts, laptops, HR records, an
 * Entra tenant and an Okta org that have already synced once, and a SaaS
 * estate whose accounts match. Scenarios then bend this world.
 */
import type { AdUser, MfaMethod, World } from '../core/types.ts';
import { createRng, type Rng } from '../core/rng.ts';
import { daysAgo, minutesAgo, nowIso } from '../core/time.ts';
import {
  ADMINS_OU, BREAK_GLASS, COMPANY, DEPARTMENTS, GROUPS, GROUPS_OU, LOCATIONS, OUS, PEOPLE, SAAS_CATALOG, SERVICE_OU,
  SYNC_SCOPE, birthright, deptOu, roleFor, samFor,
} from './company.ts';
import { addMember, createUser, findUser } from './directory.ts';
import { addSignIn, runEntraSync, runOktaImport } from './cloud.ts';
import { deliverMail } from './itsm.ts';
import { seedFiles } from './docs.ts';

export const WORLD_VERSION = 4;
const SEED_ACTOR = 'MERIDIAN\\svc-provisioning';

export const OFFICE_IPS: Record<string, string> = {
  'Boston Main Campus': '203.0.113.10',
  'Cambridge Clinic': '203.0.113.42',
  'Remote - US': '198.51.100.77',
  'Worcester Medical Center': '203.0.113.88',
};

function emptyWorld(seed: number): World {
  return {
    version: WORLD_VERSION,
    seed,
    created: nowIso(),
    player: { displayName: 'Admin', sam: 'admin', adminSam: 'adm-admin' },
    company: { name: COMPANY.name, domain: COMPANY.domain },
    ad: { domain: COMPANY.domain, netbios: COMPANY.netbios, ous: [...OUS], users: [], groups: [], computers: [] },
    entra: { tenantName: COMPANY.name, primaryDomain: COMPANY.domain, users: [], groups: [], apps: [], caPolicies: [], signIns: [], syncScope: [...SYNC_SCOPE], lastSync: nowIso(), syncErrors: [] },
    okta: { orgUrl: COMPANY.oktaOrg, users: [], apps: [], lastImport: nowIso() },
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

function backdate(u: AdUser, rng: Rng, years: number): void {
  u.created = daysAgo(rng.int(60, years * 365));
  u.whenChanged = daysAgo(rng.int(1, 40));
  u.pwdLastSet = daysAgo(rng.int(2, 85));
  u.mustChangePassword = false;
  u.lastLogon = minutesAgo(rng.int(20, 60 * 50));
}

function phone(rng: Rng): string {
  return String(rng.int(1000, 9999));
}

export function createWorld(seed: number): World {
  const rng = createRng(seed);
  const w = emptyWorld(seed);
  for (const g of GROUPS) {
    w.ad.groups.push({ name: g.name, ou: g.ou ?? GROUPS_OU, scope: 'Global', category: 'Security', description: g.description, managedBy: null, privileged: !!g.privileged });
  }
  const taken = (s: string): boolean => !!findUser(w, s);
  let emp = 100400;

  for (const dept of DEPARTMENTS) {
    let leadSam: string | null = null;
    let leadId: string | null = null;
    PEOPLE[dept].forEach(([first, last], i) => {
      const role = roleFor(dept, i === 0);
      const location = i === 0 ? 'Boston Main Campus' : rng.pick(LOCATIONS);
      const employeeId = `E${++emp}`;
      const sam = samFor(first, last, taken);
      const u = createUser(w, {
        sam, givenName: first, surname: last, ou: deptOu(dept), department: dept, title: role.title, manager: leadSam,
        employeeId, office: location, enabled: true, passwordSet: true, mustChangePassword: false,
      }, SEED_ACTOR);
      backdate(u, rng, 8);
      for (const g of birthright(role.group)) addMember(w, g, sam, SEED_ACTOR);
      w.hr.workers.push({
        employeeId, first, last, department: dept, title: role.title, managerId: leadId, location, status: 'Active',
        hireDate: u.created, termDate: null, termType: null, phoneLast4: phone(rng), workerType: 'Employee',
      });
      if (i === 0) { leadSam = sam; leadId = employeeId; }
    });
  }

  // You: the IAM engineer, reporting to the Security Manager.
  const managerSam = findUser(w, 'hkovacs')!.sam;
  const managerId = findUser(w, 'hkovacs')!.employeeId;
  const me = createUser(w, { sam: 'admin', givenName: 'IAM', surname: 'Administrator', displayName: 'Admin', ou: deptOu('Security'), department: 'Security', title: 'IAM Engineer', manager: managerSam, employeeId: `E${++emp}`, office: 'Boston Main Campus', enabled: true, passwordSet: true, mustChangePassword: false }, SEED_ACTOR);
  backdate(me, rng, 1);
  for (const g of ['grp-all-staff', 'app-expenseflow', 'grp-vpn-users']) addMember(w, g, me.sam, SEED_ACTOR);
  w.hr.workers.push({ employeeId: me.employeeId, first: 'IAM', last: 'Administrator', department: 'Security', title: 'IAM Engineer', managerId, location: 'Boston Main Campus', status: 'Active', hireDate: me.created, termDate: null, termType: null, phoneLast4: phone(rng), workerType: 'Employee' });

  // Admin accounts. Tier 0 membership is held by the IT Manager's admin account only.
  const admins: [string, string, string, string, string[]][] = [
    ['adm-admin', 'Admin', 'Tier1', 'admin', ['grp-iam-admins']],
    ['adm-ghopper', 'Grace', 'Hopper', 'ghopper', ['Domain Admins']],
    ['adm-ofarouk', 'Omar', 'Farouk', 'ofarouk', ['grp-server-admins']],
  ];
  for (const [sam, first, last, owner, groups] of admins) {
    const u = createUser(w, { sam, givenName: first, surname: last, displayName: sam === 'adm-admin' ? 'Admin (Tier 1)' : `${first} ${last} (Admin)`, ou: ADMINS_OU, department: findUser(w, owner)!.department, title: 'Administrative account', description: `Admin account for ${owner}`, enabled: true, passwordSet: true, mustChangePassword: false, kind: 'admin' }, SEED_ACTOR);
    backdate(u, rng, 3);
    for (const g of groups) addMember(w, g, sam, SEED_ACTOR);
  }

  // Service accounts. svc-backup is clean on day one; a scenario may make it a problem.
  const services: [string, string, boolean][] = [
    ['svc-backup', 'Veeam backup jobs. Owner: Grace Hopper', true],
    ['svc-monitor', 'Monitoring agent. Owner: Omar Farouk', false],
    ['svc-idp-sync', 'Okta AD agent service. Owner: Admin', true],
    ['svc-sql01', 'SQL Server engine on MHS-SQL01. Owner: Lena Novak', false],
  ];
  for (const [sam, description, never] of services) {
    const u = createUser(w, { sam, givenName: sam, surname: '', displayName: sam, ou: SERVICE_OU, description, enabled: true, passwordSet: true, mustChangePassword: false, kind: 'service' }, SEED_ACTOR);
    backdate(u, rng, 4);
    u.passwordNeverExpires = never;
    u.lastLogon = minutesAgo(rng.int(5, 600));
  }
  addMember(w, 'grp-backup-operators', 'svc-backup', SEED_ACTOR);

  for (const g of w.ad.groups) {
    const def = GROUPS.find((d) => d.name === g.name);
    if (def?.ownerTitle) g.managedBy = w.ad.users.find((u) => u.title === def.ownerTitle && u.kind === 'user')?.sam ?? null;
  }

  // Computers
  w.ad.computers.push(
    { name: 'MHS-DC01', ou: 'Corp/Servers', os: 'Windows Server 2022 Datacenter', enabled: true, lastLogon: minutesAgo(3), primaryUser: null, ip: '10.10.0.10' },
    { name: 'MHS-SYNC01', ou: 'Corp/Servers', os: 'Windows Server 2022 (Entra Connect)', enabled: true, lastLogon: minutesAgo(5), primaryUser: null, ip: '10.10.0.20' },
    { name: 'MHS-FS01', ou: 'Corp/Servers', os: 'Windows Server 2022 (File server)', enabled: true, lastLogon: minutesAgo(9), primaryUser: null, ip: '10.10.0.30' },
    { name: 'MHS-IAM-WKS01', ou: 'Corp/Workstations', os: 'Windows 11 Enterprise', enabled: true, lastLogon: minutesAgo(1), primaryUser: 'admin', ip: '10.10.20.15' },
  );
  let lt = 100;
  for (const u of w.ad.users.filter((x) => x.kind === 'user' && x.sam !== 'admin')) {
    w.ad.computers.push({ name: `MHS-LT-${++lt}`, ou: 'Corp/Workstations', os: rng.pick(['Windows 11 Enterprise', 'Windows 11 Enterprise', 'Windows 10 Enterprise']), enabled: true, lastLogon: u.lastLogon ?? minutesAgo(60), primaryUser: u.sam, ip: `10.10.${rng.int(30, 60)}.${rng.int(10, 250)}` });
  }

  // SaaS estate
  for (const a of SAAS_CATALOG) {
    const owner = w.ad.users.find((u) => u.title === a.ownerTitle)?.displayName ?? a.ownerTitle;
    w.saas.push({ id: a.id, name: a.name, description: a.description, owner, provisioning: a.provisioning, idp: a.idp, accessGroup: a.group, roles: [...a.roles], accounts: [] });
  }
  w.entra.apps.push(
    { id: 'ent-carechart', name: 'CareChart EHR', sso: 'OIDC', assignmentRequired: true, assignedGroups: ['app-carechart'], assignedUsers: [], provisioning: 'SCIM', saasId: 'carechart' },
    { id: 'ent-m365', name: 'Office 365', sso: 'OIDC', assignmentRequired: false, assignedGroups: [], assignedUsers: [], provisioning: 'None', saasId: null },
  );
  w.okta.apps.push(
    { id: 'okta-imagevault', name: 'ImageVault PACS', sso: 'SAML', assignedGroups: ['app-imagevault'], assignedUsers: [], provisioning: 'SCIM', saasId: 'imagevault' },
    { id: 'okta-payrollpro', name: 'PayrollPro', sso: 'SAML', assignedGroups: ['app-payrollpro'], assignedUsers: [], provisioning: 'None', saasId: 'payrollpro' },
    { id: 'okta-expenseflow', name: 'ExpenseFlow', sso: 'SAML', assignedGroups: ['app-expenseflow'], assignedUsers: [], provisioning: 'SCIM', saasId: 'expenseflow' },
  );

  // Break-glass: cloud-only, permanent Global Administrator, FIDO2 only.
  for (const upn of BREAK_GLASS) {
    w.entra.users.push({
      id: `bg-${upn.slice(12, 14)}-0000-4000-a000-000000000000`, upn, displayName: `Break Glass ${upn.slice(12, 14)}`, source: 'cloud', onPremSam: null,
      accountEnabled: true, department: '', jobTitle: 'Emergency access', groups: [], mfaMethods: [{ type: 'FIDO2 security key', detail: 'Stored in the CISO safe', added: daysAgo(200) }],
      mfaResetAt: null, sessionsValidFrom: daysAgo(30), sessions: [], roles: [{ role: 'Global Administrator', assignment: 'active', permanent: true, expires: null, justification: 'Break-glass account (SEC-STD-007)' }],
      licenses: [], riskLevel: 'none', deleted: false,
    });
  }

  runEntraSync(w, SEED_ACTOR);
  runOktaImport(w, SEED_ACTOR);

  // PayrollPro has no connector: its accounts were created by hand.
  const payroll = w.saas.find((s) => s.id === 'payrollpro')!;
  for (const u of w.ad.users.filter((x) => x.memberOf.includes('app-payrollpro'))) {
    payroll.accounts.push({ login: u.upn, displayName: u.displayName, role: u.memberOf.includes('grp-payroll-approve') ? 'Payroll Approver' : 'Payroll Submitter', active: true, lastLogin: minutesAgo(rng.int(60, 6000)), managedBy: 'Manual' });
  }
  for (const s of w.saas) for (const a of s.accounts) a.lastLogin ??= minutesAgo(rng.int(30, 4000));

  const methods: MfaMethod['type'][] = ['Microsoft Authenticator', 'Microsoft Authenticator', 'Microsoft Authenticator', 'Phone (SMS)', 'Windows Hello for Business'];
  for (const e of w.entra.users.filter((x) => x.source === 'synced')) {
    const t = rng.pick(methods);
    e.mfaMethods = [{ type: t, detail: t === 'Phone (SMS)' ? `+1 555 ••• ${phone(rng)}` : t === 'Microsoft Authenticator' ? rng.pick(['iPhone 15', 'Pixel 8', 'Galaxy S24', 'iPhone 13']) : 'Meridian workstation', added: daysAgo(rng.int(30, 700)) }];
    e.sessionsValidFrom = daysAgo(rng.int(20, 90));
    e.sessions = [{ issued: minutesAgo(rng.int(30, 2000)), app: 'Office 365', device: 'Windows 11 · Edge' }];
    if (rng.chance(0.5)) e.sessions.push({ issued: minutesAgo(rng.int(30, 3000)), app: 'Outlook Mobile', device: 'iOS' });
  }
  for (const o of w.okta.users) {
    o.factors = ['Okta Verify (push)'];
    o.sessions = rng.int(0, 2);
    o.lastLogin = minutesAgo(rng.int(30, 3000));
  }

  const meCloud = w.entra.users.find((e) => e.onPremSam === 'admin');
  meCloud?.roles.push(
    { role: 'User Administrator', assignment: 'eligible', permanent: true, expires: null, justification: 'IAM Operations (SEC-STD-007)' },
    { role: 'Helpdesk Administrator', assignment: 'eligible', permanent: true, expires: null, justification: 'IAM Operations (SEC-STD-007)' },
  );
  w.entra.users.find((e) => e.onPremSam === 'ghopper')?.roles.push({ role: 'Global Administrator', assignment: 'eligible', permanent: true, expires: null, justification: 'IT Manager break-fix (SEC-STD-007)' });
  w.entra.users.find((e) => e.onPremSam === 'hkovacs')?.roles.push({ role: 'Security Administrator', assignment: 'eligible', permanent: true, expires: null, justification: 'Security Manager (SEC-STD-007)' });

  w.entra.caPolicies.push(
    { id: 'ca-001', name: 'CA001 - Block legacy authentication', state: 'on', includeUsers: 'All users', excludeUsers: [...BREAK_GLASS], apps: 'All cloud apps', condition: 'legacy-auth', grant: 'block', created: daysAgo(400) },
    { id: 'ca-002', name: 'CA002 - Require MFA for administrators', state: 'on', includeUsers: 'Directory roles', excludeUsers: [...BREAK_GLASS], apps: 'All cloud apps', condition: 'none', grant: 'require-mfa', created: daysAgo(380) },
    { id: 'ca-003', name: 'CA003 - Block high sign-in risk', state: 'report-only', includeUsers: 'All users', excludeUsers: [...BREAK_GLASS], apps: 'All cloud apps', condition: 'sign-in-risk-high', grant: 'block', created: daysAgo(30) },
  );

  // Recent, ordinary sign-in history
  for (const u of w.ad.users.filter((x) => x.kind === 'user')) {
    const office = OFFICE_IPS[u.office] ?? '203.0.113.10';
    for (let i = 0; i < rng.int(1, 3); i++) {
      addSignIn(w, { time: minutesAgo(rng.int(15, 4000)), upn: u.upn, app: rng.pick(['Office 365', 'Outlook', 'Teams', 'SharePoint Online']), ip: office, location: u.office === 'Worcester Medical Center' ? 'Worcester, US' : u.office === 'Cambridge Clinic' ? 'Cambridge Clinic, US' : 'Boston, US', device: 'Windows 11 · Edge', result: 'Success', failureReason: '', mfa: 'Satisfied', ca: 'Success', risk: 'none' });
    }
  }

  // Throw away the setup noise; start the log with ordinary background activity.
  w.audit = [];
  w.counters.audit = 0;
  for (const u of rng.shuffle(w.ad.users.filter((x) => x.kind === 'user')).slice(0, 18)) {
    w.audit.push({ id: ++w.counters.audit, time: u.lastLogon ?? minutesAgo(90), source: 'AD', eventId: 4624, actor: u.sam, action: 'Account logged on', target: u.sam, detail: 'Logon type 3 (network)', origin: w.ad.computers.find((c) => c.primaryUser === u.sam)?.name ?? 'MHS-FS01' });
  }

  deliverMail(w, {
    from: 'hkovacs@meridianhealth.test', fromName: 'Hana Kovacs', minutesAgo: 25,
    subject: 'Welcome to IAM Operations',
    body: `Hi Admin,\n\nWelcome aboard. You own the IAM Operations queue in ServiceDesk from today. This is a hospital: most accounts here can reach patient records, so read HIPAA-Access-Control-Policy.md first.\n\nA few things before you start:\n- PeopleHub is the source of truth. If HR has not recorded it, it has not happened.\n- Read the SOPs in Documents\\Policies, especially identity verification. We had a social-engineering attempt on the service desk last month.\n- Every change needs a ticket and a work note. Audit samples our tickets every quarter.\n- Entra and Okta follow AD after a sync. If something "didn't work in the cloud", check whether you synced.\n\nShout if you get stuck.\n\nHana\nSecurity Manager`,
  });
  w.files = seedFiles(w);
  return w;
}
