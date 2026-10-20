/**
 * world/iga.ts — the identity governance platform (modelled on SailPoint
 * Identity Security Cloud; Saviynt's names for the same ideas are shown in the
 * console).
 *
 * The IGA platform does not read the other systems live. It sees what it last
 * aggregated: a snapshot of accounts per source (Saviynt: "import"). Accounts
 * are correlated to identities, which are the HR workers (the authoritative
 * source). Anything it cannot correlate is listed as uncorrelated until a
 * person decides who it belongs to, or that it belongs to nobody.
 *
 * Certification campaigns (Saviynt: access reviews) are built from the
 * snapshot. Decisions only change anything when the campaign is signed off:
 * revocations on connected sources are provisioned by the connector, and
 * revocations an application cannot receive (PayrollPro has no connector)
 * become manual work items, which is how real remediation gaps happen.
 */
import type { AdUser, Campaign, CertItem, Iga, IgaAccount, IgaSource, World } from '../core/types.ts';
import { daysAgo, nowIso } from '../core/time.ts';
import { audit } from './audit.ts';
import { PRIVILEGED_GROUPS, birthright, roleByTitle } from './company.ts';
import { findUser, removeMember, setEnabled } from './directory.ts';
import { setSaasAccount } from './cloud.ts';
import { openTicket } from './itsm.ts';

export class IgaError extends Error {}

export const IGA_ACTOR = 'IGA connector (svc-iga)';
const key = (source: string, nativeId: string): string => `${source}/${nativeId.toLowerCase()}`;

/** Saviynt's word for each SailPoint concept, shown in the console so both vocabularies stick. */
export const SAVIYNT_TERMS: Record<string, string> = {
  Source: 'Security System / Endpoint',
  Aggregation: 'Import (accounts and access)',
  Correlation: 'Account-to-user correlation (correlation rule)',
  'Access Profile': 'Entitlement bundle',
  Role: 'Role (enterprise / application role)',
  Certification: 'Access Review / Certification campaign',
  'SoD Policy': 'SoD ruleset (Saviynt SoD)',
  'Manual work item': 'Manual provisioning task',
};

function lead(w: World, title: string): string | null {
  return w.ad.users.find((u) => u.title === title && u.kind === 'user' && u.enabled)?.sam ?? null;
}

function defaultSources(w: World): IgaSource[] {
  const at = w.created;
  return [
    { id: 'peoplehub', name: 'PeopleHub (HR)', type: 'Authoritative (HR)', owner: lead(w, 'HR Manager'), lastAggregation: at },
    { id: 'ad', name: 'Active Directory (meridianhealth.test)', type: 'Active Directory', owner: w.player.sam, lastAggregation: at },
    { id: 'carechart', name: 'CareChart EHR', type: 'Application (connector)', owner: lead(w, 'Nurse Manager'), lastAggregation: at },
    { id: 'imagevault', name: 'ImageVault PACS', type: 'Application (connector)', owner: lead(w, 'Radiology Manager'), lastAggregation: at },
    { id: 'expenseflow', name: 'ExpenseFlow', type: 'Application (connector)', owner: lead(w, 'Financial Controller'), lastAggregation: at },
    { id: 'payrollpro', name: 'PayrollPro', type: 'Delimited file (disconnected)', owner: lead(w, 'Financial Controller'), lastAggregation: at },
  ];
}

/** The platform, created the first time anything asks for it, from what the world already holds. */
export function ensureIga(w: World): Iga {
  if (w.iga) return w.iga;
  w.iga = {
    sources: defaultSources(w),
    accounts: [],
    correlations: {},
    campaigns: [],
    exceptions: [],
    sodPolicies: [{ id: 'SOD-001', name: 'Payroll: submit and approve', left: 'grp-payroll-submit', right: 'grp-payroll-approve' }],
  };
  for (const s of w.iga.sources) w.iga.accounts.push(...readSource(w, s.id));
  return w.iga;
}

/** What a source holds right now (what an aggregation would read). */
export function readSource(w: World, sourceId: string): IgaAccount[] {
  if (sourceId === 'peoplehub') {
    return w.hr.workers.map((x) => ({ source: sourceId, nativeId: x.employeeId, displayName: `${x.first} ${x.last}`, employeeId: x.employeeId, entitlements: [x.title], disabled: x.status === 'Terminated' }));
  }
  if (sourceId === 'ad') {
    return w.ad.users.map((u) => ({ source: sourceId, nativeId: u.sam, displayName: u.displayName, employeeId: u.employeeId || null, entitlements: u.memberOf.filter((g) => g !== 'Domain Users'), disabled: !u.enabled }));
  }
  const app = w.saas.find((a) => a.id === sourceId);
  if (!app) throw new IgaError(`Unknown source ${sourceId}.`);
  return app.accounts.map((a) => ({ source: sourceId, nativeId: a.login, displayName: a.displayName, employeeId: a.employeeId ?? null, entitlements: [a.role], disabled: !a.active }));
}

export function getSource(w: World, sourceId: string): IgaSource {
  const s = ensureIga(w).sources.find((x) => x.id === sourceId);
  if (!s) throw new IgaError(`Source ${sourceId} not found.`);
  return s;
}

/** Refresh one source's snapshot. Returns what changed, as the aggregation report does. */
export function aggregate(w: World, sourceId: string, actor = w.player.sam): { accounts: number; added: number; removed: number; uncorrelated: number } {
  const iga = ensureIga(w);
  const src = getSource(w, sourceId);
  const before = new Set(iga.accounts.filter((a) => a.source === sourceId).map((a) => a.nativeId.toLowerCase()));
  const fresh = readSource(w, sourceId);
  iga.accounts = [...iga.accounts.filter((a) => a.source !== sourceId), ...fresh];
  src.lastAggregation = nowIso();
  const after = new Set(fresh.map((a) => a.nativeId.toLowerCase()));
  const added = [...after].filter((x) => !before.has(x)).length;
  const removed = [...before].filter((x) => !after.has(x)).length;
  const uncorrelated = uncorrelatedAccounts(w).filter((a) => a.source === sourceId).length;
  audit(w, { source: 'IGA', action: `Aggregation completed: ${src.name}`, target: src.name, actor, detail: `${fresh.length} accounts, ${added} new, ${removed} removed, ${uncorrelated} uncorrelated` });
  return { accounts: fresh.length, added, removed, uncorrelated };
}

/** The AD account an app account belongs to (apps are provisioned with the UPN as login). */
function adByLogin(w: World, login: string): AdUser | undefined {
  return w.ad.users.find((u) => u.upn.toLowerCase() === login.toLowerCase());
}

/**
 * The identity (employee ID) an account is correlated to, "" for an account
 * someone has declared to belong to nobody, or null when it is uncorrelated.
 * Order: a manual correlation, then the source's correlation rule (AD by
 * employeeID; applications by login = UPN).
 */
export function identityOf(w: World, a: IgaAccount): string | null {
  const iga = ensureIga(w);
  const manual = iga.correlations[key(a.source, a.nativeId)];
  if (manual !== undefined) return manual;
  const known = (id: string | null): boolean => !!id && w.hr.workers.some((x) => x.employeeId === id);
  if (a.source === 'peoplehub') return a.employeeId;
  if (a.source === 'ad') {
    const u = findUser(w, a.nativeId);
    if (u?.kind === 'admin') {
      const owner = /Admin account for (\S+)/.exec(u.description)?.[1];
      const ou = owner ? findUser(w, owner) : undefined;
      return ou && known(ou.employeeId) ? ou.employeeId : null;
    }
    return known(a.employeeId) ? a.employeeId : null;
  }
  // Applications correlate by rule (login = AD UPN). An employee ID an application merely
  // stores is evidence for a person to check, not something the rule trusts.
  const ad = adByLogin(w, a.nativeId);
  return ad && known(ad.employeeId) ? ad.employeeId : null;
}

/** Service accounts are owned by people but are not people; they are reviewed separately. */
export function isNonHuman(w: World, a: IgaAccount): boolean {
  return a.source === 'ad' && findUser(w, a.nativeId)?.kind === 'service';
}

export function uncorrelatedAccounts(w: World): IgaAccount[] {
  return ensureIga(w).accounts.filter((a) => a.source !== 'peoplehub' && !isNonHuman(w, a) && identityOf(w, a) === null);
}

export function findAccount(w: World, source: string, nativeId: string): IgaAccount {
  const a = ensureIga(w).accounts.find((x) => x.source === source && x.nativeId.toLowerCase() === nativeId.toLowerCase());
  if (!a) throw new IgaError(`No ${source} account "${nativeId}" in the last aggregation. Aggregate the source first.`);
  return a;
}

/** Decide who an account belongs to: an employee ID, or "" for nobody (an orphan). */
export function correlate(w: World, source: string, nativeId: string, employeeId: string, actor = w.player.sam): void {
  const iga = ensureIga(w);
  const a = findAccount(w, source, nativeId);
  if (employeeId && !w.hr.workers.some((x) => x.employeeId === employeeId)) throw new IgaError(`No identity with employee ID ${employeeId}.`);
  iga.correlations[key(a.source, a.nativeId)] = employeeId;
  const who = employeeId ? w.hr.workers.find((x) => x.employeeId === employeeId)! : null;
  audit(w, { source: 'IGA', action: employeeId ? 'Account correlated to identity' : 'Account marked as belonging to no identity', target: `${a.source}/${a.nativeId}`, actor, detail: who ? `${who.first} ${who.last} (${who.employeeId}, ${who.status})` : 'orphan' });
}

/** Disable an account through the source's connector. */
export function disableAccount(w: World, source: string, nativeId: string, actor = w.player.sam): void {
  const a = findAccount(w, source, nativeId);
  const src = getSource(w, source);
  if (src.type === 'Delimited file (disconnected)') throw new IgaError(`${src.name} is a disconnected source: the platform cannot change it. Raise a manual work item and deactivate the account in the application.`);
  if (source === 'ad') setEnabled(w, a.nativeId, false, IGA_ACTOR);
  else if (source === 'peoplehub') throw new IgaError('HR records are not disabled from governance; HR terminates workers in PeopleHub.');
  else setSaasAccount(w, source, a.nativeId, false, IGA_ACTOR);
  a.disabled = true;
  audit(w, { source: 'IGA', action: 'Disable account requested', target: `${source}/${a.nativeId}`, actor, detail: `Provisioned by the ${src.name} connector` });
}

// ---------------------------------------------------------------- identities

export interface IdentityView {
  employeeId: string;
  name: string;
  status: string;
  department: string;
  title: string;
  manager: string | null;
  accounts: IgaAccount[];
}

export function identities(w: World): IdentityView[] {
  const accts = ensureIga(w).accounts.filter((a) => a.source !== 'peoplehub');
  return w.hr.workers.map((x) => {
    const mgr = x.managerId ? w.hr.workers.find((m) => m.employeeId === x.managerId) : null;
    return {
      employeeId: x.employeeId, name: `${x.first} ${x.last}`, status: x.status, department: x.department, title: x.title,
      manager: mgr ? `${mgr.first} ${mgr.last}` : null,
      accounts: accts.filter((a) => identityOf(w, a) === x.employeeId),
    };
  });
}

// ---------------------------------------------------------------- certifications

/** Why a line deserves a reviewer's attention. Empty means it matches the person's role. */
export function itemFlags(w: World, employeeId: string, account: string, entitlement: string, held: string[]): string[] {
  const iga = ensureIga(w);
  const worker = w.hr.workers.find((x) => x.employeeId === employeeId);
  const flags: string[] = [];
  if (worker?.status === 'Terminated') flags.push('Terminated');
  for (const p of iga.sodPolicies) {
    if ((entitlement === p.left && held.includes(p.right)) || (entitlement === p.right && held.includes(p.left))) flags.push(`SoD ${p.id}`);
  }
  const exc = iga.exceptions.find((e) => e.employeeId === employeeId && e.entitlement === entitlement && Date.parse(e.expires) > Date.parse(nowIso()));
  if (exc) flags.push(`Exception ${exc.id}`);
  const u = findUser(w, account);
  const role = u ? roleByTitle(u.title) : undefined;
  if (role && !birthright(role.group).includes(entitlement) && !exc) flags.push('Outside role');
  if (PRIVILEGED_GROUPS.includes(entitlement)) flags.push('Privileged');
  if (u?.lastLogon && Date.parse(u.lastLogon) < Date.parse(daysAgo(90))) flags.push('Dormant 90d');
  return flags;
}

/**
 * A source-owner campaign over Active Directory group memberships for the
 * given departments: one line per membership, all reviewed by the source owner.
 */
export function createSourceCampaign(w: World, opts: { name: string; departments: string[]; reviewer: string; due: string; description: string; created?: string }): Campaign {
  const iga = ensureIga(w);
  aggregate(w, 'ad', IGA_ACTOR);
  const id = `CERT-${String(iga.campaigns.length + 1).padStart(3, '0')}`;
  const items: CertItem[] = [];
  let n = 0;
  for (const a of iga.accounts.filter((x) => x.source === 'ad' && !x.disabled)) {
    const emp = identityOf(w, a);
    if (!emp) continue;
    const worker = w.hr.workers.find((x) => x.employeeId === emp)!;
    const u = findUser(w, a.nativeId);
    if (!u || u.kind !== 'user' || !opts.departments.includes(worker.department)) continue;
    for (const g of a.entitlements) {
      items.push({
        id: `${id}-${++n}`, identity: emp, identityName: `${worker.first} ${worker.last}`, account: a.nativeId, source: 'ad', entitlement: g,
        reviewer: opts.reviewer, flags: itemFlags(w, emp, a.nativeId, g, a.entitlements), decision: 'pending', decidedBy: null, decidedAt: null, comment: '', remediation: 'none',
      });
    }
  }
  const c: Campaign = { id, name: opts.name, type: 'Source Owner', status: 'Active', created: opts.created ?? nowIso(), due: opts.due, description: opts.description, items, signedOffBy: null, signedOffAt: null };
  iga.campaigns.push(c);
  audit(w, { source: 'IGA', action: 'Certification campaign activated', target: c.name, actor: IGA_ACTOR, detail: `${items.length} access items, reviewer ${opts.reviewer}` });
  return c;
}

export function getCampaign(w: World, id: string): Campaign {
  const c = ensureIga(w).campaigns.find((x) => x.id === id);
  if (!c) throw new IgaError(`Campaign ${id} not found.`);
  return c;
}

export function decide(w: World, campaignId: string, itemIds: string[], decision: 'approve' | 'revoke', comment = '', actor = w.player.sam): number {
  const c = getCampaign(w, campaignId);
  if (c.status !== 'Active') throw new IgaError('This campaign is signed off; decisions are final.');
  let n = 0;
  for (const id of itemIds) {
    const it = c.items.find((x) => x.id === id);
    if (!it) continue;
    if (it.reviewer !== actor) throw new IgaError(`${it.identityName} / ${it.entitlement} is assigned to ${it.reviewer}. Only the assigned reviewer can decide it; reassign it if they cannot.`);
    if (findUser(w, actor)?.employeeId === it.identity) throw new IgaError('You cannot certify your own access. Reassign this item.');
    it.decision = decision;
    it.decidedBy = actor;
    it.decidedAt = nowIso();
    it.comment = comment;
    n++;
  }
  if (n) audit(w, { source: 'IGA', action: `Certification decisions: ${decision}`, target: c.name, actor, detail: `${n} item(s)${comment ? `: ${comment}` : ''}` });
  return n;
}

export function undo(w: World, campaignId: string, itemIds: string[], actor = w.player.sam): void {
  const c = getCampaign(w, campaignId);
  if (c.status !== 'Active') throw new IgaError('This campaign is signed off; decisions are final.');
  for (const id of itemIds) {
    const it = c.items.find((x) => x.id === id);
    if (it && it.reviewer === actor) { it.decision = 'pending'; it.decidedBy = null; it.decidedAt = null; it.comment = ''; }
  }
}

export function reassign(w: World, campaignId: string, itemIds: string[], reviewer: string, actor = w.player.sam): void {
  const c = getCampaign(w, campaignId);
  const u = findUser(w, reviewer);
  if (!u || !u.enabled || u.kind !== 'user') throw new IgaError(`${reviewer} is not an active person who can review.`);
  for (const id of itemIds) {
    const it = c.items.find((x) => x.id === id);
    if (!it || it.decision !== 'pending') continue;
    if (u.employeeId === it.identity) throw new IgaError(`${u.displayName} cannot review their own access.`);
    it.reviewer = u.sam;
  }
  audit(w, { source: 'IGA', action: 'Certification items reassigned', target: c.name, actor, detail: `${itemIds.length} item(s) to ${u.sam}` });
}

/** Manual-provisioning apps whose access group a revocation removes: the account itself still has to be removed by hand. */
function manualAppFor(w: World, entitlement: string): string | null {
  return w.saas.find((a) => a.accessGroup === entitlement && a.provisioning === 'Manual')?.id ?? null;
}

/** Sign off: every line decided, then revocations are provisioned (or raised as manual work). */
export function signOff(w: World, campaignId: string, actor = w.player.sam): { revoked: number; manual: string[] } {
  const c = getCampaign(w, campaignId);
  if (c.status !== 'Active') throw new IgaError('Already signed off.');
  const pending = c.items.filter((i) => i.decision === 'pending').length;
  if (pending) throw new IgaError(`${pending} item(s) are still pending. Every line needs a decision before sign-off.`);
  const manual: string[] = [];
  let revoked = 0;
  for (const it of c.items.filter((i) => i.decision === 'revoke')) {
    if (it.source === 'ad') {
      removeMember(w, it.entitlement, it.account, IGA_ACTOR);
      it.remediation = 'done';
      revoked++;
    }
    const app = manualAppFor(w, it.entitlement);
    if (app) {
      const login = findUser(w, it.account)?.upn ?? it.account;
      const appName = w.saas.find((a) => a.id === app)!.name;
      const t = openTicket(w, {
        type: 'Request', category: 'Manual Provisioning', priority: 3, caller: 'Identity Governance', requestedFor: it.identityName,
        short: `Manual work item: remove ${appName} account ${login} (${c.id})`,
        description: `Certification ${c.name} revoked ${it.entitlement} for ${it.identityName}. ${appName} has no connector, so the account must be deactivated in the application by hand, then this work item closed.\n\nAccount: ${login}`,
        variables: { Campaign: c.id, Application: appName, Account: login },
      });
      it.remediation = 'manual-open';
      manual.push(t.id);
    }
  }
  c.status = 'Signed off';
  c.signedOffBy = actor;
  c.signedOffAt = nowIso();
  audit(w, { source: 'IGA', action: 'Certification signed off', target: c.name, actor, detail: `${revoked} revocation(s) provisioned, ${manual.length} manual work item(s)` });
  return { revoked, manual };
}

export function addException(w: World, e: { id: string; employeeId: string; entitlement: string; approvedBy: string; expires: string; reason: string }): void {
  ensureIga(w).exceptions.push(e);
}
