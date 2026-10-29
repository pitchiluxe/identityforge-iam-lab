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
  /**
   * The current password. Real AD keeps only a hash; the range keeps the text
   * so a sign-in (Remote Desktop) can be tested. Null when nobody in the
   * range knows it (seeded accounts, or a reset typed through Read-Host).
   */
  labPassword?: string | null;
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
  /** Free text, e.g. "Reclaimed from Ana Ruiz" after the user was deleted. */
  description?: string;
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
  /** Guest for B2B collaborators; absent means Member. */
  userType?: 'Member' | 'Guest';
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
  /** Cloud-only lab accounts: the current password, so the Azure portal sign-in can be tested. */
  labPassword?: string;
  mustChangePassword?: boolean;
  /** Two-letter country; licences need it. Cloud-side, so editable on synced users too. */
  usageLocation?: string;
  /** Licences assigned to the user directly (kept by sync; group-based ones are recomputed). */
  directLicenses?: string[];
  /** The current Temporary Access Pass, if one was issued (world/authMethods.ts). */
  tap?: { code: string; expires: string; oneTime: boolean; used: boolean };
}

/** A cloud-only group created in Entra (synced AD groups are tracked by name in EntraTenant.groups). */
export interface CloudGroup {
  id: string;
  name: string;
  type: 'Security' | 'Microsoft 365';
  description: string;
  owners: string[];
  created: string;
}

export interface AdminUnit {
  id: string;
  name: string;
  description: string;
  members: string[];
  scopedRoles: { upn: string; role: string }[];
  created: string;
}

export interface TenantLicense {
  sku: string;
  total: number;
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
  /** SAML or OIDC configuration, on both sides of the trust (see world/federation.ts). */
  fed?: AppFederation;
  /** UPNs who own the enterprise app (may manage its assignments). */
  owners?: string[];
}

/** An app registration (MSP company tenants, world/apps.ts). */
export interface AppRegistration {
  appId: string;
  objectId: string;
  name: string;
  owners: string[];
  redirectUris: string[];
  secrets: { id: string; description: string; created: string; expires: string }[];
  permissions: { api: string; name: string; type: 'Delegated' | 'Application'; consented: boolean }[];
  created: string;
}

export interface SamlCert { thumbprint: string; created: string; expires: string; active: boolean }
export interface ClientSecret { id: string; hint: string; created: string; expires: string }

/** Identity provider (Entra) side and service provider (the app's own admin page) side of one SSO trust. */
export interface AppFederation {
  protocol: 'SAML' | 'OIDC';
  saml?: {
    entityId: string;
    replyUrls: string[];
    signOnUrl: string;
    nameIdSource: 'user.userprincipalname' | 'user.mail' | 'user.objectid' | 'user.employeeid';
    nameIdFormat: 'emailAddress' | 'persistent' | 'unspecified';
    claims: { name: string; source: string }[];
    certs: SamlCert[];
  };
  oidc?: {
    clientId: string;
    redirectUris: string[];
    secrets: ClientSecret[];
    groupsClaim: boolean;
  };
  /** What the application itself is configured to send and accept. */
  sp: {
    entityId?: string;
    acsUrl?: string;
    expectsNameId?: 'upn' | 'email';
    idpCertThumbprint?: string;
    redirectUri?: string;
    clientSecretId?: string;
  };
}

export interface SyncError {
  sam: string;
  upn: string;
  error: string;
  detail: string;
}

/** A device registered in Entra ID (MSP companies: workstations, hybrid-joined by Entra Connect). */
export interface EntraDevice {
  id: string;
  name: string;
  trustType: 'Hybrid Azure AD joined';
  ownerUpn: string | null;
  accountEnabled: boolean;
  os: string;
  registered: string;
}

export interface EntraTenant {
  /** MSP companies only, filled by Entra Connect (world/cloud.ts). */
  devices?: EntraDevice[];
  /** Created lazily by world/entraAdmin.ts. */
  cloudGroups?: CloudGroup[];
  /** Created lazily by world/apps.ts. */
  appRegistrations?: AppRegistration[];
  /** Authentication methods policy, created lazily by world/authMethods.ts. */
  authMethodsPolicy?: Record<string, boolean>;
  /** Created lazily by world/identityExtras.ts. */
  adminUnits?: AdminUnit[];
  externalSettings?: { guestInviteRestrictions: 'everyone' | 'members' | 'admins' | 'none'; allowDomains: string[]; denyDomains: string[] };
  /** One-time markers: tenant security baseline and MSP PIM eligibility were applied. */
  securityBaseline?: boolean;
  pimDefaults?: boolean;
  /** Named locations for Conditional Access (world/tenantSettings.ts). */
  namedLocations?: { name: string; ips: string[]; trusted: boolean }[];
  licenses?: TenantLicense[];
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
  /** The employee ID the application stores, when it stores one (IGA correlates on it). */
  employeeId?: string;
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
  /** A Meridian Department, 'Contractor', or an MSP company's own department name. */
  department: Department | 'Contractor' | (string & {});
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
  /** ServiceNow escalations and the verdict each got (world/servicenow.ts). */
  escalations?: { team: EscalationTeam; reason: string; time: string; verdict: 'accepted' | 'declined' | 'redirected' }[];
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

export type AuditSource = 'AD' | 'Entra ID' | 'Okta' | 'SaaS' | 'ServiceDesk' | 'HR' | 'Mail' | 'Sync' | 'IGA' | 'PAM' | 'Azure';

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

/** Who an MSP engineer can hand a ticket to (ServiceNow). */
export type EscalationTeam = 'Security Operations' | 'Customer approver' | 'Change Advisory Board' | 'Tier 3 Engineering';

export type CheckSpec =
  /** No audit event after `afterAudit` with this target (or naming it in detail) and one of these actions. */
  | { k: 'neverChanged'; target: string; actions: string[]; afterAudit: number }
  | { k: 'escalatedTo'; ticket: string; team: EscalationTeam }
  | { k: 'cloudGroupMember'; upn: string; group: string; value: boolean }
  | { k: 'entraLicense'; upn: string; sku: string; value: boolean }
  /** A direct assignment at exactly this scope (inherited ones do not count). */
  | { k: 'azureRole'; principal: string; role: string; scope: string; value: boolean }
  | { k: 'tapIssuedSince'; upn: string; since: string }
  | { k: 'entraGuest'; email: string; value: boolean }
  | { k: 'adOuExists'; ou: string; value: boolean }
  /** A successful sign-in (4624) by sam, on host if given, at or after `after` (the ticket opening). */
  | { k: 'signedInOn'; sam: string; host?: string; after: string; label?: string }
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
  | { k: 'securityTicketRaised'; since: string; anyOf: string[] }
  | { k: 'ssoWorks'; app: string; upn: string }
  | { k: 'entraDirectAssignment'; app: string; upn: string; value: boolean }
  | { k: 'igaAggregatedSince'; source: string; since: string }
  | { k: 'igaCorrelation'; source: string; account: string; employeeId: string | null }
  | { k: 'certSignedOff'; campaign: string }
  | { k: 'pamSession'; account: string; since: string }
  | { k: 'pamPasswordShown'; account: string; since: string; value: boolean }
  | { k: 'pamRotatedSince'; account: string; since: string }
  | { k: 'pamManaged'; account: string; value: boolean }
  | { k: 'pamDependenciesInSync'; account: string }
  | { k: 'pamRequestWithTicket'; account: string; since: string; ticket: string };

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
  /** MSP labs: the escalation the template expects (none = handle it yourself). */
  escalation?: { team: EscalationTeam; outcome: 'closed' | 'returned'; code?: ResolutionCode; response: string };
  /** MSP labs: Resolve attempts the gate refused. */
  attempts?: number;
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

export interface AzureResource {
  /** Full ARM resource id, which is also its RBAC scope. */
  id: string;
  name: string;
  type: string;
  rg: string;
  subscription: string;
  location: string;
  created: string;
  /** Key vaults: access model, access policies and secret names (never values). */
  vault?: { model: 'rbac' | 'accessPolicy'; accessPolicies: { principal: string; secrets: ('get' | 'list' | 'set' | 'delete')[] }[]; secrets: { name: string; enabled: boolean; expires: string | null }[] };
  /** VMs and App Services: system-assigned managed identity enabled. */
  identity?: boolean;
}

/** An Azure RBAC role assignment (not to be confused with Entra directory roles, RoleAssignment). */
export interface AzureRoleAssignment {
  id: string;
  /** UPN for a user, display name for a group. */
  principal: string;
  principalType: 'User' | 'Group' | 'ServicePrincipal';
  role: string;
  scope: string;
  created: string;
  createdBy: string;
}

export interface AzureEstate {
  subscriptions: { id: string; name: string }[];
  resourceGroups: { name: string; subscription: string; location: string }[];
  resources: AzureResource[];
  assignments: AzureRoleAssignment[];
}

export interface World {
  version: number;
  /** MSP customer company (world/profiles.ts); absent for Meridian. */
  profileId?: string;
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
  /** Identity governance platform, created on first use (world/iga.ts). */
  iga?: Iga;
  /** Privileged access vault, created on first use (world/pam.ts). */
  pam?: Pam;
  /** Azure subscriptions, resources and RBAC, created on first use (world/azure.ts). */
  azure?: AzureEstate;
}

// ---------------------------------------------------------------- Identity governance (IGA)

export interface IgaSource {
  id: string;
  name: string;
  type: 'Authoritative (HR)' | 'Active Directory' | 'Application (connector)' | 'Delimited file (disconnected)';
  /** sam of the source owner. */
  owner: string | null;
  lastAggregation: string;
}

/** An account as the IGA platform last saw it during aggregation. */
export interface IgaAccount {
  source: string;
  nativeId: string;
  displayName: string;
  /** Employee ID read from the source, if it carries one. */
  employeeId: string | null;
  entitlements: string[];
  disabled: boolean;
}

export interface CertItem {
  id: string;
  /** Employee ID of the identity. */
  identity: string;
  identityName: string;
  account: string;
  source: string;
  entitlement: string;
  /** sam of the reviewer. */
  reviewer: string;
  flags: string[];
  decision: 'pending' | 'approve' | 'revoke';
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string;
  remediation: 'none' | 'done' | 'manual-open' | 'manual-done';
}

export interface Campaign {
  id: string;
  name: string;
  type: 'Source Owner' | 'Manager' | 'Search';
  status: 'Active' | 'Signed off';
  created: string;
  due: string;
  description: string;
  items: CertItem[];
  signedOffBy: string | null;
  signedOffAt: string | null;
}

export interface AccessException { id: string; employeeId: string; entitlement: string; approvedBy: string; expires: string; reason: string }

export interface Iga {
  sources: IgaSource[];
  accounts: IgaAccount[];
  /** Manual correlations, keyed "source/nativeId": an employee ID, or "" for "belongs to nobody". */
  correlations: Record<string, string>;
  campaigns: Campaign[];
  exceptions: AccessException[];
  sodPolicies: { id: string; name: string; left: string; right: string }[];
}

// ---------------------------------------------------------------- Privileged access (PAM vault)

export interface PamSafe {
  name: string;
  description: string;
  members: { member: string; role: 'Use' | 'Retrieve' | 'Approve' | 'Manage' }[];
  dualControl: boolean;
  requireTicket: boolean;
  rotateOnCheckin: boolean;
}

export interface PamDependency { type: 'Windows Service' | 'Scheduled Task' | 'IIS Application Pool'; host: string; name: string; syncedVersion: number }

export interface PamAccount {
  id: string;
  safe: string;
  userName: string;
  address: string;
  platform: 'Windows Domain Account' | 'Windows Service Account' | 'Entra ID Cloud Account';
  managed: boolean;
  rotationDays: number;
  lastRotated: string;
  passwordVersion: number;
  dependencies: PamDependency[];
}

export interface PamRequest { id: string; accountId: string; requester: string; reason: string; ticket: string; state: 'Pending' | 'Approved' | 'Rejected'; approver: string | null; time: string; decision: string }
export interface PamSession { id: string; accountId: string; user: string; target: string; start: string; end: string | null; ticket: string }
export interface PamEvent { id: number; time: string; user: string; action: string; accountId: string; detail: string }

export interface Pam {
  safes: PamSafe[];
  accounts: PamAccount[];
  requests: PamRequest[];
  sessions: PamSession[];
  events: PamEvent[];
  /** Privileged accounts found by discovery that are not in the vault yet. */
  discovered: { userName: string; address: string; reason: string }[];
  /** What really runs as each account (the estate), whether or not the vault knows about it. */
  usages: Record<string, { type: PamDependency['type']; host: string; name: string }[]>;
}
