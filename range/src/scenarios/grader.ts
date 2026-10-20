/**
 * scenarios/grader.ts — the examiner.
 *
 * Reads the world and nothing else. It cannot change state, and it is the
 * only thing that decides whether a scenario passed. The AI coach is handed a
 * copy of these results; it never grades.
 */
import type { CheckResult, CheckSpec, GradeResult, ScenarioInstance, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { findUser } from '../world/directory.ts';
import { activeRole, findOktaUser, inSyncScope, oktaHasApp } from '../world/cloud.ts';
import { GROUPS_OU } from '../world/company.ts';
import { hasAssignment, simulateSso } from '../world/federation.ts';
import { ensureIga, identityOf } from '../world/iga.ts';
import { ensurePam, usageHealth } from '../world/pam.ts';

const since = (t: string | null | undefined, s: string): boolean => !!t && Date.parse(t) >= Date.parse(s);
const sameSet = (a: string[], b: string[]): boolean => {
  const x = [...a].map((v) => v.toLowerCase()).sort();
  const y = [...b].map((v) => v.toLowerCase()).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

function noteText(w: World, ticket: string): string {
  const t = w.tickets.find((x) => x.id === ticket);
  if (!t) return '';
  return [...t.workNotes.map((n) => n.text), t.resolution?.notes ?? ''].join('\n').toLowerCase();
}

export function evaluate(w: World, spec: CheckSpec): { pass: boolean; detail: string } {
  const ok = (pass: boolean, detail: string): { pass: boolean; detail: string } => ({ pass, detail });
  switch (spec.k) {
    case 'adExists': {
      const u = findUser(w, spec.sam);
      return ok(!!u === spec.value, u ? `${spec.sam} exists in ${u.ou}.` : `${spec.sam} does not exist.`);
    }
    case 'adEnabled': {
      const u = findUser(w, spec.sam);
      if (!u) return ok(false, `${spec.sam} not found.`);
      return ok(u.enabled === spec.value, `${spec.sam} is ${u.enabled ? 'enabled' : 'disabled'}.`);
    }
    case 'adLocked': {
      const u = findUser(w, spec.sam);
      if (!u) return ok(false, `${spec.sam} not found.`);
      return ok(u.lockedOut === spec.value, `${spec.sam} is ${u.lockedOut ? 'locked out' : 'not locked out'}.`);
    }
    case 'adOu': {
      const u = findUser(w, spec.sam);
      if (!u) return ok(false, `${spec.sam} not found.`);
      return ok(u.ou === spec.ou, `${spec.sam} is in ${u.ou}.`);
    }
    case 'adAttr': {
      const u = findUser(w, spec.sam);
      if (!u) return ok(false, `${spec.sam} not found.`);
      const v = String(u[spec.attr] ?? '');
      const pass = spec.equals !== undefined ? v.toLowerCase() === spec.equals.toLowerCase() : spec.contains !== undefined ? v.toLowerCase().includes(spec.contains.toLowerCase()) : true;
      return ok(pass, `${spec.attr} = "${v || '<empty>'}"`);
    }
    case 'adMember': {
      const u = findUser(w, spec.sam);
      if (!u) return ok(!spec.value, `${spec.sam} not found.`);
      const m = u.memberOf.some((g) => g.toLowerCase() === spec.group.toLowerCase());
      return ok(m === spec.value, `${spec.sam} is ${m ? '' : 'not '}a member of ${spec.group}.`);
    }
    case 'adOnlyGroups': {
      const u = findUser(w, spec.sam);
      if (!u) return ok(false, `${spec.sam} not found.`);
      const extra = u.memberOf.filter((g) => !spec.groups.some((x) => x.toLowerCase() === g.toLowerCase()));
      const missing = spec.groups.filter((g) => !u.memberOf.some((x) => x.toLowerCase() === g.toLowerCase()));
      const parts = [extra.length ? `extra: ${extra.join(', ')}` : '', missing.length ? `missing: ${missing.join(', ')}` : ''].filter(Boolean);
      return ok(sameSet(u.memberOf, spec.groups), parts.length ? parts.join('; ') : 'Group memberships match exactly.');
    }
    case 'adPwdResetSince': {
      const u = findUser(w, spec.sam);
      if (!u) return ok(false, `${spec.sam} not found.`);
      const reset = since(u.pwdLastSet, spec.since);
      return ok(reset === spec.value, reset ? `Password was reset during this scenario.` : `Password was not reset during this scenario.`);
    }
    case 'adMustChange': {
      const u = findUser(w, spec.sam);
      if (!u) return ok(false, `${spec.sam} not found.`);
      return ok(u.mustChangePassword === spec.value, `User must change password at next logon: ${u.mustChangePassword ? 'yes' : 'no'}.`);
    }
    case 'adPwdNeverExpires': {
      const u = findUser(w, spec.sam);
      if (!u) return ok(false, `${spec.sam} not found.`);
      return ok(u.passwordNeverExpires === spec.value, `Password never expires: ${u.passwordNeverExpires ? 'yes' : 'no'}.`);
    }
    case 'adGroupOwner': {
      const g = w.ad.groups.find((x) => x.name === spec.group);
      return ok(!!g && g.managedBy === spec.owner, `managedBy = ${g?.managedBy ?? '<empty>'}`);
    }
    case 'entraMatchesAd': {
      const u = findUser(w, spec.sam);
      if (!u) return ok(false, `${spec.sam} not found in AD.`);
      if (!inSyncScope(u)) return ok(false, `${spec.sam} is in ${u.ou}, which is outside the Entra Connect sync scope.`);
      const e = w.entra.users.find((x) => !x.deleted && x.onPremSam === u.sam);
      if (!e) return ok(false, `No Entra ID object is linked to ${spec.sam}. Has a sync run since the change?`);
      const adGroups = u.memberOf.filter((g) => w.ad.groups.some((ag) => ag.name === g && ag.ou === GROUPS_OU));
      const enabled = u.enabled && !(u.accountExpires && Date.parse(u.accountExpires) <= Date.parse(nowIso()));
      const diffs: string[] = [];
      if (e.accountEnabled !== enabled) diffs.push(`accountEnabled ${e.accountEnabled} vs AD ${enabled}`);
      if (e.displayName !== u.displayName) diffs.push(`displayName "${e.displayName}" vs AD "${u.displayName}"`);
      if (e.department !== u.department) diffs.push(`department "${e.department}" vs AD "${u.department}"`);
      if (e.jobTitle !== u.title) diffs.push(`jobTitle "${e.jobTitle}" vs AD "${u.title}"`);
      if (e.upn.toLowerCase() !== u.upn.toLowerCase()) diffs.push(`UPN ${e.upn} vs AD ${u.upn}`);
      const cloudSynced = e.groups.filter((g) => w.ad.groups.some((ag) => ag.name === g));
      if (!sameSet(cloudSynced, adGroups)) diffs.push('group memberships differ');
      return ok(!diffs.length, diffs.length ? `Entra ID is stale: ${diffs.join('; ')}. Run a delta sync.` : 'Entra ID matches AD.');
    }
    case 'noSyncError': {
      const err = w.entra.syncErrors.find((e) => e.sam === spec.sam);
      return ok(!err, err ? `${err.error}: ${err.detail}` : 'No sync errors for this object.');
    }
    case 'entraEnabled': {
      const e = w.entra.users.find((x) => x.upn.toLowerCase() === spec.upn.toLowerCase());
      const enabled = !!e && !e.deleted && e.accountEnabled;
      return ok(enabled === spec.value, e ? `accountEnabled = ${enabled}` : 'No Entra ID user.');
    }
    case 'entraSessionsRevokedSince': {
      const e = w.entra.users.find((x) => x.upn.toLowerCase() === spec.upn.toLowerCase());
      const revoked = !!e && since(e.sessionsValidFrom, spec.since);
      return ok(revoked, revoked ? 'Sign-in sessions were revoked.' : 'Existing sign-in sessions are still valid.');
    }
    case 'entraMfaClearedSince': {
      const e = w.entra.users.find((x) => x.upn.toLowerCase() === spec.upn.toLowerCase());
      const cleared = !!e && since(e.mfaResetAt, spec.since);
      return ok(cleared === spec.value, cleared ? 'MFA methods were removed during this scenario.' : 'MFA methods were not changed.');
    }
    case 'entraRole': {
      const e = w.entra.users.find((x) => x.upn.toLowerCase() === spec.upn.toLowerCase());
      const a = e ? activeRole(e, spec.role) : 'none';
      const r = e?.roles.find((x) => x.role === spec.role);
      return ok(a === spec.assignment, `${spec.role}: ${a}${r ? (r.permanent ? ' (permanent)' : ` (until ${r.expires})`) : ''}`);
    }
    case 'caPolicy': {
      const candidates = w.entra.caPolicies.filter((p) => p.grant === spec.grant && p.includeUsers === 'All users' && p.apps === 'All cloud apps' && p.condition === 'none');
      if (!candidates.length) return ok(false, `No policy targets All users / All cloud apps with grant ${spec.grant}.`);
      const good = candidates.find((p) => spec.states.includes(p.state) && spec.mustExclude.every((x) => p.excludeUsers.includes(x)));
      if (good) return ok(true, `${good.name} (${good.state}) excludes ${spec.mustExclude.join(', ')}.`);
      const p = candidates[0]!;
      const missing = spec.mustExclude.filter((x) => !p.excludeUsers.includes(x));
      return ok(false, `${p.name}: state ${p.state}${missing.length ? `; not excluded: ${missing.join(', ')}` : ''}.`);
    }
    case 'oktaStatus': {
      const o = findOktaUser(w, spec.login);
      const status = o?.status ?? 'DEPROVISIONED';
      return ok(spec.statuses.includes(status), `Okta status: ${status}${o ? '' : ' (no Okta user)'}.`);
    }
    case 'oktaSessionsClearedSince': {
      const o = findOktaUser(w, spec.login);
      const cleared = !o || since(o.sessionsClearedAt, spec.since);
      return ok(cleared, cleared ? 'Okta sessions were cleared.' : 'Okta sessions are still live.');
    }
    case 'oktaAppAccess': {
      const o = findOktaUser(w, spec.login);
      const has = !!o && o.status === 'ACTIVE' && oktaHasApp(w, o, spec.app);
      return ok(has === spec.value, `${has ? 'Has' : 'No'} access to ${spec.app} in Okta${o ? '' : ' (no Okta user — run an import)'}.`);
    }
    case 'oktaDirectAssignment': {
      const o = findOktaUser(w, spec.login);
      const app = w.okta.apps.find((a) => a.id === spec.app);
      const direct = !!o && !!app && app.assignedUsers.includes(o.login);
      return ok(direct === spec.value, direct ? `Assigned directly to ${app?.name}.` : `No direct assignment to ${app?.name ?? spec.app}.`);
    }
    case 'saasActive': {
      const app = w.saas.find((a) => a.id === spec.app);
      const acct = app?.accounts.find((a) => a.login.toLowerCase() === spec.login.toLowerCase());
      const active = !!acct?.active;
      return ok(active === spec.value, `${app?.name ?? spec.app} account: ${acct ? (acct.active ? 'active' : 'deactivated') : 'none'}${acct ? ` (${acct.managedBy})` : ''}.`);
    }
    case 'ticketResolved': {
      const t = w.tickets.find((x) => x.id === spec.ticket);
      if (!t) return ok(false, `${spec.ticket} not found.`);
      if (spec.allowOnHold && t.state === 'On Hold') return ok(true, `${t.id} is On Hold.`);
      const pass = t.state === 'Resolved' && !!t.resolution && spec.codes.includes(t.resolution.code);
      return ok(pass, t.resolution ? `${t.id} resolved as "${t.resolution.code}".` : `${t.id} is ${t.state}.`);
    }
    case 'ticketNote': {
      const text = noteText(w, spec.ticket);
      const hit = spec.anyOf.find((k) => text.includes(k.toLowerCase()));
      return ok(!!hit, hit ? `Notes mention "${hit}".` : `Notes do not mention any of: ${spec.anyOf.join(', ')}.`);
    }
    case 'mailReported': {
      const m = w.mail.find((x) => x.id === spec.mail);
      const reported = m?.folder === 'Reported';
      return ok(reported === spec.value, reported ? 'Reported as phishing.' : 'Not reported.');
    }
    case 'securityTicketRaised': {
      const raised = w.tickets.find((t) => t.type === 'Security Incident' && t.scenarioId === null && since(t.opened, spec.since) &&
        spec.anyOf.some((k) => `${t.short}\n${t.description}\n${t.workNotes.map((n) => n.text).join('\n')}`.toLowerCase().includes(k.toLowerCase())));
      return ok(!!raised, raised ? `${raised.id} raised for Security Operations.` : `No Security Incident mentioning ${spec.anyOf.join(' / ')} was raised.`);
    }
    case 'ssoWorks': {
      const r = simulateSso(w, spec.app, spec.upn);
      return ok(r.ok, r.ok ? r.message : `${r.code}: ${r.message}`);
    }
    case 'entraDirectAssignment': {
      const app = w.entra.apps.find((a) => a.id === spec.app);
      const e = w.entra.users.find((x) => !x.deleted && x.upn.toLowerCase() === spec.upn.toLowerCase());
      const direct = !!app && !!e && hasAssignment(w, { ...app, assignedGroups: [] }, e) === 'direct';
      return ok(direct === spec.value, direct ? `Assigned directly to ${app?.name}.` : `No direct assignment to ${app?.name ?? spec.app}.`);
    }
    case 'igaAggregatedSince': {
      const src = ensureIga(w).sources.find((x) => x.id === spec.source);
      return ok(!!src && since(src.lastAggregation, spec.since), src ? `${src.name} last aggregated ${src.lastAggregation}.` : 'Unknown source.');
    }
    case 'igaCorrelation': {
      const a = ensureIga(w).accounts.find((x) => x.source === spec.source && x.nativeId.toLowerCase() === spec.account.toLowerCase());
      if (!a) return ok(false, `${spec.account} has not been aggregated from ${spec.source}.`);
      const id = identityOf(w, a);
      const who = id ? w.hr.workers.find((x) => x.employeeId === id) : null;
      const shown = id === null ? 'uncorrelated' : id === '' ? 'marked as belonging to no identity' : `correlated to ${who ? `${who.first} ${who.last} ` : ''}(${id})`;
      return ok((id ?? null) === spec.employeeId || (spec.employeeId === '' && id === ''), `${spec.account} is ${shown}.`);
    }
    case 'certSignedOff': {
      const c = ensureIga(w).campaigns.find((x) => x.id === spec.campaign);
      if (!c) return ok(false, `Campaign ${spec.campaign} not found.`);
      const pending = c.items.filter((i) => i.decision === 'pending').length;
      return ok(c.status === 'Signed off', c.status === 'Signed off' ? `Signed off by ${c.signedOffBy}.` : `${c.status}; ${pending} item(s) pending.`);
    }
    case 'pamSession': {
      const pam = ensurePam(w);
      const s2 = pam.sessions.find((x) => (x.accountId === spec.account) && since(x.start, spec.since));
      return ok(!!s2, s2 ? `${s2.id}: ${s2.user} connected to ${s2.target} through a recorded session.` : 'No privileged session through the vault for this account.');
    }
    case 'pamPasswordShown': {
      const shown = ensurePam(w).events.some((e) => e.accountId === spec.account && e.action === 'Show password' && since(e.time, spec.since));
      return ok(shown === spec.value, shown ? 'The password was shown (recorded in the vault audit).' : 'The password was never shown.');
    }
    case 'pamRotatedSince': {
      const a = ensurePam(w).accounts.find((x) => x.id === spec.account);
      return ok(!!a && since(a.lastRotated, spec.since), a ? `Last changed ${a.lastRotated} (version ${a.passwordVersion}).` : 'Account is not in the vault.');
    }
    case 'pamManaged': {
      const a = ensurePam(w).accounts.find((x) => x.id === spec.account);
      const managed = !!a && a.managed;
      return ok(managed === spec.value, a ? `In safe ${a.safe}; automatic management ${a.managed ? 'on' : 'off'}.` : 'Not in the vault.');
    }
    case 'pamDependenciesInSync': {
      const a = ensurePam(w).accounts.find((x) => x.id === spec.account);
      if (!a) return ok(false, 'Not in the vault.');
      const broken = usageHealth(w, a.id).filter((u) => !u.ok);
      return ok(!broken.length, broken.length ? `Out of sync, the service will fail to start: ${broken.map((u) => `${u.name} on ${u.host}${u.registered ? '' : ' (not registered as a usage)'}`).join(', ')}.` : 'Every usage has the current password.');
    }
    case 'pamRequestWithTicket': {
      const r = ensurePam(w).requests.find((x) => x.accountId === spec.account && x.state === 'Approved' && x.ticket.toLowerCase() === spec.ticket.toLowerCase() && since(x.time, spec.since));
      return ok(!!r, r ? `${r.id} approved by ${r.approver} for ${r.ticket}.` : `No approved access request referencing ${spec.ticket}.`);
    }
  }
}

export function grade(w: World, s: ScenarioInstance): GradeResult {
  const results: CheckResult[] = s.checks.map((c) => {
    const r = evaluate(w, c.spec);
    return { id: c.id, label: c.label, critical: c.critical, pass: r.pass, detail: r.detail };
  });
  const score = results.length ? Math.round((results.filter((r) => r.pass).length / results.length) * 100) : 0;
  const passed = results.every((r) => r.pass || !r.critical) && score >= 80;
  return { time: nowIso(), score, passed, results };
}
