/**
 * world/company.ts — Meridian Health System, designed the same way as in IAM Range
 * (../IAM_virtual-machine: src/config/company.ts, src/vm/orgPlan.ts and
 * omari-lab/05-CONFIGURATION/01-ad-structure.ps1).
 *
 * This is the single source of truth for the OU tree, the group model, job
 * roles and birthright access. The seed, the scenarios, the grader and the
 * Birthright-Access-Matrix.csv on the virtual disk all read it, so they cannot
 * disagree about what a Financial Analyst is meant to have.
 */
import type { Department } from '../core/types.ts';

export const COMPANY = {
  name: 'Meridian Health System',
  domain: 'meridianhealth.test',
  netbios: 'MERIDIAN',
  tenant: 'meridianhealth.onmicrosoft.test',
  oktaOrg: 'https://meridianhealth.okta.test',
} as const;

export const DEPARTMENTS: readonly Department[] = ['IT', 'Help Desk', 'Security', 'HR', 'Finance', 'Nursing', 'Radiology'];

export const USERS_OU = 'Corp/Users';
export const DISABLED_OU = 'Corp/Disabled Users';
export const STAGING_OU = 'Corp/Staging';
export const SERVICE_OU = 'Corp/ServiceAccounts';
export const GROUPS_OU = 'Corp/Groups';
export const ADMINS_OU = 'Corp/Admins';
export const BUILTIN_OU = 'Users';

export function deptOu(d: Department): string {
  return `${USERS_OU}/${d}`;
}

export const OUS: readonly string[] = [
  'Corp',
  USERS_OU,
  ...DEPARTMENTS.map(deptOu),
  GROUPS_OU,
  SERVICE_OU,
  ADMINS_OU,
  'Corp/Workstations',
  'Corp/Servers',
  DISABLED_OU,
  STAGING_OU,
  BUILTIN_OU,
];

/** OUs Entra Connect synchronises. Staging and service accounts are deliberately out of scope. */
export const SYNC_SCOPE: readonly string[] = [USERS_OU, DISABLED_OU, ADMINS_OU];

export interface JobRole {
  group: string;
  title: string;
  department: Department;
  lead: boolean;
}

export const JOB_ROLES: readonly JobRole[] = [
  { group: 'role-it-sysadmin', title: 'Systems Administrator', department: 'IT', lead: false },
  { group: 'role-it-manager', title: 'IT Manager', department: 'IT', lead: true },
  { group: 'role-helpdesk-analyst', title: 'Service Desk Analyst', department: 'Help Desk', lead: false },
  { group: 'role-helpdesk-lead', title: 'Service Desk Lead', department: 'Help Desk', lead: true },
  { group: 'role-security-analyst', title: 'Security Analyst', department: 'Security', lead: false },
  { group: 'role-security-manager', title: 'Security Manager', department: 'Security', lead: true },
  { group: 'role-hr-partner', title: 'HR Business Partner', department: 'HR', lead: false },
  { group: 'role-hr-manager', title: 'HR Manager', department: 'HR', lead: true },
  { group: 'role-finance-analyst', title: 'Financial Analyst', department: 'Finance', lead: false },
  { group: 'role-finance-controller', title: 'Financial Controller', department: 'Finance', lead: true },
  { group: 'role-nursing-rn', title: 'Registered Nurse', department: 'Nursing', lead: false },
  { group: 'role-nursing-manager', title: 'Nurse Manager', department: 'Nursing', lead: true },
  { group: 'role-radiology-tech', title: 'Radiologic Technologist', department: 'Radiology', lead: false },
  { group: 'role-radiology-manager', title: 'Radiology Manager', department: 'Radiology', lead: true },
];

export function roleFor(department: Department, lead: boolean): JobRole {
  const r = JOB_ROLES.find((j) => j.department === department && j.lead === lead);
  if (!r) throw new Error(`No job role for ${department}`);
  return r;
}

export function roleByTitle(title: string): JobRole | undefined {
  return JOB_ROLES.find((j) => j.title === title);
}

/** Everyone gets these. */
export const BASE_ACCESS = ['grp-all-staff', 'app-expenseflow'] as const;

/** Birthright access per job role, on top of BASE_ACCESS and the role group itself. */
export const ROLE_ACCESS: Record<string, readonly string[]> = {
  'role-it-sysadmin': ['grp-vpn-users', 'app-carechart'],
  'role-it-manager': ['grp-vpn-users', 'app-carechart'],
  'role-helpdesk-analyst': ['grp-helpdesk-tier1'],
  'role-helpdesk-lead': ['grp-helpdesk-tier1'],
  'role-security-analyst': ['grp-sec-ops', 'grp-vpn-users'],
  'role-security-manager': ['grp-sec-ops', 'grp-vpn-users'],
  'role-hr-partner': ['grp-hr-readers'],
  'role-hr-manager': ['grp-hr-readers', 'grp-hr-managers'],
  'role-finance-analyst': ['grp-finance-analysts', 'grp-payroll-submit', 'app-payrollpro'],
  'role-finance-controller': ['grp-finance-analysts', 'grp-payroll-approve', 'app-payrollpro'],
  'role-nursing-rn': ['grp-nursing-clinical', 'grp-vpn-users', 'app-carechart'],
  'role-nursing-manager': ['grp-nursing-clinical', 'grp-vpn-users', 'app-carechart'],
  'role-radiology-tech': ['grp-radiology-pacs', 'app-imagevault'],
  'role-radiology-manager': ['grp-radiology-pacs', 'app-imagevault'],
};

/** The complete birthright group set for a job role. */
export function birthright(roleGroup: string): string[] {
  return [...BASE_ACCESS, roleGroup, ...(ROLE_ACCESS[roleGroup] ?? [])].sort();
}

export interface GroupDef {
  name: string;
  description: string;
  privileged?: boolean;
  ou?: string;
  /** Job title whose holder owns the group. */
  ownerTitle?: string;
}

export const GROUPS: readonly GroupDef[] = [
  { name: 'grp-all-staff', description: 'All employees (birthright). Microsoft 365 E3 license group.', ownerTitle: 'HR Manager' },
  { name: 'grp-vpn-users', description: 'Remote access VPN', ownerTitle: 'IT Manager' },
  { name: 'grp-helpdesk-tier1', description: 'Help desk tier 1: password reset and unlock delegation', ownerTitle: 'Service Desk Lead' },
  { name: 'grp-sec-ops', description: 'Security operations tooling', ownerTitle: 'Security Manager' },
  { name: 'grp-hr-readers', description: 'HR share and PeopleHub read', ownerTitle: 'HR Manager' },
  { name: 'grp-hr-managers', description: 'HR managers with write to employee records', ownerTitle: 'HR Manager' },
  { name: 'grp-finance-analysts', description: 'Finance share read/write', ownerTitle: 'Financial Controller' },
  { name: 'grp-payroll-submit', description: 'PayrollPro: create and submit pay runs (SoD: never with grp-payroll-approve)', ownerTitle: 'Financial Controller' },
  { name: 'grp-payroll-approve', description: 'PayrollPro: approve pay runs (SoD: never with grp-payroll-submit)', ownerTitle: 'Financial Controller' },
  { name: 'grp-nursing-clinical', description: 'Nursing units: clinical share and medication dispensing cabinets', ownerTitle: 'Nurse Manager' },
  { name: 'grp-radiology-pacs', description: 'Radiology shared drive and reading-room workstations', ownerTitle: 'Radiology Manager' },
  { name: 'app-carechart', description: 'CareChart EHR assignment (Entra ID SSO + SCIM)', ownerTitle: 'Nurse Manager' },
  { name: 'app-imagevault', description: 'ImageVault PACS assignment (Okta SSO + SCIM)', ownerTitle: 'Radiology Manager' },
  { name: 'app-payrollpro', description: 'PayrollPro assignment (Okta SSO, MANUAL provisioning)', ownerTitle: 'Financial Controller' },
  { name: 'app-expenseflow', description: 'ExpenseFlow assignment (Okta SSO + SCIM, birthright)', ownerTitle: 'Financial Controller' },
  { name: 'grp-iam-admins', description: 'IAM operations delegated administration', privileged: true, ownerTitle: 'Security Manager' },
  { name: 'grp-server-admins', description: 'Tier 1 server administrators', privileged: true, ownerTitle: 'IT Manager' },
  { name: 'grp-backup-operators', description: 'Backup software service rights (non-admin)', ownerTitle: 'IT Manager' },
  ...JOB_ROLES.map((r) => ({ name: r.group, description: `Job role: ${r.title} (${r.department})` })),
  { name: 'Domain Admins', description: 'Designated administrators of the domain', privileged: true, ou: BUILTIN_OU },
  { name: 'Enterprise Admins', description: 'Designated administrators of the enterprise', privileged: true, ou: BUILTIN_OU },
  { name: 'Account Operators', description: 'Members can administer domain user and group accounts', privileged: true, ou: BUILTIN_OU },
  { name: 'Domain Users', description: 'All domain users', ou: BUILTIN_OU },
];

export const PRIVILEGED_GROUPS = GROUPS.filter((g) => g.privileged).map((g) => g.name);

/** Same people as IAM Range's hiring plan. The first person listed leads the department. */
export const PEOPLE: Record<Department, [string, string][]> = {
  IT: [['Grace', 'Hopper'], ['Omar', 'Farouk'], ['Lena', 'Novak'], ['Tariq', 'Bello'], ['Mei', 'Tanaka']],
  'Help Desk': [['Sam', 'Rivera'], ['Ivy', 'Mensah'], ['Noah', 'Brandt'], ['Zara', 'Quinn'], ['Eli', 'Moreau']],
  Security: [['Hana', 'Kovacs'], ['Dev', 'Anand'], ['Rosa', 'Lindqvist'], ['Kwame', 'Asante'], ['Yuki', 'Sato']],
  HR: [['Clara', 'Jensen'], ['Amir', 'Rahimi'], ['Beth', 'Coleman'], ['Jonas', 'Weber'], ['Ines', 'Duarte']],
  Finance: [['Victor', 'Hale'], ['Priya', 'Raman'], ['Lucas', 'Ferreira'], ['Anna', 'Berg'], ['Tomas', 'Kral']],
  Nursing: [['Iris', 'Chandra'], ['Felix', 'Wagner'], ['Nia', 'Owusu'], ['Oscar', 'Lund'], ['Sofia', 'Marin']],
  Radiology: [['Marco', 'Rossi'], ['Leah', 'Goldberg'], ['Ken', 'Ito'], ['Ada', 'Nwosu'], ['Pablo', 'Ortega']],
};

/** Fictional new hires the scenarios draw from. None of them exist at seed time. */
export const CANDIDATES: readonly [string, string][] = [
  ['Maya', 'Okafor'], ['Liam', 'Petrov'], ['Chloe', 'Nakamura'], ['Ethan', 'Varga'], ['Aisha', 'Haddad'],
  ['Mateo', 'Silva'], ['Freya', 'Holm'], ['Ravi', 'Kapoor'], ['Elena', 'Popescu'], ['Jamal', 'Wright'],
  ['Sara', 'Lindgren'], ['Diego', 'Castillo'], ['Nora', 'Fitzgerald'], ['Kai', 'Yamamoto'], ['Lucia', 'Romano'],
  ['Owen', 'Gallagher'], ['Amara', 'Diallo'], ['Hugo', 'Lefevre'], ['Ines', 'Moreira'], ['Theo', 'Hartmann'],
  ['Zoe', 'Brennan'], ['Arjun', 'Mehta'], ['Lina', 'Saleh'], ['Mason', 'Kowalski'], ['Grace', 'Huang'],
  ['Hassan', 'Jaber'], ['Emma', 'Lund'], ['Victor', 'Dubois'], ['Naomi', 'Adeyemi'], ['Leo', 'Marchetti'],
];

export const LOCATIONS = ['Boston Main Campus', 'Cambridge Clinic', 'Remote - US', 'Worcester Medical Center'] as const;

/** Naming standard: first initial + surname, lower case; append 2, 3 ... on collision. */
export function samFor(first: string, last: string, taken: (sam: string) => boolean): string {
  const base = `${first[0]}${last}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18);
  if (!taken(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken(`${base}${n}`)) return `${base}${n}`;
  throw new Error('Naming standard exhausted');
}

export const SAAS_CATALOG = [
  { id: 'carechart', name: 'CareChart EHR', description: 'Electronic health record (clinical documentation, orders, medications)', idp: 'Entra ID', provisioning: 'SCIM (Entra)', group: 'app-carechart', ownerTitle: 'Nurse Manager', roles: ['Clinician', 'Charge Nurse', 'Admin'] },
  { id: 'imagevault', name: 'ImageVault PACS', description: 'Picture archiving and communication (medical imaging)', idp: 'Okta', provisioning: 'SCIM (Okta)', group: 'app-imagevault', ownerTitle: 'Radiology Manager', roles: ['Imaging User', 'Radiology Manager', 'Admin'] },
  { id: 'payrollpro', name: 'PayrollPro', description: 'Payroll processing (no SCIM connector: accounts are created and removed by hand)', idp: 'Okta', provisioning: 'Manual', group: 'app-payrollpro', ownerTitle: 'Financial Controller', roles: ['Payroll Submitter', 'Payroll Approver', 'Viewer'] },
  { id: 'expenseflow', name: 'ExpenseFlow', description: 'Expenses and travel (birthright for every employee)', idp: 'Okta', provisioning: 'SCIM (Okta)', group: 'app-expenseflow', ownerTitle: 'Financial Controller', roles: ['Employee', 'Approver'] },
] as const;

export const BREAK_GLASS = ['bg-emergency01@meridianhealth.onmicrosoft.test', 'bg-emergency02@meridianhealth.onmicrosoft.test'] as const;
