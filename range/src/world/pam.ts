/**
 * world/pam.ts — the privileged access vault (modelled on CyberArk PAM:
 * safes, the Password Vault Web Access portal, PSM sessions and the CPM).
 *
 * The vault holds privileged credentials in safes. Members get only what they
 * need: Use connects through a recorded session without ever seeing the
 * password; Retrieve shows it; Approve answers dual-control requests; Manage
 * onboards, rotates and registers usages. Tier 0 needs an approved change
 * and a second person, and its password changes after every use.
 *
 * Rotation is where outages come from: every place an account's password is
 * stored (a Windows service, a scheduled task) must be registered as a usage,
 * or the next rotation breaks it. The estate (pam.usages) is the truth; the
 * vault's registered dependencies are what it will update.
 */
import type { Pam, PamAccount, PamDependency, PamRequest, PamSafe, PamSession, World } from '../core/types.ts';
import { daysAgo, nowIso } from '../core/time.ts';
import { audit } from './audit.ts';
import { BREAK_GLASS } from './company.ts';
import { findUser, resetPassword } from './directory.ts';

export class PamError extends Error {}

export const CPM = 'CPM (Central Policy Manager)';

function lead(w: World, title: string): string {
  return w.ad.users.find((u) => u.title === title && u.kind === 'user')?.sam ?? 'ghopper';
}

export function ensurePam(w: World): Pam {
  if (w.pam) return w.pam;
  const itMgr = lead(w, 'IT Manager');
  const secMgr = lead(w, 'Security Manager');
  const safes: PamSafe[] = [
    { name: 'T0-DomainAdmins', description: 'Tier 0: domain administration. Dual control, approved change required, password changes after every use.', dualControl: true, requireTicket: true, rotateOnCheckin: true,
      members: [{ member: 'grp-iam-admins', role: 'Use' }, { member: itMgr, role: 'Approve' }, { member: secMgr, role: 'Approve' }] },
    { name: 'T1-ServerAdmins', description: 'Tier 1: server administration.', dualControl: false, requireTicket: true, rotateOnCheckin: true,
      members: [{ member: 'grp-iam-admins', role: 'Use' }, { member: 'grp-server-admins', role: 'Use' }, { member: itMgr, role: 'Approve' }] },
    { name: 'SVC-Windows', description: 'Windows service accounts. Rotated by the CPM every 30 days; usages updated on every change.', dualControl: false, requireTicket: false, rotateOnCheckin: false,
      members: [{ member: 'grp-iam-admins', role: 'Manage' }, { member: 'grp-iam-admins', role: 'Retrieve' }, { member: itMgr, role: 'Retrieve' }] },
    { name: 'BreakGlass', description: 'Emergency access (Entra ID Global Administrator). Retrieval by the Security Manager only; every use is reviewed.', dualControl: true, requireTicket: true, rotateOnCheckin: true,
      members: [{ member: secMgr, role: 'Retrieve' }, { member: itMgr, role: 'Approve' }, { member: 'grp-iam-admins', role: 'Manage' }] },
  ];
  const acct = (id: string, safe: string, userName: string, platform: PamAccount['platform'], rotationDays: number, deps: PamDependency[] = []): PamAccount => ({
    id, safe, userName, platform, rotationDays, managed: true, passwordVersion: 4, lastRotated: daysAgo(Math.min(rotationDays, 3)),
    address: platform === 'Entra ID Cloud Account' ? 'meridianhealth.onmicrosoft.test' : w.ad.domain, dependencies: deps,
  });
  const usages: Pam['usages'] = {
    'svc-backup': [{ type: 'Windows Service', host: 'MHS-BKP01', name: 'Veeam Backup Service' }],
    'svc-monitor': [{ type: 'Scheduled Task', host: 'MHS-MON01', name: 'Collect-ServerHealth' }],
    'svc-idp-sync': [{ type: 'Windows Service', host: 'MHS-DC01', name: 'Okta AD Agent' }],
    'svc-sql01': [{ type: 'Windows Service', host: 'MHS-SQL01', name: 'MSSQLSERVER' }, { type: 'Windows Service', host: 'MHS-SQL01', name: 'SQLSERVERAGENT' }],
  };
  const reg = (sam: string): PamDependency[] => (usages[sam] ?? []).map((u) => ({ ...u, syncedVersion: 4 }));
  w.pam = {
    safes,
    accounts: [
      acct('t0-adm-ghopper', 'T0-DomainAdmins', 'adm-ghopper', 'Windows Domain Account', 1),
      acct('t1-adm-ofarouk', 'T1-ServerAdmins', 'adm-ofarouk', 'Windows Domain Account', 7),
      acct('svc-backup', 'SVC-Windows', 'svc-backup', 'Windows Service Account', 30, reg('svc-backup')),
      acct('svc-monitor', 'SVC-Windows', 'svc-monitor', 'Windows Service Account', 30, reg('svc-monitor')),
      acct('svc-idp-sync', 'SVC-Windows', 'svc-idp-sync', 'Windows Service Account', 30, reg('svc-idp-sync')),
      ...BREAK_GLASS.map((upn, i) => acct(`bg-0${i + 1}`, 'BreakGlass', upn, 'Entra ID Cloud Account', 90)),
    ],
    requests: [],
    sessions: [],
    events: [],
    discovered: [{ userName: 'svc-sql01', address: w.ad.domain, reason: 'Found by Accounts Discovery on MHS-SQL01: runs SQL Server services; not in any safe.' }],
    usages,
  };
  return w.pam;
}

export function getAccount(w: World, id: string): PamAccount {
  const a = ensurePam(w).accounts.find((x) => x.id === id || x.userName.toLowerCase() === id.toLowerCase());
  if (!a) throw new PamError(`Account ${id} is not in the vault.`);
  return a;
}

export function getSafe(w: World, name: string): PamSafe {
  const s = ensurePam(w).safes.find((x) => x.name === name);
  if (!s) throw new PamError(`Safe ${name} not found.`);
  return s;
}

/** Safe roles held by a vault user, directly or through an AD group. */
export function rolesIn(w: World, safe: PamSafe, actor: string): PamSafe['members'][number]['role'][] {
  const u = findUser(w, actor);
  const groups = new Set(u?.memberOf ?? []);
  return safe.members.filter((m) => m.member.toLowerCase() === actor.toLowerCase() || groups.has(m.member)).map((m) => m.role);
}

function log(w: World, user: string, action: string, a: PamAccount, detail = ''): void {
  const pam = ensurePam(w);
  pam.events.unshift({ id: pam.events.length + 1, time: nowIso(), user, action, accountId: a.id, detail });
  audit(w, { source: 'PAM', action: `Vault: ${action}`, target: `${a.safe}/${a.userName}`, actor: user, detail });
}

function need(w: World, a: PamAccount, actor: string, role: 'Use' | 'Retrieve' | 'Manage'): void {
  const roles = rolesIn(w, getSafe(w, a.safe), actor);
  const ok = roles.includes(role) || (role === 'Use' && roles.includes('Retrieve'));
  if (!ok) {
    const has = roles.length ? `You hold ${roles.join(', ')} on ${a.safe}` : `You are not a member of ${a.safe}`;
    throw new PamError(`${has}; this needs ${role}.${role === 'Retrieve' && roles.includes('Use') ? ' Connect through a session instead: you can use the account without ever seeing its password.' : ''}`);
  }
}

/** A change ticket that justifies privileged access: a Change, fully approved, still open. */
export function validChange(w: World, ticket: string): { ok: boolean; why: string } {
  const t = w.tickets.find((x) => x.id.toLowerCase() === ticket.trim().toLowerCase());
  if (!t) return { ok: false, why: `Ticket ${ticket || '(none)'} was not found in ServiceDesk.` };
  if (t.type !== 'Change' && !(t.type === 'Incident' && t.priority === 1)) return { ok: false, why: `${t.id} is a ${t.type}. Privileged access needs an approved Change (or a P1 incident for emergencies).` };
  if (t.state === 'Resolved' || t.state === 'Cancelled') return { ok: false, why: `${t.id} is ${t.state}.` };
  if (t.type === 'Change' && (!t.approvals.length || t.approvals.some((a) => a.state !== 'Approved'))) return { ok: false, why: `${t.id} is not fully approved by the CAB.` };
  return { ok: true, why: `${t.id}: ${t.short}` };
}

/** Ask for access. Dual control is answered by an approver; without a valid change it is rejected. */
export function requestAccess(w: World, accountId: string, reason: string, ticket: string, actor = w.player.adminSam): PamRequest {
  const pam = ensurePam(w);
  const a = getAccount(w, accountId);
  const safe = getSafe(w, a.safe);
  need(w, a, actor, 'Use');
  if (!reason.trim()) throw new PamError('A reason is required.');
  const change = safe.requireTicket ? validChange(w, ticket) : { ok: true, why: 'No ticket required for this safe.' };
  const approver = safe.members.find((m) => m.role === 'Approve' && m.member !== actor)?.member ?? null;
  const r: PamRequest = {
    id: `REQ-${String(pam.requests.length + 1).padStart(4, '0')}`, accountId: a.id, requester: actor, reason: reason.trim(), ticket: ticket.trim(),
    state: change.ok ? 'Approved' : 'Rejected', approver, time: nowIso(),
    decision: change.ok ? `${approver ?? 'Approver'} approved: ${change.why}` : `${approver ?? 'Approver'} rejected: ${change.why}`,
  };
  pam.requests.unshift(r);
  log(w, actor, `Access request ${r.state.toLowerCase()}`, a, `${r.ticket || 'no ticket'}: ${r.reason}`);
  return r;
}

function approvedRequest(w: World, a: PamAccount, actor: string): PamRequest | undefined {
  const cutoff = Date.parse(nowIso()) - 8 * 3_600_000;
  return ensurePam(w).requests.find((r) => r.accountId === a.id && r.requester === actor && r.state === 'Approved' && Date.parse(r.time) >= cutoff);
}

/** Connect through the session manager: recorded, isolated, and the password is never shown. */
export function connect(w: World, accountId: string, target: string, actor = w.player.adminSam): PamSession {
  const pam = ensurePam(w);
  const a = getAccount(w, accountId);
  const safe = getSafe(w, a.safe);
  need(w, a, actor, 'Use');
  const req = approvedRequest(w, a, actor);
  if ((safe.dualControl || safe.requireTicket) && !req) throw new PamError(`${a.safe} requires an approved access request${safe.requireTicket ? ' that references an approved change' : ''}. Request access first.`);
  if (pam.sessions.some((s) => s.accountId === a.id && !s.end && s.user !== actor)) throw new PamError('The account is in use by someone else (exclusive access).');
  const s: PamSession = { id: `PSM-${String(pam.sessions.length + 1).padStart(4, '0')}`, accountId: a.id, user: actor, target: target.trim() || 'MHS-DC01', start: nowIso(), end: null, ticket: req?.ticket ?? '' };
  pam.sessions.unshift(s);
  log(w, actor, 'Connect (PSM session, recorded)', a, `to ${s.target}${s.ticket ? ` for ${s.ticket}` : ''}`);
  return s;
}

/** End a session. Safes that rotate on check-in change the password straight away. */
export function endSession(w: World, sessionId: string, actor = w.player.adminSam): PamSession {
  const s = ensurePam(w).sessions.find((x) => x.id === sessionId);
  if (!s) throw new PamError('Session not found.');
  if (s.end) return s;
  s.end = nowIso();
  const a = getAccount(w, s.accountId);
  log(w, actor, 'Session ended; recording saved', a, s.id);
  if (getSafe(w, a.safe).rotateOnCheckin) rotate(w, a.id, CPM);
  return s;
}

/** Show the password. Allowed only with Retrieve, and always recorded. */
export function showPassword(w: World, accountId: string, reason: string, actor = w.player.adminSam): string {
  const a = getAccount(w, accountId);
  need(w, a, actor, 'Retrieve');
  if (getSafe(w, a.safe).dualControl && !approvedRequest(w, a, actor)) throw new PamError(`${a.safe} requires an approved request before the password can be shown.`);
  log(w, actor, 'Show password', a, reason || 'no reason given');
  return `Mh!${a.passwordVersion}${a.userName.length * 7}-${a.id.slice(0, 3).toUpperCase()}#vault`;
}

/** Change the password now (CPM). Registered usages are updated with it; unregistered ones are not. */
export function rotate(w: World, accountId: string, actor = w.player.adminSam): PamAccount {
  const a = getAccount(w, accountId);
  if (actor !== CPM) need(w, a, actor, 'Manage');
  if (!a.managed) throw new PamError('Automatic management is off for this account. Turn it on before the CPM can change the password.');
  a.passwordVersion++;
  a.lastRotated = nowIso();
  for (const d of a.dependencies) d.syncedVersion = a.passwordVersion;
  if (a.platform !== 'Entra ID Cloud Account' && findUser(w, a.userName)) resetPassword(w, a.userName, { mustChange: false, password: null }, 'CyberArk CPM');
  log(w, actor, 'Change password', a, `version ${a.passwordVersion}; ${a.dependencies.length} usage(s) updated`);
  return a;
}

/** Bring a discovered account into a safe under automatic management. */
export function onboard(w: World, userName: string, safe: string, rotationDays: number, actor = w.player.adminSam): PamAccount {
  const pam = ensurePam(w);
  const d = pam.discovered.find((x) => x.userName.toLowerCase() === userName.toLowerCase());
  if (!d) throw new PamError(`${userName} is not in the pending (discovered) accounts list.`);
  const s = getSafe(w, safe);
  if (!rolesIn(w, s, actor).includes('Manage')) throw new PamError(`You need Manage on ${safe} to add accounts to it.`);
  const u = findUser(w, userName);
  const a: PamAccount = {
    id: userName.toLowerCase(), safe, userName: u?.sam ?? userName, address: d.address,
    platform: u?.kind === 'service' ? 'Windows Service Account' : 'Windows Domain Account',
    managed: true, rotationDays: Math.max(1, Math.round(rotationDays)), lastRotated: u?.pwdLastSet ?? nowIso(), passwordVersion: 1, dependencies: [],
  };
  pam.accounts.push(a);
  pam.discovered = pam.discovered.filter((x) => x !== d);
  log(w, actor, 'Account onboarded', a, `safe ${safe}, change every ${a.rotationDays} days`);
  return a;
}

export function setManaged(w: World, accountId: string, managed: boolean, actor = w.player.adminSam): PamAccount {
  const a = getAccount(w, accountId);
  need(w, a, actor, 'Manage');
  a.managed = managed;
  log(w, actor, managed ? 'Automatic management enabled' : 'Automatic management disabled', a);
  return a;
}

/** Register a place the password is stored, so the CPM updates it on every change. */
export function addUsage(w: World, accountId: string, dep: { type: PamDependency['type']; host: string; name: string }, actor = w.player.adminSam): PamAccount {
  const a = getAccount(w, accountId);
  need(w, a, actor, 'Manage');
  if (!dep.host.trim() || !dep.name.trim()) throw new PamError('Enter the server and the service or task name.');
  if (a.dependencies.some((d) => d.host.toLowerCase() === dep.host.trim().toLowerCase() && d.name.toLowerCase() === dep.name.trim().toLowerCase())) throw new PamError('That usage is already registered.');
  // A usage added after a change still holds the old password until the next change or a usage sync.
  a.dependencies.push({ type: dep.type, host: dep.host.trim().toUpperCase(), name: dep.name.trim(), syncedVersion: a.passwordVersion === 1 ? 1 : 0 });
  log(w, actor, 'Usage registered', a, `${dep.type} ${dep.name} on ${dep.host}`);
  return a;
}

/** Push the current password to every registered usage. */
export function syncUsages(w: World, accountId: string, actor = w.player.adminSam): PamAccount {
  const a = getAccount(w, accountId);
  need(w, a, actor, 'Manage');
  for (const d of a.dependencies) d.syncedVersion = a.passwordVersion;
  log(w, actor, 'Usages synchronized', a, `${a.dependencies.length} usage(s)`);
  return a;
}

/** Every place the account really runs, and whether it still has the right password. */
export function usageHealth(w: World, accountId: string): { type: string; host: string; name: string; registered: boolean; ok: boolean }[] {
  const pam = ensurePam(w);
  const a = getAccount(w, accountId);
  return (pam.usages[a.userName] ?? []).map((u) => {
    const reg = a.dependencies.find((d) => d.host.toLowerCase() === u.host.toLowerCase() && d.name.toLowerCase() === u.name.toLowerCase());
    // Unregistered usages keep working only until the vault first changes the password.
    const ok = reg ? reg.syncedVersion === a.passwordVersion : a.passwordVersion <= 1;
    return { ...u, registered: !!reg, ok };
  });
}
