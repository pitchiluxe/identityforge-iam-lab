/**
 * core/types.ts — the shape of the simulated company.
 *
 * The whole world is one plain JSON object so it can be saved, reloaded and
 * graded without any hidden state. Every module receives a World and changes
 * it through its own functions; nothing else holds a copy.
 */

export type Department = 'IT' | 'Help Desk' | 'Security' | 'HR' | 'Finance' | 'Nursing' | 'Radiology';

// ---------------------------------------------------------------- Active Directory

export interface AdUser {
  sam: string;
  upn: string;
  mail: string;
  employeeId: string;
  givenName: string;
  surname: string;
  displayName: string;
  department: string;
  title: string;
  /** sam of the manager, or null. */
  manager: string | null;
  /** Path form, e.g. "Corp/Users/Finance". */
  ou: string;
  enabled: boolean;
  lockedOut: boolean;
  badPwdCount: number;
  pwdLastSet: string;
  mustChangePassword: boolean;
  passwordNeverExpires: boolean;
  lastLogon: string | null;
  accountExpires: string | null;
  description: string;
  office: string;
  memberOf: string[];
  kind: 'user' | 'service' | 'admin';
  created: string;
  whenChanged: string;
}

export interface AdGroup {
  name: string;
  ou: string;
  scope: 'Global' | 'DomainLocal' | 'Universal';
  category: 'Security' | 'Distribution';
  description: string;
  /** sam of the owner, or null. */
  managedBy: string | null;
  privileged: boolean;
}

export interface AdComputer {
  name: string;
  ou: string;
  os: string;
  enabled: boolean;
  lastLogon: string;
  /** sam of the person who usually signs in on it. */
  primaryUser: string | null;
  ip: string;
}

export interface Directory {
  domain: string;
  netbios: string;
  ous: string[];
  users: AdUser[];
  groups: AdGroup[];
  computers: AdComputer[];
  /**
   * Attributes the lab does not grade but ADUC shows and edits (address,
   * telephones, profile, OU descriptions, delegations). Optional so older
   * saved worlds load unchanged.
   */
  extra?: {
    userAttrs: Record<string, Record<string, string>>;
    groupAttrs: Record<string, Record<string, string>>;
    ouInfo: Record<string, { description: string; protected: boolean; attrs: Record<string, string>; created: string }>;
    delegations: { ou: string | null; trustee: string; tasks: string[]; at: string }[];
  };
}

// ---------------------------------------------------------------- Entra ID

export interface MfaMethod {
  type: 'Microsoft Authenticator' | 'Phone (SMS)' | 'FIDO2 security key' | 'Windows Hello for Business';
  detail: string;
  added: string;
}

export interface RoleAssignment {
  role: string;
  assignment: 'active' | 'eligible';
  permanent: boolean;
  expires: string | null;
  justification: string;
}

export interface EntraUser {
  id: string;
  upn: string;
  displayName: string;
  source: 'synced' | 'cloud';
  /** sam of the AD object this was synced from. */
  onPremSam: string | null;
  accountEnabled: boolean;
  department: string;
  jobTitle: string;
  groups: string[];
  mfaMethods: MfaMethod[];
  mfaResetAt: string | null;
  /** Refresh tokens issued before this are invalid. */
  sessionsValidFrom: string;
  /** When each live session was issued. */
  sessions: { issued: string; app: string; device: string }[];
  roles: RoleAssignment[];
  licenses: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  deleted: boolean;
}

export interface SignIn {
  id: string;
  time: string;
  upn: string;
  app: string;
  ip: string;
  location: string;
  device: string;
  result: 'Success' | 'Failure' | 'Interrupted';
  failureReason: string;
  mfa: 'Satisfied' | 'Denied by user' | 'Not required' | 'Pending';
  ca: string;
  risk: 'none' | 'low' | 'medium' | 'high';
}

export interface CaPolicy {
  id: string;
  name: string;
  state: 'on' | 'off' | 'report-only';
  includeUsers: 'All users' | 'Directory roles' | string;
  excludeUsers: string[];
  apps: 'All cloud apps' | string;
  condition: 'none' | 'legacy-auth' | 'sign-in-risk-high' | 'outside-trusted-locations';
  grant: 'block' | 'require-mfa' | 'require-compliant-device';
  created: string;
}

export interface EntraApp {
  id: string;
  name: string;
  sso: 'OIDC' | 'SAML';
  assignmentRequired: boolean;
  assignedGroups: string[];
  assignedUsers: string[];
  provisioning: 'SCIM' | 'None';
  /** SaaS app id this enterprise app provisions to. */
  saasId: string | null;
}

export interface SyncError {
  sam: string;
  upn: string;
  error: string;
  detail: string;
}

export interface EntraTenant {
  tenantName: string;
  primaryDomain: string;
  users: EntraUser[];
  groups: string[];
  apps: EntraApp[];
  caPolicies: CaPolicy[];
  signIns: SignIn[];
  syncScope: string[];
  lastSync: string;
  syncErrors: SyncError[];
}

// ---------------------------------------------------------------- Okta

export type OktaStatus = 'ACTIVE' | 'SUSPENDED' | 'DEPROVISIONED' | 'LOCKED_OUT' | 'STAGED';

export interface OktaUser {
  login: string;
  displayName: string;
  status: OktaStatus;
  source: 'Active Directory' | 'Okta';
  onPremSam: string | null;
  groups: string[];
  factors: string[];
  factorsResetAt: string | null;
  sessions: number;
  sessionsClearedAt: string | null;
  lastLogin: string | null;
}

export interface OktaApp {
  id: string;
  name: string;
  sso: 'SAML' | 'OIDC' | 'SWA';
  assignedGroups: string[];
  assignedUsers: string[];
  provisioning: 'SCIM' | 'None';
  saasId: string | null;
}

export interface OktaOrg {
  orgUrl: string;
  users: OktaUser[];
  apps: OktaApp[];
  lastImport: string;
}

// ---------------------------------------------------------------- SaaS, HR, ITSM, mail

export interface SaasAccount {
  login: string;
  displayName: string;
  role: string;
  active: boolean;
  lastLogin: string | null;
  /** Who manages it: a provisioning connector, or a person by hand. */
  managedBy: 'SCIM (Okta)' | 'SCIM (Entra)' | 'Manual';
}

export interface SaasApp {
  id: string;
  name: string;
  description: string;
  owner: string;
  provisioning: 'SCIM (Okta)' | 'SCIM (Entra)' | 'Manual';
  idp: 'Okta' | 'Entra ID';
  accessGroup: string;
  roles: string[];
  accounts: SaasAccount[];
}

export type WorkerStatus = 'Active' | 'Pending Hire' | 'Terminated' | 'Leave of Absence';

export interface Worker {
  employeeId: string;
  first: string;
  last: string;
  department: Department | 'Contractor';
  title: string;
  /** employeeId of the manager. */
  managerId: string | null;
  location: string;
  status: WorkerStatus;
  hireDate: string;
  termDate: string | null;
  termType: 'Voluntary' | 'Involuntary' | null;
  /** Last four digits of the phone on file, used for identity verification. */
  phoneLast4: string;
  workerType: 'Employee' | 'Contractor';
}

export interface HrTransaction {
  time: string;
  employeeId: string;
  type: 'Hire' | 'Transfer' | 'Termination' | 'Leave' | 'Return' | 'Title Change';
  detail: string;
  effective: string;
}

export interface Hris {
  workers: Worker[];
  transactions: HrTransaction[];
}

export type TicketType = 'Incident' | 'Request' | 'Security Incident' | 'Change';
export type TicketState = 'New' | 'In Progress' | 'On Hold' | 'Resolved' | 'Cancelled';

export const RESOLUTION_CODES = [
  'Solved (Fulfilled)',
  'Solved (Workaround)',
  'Rejected - Policy',
  'Rejected - Not Approved',
  'Unable to Verify Identity',
  'Escalated to Security',
  'Duplicate',
] as const;
export type ResolutionCode = (typeof RESOLUTION_CODES)[number];

export interface Approval {
  approver: string;
  role: string;
  state: 'Approved' | 'Requested' | 'Rejected';
  time: string | null;
}

export interface Ticket {
  id: string;
  type: TicketType;
  short: string;
  description: string;
  caller: string;
  requestedFor: string;
  category: string;
  priority: 1 | 2 | 3 | 4;
  state: TicketState;
  assignmentGroup: string;
  opened: string;
  slaDue: string;
  approvals: Approval[];
  variables: Record<string, string>;
  workNotes: { time: string; author: string; text: string }[];
  resolution: { code: ResolutionCode; notes: string; time: string } | null;
  scenarioId: string | null;
}

export interface MailMessage {
  id: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  time: string;
  read: boolean;
  folder: 'Inbox' | 'Sent' | 'Reported';
  external: boolean;
}

// ---------------------------------------------------------------- Files and audit

export interface VFile {
  path: string;
  content: string;
  modified: string;
  readOnly: boolean;
  /** Set when the file is in the Recycle Bin. */
  deleted?: { from: string; at: string };
}

export type AuditSource = 'AD' | 'Entra ID' | 'Okta' | 'SaaS' | 'ServiceDesk' | 'HR' | 'Mail' | 'Sync';

export interface AuditEvent {
  id: number;
  time: string;
  source: AuditSource;
  /** Windows Security event ID for AD events. */
  eventId: number | null;
  actor: string;
  action: string;
  target: string;
  detail: string;
  /** Workstation or IP the event came from. */
  origin: string;
}

// ---------------------------------------------------------------- Scenarios and progress

export type CheckSpec =
  | { k: 'adExists'; sam: string; value: boolean }
  | { k: 'adEnabled'; sam: string; value: boolean }
  | { k: 'adLocked'; sam: string; value: boolean }
  | { k: 'adOu'; sam: string; ou: string }
  | { k: 'adAttr'; sam: string; attr: 'title' | 'department' | 'manager' | 'employeeId' | 'description' | 'upn' | 'givenName' | 'surname'; equals?: string; contains?: string }
  | { k: 'adMember'; sam: string; group: string; value: boolean }
  | { k: 'adOnlyGroups'; sam: string; groups: string[] }
  | { k: 'adPwdResetSince'; sam: string; since: string; value: boolean }
  | { k: 'adMustChange'; sam: string; value: boolean }
  | { k: 'adPwdNeverExpires'; sam: string; value: boolean }
  | { k: 'adGroupOwner'; group: string; owner: string }
  | { k: 'entraMatchesAd'; sam: string }
  | { k: 'entraEnabled'; upn: string; value: boolean }
  | { k: 'entraSessionsRevokedSince'; upn: string; since: string }
  | { k: 'entraMfaClearedSince'; upn: string; since: string; value: boolean }
  | { k: 'entraRole'; upn: string; role: string; assignment: 'active' | 'eligible' | 'none' }
  | { k: 'caPolicy'; grant: CaPolicy['grant']; mustExclude: string[]; states: CaPolicy['state'][] }
  | { k: 'oktaStatus'; login: string; statuses: OktaStatus[] }
  | { k: 'oktaSessionsClearedSince'; login: string; since: string }
  | { k: 'oktaAppAccess'; login: string; app: string; value: boolean }
  | { k: 'oktaDirectAssignment'; login: string; app: string; value: boolean }
  | { k: 'saasActive'; app: string; login: string; value: boolean }
  | { k: 'ticketResolved'; ticket: string; codes: ResolutionCode[]; allowOnHold?: boolean }
  | { k: 'noSyncError'; sam: string }
  | { k: 'ticketNote'; ticket: string; anyOf: string[] }
  | { k: 'mailReported'; mail: string; value: boolean }
  | { k: 'securityTicketRaised'; since: string; anyOf: string[] };

export interface Check {
  id: string;
  label: string;
  /** Failing a critical check fails the scenario whatever the score. */
  critical: boolean;
  spec: CheckSpec;
}

export type Category = 'Joiner' | 'Mover' | 'Leaver' | 'Authentication' | 'Access Request' | 'Governance' | 'Privileged Access' | 'Incident Response' | 'Hybrid Identity' | 'Federation & SSO';

export interface ScenarioInstance {
  id: string;
  templateId: string;
  twist: string;
  title: string;
  category: Category;
  difficulty: 1 | 2 | 3;
  skills: string[];
  started: string;
  ticketIds: string[];
  mailIds: string[];
  params: Record<string, string>;
  checks: Check[];
  hints: string[];
  hintsUsed: number;
  debrief: string;
  interview: { question: string; modelAnswer: string };
  designedBy: string | null;
  result: GradeResult | null;
  status: 'active' | 'passed' | 'failed' | 'abandoned';
  /** Audit ids (exclusive, inclusive] written while the lab was set up: backdrop, not the learner's work. */
  setupAudit?: [number, number];
}

export interface CheckResult {
  id: string;
  label: string;
  critical: boolean;
  pass: boolean;
  detail: string;
}

export interface GradeResult {
  time: string;
  score: number;
  passed: boolean;
  results: CheckResult[];
}

export interface Player {
  displayName: string;
  sam: string;
  adminSam: string;
}

export interface World {
  version: number;
  seed: number;
  created: string;
  player: Player;
  company: { name: string; domain: string };
  ad: Directory;
  entra: EntraTenant;
  okta: OktaOrg;
  saas: SaasApp[];
  hr: Hris;
  tickets: Ticket[];
  mail: MailMessage[];
  files: VFile[];
  audit: AuditEvent[];
  scenarios: ScenarioInstance[];
  counters: { ticket: number; audit: number; mail: number; scenario: number; signIn: number };
}
