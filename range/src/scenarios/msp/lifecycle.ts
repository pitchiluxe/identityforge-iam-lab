/**
 * scenarios/msp/lifecycle.ts — joiner, mover, leaver and greenfield build-out
 * for any MSP customer, driven by its profile (OUs, naming standard, birthright).
 */
import { fmtDate, minutesAgo, nowIso } from '../../core/time.ts';
import { addMember, createOu, createUser, findUser, moveUser, removeMember, setEnabled, setUser } from '../../world/directory.ts';
import { runEntraSync } from '../../world/cloud.ts';
import { revokeSessionsAs } from '../../world/entraAdmin.ts';
import { openTicket } from '../../world/itsm.ts';
import { check, close, type Built, type Template } from '../template.ts';
import { birthrightOf, hasStaff, hrContact, leadOf, mspUpn, newHire, pickStaff, profileOf, roleOfTitle } from './common.ts';

export interface MspTemplate extends Template {
  /** Whether this ticket makes sense for the company as it is now. */
  fits(w: import('../../core/types.ts').World): boolean;
  /** Suspicious requests (escalate or decline). */
  suspicious?: boolean;
}

const TEMP_PASSWORD = 'Welcome-2026-Temp!';

export const mspJoiner: MspTemplate = {
  id: 'msp-joiner', title: 'New hire account', category: 'Joiner', difficulty: 1,
  skills: ['Joiner provisioning', 'Naming standards', 'Birthright access', 'Hybrid sync'],
  summary: 'Create the AD account for a new hire in the right OU with exactly their birthright groups, then sync to Entra.',
  twists: [{ id: 'standard', label: 'Standard new hire' }],
  fits: hasStaff,
  build(ctx): Built {
    const { w, rng } = ctx;
    const p = profileOf(w);
    const roles = p.roles.filter((r) => !r.lead && leadOf(w, r.department));
    const role = rng.pick(roles);
    const mgr = leadOf(w, role.department)!;
    const who = newHire(ctx);
    let n = 400000 + w.hr.workers.length;
    while (w.hr.workers.some((x) => x.employeeId === `${p.prefix}${n}`)) n++;
    const employeeId = `${p.prefix}${n}`;
    w.hr.workers.push({ employeeId, first: who.first, last: who.last, department: role.department, title: role.title, managerId: mgr.employeeId, location: p.locations[0]!, status: 'Pending Hire', hireDate: nowIso(), termDate: null, termType: null, phoneLast4: String(rng.int(1000, 9999)), workerType: 'Employee' });
    const hr = hrContact(w);
    const t = openTicket(w, {
      type: 'Request', category: 'Onboarding', priority: 3, caller: hr.displayName, requestedFor: `${who.first} ${who.last}`, scenarioId: ctx.id, openedMinutesAgo: 90,
      short: `New hire: ${who.first} ${who.last} (${role.title}) starts today`,
      description: `${who.first} ${who.last} joins ${p.name} today.\n\nEmployee ID: ${employeeId}\nTitle: ${role.title}\nDepartment: ${role.department}\nManager: ${mgr.displayName}\nLogon name (naming standard): ${who.sam}\n\nPlease create their account with standard access for the role so they can sign in at 9.`,
      variables: { 'Employee ID': employeeId, 'Logon name': who.sam, 'Department': role.department, 'Title': role.title, 'Manager': mgr.displayName, 'Start date': fmtDate(nowIso()) },
      approvals: [{ approver: hr.displayName, role: 'HR', state: 'Approved', time: minutesAgo(100) }],
    });
    const groups = birthrightOf(p, role);
    return {
      title: `Onboard ${who.first} ${who.last}`, ticketIds: [t.id], mailIds: [],
      params: { sam: who.sam, first: who.first, last: who.last, employeeId, dept: role.department, title: role.title, manager: mgr.sam, groups: groups.join('|') },
      checks: [
        check(`Account ${who.sam} exists`, { k: 'adExists', sam: who.sam, value: true }, true),
        check(`In ${p.usersOu}/${role.department}`, { k: 'adOu', sam: who.sam, ou: `${p.usersOu}/${role.department}` }, true),
        check('Employee ID recorded', { k: 'adAttr', sam: who.sam, attr: 'employeeId', equals: employeeId }, true),
        check('Exactly the birthright groups for the role', { k: 'adOnlyGroups', sam: who.sam, groups }, true),
        check('Account enabled', { k: 'adEnabled', sam: who.sam, value: true }),
        check('Must change password at first sign-in', { k: 'adMustChange', sam: who.sam, value: true }),
        check('Synced to Entra ID', { k: 'entraMatchesAd', sam: who.sam }),
        check('Ticket resolved as fulfilled', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }, true),
      ],
      hints: [`Use the logon name from the ticket and the department OU under ${p.usersOu}.`, `Birthright for ${role.title}: ${groups.join(', ')}.`, 'Run a sync (or wait for the scheduler) so Entra ID gets the account.'],
      debrief: `A joiner is right when the account is where policy puts it (${p.usersOu}/${role.department}), carries exactly the role's birthright and nothing more, and reaches the cloud through sync. Copying another user's groups is how access creep starts.`,
      interview: { question: 'Why provision from a role definition instead of copying a colleague?', modelAnswer: 'A colleague has years of extra access; copying them grants it again. A role-based birthright gives exactly what the job needs, is auditable, and changes in one place.' },
    };
  },
  solve(w, s) {
    const p = profileOf(w);
    const q = s.params;
    createUser(w, { sam: q.sam!, givenName: q.first!, surname: q.last!, ou: `${p.usersOu}/${q.dept}`, department: q.dept, title: q.title, employeeId: q.employeeId, manager: q.manager, enabled: true, passwordSet: true, password: TEMP_PASSWORD, mustChangePassword: true });
    for (const g of q.groups!.split('|')) addMember(w, g, q.sam!);
    runEntraSync(w);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `Created ${q.sam} with role birthright, enabled with a temporary password (must change), synced to Entra.`);
  },
};

export const mspLeaver: MspTemplate = {
  id: 'msp-leaver', title: 'Leaver offboarding', category: 'Leaver', difficulty: 2,
  skills: ['Leaver deprovisioning', 'Session revocation', 'Hybrid sync'],
  summary: 'Disable, strip access and end cloud sessions for a leaver.',
  twists: [{ id: 'standard', label: 'Resignation, last day today' }, { id: 'urgent', label: 'Involuntary termination, effective now' }],
  fits: hasStaff,
  build(ctx): Built {
    const { w, twist } = ctx;
    const u = pickStaff(ctx, (_x, r) => !r.lead);
    const hrw = w.hr.workers.find((x) => x.employeeId === u.employeeId)!;
    hrw.status = 'Terminated';
    hrw.termDate = nowIso();
    hrw.termType = twist === 'urgent' ? 'Involuntary' : 'Voluntary';
    const hr = hrContact(w);
    const t = openTicket(w, {
      type: 'Request', category: 'Offboarding', priority: twist === 'urgent' ? 1 : 3, caller: hr.displayName, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: twist === 'urgent' ? 5 : 120,
      short: twist === 'urgent' ? `URGENT termination: ${u.displayName} — remove access now` : `Leaver: ${u.displayName}, last day today`,
      description: twist === 'urgent'
        ? `${u.displayName} (${u.employeeId}, ${u.title}) is being terminated right now. Remove all access immediately, including anything they are signed in to on their phone. Do not contact them.`
        : `${u.displayName} (${u.employeeId}, ${u.title}, ${u.department}) has resigned. Today is their last day. Please offboard them per the leaver process.`,
      variables: { 'Employee ID': u.employeeId, 'Termination type': hrw.termType!, 'Effective': fmtDate(nowIso()) },
      approvals: [{ approver: hr.displayName, role: 'HR', state: 'Approved', time: minutesAgo(10) }],
    });
    return {
      title: `Offboard ${u.displayName}`, ticketIds: [t.id], mailIds: [],
      params: { sam: u.sam, upn: u.upn },
      checks: [
        check('AD account disabled', { k: 'adEnabled', sam: u.sam, value: false }, true),
        check('Account kept, not deleted', { k: 'adExists', sam: u.sam, value: true }, true),
        check('Group memberships removed', { k: 'adOnlyGroups', sam: u.sam, groups: [] }),
        check('Entra ID account disabled (synced)', { k: 'entraEnabled', upn: u.upn, value: false }, true),
        check('Entra ID sessions revoked', { k: 'entraSessionsRevokedSince', upn: u.upn, since: ctx.started }, twist === 'urgent'),
        check('Ticket resolved as fulfilled', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }, true),
      ],
      hints: ['Disabling AD does not end sessions that are already open in the cloud.', 'Revoke the Entra sessions in the Azure portal and run a sync so the disable reaches Entra.'],
      debrief: 'A leaver is done when every route in is closed: AD disabled (kept for the retention period), groups removed, the change synced, and live cloud sessions revoked. For an involuntary leaver, revoking sessions is part of the first minutes.',
      interview: { question: 'The account is disabled in AD but the leaver still reads email on their phone. Why?', modelAnswer: 'The cloud learns about the disable only after sync, and existing refresh tokens stay valid until revoked. Sync, revoke sessions, then confirm in the sign-in logs.' },
    };
  },
  solve(w, s) {
    const { sam, upn } = s.params as { sam: string; upn: string };
    setEnabled(w, sam, false);
    for (const g of [...findUser(w, sam)!.memberOf]) removeMember(w, g, sam);
    runEntraSync(w);
    revokeSessionsAs(w, mspUpn(w), upn);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `Disabled ${sam}, removed groups, synced and revoked Entra sessions.`);
  },
};

export const mspMover: MspTemplate = {
  id: 'msp-mover', title: 'Internal transfer', category: 'Mover', difficulty: 2,
  skills: ['Mover access changes', 'Least privilege', 'Birthright'],
  summary: 'Move someone to a new role: new title, department, OU and birthright, and remove the old access.',
  twists: [{ id: 'standard', label: 'Standard transfer' }, { id: 'keep-old', label: 'Manager asks to keep the old access "for a while"', trap: true }],
  fits: (w) => hasStaff(w) && profileOf(w).departments.length > 1,
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    const p = profileOf(w);
    const u = pickStaff(ctx, (_x, r) => !r.lead);
    const from = roleOfTitle(p, u.title)!;
    const target = rng.pick(p.roles.filter((r) => !r.lead && r.department !== from.department && leadOf(w, r.department)));
    const mgr = leadOf(w, target.department)!;
    const hrw = w.hr.workers.find((x) => x.employeeId === u.employeeId)!;
    hrw.department = target.department;
    hrw.title = target.title;
    hrw.managerId = mgr.employeeId;
    const t = openTicket(w, {
      type: 'Request', category: 'Access', priority: 3, caller: mgr.displayName, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 60,
      short: `Transfer: ${u.displayName} to ${target.department} as ${target.title}`,
      description: `${u.displayName} (${u.employeeId}) moves from ${from.department} to my team in ${target.department} as ${target.title}, effective today. Please update their account and access.${twist === 'keep-old' ? `\n\nCould you keep their old ${from.department} access for a few weeks too? They'll still help their old team out now and then.` : ''}`,
      variables: { 'Employee ID': u.employeeId, 'New department': target.department, 'New title': target.title },
    });
    const groups = birthrightOf(p, target);
    return {
      title: `Transfer ${u.displayName}`, ticketIds: [t.id], mailIds: [],
      params: { sam: u.sam, dept: target.department, title: target.title, groups: groups.join('|') },
      checks: [
        check(`Title is ${target.title}`, { k: 'adAttr', sam: u.sam, attr: 'title', equals: target.title }),
        check(`Department is ${target.department}`, { k: 'adAttr', sam: u.sam, attr: 'department', equals: target.department }, true),
        check(`Moved to ${p.usersOu}/${target.department}`, { k: 'adOu', sam: u.sam, ou: `${p.usersOu}/${target.department}` }, true),
        check('Only the new role\'s birthright (old access removed)', { k: 'adOnlyGroups', sam: u.sam, groups }, true),
        check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }, true),
      ],
      hints: ['A mover gets the new role\'s birthright and loses the old one.', twist === 'keep-old' ? 'Keeping old access "for a while" is how access creep starts: extra access needs its own approved, time-bound request.' : 'Change title, department and OU, then swap the role groups.'],
      debrief: `Movers are where access creep happens. The new role gets its birthright; the old role's access goes the same day.${twist === 'keep-old' ? ' A manager asking to keep old access is not an approval: it needs a separate, time-bound request approved by the old access owner.' : ''}`,
      interview: { question: 'A manager asks you to leave a mover\'s old access in place "for a few weeks". What do you do?', modelAnswer: 'Remove it with the move and offer a separate time-bound request approved by the owner of that access, so the exception is visible and expires.' },
    };
  },
  solve(w, s) {
    const p = profileOf(w);
    const q = s.params;
    setUser(w, q.sam!, { title: q.title!, department: q.dept! });
    moveUser(w, q.sam!, `${p.usersOu}/${q.dept}`);
    for (const g of [...findUser(w, q.sam!)!.memberOf]) removeMember(w, g, q.sam!);
    for (const g of q.groups!.split('|')) addMember(w, g, q.sam!);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Updated title and department, moved OU, swapped to the new role birthright.');
  },
  naive(w, s) {
    const p = profileOf(w);
    const q = s.params;
    setUser(w, q.sam!, { title: q.title!, department: q.dept! });
    moveUser(w, q.sam!, `${p.usersOu}/${q.dept}`);
    for (const g of q.groups!.split('|')) if (!findUser(w, q.sam!)!.memberOf.includes(g)) addMember(w, g, q.sam!);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Moved and added new access; kept old access as the manager asked.');
  },
};

export const mspGreenfield: MspTemplate = {
  id: 'msp-greenfield-ou', title: 'Build the OU structure', category: 'Joiner', difficulty: 1,
  skills: ['AD design', 'OU structure'],
  summary: 'A new customer domain: build the OU tree the MSP standard uses before anyone is onboarded.',
  twists: [{ id: 'standard', label: 'New domain' }],
  fits: (w) => !!w.profileId && profileOf(w).reality === 'greenfield' && !w.ad.ous.includes(profileOf(w).usersOu.split('/')[0]!),
  build(ctx): Built {
    const p = profileOf(ctx.w);
    const root = p.usersOu.split('/')[0]!;
    const depts = p.departments.slice(0, 2);
    const ous = [root, p.usersOu, p.groupsOu, p.computersOu, p.disabledOu, ...depts.map((d) => `${p.usersOu}/${d}`)];
    const t = openTicket(ctx.w, {
      type: 'Change', category: 'Infrastructure', priority: 3, caller: 'MSP Service Delivery', scenarioId: ctx.id, openedMinutesAgo: 30,
      short: `${p.name}: build the OU structure`,
      description: `${p.name} (${p.domain}) has signed with us. Before the first hires, create the OU structure from our standard:\n\n${ous.map((o) => `- ${o}`).join('\n')}\n\nFirst hires will be in ${depts.join(' and ')}.`,
    });
    return {
      title: `Build OUs for ${p.name}`, ticketIds: [t.id], mailIds: [], params: { ous: ous.join('|') },
      checks: [...ous.map((o) => check(`OU ${o} exists`, { k: 'adOuExists', ou: o, value: true }, true)), check('Change resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }, true)],
      hints: ['Create parents before children: the root OU first.', `In PowerShell: New-ADOrganizationalUnit -Name ${root} -Server ${p.domain}`],
      debrief: 'An OU tree is the foundation for delegation, Group Policy and sync scope. Building it from a standard on day one is far cheaper than reorganising a populated domain later.',
      interview: { question: 'Why do OUs matter for Entra Connect?', modelAnswer: 'Sync scope is chosen by OU: a clear tree lets you sync people and groups and keep service accounts and staging out of the cloud.' },
    };
  },
  solve(w, s) {
    for (const ou of s.params.ous!.split('|')) {
      const i = ou.lastIndexOf('/');
      createOu(w, i < 0 ? ou : ou.slice(i + 1), i < 0 ? null : ou.slice(0, i));
    }
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Created the standard OU structure for the new domain.');
  },
};
