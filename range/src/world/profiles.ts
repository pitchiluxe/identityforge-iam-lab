/**
 * world/profiles.ts — the ten MSP customer companies.
 *
 * Meridian is described by world/company.ts and stays as it is. These ten are
 * the customers of the managed service provider the learner works for: each
 * becomes its own World (world/mspSeed.ts) with its own domain, tenant, OU
 * tree, naming standard, job roles and birthright access. Everything is
 * fictional (.test domains, .onmicrosoft.test tenants).
 *
 * A profile is the single source of truth for its company, in the same way
 * company.ts is for Meridian: the seed, the MSP scenarios and the grader all
 * read it.
 */

export type StartingReality = 'greenfield' | 'clean' | 'messy' | 'churn' | 'regulated' | 'frontline' | 'research' | 'cloud-first' | 'government' | 'merger';

export interface ProfileRole {
  title: string;
  department: string;
  roleGroup: string;
  lead: boolean;
}

export interface ProfileGroup {
  name: string;
  description: string;
  privileged?: boolean;
}

export interface CompanyProfile {
  id: string;
  name: string;
  industry: string;
  domain: string;
  netbios: string;
  tenant: string;
  /** Three letters used for computer names (HBL-WKS-0142). */
  prefix: string;
  reality: StartingReality;
  /** Seeded headcount (0 for a greenfield company). */
  staff: number;
  departments: string[];
  /** OU paths that exist at seed time, root first. Empty for a greenfield domain. */
  ous: string[];
  usersOu: string;
  disabledOu: string;
  stagingOu: string;
  groupsOu: string;
  computersOu: string;
  adminsOu: string;
  syncScope: string[];
  samFormat: 'first.last' | 'flast' | 'firstl';
  roles: ProfileRole[];
  baseAccess: string[];
  /** roleGroup -> groups granted on top of baseAccess and the role group itself. */
  roleAccess: Record<string, string[]>;
  groups: ProfileGroup[];
  hasOkta: boolean;
  locations: string[];
  /** Fixed per company so its world is the same on every machine. */
  seed: number;
}

type Style = 'kebab' | 'snake' | 'pascal';

/** A group name in the company's own convention. */
function gname(style: Style, prefix: string, parts: string[]): string {
  const words = parts.flatMap((p) => p.split(/[\s/&-]+/)).filter(Boolean);
  if (style === 'kebab') return prefix + words.join('-').toLowerCase();
  if (style === 'snake') return prefix + words.map((w) => w.toUpperCase()).join('_');
  return prefix + words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('-');
}

interface DeptDef {
  name: string;
  staff: string;
  lead: string;
  /** Extra resource groups this department's roles get (short names). */
  access: string[];
}

interface Spec {
  id: string; name: string; industry: string; domain: string; netbios: string; prefix: string;
  reality: StartingReality; staff: number; seed: number; hasOkta: boolean; locations: string[];
  samFormat: CompanyProfile['samFormat'];
  root: string;
  style: Style; gp: string;
  /** Group style of the second (acquired) naming convention, Atlas only. */
  legacy?: { style: Style; gp: string };
  base: string[];
  depts: DeptDef[];
  /** Shared resource groups with descriptions (short name -> description). */
  resources: Record<string, string>;
  privileged: Record<string, string>;
}

function build(s: Spec): CompanyProfile {
  const g = (...parts: string[]): string => gname(s.style, s.gp, parts);
  const r = s.root;
  const usersOu = `${r}/Users`;
  const ous = s.reality === 'greenfield' ? [] : [
    r, usersOu, ...s.depts.map((d) => `${usersOu}/${d.name}`),
    `${r}/Groups`, `${r}/Computers`, `${r}/Admins`, `${r}/Staging`, `${r}/Disabled Users`, `${r}/ServiceAccounts`,
  ];
  const roles: ProfileRole[] = s.depts.flatMap((d) => [
    { title: d.staff, department: d.name, roleGroup: g('role', d.name, d.staff), lead: false },
    { title: d.lead, department: d.name, roleGroup: g('role', d.name, d.lead), lead: true },
  ]);
  const roleAccess: Record<string, string[]> = {};
  for (const d of s.depts) {
    const extra = d.access.map((a) => g(a));
    for (const role of roles.filter((x) => x.department === d.name)) roleAccess[role.roleGroup] = extra;
  }
  const groups: ProfileGroup[] = [
    ...s.base.map((b) => ({ name: g(b), description: s.resources[b] ?? `${b} (birthright)` })),
    ...Object.entries(s.resources).filter(([k]) => !s.base.includes(k)).map(([k, v]) => ({ name: g(k), description: v })),
    ...Object.entries(s.privileged).map(([k, v]) => ({ name: g(k), description: v, privileged: true })),
    ...roles.map((x) => ({ name: x.roleGroup, description: `Job role: ${x.title} (${x.department})` })),
  ];
  if (s.legacy) {
    const lg = (...parts: string[]): string => gname(s.legacy!.style, s.legacy!.gp, parts);
    groups.push(
      { name: lg('all', 'staff'), description: 'Acquired company (Ridgeway Power): all staff. Pending merger reconciliation.' },
      { name: lg('field', 'ops'), description: 'Acquired company (Ridgeway Power): field operations share.' },
    );
  }
  return {
    id: s.id, name: s.name, industry: s.industry, domain: s.domain, netbios: s.netbios,
    tenant: `${s.domain.split('.')[0]}.onmicrosoft.test`, prefix: s.prefix, reality: s.reality, staff: s.staff,
    departments: s.depts.map((d) => d.name), ous,
    usersOu, disabledOu: `${r}/Disabled Users`, stagingOu: `${r}/Staging`, groupsOu: `${r}/Groups`,
    computersOu: `${r}/Computers`, adminsOu: `${r}/Admins`,
    syncScope: [usersOu, `${r}/Disabled Users`, `${r}/Admins`],
    samFormat: s.samFormat, roles, baseAccess: s.base.map((b) => g(b)), roleAccess, groups,
    hasOkta: s.hasOkta, locations: s.locations, seed: s.seed,
  };
}

const dept = (name: string, staff: string, lead: string, access: string[] = []): DeptDef => ({ name, staff, lead, access });

export const MSP_COMPANIES: readonly CompanyProfile[] = [
  build({
    id: 'harborline', name: 'Harborline Logistics', industry: 'Freight and logistics', domain: 'harborline.test', netbios: 'HARBORLINE', prefix: 'HBL',
    reality: 'greenfield', staff: 0, seed: 7101, hasOkta: false, locations: ['Port of Savannah HQ', 'Atlanta Hub', 'Remote - US'], samFormat: 'first.last',
    root: 'Harborline', style: 'kebab', gp: 'grp-', base: ['all-staff'],
    depts: [
      dept('Operations', 'Logistics Coordinator', 'Operations Manager', ['dispatch']),
      dept('Warehouse', 'Warehouse Associate', 'Warehouse Supervisor', ['wms']),
      dept('Finance', 'Accountant', 'Finance Manager', ['finance-share']),
      dept('IT', 'IT Support Specialist', 'IT Manager', ['vpn']),
      dept('HR', 'HR Generalist', 'HR Manager', ['hr-share']),
    ],
    resources: { 'all-staff': 'All employees (birthright). Microsoft 365 Business Premium licence group.', dispatch: 'Dispatch board and route planning', wms: 'Warehouse management system', 'finance-share': 'Finance share', vpn: 'Remote access VPN', 'hr-share': 'HR share' },
    privileged: { 'it-admins': 'IT delegated administration' },
  }),
  build({
    id: 'brightwater', name: 'Brightwater Law LLP', industry: 'Legal services', domain: 'brightwaterlaw.test', netbios: 'BRIGHTWATER', prefix: 'BWL',
    reality: 'clean', staff: 25, seed: 7102, hasOkta: false, locations: ['Chicago Office', 'Milwaukee Office'], samFormat: 'flast',
    root: 'Firm', style: 'snake', gp: 'SG_', base: ['all-staff', 'dms-users'],
    depts: [
      dept('Partners', 'Partner', 'Managing Partner', ['matters-all', 'billing-approve']),
      dept('Associates', 'Associate', 'Senior Associate', ['matters-assigned']),
      dept('Paralegals', 'Paralegal', 'Paralegal Manager', ['matters-assigned', 'efiling']),
      dept('Legal Operations', 'Legal Operations Analyst', 'Director of Legal Operations', ['billing-submit']),
      dept('IT', 'IT Analyst', 'IT Director', ['vpn']),
    ],
    resources: { 'all-staff': 'All firm staff (birthright). Microsoft 365 E3 licence group.', 'dms-users': 'Document management system (birthright)', 'matters-all': 'All client matters (ethical walls apply)', 'matters-assigned': 'Assigned client matters only', 'billing-approve': 'Time and billing: approve invoices', 'billing-submit': 'Time and billing: submit invoices', efiling: 'Court e-filing portal', vpn: 'Remote access VPN' },
    privileged: { 'it-admins': 'IT delegated administration' },
  }),
  build({
    id: 'kestrel', name: 'Kestrel Manufacturing', industry: 'Industrial manufacturing', domain: 'kestrelmfg.test', netbios: 'KESTREL', prefix: 'KMF',
    reality: 'messy', staff: 120, seed: 7103, hasOkta: true, locations: ['Dayton Plant', 'Toledo Plant', 'Head Office'], samFormat: 'flast',
    root: 'Kestrel', style: 'pascal', gp: 'GRP_', base: ['all-staff'],
    depts: [
      dept('Production', 'Machine Operator', 'Production Supervisor', ['mes', 'shopfloor']),
      dept('Engineering', 'Process Engineer', 'Engineering Manager', ['cad', 'vpn']),
      dept('Quality', 'Quality Inspector', 'Quality Manager', ['qms']),
      dept('Supply Chain', 'Buyer', 'Supply Chain Manager', ['erp-purchasing']),
      dept('Finance', 'Accountant', 'Controller', ['erp-finance']),
      dept('IT', 'Systems Administrator', 'IT Manager', ['vpn']),
      dept('HR', 'HR Coordinator', 'HR Manager', ['hr-share']),
    ],
    resources: { 'all-staff': 'All employees (birthright)', mes: 'Manufacturing execution system', shopfloor: 'Shop-floor kiosks', cad: 'CAD vault', vpn: 'Remote access VPN', qms: 'Quality management system', 'erp-purchasing': 'ERP purchasing module', 'erp-finance': 'ERP finance module', 'hr-share': 'HR share' },
    privileged: { 'server-admins': 'Server administrators', 'it-admins': 'IT delegated administration' },
  }),
  build({
    id: 'aldervalley', name: 'Alder Valley University', industry: 'Higher education', domain: 'aldervalley.test', netbios: 'ALDERVALLEY', prefix: 'AVU',
    reality: 'churn', staff: 80, seed: 7104, hasOkta: true, locations: ['Main Campus', 'North Campus', 'Remote - US'], samFormat: 'first.last',
    root: 'University', style: 'kebab', gp: 'av-', base: ['all-staff', 'lms'],
    depts: [
      dept('Faculty', 'Lecturer', 'Department Chair', ['gradebook', 'research-share']),
      dept('Registrar', 'Registrar Officer', 'University Registrar', ['sis-write']),
      dept('Research', 'Research Assistant', 'Research Director', ['research-share', 'hpc']),
      dept('Student Services', 'Student Advisor', 'Dean of Students', ['sis-read']),
      dept('IT', 'IT Technician', 'Director of IT', ['vpn']),
      dept('HR', 'HR Officer', 'HR Director', ['hr-share']),
    ],
    resources: { 'all-staff': 'All staff and faculty (birthright)', lms: 'Learning management system (birthright)', gradebook: 'Gradebook write', 'research-share': 'Research data share', 'sis-write': 'Student information system: write', 'sis-read': 'Student information system: read', hpc: 'High-performance computing cluster', vpn: 'Remote access VPN', 'hr-share': 'HR share' },
    privileged: { 'it-admins': 'IT delegated administration' },
  }),
  build({
    id: 'summitridge', name: 'Summit Ridge Credit Union', industry: 'Financial services (regulated)', domain: 'summitridgecu.test', netbios: 'SUMMITRIDGE', prefix: 'SRC',
    reality: 'regulated', staff: 45, seed: 7105, hasOkta: false, locations: ['Denver Branch', 'Boulder Branch', 'Operations Centre'], samFormat: 'flast',
    root: 'SRCU', style: 'snake', gp: 'SEC_', base: ['all-staff'],
    depts: [
      dept('Branch Operations', 'Member Service Representative', 'Branch Manager', ['core-teller']),
      dept('Lending', 'Loan Officer', 'Lending Manager', ['loan-origination']),
      dept('Compliance', 'Compliance Analyst', 'Chief Compliance Officer', ['audit-read']),
      dept('Finance', 'Accountant', 'Chief Financial Officer', ['gl-post']),
      dept('IT', 'Systems Engineer', 'Information Security Officer', ['vpn']),
    ],
    resources: { 'all-staff': 'All employees (birthright)', 'core-teller': 'Core banking: teller', 'loan-origination': 'Loan origination system', 'audit-read': 'Audit evidence (read)', 'gl-post': 'General ledger: post entries', vpn: 'Remote access VPN' },
    privileged: { 'core-admins': 'Core banking administrators (PIM only)', 'it-admins': 'IT delegated administration (PIM only)' },
  }),
  build({
    id: 'pinecrest', name: 'Pinecrest Retail Group', industry: 'Retail', domain: 'pinecrestretail.test', netbios: 'PINECREST', prefix: 'PRG',
    reality: 'frontline', staff: 70, seed: 7106, hasOkta: true, locations: ['Head Office', 'Store 014 Portland', 'Store 022 Salem', 'Store 031 Eugene'], samFormat: 'firstl',
    root: 'Pinecrest', style: 'kebab', gp: 'pc-', base: ['all-staff'],
    depts: [
      dept('Stores', 'Sales Associate', 'Store Manager', ['pos', 'scheduling']),
      dept('Merchandising', 'Merchandiser', 'Merchandising Manager', ['pim']),
      dept('Loss Prevention', 'Loss Prevention Agent', 'Loss Prevention Manager', ['cctv']),
      dept('Finance', 'Accountant', 'Finance Manager', ['erp-finance']),
      dept('IT', 'IT Support Specialist', 'IT Manager', ['vpn']),
      dept('HR', 'HR Coordinator', 'HR Manager', ['hr-share']),
    ],
    resources: { 'all-staff': 'All employees (birthright)', pos: 'Point of sale', scheduling: 'Shift scheduling', pim: 'Product information management', cctv: 'CCTV review console', 'erp-finance': 'ERP finance', vpn: 'Remote access VPN', 'hr-share': 'HR share' },
    privileged: { 'it-admins': 'IT delegated administration' },
  }),
  build({
    id: 'lumen', name: 'Lumen BioLabs', industry: 'Biotech research', domain: 'lumenbio.test', netbios: 'LUMENBIO', prefix: 'LBL',
    reality: 'research', staff: 40, seed: 7107, hasOkta: false, locations: ['Cambridge Lab', 'Remote - US'], samFormat: 'first.last',
    root: 'Lumen', style: 'kebab', gp: 'lb-', base: ['all-staff', 'eln'],
    depts: [
      dept('Research', 'Research Scientist', 'Principal Investigator', ['lab-data', 'lims']),
      dept('Clinical', 'Clinical Research Associate', 'Clinical Operations Lead', ['trial-data']),
      dept('Regulatory', 'Regulatory Specialist', 'Head of Regulatory', ['submissions']),
      dept('IT', 'Research IT Engineer', 'Head of IT', ['vpn']),
      dept('Operations', 'Lab Operations Coordinator', 'Operations Director', ['inventory']),
    ],
    resources: { 'all-staff': 'All employees (birthright)', eln: 'Electronic lab notebook (birthright)', 'lab-data': 'Lab instrument data share', lims: 'Lab information management system', 'trial-data': 'Clinical trial data (restricted)', submissions: 'Regulatory submissions vault', vpn: 'Remote access VPN', inventory: 'Reagent inventory' },
    privileged: { 'it-admins': 'IT delegated administration' },
  }),
  build({
    id: 'cobalt', name: 'Cobalt Software', industry: 'SaaS software', domain: 'cobaltsoft.test', netbios: 'COBALT', prefix: 'CBS',
    reality: 'cloud-first', staff: 8, seed: 7108, hasOkta: false, locations: ['Remote - US', 'Austin Office'], samFormat: 'first.last',
    root: 'Cobalt', style: 'kebab', gp: 'cs-', base: ['all-staff'],
    depts: [
      dept('Engineering', 'Software Engineer', 'Engineering Manager', ['github', 'azure-dev']),
      dept('Product', 'Product Manager', 'Head of Product', ['roadmap']),
      dept('Customer Success', 'Customer Success Manager', 'Head of Customer Success', ['crm']),
      dept('Operations', 'Operations Generalist', 'COO', ['finance-share']),
    ],
    resources: { 'all-staff': 'All employees (birthright)', github: 'GitHub organisation (SSO)', 'azure-dev': 'Azure dev subscription contributors', roadmap: 'Product roadmap tool', crm: 'CRM', 'finance-share': 'Finance share' },
    privileged: { 'cloud-admins': 'Cloud platform administrators' },
  }),
  build({
    id: 'riverside', name: 'Riverside County Services', industry: 'Local government', domain: 'riversidecounty.test', netbios: 'RIVERSIDE', prefix: 'RCS',
    reality: 'government', staff: 60, seed: 7109, hasOkta: false, locations: ['County Building', 'Public Works Depot', 'Remote - US'], samFormat: 'first.last',
    root: 'County', style: 'snake', gp: 'RC_', base: ['all-staff'],
    depts: [
      dept('Public Works', 'Public Works Technician', 'Public Works Director', ['gis', 'work-orders']),
      dept('Clerk', 'Deputy Clerk', 'County Clerk', ['records']),
      dept('Social Services', 'Caseworker', 'Social Services Manager', ['case-mgmt']),
      dept('Finance', 'Budget Analyst', 'Finance Director', ['erp-finance']),
      dept('IT', 'Network Administrator', 'Chief Information Officer', ['vpn']),
      dept('HR', 'HR Analyst', 'HR Director', ['hr-share']),
    ],
    resources: { 'all-staff': 'All county staff (birthright)', gis: 'GIS mapping', 'work-orders': 'Work order system', records: 'Records management (retention holds apply)', 'case-mgmt': 'Social services case management (CJIS-style controls)', 'erp-finance': 'ERP finance', vpn: 'Remote access VPN', 'hr-share': 'HR share' },
    privileged: { 'it-admins': 'IT delegated administration' },
  }),
  build({
    id: 'atlas', name: 'Atlas Energy Partners', industry: 'Energy (mid-merger)', domain: 'atlasenergy.test', netbios: 'ATLASENERGY', prefix: 'AEP',
    reality: 'merger', staff: 90, seed: 7110, hasOkta: true, locations: ['Houston HQ', 'Midland Field Office', 'Ridgeway Power (acquired)'], samFormat: 'first.last',
    root: 'Atlas', style: 'kebab', gp: 'ae-', legacy: { style: 'snake', gp: 'RWP_' }, base: ['all-staff'],
    depts: [
      dept('Field Operations', 'Field Technician', 'Field Operations Manager', ['scada-view', 'field-ops']),
      dept('Engineering', 'Reservoir Engineer', 'Engineering Director', ['petrel', 'vpn']),
      dept('Trading', 'Energy Trader', 'Head of Trading', ['etrm']),
      dept('Finance', 'Financial Analyst', 'Controller', ['erp-finance']),
      dept('IT', 'Systems Engineer', 'IT Director', ['vpn']),
      dept('HR', 'HR Business Partner', 'HR Director', ['hr-share']),
    ],
    resources: { 'all-staff': 'All employees (birthright)', 'scada-view': 'SCADA read-only console', 'field-ops': 'Field operations share', petrel: 'Reservoir modelling', etrm: 'Energy trading and risk management', 'erp-finance': 'ERP finance', vpn: 'Remote access VPN', 'hr-share': 'HR share' },
    privileged: { 'it-admins': 'IT delegated administration', 'ot-admins': 'Operational technology administrators' },
  }),
];

export function profileById(id: string): CompanyProfile | undefined {
  return MSP_COMPANIES.find((p) => p.id === id);
}

/** What is wrong with a profile; [] when it is consistent. */
export function profileProblems(p: CompanyProfile): string[] {
  const out: string[] = [];
  const groups = new Set(p.groups.map((g) => g.name));
  if (p.netbios.length > 15) out.push(`NetBIOS name ${p.netbios} is longer than 15 characters`);
  if (p.netbios !== p.netbios.toUpperCase()) out.push(`NetBIOS name ${p.netbios} is not upper case`);
  if (!/^[A-Z]{3}$/.test(p.prefix)) out.push(`Prefix ${p.prefix} is not three letters`);
  for (const r of p.roles) {
    if (!p.departments.includes(r.department)) out.push(`Role ${r.title} names unknown department ${r.department}`);
    if (!groups.has(r.roleGroup)) out.push(`Role group ${r.roleGroup} is not defined`);
  }
  for (const d of p.departments) if (!p.roles.some((r) => r.department === d && r.lead) || !p.roles.some((r) => r.department === d && !r.lead)) out.push(`Department ${d} needs a staff and a lead role`);
  for (const g of p.baseAccess) if (!groups.has(g)) out.push(`Base access group ${g} is not defined`);
  for (const [role, list] of Object.entries(p.roleAccess)) {
    if (!p.roles.some((r) => r.roleGroup === role)) out.push(`roleAccess names unknown role ${role}`);
    for (const g of list) if (!groups.has(g)) out.push(`roleAccess for ${role} names undefined group ${g}`);
  }
  if (p.reality !== 'greenfield') {
    for (const s of p.syncScope) if (!p.ous.includes(s)) out.push(`Sync scope ${s} is not an OU`);
    for (const o of [p.usersOu, p.disabledOu, p.stagingOu, p.groupsOu, p.computersOu, p.adminsOu]) if (!p.ous.includes(o)) out.push(`OU ${o} is missing`);
  } else if (p.ous.length || p.staff) out.push('A greenfield company starts with no OUs and no staff');
  return out;
}
