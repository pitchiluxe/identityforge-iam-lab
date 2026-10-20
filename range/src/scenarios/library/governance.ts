/**
 * Governance: access requests, reviews, stale and orphaned accounts, SSO
 * assignment and the "just do it, I'm the boss" email.
 */
import { daysAgo, daysFromNow, fmtDate, minutesAgo, nowIso } from '../../core/time.ts';
import { DISABLED_OU, birthright, deptOu, roleByTitle, samFor } from '../../world/company.ts';
import { addMember, createUser, getUser, moveUser, removeMember, setEnabled, setUser } from '../../world/directory.ts';
import { addSignIn, oktaAssignApp, revokeSessions, runOktaImport } from '../../world/cloud.ts';
import { deliverMail, openTicket, reportPhishing } from '../../world/itsm.ts';
import { writeFile, homeDir } from '../../world/docs.ts';
import {
  type Built, type Template, check, close, employees, isLead, leadOf, pickDepartment, pickEmployee, raiseSir, securityUser, syncAll, workerOf,
} from '../template.ts';

const SVC = 'MERIDIAN\\svc-provisioning';

const CONTRACTORS: [string, string][] = [['Ryan', 'Doyle'], ['Petra', 'Novotna'], ['Marcus', 'Bell'], ['Keiko', 'Mori'], ['Sean', 'Walsh'], ['Dana', 'Ibarra']];

// ------------------------------------------------------------------- Access request

export const accessRequest: Template = {
  id: 'access-request',
  title: 'Access request with approvals',
  category: 'Access Request',
  difficulty: 2,
  skills: ['Access request fulfilment', 'Approval workflow', 'Segregation of duties', 'Okta SSO'],
  summary: 'Someone wants access outside their birthright. Check both approvals and the SoD matrix, then grant it the right way.',
  twists: [
    { id: 'approved', label: 'Fully approved, grant through the access group' },
    { id: 'missing-owner-approval', label: 'Manager approved, owner has not', trap: true },
    { id: 'sod-conflict', label: 'Approved, but creates a toxic combination', trap: true },
  ],
  build(ctx): Built {
    const { w, twist } = ctx;
    if (twist === 'sod-conflict') {
      const u = pickEmployee({ ...ctx, department: 'Finance' }, (x) => x.memberOf.includes('grp-payroll-submit') && !!x.manager);
      const manager = getUser(w, u.manager!);
      const t = openTicket(w, {
        type: 'Request', category: 'Access Request', priority: 3, caller: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 140,
        short: `Access request: grp-payroll-approve for ${u.displayName}`,
        description: `Requesting grp-payroll-approve so I can approve this month's pay run while ${manager.displayName} is on vacation next week. It's only temporary.\n\nBusiness justification: payroll must go out on the 28th.`,
        variables: { 'Requested access': 'grp-payroll-approve', 'Duration': '2 weeks' },
        approvals: [
          { approver: manager.displayName, role: 'Manager', state: 'Approved', time: minutesAgo(120) },
          { approver: manager.displayName, role: 'Owner of grp-payroll-approve', state: 'Approved', time: minutesAgo(118) },
        ],
      });
      return {
        title: `Payroll approval rights for ${u.displayName}`,
        ticketIds: [t.id], mailIds: [], params: { sam: u.sam, group: 'grp-payroll-approve' },
        checks: [
          check('grp-payroll-approve NOT granted (SoD conflict with grp-payroll-submit)', { k: 'adMember', sam: u.sam, group: 'grp-payroll-approve', value: false }, true),
          check('Rejected under policy', { k: 'ticketResolved', ticket: t.id, codes: ['Rejected - Policy'] }, true),
          check('Notes cite segregation of duties', { k: 'ticketNote', ticket: t.id, anyOf: ['sod', 'segregation', 'separation', 'toxic', 'conflict'] }),
        ],
        hints: [
          'The approvals are all green. Is approval the only control on this request?',
          `Open Documents\\Policies\\SoD-Matrix.csv and compare it with ${u.sam}'s current groups.`,
          `${u.sam} already has grp-payroll-submit. Submit + approve is a toxic pair, so reject under policy (Rejected - Policy) and suggest a different approver for the holiday.`,
        ],
        debrief: `${u.displayName} already holds grp-payroll-submit. Adding grp-payroll-approve lets one person create and approve the same pay run, which is the fraud scenario SoD exists to prevent. Approval does not override policy, and "temporary" is how most SoD findings start. The fix is a different approver (another controller or the CFO) for the vacation week.`,
        interview: { question: 'What is segregation of duties, and give an example of a toxic combination?', modelAnswer: 'SoD splits a sensitive process so no single person can complete it alone, for example creating a vendor and paying it, or submitting and approving payroll. In IAM it means checking requests against an SoD matrix before granting, rejecting conflicts even when they are approved, and detecting existing conflicts in access reviews.' },
      };
    }
    const u = pickEmployee(ctx, (x) => x.department !== 'Radiology' && !!x.manager && !x.memberOf.includes('app-imagevault'));
    const manager = getUser(w, u.manager!);
    const owner = getUser(w, w.ad.groups.find((g) => g.name === 'app-imagevault')!.managedBy!);
    const ownerApproved = twist === 'approved';
    const t = openTicket(w, {
      type: 'Request', category: 'Access Request', priority: 3, caller: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 300,
      short: `Access request: ImageVault PACS for ${u.displayName}`,
      description: `I need read access to ImageVault PACS to review prior imaging studies for a ${u.department} case review (patient safety committee).\n\nCatalog item: Application access\nApplication: ImageVault PACS (access group app-imagevault)\nRole needed: Sales User (read)`,
      variables: { 'Application': 'ImageVault PACS', 'Access group': 'app-imagevault', 'Role': 'Imaging User' },
      approvals: [
        { approver: manager.displayName, role: 'Manager', state: 'Approved', time: minutesAgo(250) },
        { approver: owner.displayName, role: 'Application owner (app-imagevault)', state: ownerApproved ? 'Approved' : 'Requested', time: ownerApproved ? minutesAgo(60) : null },
      ],
    });
    return {
      title: `ImageVault access for ${u.displayName}`,
      ticketIds: [t.id], mailIds: [], params: { sam: u.sam, upn: u.upn },
      checks: ownerApproved
        ? [
            check('Added to app-imagevault', { k: 'adMember', sam: u.sam, group: 'app-imagevault', value: true }, true),
            check('Okta shows ImageVault assigned (import run)', { k: 'oktaAppAccess', login: u.upn, app: 'okta-imagevault', value: true }),
            check('Granted through the group, not a direct Okta assignment', { k: 'oktaDirectAssignment', login: u.upn, app: 'okta-imagevault', value: false }),
            check('ImageVault account provisioned by SCIM', { k: 'saasActive', app: 'imagevault', login: u.upn, value: true }),
            check('Ticket resolved as fulfilled', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
          ]
        : [
            check('Access NOT granted before the owner approved', { k: 'adMember', sam: u.sam, group: 'app-imagevault', value: false }, true),
            check('No direct Okta assignment either', { k: 'oktaDirectAssignment', login: u.upn, app: 'okta-imagevault', value: false }, true),
            check('Ticket On Hold or Rejected - Not Approved', { k: 'ticketResolved', ticket: t.id, codes: ['Rejected - Not Approved'], allowOnHold: true }, true),
          ],
      hints: [
        'Read the approvals section of the ticket carefully, then Access-Request-and-Approval-Policy.md.',
        ownerApproved ? 'Both approvals are in. How does the policy say access must be granted: in Okta, or through AD?' : `Is "Requested" the same as "Approved"? Who is still missing?`,
        ownerApproved ? 'Add the user to app-imagevault in AD, run an Okta import so SCIM provisions the account, and resolve.' : `${owner.displayName} has not approved. Put the ticket On Hold (or reject it as Not Approved) and grant nothing.`,
      ],
      debrief: ownerApproved
        ? 'Both approvals were present, so access is granted through the access group app-imagevault. That keeps it visible to access reviews and lets SCIM create and later remove the account. A direct Okta assignment would work today and would never be removed by the leaver process.'
        : `${owner.displayName}, the app owner, had not approved. A manager can vouch for the need, but only the owner can accept the risk for their data. Granting early "because it will be approved anyway" is an audit finding every time.`,
      interview: { question: 'Who should approve access to an application, and why both?', modelAnswer: 'The manager confirms the business need and that the person works for them; the resource or application owner accepts the data risk and knows what the role actually allows. Fulfil only when both are approved, grant through the managed access group, and record it on the ticket so reviews and audits can trace it.' },
    };
  },
  solve(w, s) {
    if (s.twist === 'approved') {
      addMember(w, 'app-imagevault', s.params.sam!);
      runOktaImport(w);
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Manager and owner approved. Added to app-imagevault, ran Okta import; SCIM provisioned the account.');
    } else if (s.twist === 'missing-owner-approval') {
      close(w, s.ticketIds[0]!, 'Rejected - Not Approved', 'Application owner approval is still Requested. Nothing granted; requester asked to chase the owner and resubmit.');
    } else {
      close(w, s.ticketIds[0]!, 'Rejected - Policy', 'SoD conflict: requester holds grp-payroll-submit; grp-payroll-approve would be a toxic combination. Suggested an alternative approver.');
    }
  },
  naive(w, s) {
    addMember(w, s.params.group ?? 'app-imagevault', s.params.sam!);
    runOktaImport(w);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Granted the requested access.');
  },
};

// ------------------------------------------------------------------- Access review

export const accessReview: Template = {
  id: 'access-review',
  title: 'Quarterly user access review',
  category: 'Governance',
  difficulty: 2,
  skills: ['Access certification', 'Privilege creep detection', 'RBAC / birthright access', 'Audit evidence'],
  summary: 'Review a department against the birthright matrix. Remove creep, keep approved exceptions, record each decision.',
  twists: [{ id: 'department', label: 'Department review with leftovers and one exception' }],
  build(ctx): Built {
    const { w, rng } = ctx;
    const dept = pickDepartment(ctx);
    const people = rng.shuffle(employees(ctx, (u) => u.department === dept && !isLead(u))).slice(0, 3);
    if (people.length < 3) throw new Error(`Not enough free people in ${dept} for a review.`);
    const pool = ['grp-hr-managers', 'grp-sec-ops', 'grp-finance-analysts', 'app-carechart', 'grp-radiology-pacs', 'grp-nursing-clinical', 'grp-helpdesk-tier1', 'grp-hr-readers', 'app-imagevault'];
    const removals: [string, string][] = [];
    const extraFor = (sam: string, n: number): string[] => {
      const u = getUser(w, sam);
      const role = roleByTitle(u.title)!;
      const picks = rng.shuffle(pool.filter((g) => !birthright(role.group).includes(g) && !u.memberOf.includes(g))).slice(0, n);
      for (const g of picks) addMember(w, g, sam, SVC);
      return picks;
    };
    for (const g of extraFor(people[0]!.sam, 2)) removals.push([people[0]!.sam, g]);
    for (const g of extraFor(people[1]!.sam, 1)) removals.push([people[1]!.sam, g]);
    const [exceptionGroup] = extraFor(people[2]!.sam, 1);
    const excId = `EXC-${rng.int(1000, 9999)}`;
    const ownerSam = w.ad.groups.find((g) => g.name === exceptionGroup)?.managedBy;
    const owner = ownerSam ? getUser(w, ownerSam).displayName : 'the group owner';
    const sec = securityUser(w);
    const t = openTicket(w, {
      type: 'Request', category: 'Access Review', priority: 3, caller: sec.displayName, scenarioId: ctx.id, openedMinutesAgo: 600,
      short: `Q4 user access review — ${dept} (${people.length} users sampled)`,
      description: `Quarterly access certification for ${dept}. Audit sampled these users:\n${people.map((p) => `- ${p.displayName} (${p.sam}), ${p.title}`).join('\n')}\n\nCompare each with Birthright-Access-Matrix.csv. Remove access that does not match their current job unless an approved exception is listed below. Record a decision per user in the work notes.\n\nApproved exceptions on file:\n- ${excId}: ${people[2]!.sam} keeps ${exceptionGroup} until ${fmtDate(daysFromNow(45))} (approved by ${owner}).`,
      variables: { 'Department': dept, 'Exceptions': `${excId}: ${people[2]!.sam} / ${exceptionGroup}` },
    });
    return {
      title: `Access review: ${dept}`,
      ticketIds: [t.id], mailIds: [],
      params: { sams: people.map((p) => p.sam).join(','), removals: removals.map(([s, g]) => `${s}:${g}`).join(','), exception: `${people[2]!.sam}:${exceptionGroup}` },
      checks: [
        ...removals.map(([sam, g]) => check(`Removed ${g} from ${sam}`, { k: 'adMember', sam, group: g, value: false } as const)),
        check(`Kept approved exception ${exceptionGroup} for ${people[2]!.sam} (${excId})`, { k: 'adMember', sam: people[2]!.sam, group: exceptionGroup!, value: true }, true),
        ...people.map((p) => check(`${p.sam} keeps their job-role access`, { k: 'adMember', sam: p.sam, group: roleByTitle(p.title)!.group, value: true } as const, true)),
        check('Decisions recorded, including the exception', { k: 'ticketNote', ticket: t.id, anyOf: [excId, 'exception'] }),
        check('Review ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'An access review compares what someone has with what their current job should give them.',
        `For each sampled user, compare memberOf with the matrix row for their title. Then read the exceptions in the ticket.`,
        `Remove: ${removals.map(([s, g]) => `${g} from ${s}`).join('; ')}. Keep ${exceptionGroup} for ${people[2]!.sam} because of ${excId}. Note every decision.`,
      ],
      debrief: 'A review is only useful if it changes something and can be audited. Leftover groups from earlier jobs are removed, an owner-approved exception with an expiry date is kept, and core job access is left alone. The work notes are the evidence an auditor will sample.',
      interview: { question: 'How would you run a user access review that actually reduces risk?', modelAnswer: 'Scope it (a department, an app or privileged groups), compare each user\'s access with their role\'s expected access, have the manager or owner certify each line, revoke what is not justified, keep exceptions only with an owner and an expiry, verify the removals happened, and keep the decisions as audit evidence. Rubber-stamping is the failure mode, so show reviewers what is outside the role.' },
    };
  },
  solve(w, s) {
    for (const pair of s.params.removals!.split(',')) {
      const [sam, g] = pair.split(':');
      removeMember(w, g!, sam!);
    }
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `Removed leftover access (${s.params.removals}); kept approved exception ${s.params.exception}; job-role access confirmed for all sampled users.`);
  },
  naive(w, s) {
    for (const sam of s.params.sams!.split(',')) {
      const u = getUser(w, sam);
      const keep = new Set(birthright(roleByTitle(u.title)!.group));
      for (const g of [...u.memberOf]) if (!keep.has(g)) removeMember(w, g, sam);
    }
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Reset everyone to birthright.');
  },
};

// ------------------------------------------------------------------- Stale accounts

export const staleAccounts: Template = {
  id: 'stale-accounts',
  title: 'Stale account cleanup',
  category: 'Governance',
  difficulty: 2,
  skills: ['Dormant account management', 'PowerShell reporting', 'Policy exceptions'],
  summary: 'Find accounts with no sign-in for 90 days and disable them, without breaking the exceptions the policy protects.',
  twists: [{ id: 'monthly', label: 'Monthly review with a leave-of-absence and a service account' }],
  build(ctx): Built {
    const { w, rng } = ctx;
    const pool = rng.shuffle(employees(ctx, (u) => !isLead(u)));
    const [a, b, leave] = pool;
    if (!a || !b || !leave) throw new Error('Not enough free employees for a stale review.');
    a.lastLogon = daysAgo(rng.int(100, 160));
    b.lastLogon = daysAgo(rng.int(120, 220));
    leave.lastLogon = daysAgo(rng.int(95, 130));
    const lw = workerOf(w, leave)!;
    lw.status = 'Leave of Absence';
    w.hr.transactions.push({ time: daysAgo(100), employeeId: leave.employeeId, type: 'Leave', detail: 'Parental leave, expected return in 3 months', effective: daysAgo(98) });
    const svc = getUser(w, 'svc-sql01');
    svc.lastLogon = daysAgo(rng.int(140, 200));
    const sec = securityUser(w);
    const t = openTicket(w, {
      type: 'Request', category: 'Access Review', priority: 3, caller: sec.displayName, scenarioId: ctx.id, openedMinutesAgo: 900,
      short: 'Monthly stale account review (90 days)',
      description: 'Monthly control SEC-C-12: disable enabled user accounts with no sign-in in 90 days, per Stale-Account-Procedure.md. Report each account and the action taken in the work notes.\n\nTip: Documents\\Scripts\\Get-StaleAccounts.ps1',
    });
    return {
      title: 'Stale account cleanup',
      ticketIds: [t.id], mailIds: [],
      params: { sams: `${a.sam},${b.sam}`, leaveSam: leave.sam, svcSam: 'svc-sql01' },
      checks: [
        check(`${a.sam} disabled (stale)`, { k: 'adEnabled', sam: a.sam, value: false }),
        check(`${b.sam} disabled (stale)`, { k: 'adEnabled', sam: b.sam, value: false }),
        check(`${a.sam} description records the ticket`, { k: 'adAttr', sam: a.sam, attr: 'description', contains: t.id }),
        check(`${leave.sam} left enabled: on Leave of Absence in PeopleHub`, { k: 'adEnabled', sam: leave.sam, value: true }, true),
        check('svc-sql01 left alone: service accounts belong to their owners', { k: 'adEnabled', sam: 'svc-sql01', value: true }, true),
        check('Exception noted for the worker on leave', { k: 'ticketNote', ticket: t.id, anyOf: [leave.sam, 'leave'] }),
        check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'Start with Search-ADAccount -AccountInactive -TimeSpan 90.00:00:00 -UsersOnly. Then read the exceptions in the procedure.',
        `Check every result in PeopleHub. Is anyone on leave? Is anyone not a person at all?`,
        `Disable ${a.sam} and ${b.sam} with a description; leave ${leave.sam} (Leave of Absence) and svc-sql01 (service account) and say why in the notes.`,
      ],
      debrief: `Two people were genuinely dormant and are disabled, not deleted, so they can be restored if HR disagrees. ${leave.displayName} is on Leave of Absence, which the procedure protects; disabling them would be a broken promise to someone on parental leave. svc-sql01 runs SQL Server: disabling a service account from a stale report is how outages start, so it goes to its owner instead.`,
      interview: { question: 'How do you handle dormant accounts safely?', modelAnswer: 'Report enabled accounts past the inactivity threshold (lastLogonTimestamp, plus cloud sign-in activity), cross-check HR for leave or recent hires, exclude service accounts to their owners, disable rather than delete with a dated description, wait a retention period, then delete through change control. Document exceptions.' },
    };
  },
  solve(w, s) {
    for (const sam of s.params.sams!.split(',')) {
      setEnabled(w, sam, false);
      setUser(w, sam, { description: `Disabled ${nowIso().slice(0, 10)} stale per ${s.ticketIds[0]}` });
    }
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `Disabled ${s.params.sams}. Exceptions: ${s.params.leaveSam} on leave of absence; svc-sql01 is a service account, referred to its owner.`);
  },
  naive(w, s) {
    for (const sam of [...s.params.sams!.split(','), s.params.leaveSam!, 'svc-sql01']) setEnabled(w, sam, false);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Disabled everything inactive for 90 days.');
  },
};

// ------------------------------------------------------------------- Orphaned accounts

export const orphanAccounts: Template = {
  id: 'orphan-accounts',
  title: 'Audit finding: orphaned accounts',
  category: 'Governance',
  difficulty: 3,
  skills: ['AD to HR reconciliation', 'Leaver deprovisioning', 'Audit remediation', 'Incident recognition'],
  summary: 'Internal Audit says two enabled accounts have no active HR record. Find them, contain them and spot the one that signed in after leaving.',
  twists: [{ id: 'contractor-and-missed-leaver', label: 'An expired contractor and a missed leaver' }],
  build(ctx): Built {
    const { w, rng } = ctx;
    const missed = pickEmployee(ctx, (u) => !isLead(u));
    const mw = workerOf(w, missed)!;
    mw.status = 'Terminated';
    mw.termDate = daysAgo(21);
    mw.termType = 'Voluntary';
    w.hr.transactions.push({ time: daysAgo(22), employeeId: missed.employeeId, type: 'Termination', detail: 'Voluntary resignation (offboarding ticket was never raised)', effective: daysAgo(21) });
    addSignIn(w, { time: daysAgo(2), upn: missed.upn, app: 'SharePoint Online', ip: '198.51.100.140', location: 'Boston, US', device: 'macOS · Safari', result: 'Success', failureReason: '', mfa: 'Satisfied', ca: 'Success', risk: 'low' });
    const sponsor = leadOf(w, 'Nursing');
    const [cFirst, cLast] = rng.pick(CONTRACTORS.filter(([f, l]) => !w.ad.users.some((u) => u.givenName === f && u.surname === l)));
    const cSam = samFor(cFirst, cLast, (x) => w.ad.users.some((u) => u.sam === x));
    const contractor = createUser(w, { sam: cSam, givenName: cFirst, surname: cLast, ou: deptOu('Nursing'), department: 'Nursing', title: 'Contractor', description: `Contractor (Northwind Consulting). Sponsor: ${sponsor.displayName}. SOW ended ${fmtDate(daysAgo(30))}`, enabled: true, passwordSet: true, mustChangePassword: false }, SVC);
    contractor.lastLogon = daysAgo(rng.int(6, 12));
    contractor.created = daysAgo(200);
    for (const g of ['grp-nursing-clinical', 'app-carechart', 'grp-vpn-users']) addMember(w, g, contractor.sam, SVC);
    syncAll(w);
    const exportPath = `${homeDir(w)}\\Documents\\Exports\\IA-2026-14-enabled-accounts.csv`;
    const rows = w.ad.users.filter((u) => u.enabled && u.kind === 'user').map((u) => `${u.sam},${u.employeeId},${u.department},"${u.ou}",${u.lastLogon?.slice(0, 10) ?? ''}`);
    writeFile(w, exportPath, ['SamAccountName,EmployeeID,Department,OU,LastLogon', ...rows].join('\n') + '\n');
    const t = openTicket(w, {
      type: 'Request', category: 'Audit Finding', priority: 2, caller: 'Internal Audit', scenarioId: ctx.id, openedMinutesAgo: 1440,
      short: 'Audit finding IA-2026-14: enabled accounts without an active HR record',
      description: `During the AD-to-HR reconciliation, Internal Audit found 2 enabled user accounts that have no Active worker in PeopleHub.\n\nThe export we used is on your disk: Documents\\Exports\\IA-2026-14-enabled-accounts.csv\n\nPlease identify both, remediate per the JML and stale/orphan procedures, and document what you did. If either account was used after the person left, treat that as a security matter.`,
    });
    return {
      title: 'Audit finding: orphaned accounts',
      ticketIds: [t.id], mailIds: [],
      params: { sams: `${missed.sam},${contractor.sam}`, missedUpn: missed.upn },
      checks: [
        check(`Missed leaver ${missed.sam} disabled`, { k: 'adEnabled', sam: missed.sam, value: false }, true),
        check(`Expired contractor ${contractor.sam} disabled`, { k: 'adEnabled', sam: contractor.sam, value: false }, true),
        check(`${missed.sam} groups removed`, { k: 'adOnlyGroups', sam: missed.sam, groups: [] }),
        check(`${contractor.sam} groups removed`, { k: 'adOnlyGroups', sam: contractor.sam, groups: [] }),
        check(`${missed.sam} moved to Disabled Users`, { k: 'adOu', sam: missed.sam, ou: DISABLED_OU }),
        check(`${contractor.sam} moved to Disabled Users`, { k: 'adOu', sam: contractor.sam, ou: DISABLED_OU }),
        check(`${missed.sam}'s cloud sessions revoked`, { k: 'entraSessionsRevokedSince', upn: missed.upn, since: ctx.started }),
        check('Post-termination sign-in escalated to Security', { k: 'securityTicketRaised', since: ctx.started, anyOf: [missed.sam, missed.upn, missed.displayName] }),
        check('Both accounts named in the notes', { k: 'ticketNote', ticket: t.id, anyOf: [missed.sam] }),
        check('Finding resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'Reconcile the export against PeopleHub. Which accounts have no worker, or a worker who is not Active?',
        'One account has no employee ID at all. Another belongs to someone PeopleHub says left three weeks ago. Check that person\'s sign-in log.',
        `Offboard ${missed.sam} and ${contractor.sam} fully (disable, groups, Disabled Users, revoke sessions). ${missed.displayName} signed in after their termination date: raise a Security Incident.`,
      ],
      debrief: `${contractor.displayName}'s statement of work ended a month ago, but contractors are not in PeopleHub, so nothing ever turned the account off. ${missed.displayName} resigned three weeks ago and no offboarding ticket was raised. Their sign-in two days ago is post-termination access, which is a security incident, not just a cleanup item. The lasting fix is upstream: every account needs a sponsor or HR record with an end date, and HR terminations should raise the offboarding ticket automatically.`,
      interview: { question: 'How would you find and fix orphaned accounts?', modelAnswer: 'Reconcile every enabled account against the HR system and the contractor or sponsor register on a key like employee ID. Accounts with no owner, or whose owner is terminated, are disabled and stripped of access, sessions revoked, and logged. Check sign-in activity after the termination date and escalate any. Then fix the process gap: automatic leaver triggers and expiry dates on non-employee accounts.' },
    };
  },
  solve(w, s) {
    for (const sam of s.params.sams!.split(',')) {
      setEnabled(w, sam, false);
      for (const g of [...getUser(w, sam).memberOf]) removeMember(w, g, sam);
      setUser(w, sam, { description: `Disabled ${nowIso().slice(0, 10)} orphan per ${s.ticketIds[0]}` });
      moveUser(w, sam, DISABLED_OU);
    }
    syncAll(w);
    revokeSessions(w, s.params.missedUpn!);
    raiseSir(w, `Post-termination access: ${s.params.missedUpn}`, `Account signed in after HR termination date. Account now disabled and sessions revoked.`);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `Orphans ${s.params.sams} disabled, stripped, moved to Disabled Users; sessions revoked; post-termination sign-in escalated.`);
  },
};

// ------------------------------------------------------------------- SSO app access

export const ssoAccess: Template = {
  id: 'sso-app-access',
  title: 'SSO application access',
  category: 'Federation & SSO',
  difficulty: 2,
  skills: ['Okta application assignment', 'SCIM provisioning', 'Group-based access'],
  summary: 'An app says "you are not assigned". Fix it the way that survives the next audit and the next leaver.',
  twists: [
    { id: 'missing-group', label: 'Assignment group membership lost', trap: true },
    { id: 'direct-assignments', label: 'Clean up direct assignments found by audit' },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    if (twist === 'missing-group') {
      const u = pickEmployee({ ...ctx, department: 'Radiology' }, (x) => x.department === 'Radiology' && x.memberOf.includes('app-imagevault'));
      removeMember(w, 'app-imagevault', u.sam, SVC);
      runOktaImport(w, 'Okta AD Agent (MHS-DC01)');
      const t = openTicket(w, {
        type: 'Incident', category: 'Application Access', priority: 2, caller: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 25,
        short: `ImageVault: "You are not assigned to this application in Okta" (${u.displayName})`,
        description: `I can't get into ImageVault since this morning. Okta shows: "User is not assigned to the client application." I have three customer calls today. Everyone else on the Sales team can log in.`,
      });
      return {
        title: `Restore ImageVault access: ${u.displayName}`,
        ticketIds: [t.id], mailIds: [], params: { sam: u.sam, upn: u.upn },
        checks: [
          check('Back in app-imagevault (Radiology birthright)', { k: 'adMember', sam: u.sam, group: 'app-imagevault', value: true }, true),
          check('Fixed through the group, not a direct Okta assignment', { k: 'oktaDirectAssignment', login: u.upn, app: 'okta-imagevault', value: false }, true),
          check('Okta shows the app assigned', { k: 'oktaAppAccess', login: u.upn, app: 'okta-imagevault', value: true }),
          check('ImageVault account active again', { k: 'saasActive', app: 'imagevault', login: u.upn, value: true }),
          check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
        ],
        hints: [
          'Why would one person on a team lose an app the rest of the team has?',
          `Compare ${u.sam}'s groups with the Radiology row in Birthright-Access-Matrix.csv, and look at the AD audit log for recent group removals.`,
          `Add ${u.sam} back to app-imagevault in AD and run an Okta import. Do not assign the app directly in Okta.`,
        ],
        debrief: 'The Okta assignment for ImageVault comes from the AD group app-imagevault, and someone removed this user from it. Re-adding the group membership fixes the cause, and SCIM reactivates the ImageVault account. A direct Okta assignment is faster, but it lives outside the role model: the access review will not see it, and nothing removes it when the person leaves.',
        interview: { question: 'Why assign SSO apps by group instead of to individual users?', modelAnswer: 'Group-based assignment ties access to roles, so joiners get it automatically, movers and leavers lose it automatically, and access reviews can certify the group. Direct assignments bypass all of that and become orphaned access. Use direct assignment only for documented exceptions, ideally with expiry.' },
      };
    }
    const sales = rng.shuffle(employees({ ...ctx, department: 'Radiology' }, (x) => x.department === 'Radiology' && x.memberOf.includes('app-imagevault'))).slice(0, 2);
    const outsider = pickEmployee({ ...ctx, department: undefined }, (x) => x.department !== 'Radiology' && !x.memberOf.includes('app-imagevault') && !sales.some((s) => s.sam === x.sam));
    for (const u of [...sales, outsider]) oktaAssignApp(w, 'okta-imagevault', u.upn, true, 'okta-admin@meridianhealth.test');
    const t = openTicket(w, {
      type: 'Request', category: 'Audit Finding', priority: 3, caller: securityUser(w).displayName, scenarioId: ctx.id, openedMinutesAgo: 2000,
      short: 'Okta: ImageVault PACS has direct user assignments',
      description: `The Okta app review found ${sales.length + 1} users assigned directly to ImageVault PACS instead of through app-imagevault:\n${[...sales, outsider].map((u) => `- ${u.upn}`).join('\n')}\n\nPer IAM-POL-004, access must come from the access group. Remove the direct assignments. Anyone who should not have ImageVault at all must lose access.`,
    });
    return {
      title: 'Remove direct Okta assignments',
      ticketIds: [t.id], mailIds: [], params: { sams: [...sales, outsider].map((u) => u.sam).join(','), outsider: outsider.upn, sales: sales.map((u) => u.upn).join(',') },
      checks: [
        ...[...sales, outsider].map((u) => check(`No direct assignment for ${u.upn}`, { k: 'oktaDirectAssignment', login: u.upn, app: 'okta-imagevault', value: false } as const)),
        check(`${outsider.upn} (not Radiology, no approval) lost ImageVault`, { k: 'saasActive', app: 'imagevault', login: outsider.upn, value: false }, true),
        ...sales.map((u) => check(`${u.upn} still has ImageVault through the group`, { k: 'saasActive', app: 'imagevault', login: u.upn, value: true } as const, true)),
        check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'For each listed user: do they also get ImageVault from a group?',
        'In the Okta admin console, open ImageVault PACS > Assignments. Compare the direct assignments with membership of app-imagevault.',
        `Remove all three direct assignments. The two Radiology users keep access through app-imagevault; ${outsider.upn} has no group and loses it, which is correct.`,
      ],
      debrief: `Two direct assignments were redundant (the Radiology users already get the app from app-imagevault), and one gave ImageVault to ${outsider.displayName} with no approval at all. Removing direct assignments is safe when you check the group first: the Radiology users keep access and SCIM deactivates the account that should never have existed.`,
      interview: { question: 'You find users assigned directly to an app in Okta. How do you clean it up safely?', modelAnswer: 'For each direct assignment check whether the user also gets access from a group. Redundant ones are removed with no impact; ones without a group need an approval decision (move them into the group via a request, or remove). Remove, let SCIM deprovision, verify in the app, and document. Then block direct assignment by process.' },
    };
  },
  solve(w, s) {
    if (s.twist === 'missing-group') {
      addMember(w, 'app-imagevault', s.params.sam!);
      runOktaImport(w);
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'User had been removed from app-imagevault. Restored the group membership (Radiology birthright), ran Okta import; SCIM reactivated the account.');
      return;
    }
    for (const login of [...s.params.sales!.split(','), s.params.outsider!]) oktaAssignApp(w, 'okta-imagevault', login, false);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Removed all direct assignments. Radiology users keep access via app-imagevault; the non-Sales user lost ImageVault.');
  },
  naive(w, s) {
    if (s.twist === 'missing-group') {
      oktaAssignApp(w, 'okta-imagevault', s.params.upn!, true);
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Assigned ImageVault to the user in Okta.');
    }
  },
};

// ------------------------------------------------------------------- Executive impersonation

export const execEmail: Template = {
  id: 'exec-impersonation',
  title: 'Urgent request from an executive',
  category: 'Incident Response',
  difficulty: 2,
  skills: ['Social engineering defence', 'Phishing recognition', 'Segregation of duties'],
  summary: 'An "executive" emails you directly to grant access and skip the ticket. Look closely at who sent it.',
  twists: [{ id: 'lookalike-domain', label: 'Look-alike domain asking for payroll rights', trap: true }],
  build(ctx): Built {
    const { w } = ctx;
    const exec = leadOf(w, 'Finance');
    const assistant = pickEmployee({ ...ctx, department: 'Finance' }, (x) => x.department === 'Finance' && x.memberOf.includes('grp-payroll-submit'));
    const from = `${exec.givenName.toLowerCase()}.${exec.surname.toLowerCase()}@meridian-health.co`;
    const m = deliverMail(w, {
      from, fromName: exec.displayName, external: true, minutesAgo: 4,
      subject: 'Need this done before I board',
      body: `Admin,\n\nI'm about to board for the board meeting and I'm out of reach for 6 hours. Payroll has to be approved before I land.\n\nPlease add ${assistant.displayName} to grp-payroll-approve right now so they can approve it in my absence. No need for a ticket, I'm approving it here. I'll sort the paperwork out on Monday.\n\nThanks for being quick on this.\n\n${exec.displayName}\nFinancial Controller\nSent from my iPhone`,
    });
    return {
      title: 'Urgent access request by email',
      ticketIds: [], mailIds: [m.id], params: { sam: assistant.sam, from },
      checks: [
        check(`${assistant.sam} NOT added to grp-payroll-approve`, { k: 'adMember', sam: assistant.sam, group: 'grp-payroll-approve', value: false }, true),
        check('Email reported as phishing', { k: 'mailReported', mail: m.id, value: true }, true),
        check('Security Incident raised about the look-alike domain', { k: 'securityTicketRaised', since: ctx.started, anyOf: ['meridian-health.co', from] }),
      ],
      hints: [
        'Read the sender address character by character.',
        `Where did the email come from, does it follow the access request policy, and what does SoD-Matrix.csv say about ${assistant.sam}?`,
        'meridian-health.co is not meridianhealth.test. Report the email as phishing, change nothing, and raise a Security Incident naming the domain.',
      ],
      debrief: `The sender is ${from}, a look-alike of the real domain, and the email has every pressure tactic: authority, urgency, unreachability and "skip the process". Even if it had been genuine, it asks for a toxic combination (${assistant.sam} already submits payroll) and bypasses approvals. Report it, change nothing, and let Security block the domain and warn Finance.`,
      interview: { question: 'You get an urgent email from the CFO asking you to grant access immediately. What do you do?', modelAnswer: 'Pause and verify: check the sender domain and headers, and confirm through a known channel (call the person on the number in the directory). Never bypass the request and approval process because of urgency. If it is fake, report it and raise an incident; if it is real, it still goes through a ticket with the right approvals and an SoD check.' },
    };
  },
  solve(w, s) {
    reportPhishing(w, s.mailIds[0]!);
    raiseSir(w, `BEC attempt from look-alike domain meridian-health.co`, `Email impersonating the Financial Controller from ${s.params.from} asked for payroll approval rights. No change made.`);
  },
  naive(w, s) {
    addMember(w, 'grp-payroll-approve', s.params.sam!);
  },
};
