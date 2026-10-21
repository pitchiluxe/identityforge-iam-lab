/**
 * Privileged access, Conditional Access and hybrid identity.
 */
import { atTime, daysAgo, minutesAgo, nowIso } from '../../core/time.ts';
import { BREAK_GLASS, STAGING_OU, birthright, deptOu, roleFor } from '../../world/company.ts';
import { addMember, changeOwnPassword, createUser, getUser, moveUser, removeMember, setUser, signIn } from '../../world/directory.ts';
import { assignRole, findEntraUser, removeRole, runEntraSync, saveCaPolicy } from '../../world/cloud.ts';
import { nextEmployeeId, openTicket } from '../../world/itsm.ts';
import { type Built, type Template, check, close, isLead, issueLaptop, labSecret, leadOf, newPerson, pickDepartment, pickEmployee, securityUser, syncAll } from '../template.ts';

const SVC = 'MERIDIAN\\svc-provisioning';

// ------------------------------------------------------------------- PIM

export const standingPrivilege: Template = {
  id: 'standing-privilege',
  title: 'Standing privileged access',
  category: 'Privileged Access',
  difficulty: 3,
  skills: ['Privileged Identity Management', 'Least privilege', 'Tier 0 protection'],
  summary: 'Nobody gets permanent admin. Turn standing privilege into just-in-time eligibility, and say no to requests for it.',
  twists: [
    { id: 'request-permanent', label: 'Engineer asks for permanent Domain Admin and Global Admin', trap: true },
    { id: 'standing-global-admin', label: 'Audit finds a permanent active Global Administrator' },
  ],
  build(ctx): Built {
    const { w, twist } = ctx;
    if (twist === 'request-permanent') {
      const u = pickEmployee({ ...ctx, department: 'IT' }, (x) => x.department === 'IT' && !isLead(x));
      const mgr = getUser(w, u.manager!);
      const t = openTicket(w, {
        type: 'Request', category: 'Privileged Access', priority: 3, caller: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 400,
        short: `Permanent Domain Admin and Global Admin for ${u.displayName}`,
        description: `Please add me to Domain Admins and give me permanent Global Administrator in Entra.\n\nI keep waiting hours for change approvals and PIM activations every time I need to fix something after hours. ${mgr.givenName} is fine with it (see approval).`,
        variables: { 'Requested': 'Domain Admins; Global Administrator (permanent, active)' },
        approvals: [{ approver: mgr.displayName, role: 'Manager', state: 'Approved', time: minutesAgo(380) }],
      });
      return {
        title: `Permanent admin request: ${u.displayName}`,
        ticketIds: [t.id], mailIds: [], params: { sam: u.sam, upn: u.upn },
        checks: [
          check('Not added to Domain Admins', { k: 'adMember', sam: u.sam, group: 'Domain Admins', value: false }, true),
          check('No Global Administrator assignment', { k: 'entraRole', upn: u.upn, role: 'Global Administrator', assignment: 'none' }, true),
          check('Rejected under the Privileged Access Standard', { k: 'ticketResolved', ticket: t.id, codes: ['Rejected - Policy'] }, true),
          check('Notes offer the just-in-time alternative', { k: 'ticketNote', ticket: t.id, anyOf: ['eligible', 'pim', 'just-in-time', 'just in time', 'jit'] }),
        ],
        hints: [
          'What does Privileged-Access-Standard.md say about permanent admin, and who may change Tier 0 groups?',
          'A manager approval does not override the standard. What would actually solve their after-hours problem?',
          'Reject under policy. Explain that Tier 0 needs a CHG through the Domain Admin team and that Entra roles are PIM eligible; offer an eligible, narrower role if their job needs one.',
        ],
        debrief: `Standing Domain Admin and Global Admin on a day-to-day account is exactly what attackers look for: one phished password becomes the whole company. The real problem (slow after-hours access) is solved with PIM eligibility for the narrowest role that does the job, plus an emergency process, not with permanent privilege. And IAM Operations cannot add to Domain Admins anyway; that is the point of tiering.`,
        interview: { question: 'An engineer wants permanent admin rights because PIM is slow. How do you respond?', modelAnswer: 'Decline permanent privilege and explain the risk, then solve the real problem: give an eligible assignment for the least-privileged role they need, tune activation (approval, duration, MFA) for their on-call pattern, and keep Tier 0 changes in change control with break-glass for true emergencies.' },
      };
    }
    const u = pickEmployee({ ...ctx, department: 'IT' }, (x) => x.department === 'IT' && !!findEntraUser(w, x.upn));
    assignRole(w, u.upn, 'Global Administrator', 'active', { permanent: true, justification: 'Temporary for tenant migration (2025)' }, SVC);
    const sec = securityUser(w);
    const t = openTicket(w, {
      type: 'Request', category: 'Privileged Access', priority: 2, caller: sec.displayName, scenarioId: ctx.id, openedMinutesAgo: 180,
      short: `Standing Global Administrator found: ${u.upn}`,
      description: `Our quarterly privileged role review found ${u.upn} with a PERMANENT ACTIVE Global Administrator assignment ("Temporary for tenant migration (2025)").\n\nPer SEC-STD-007, convert it to a PIM eligible assignment. ${u.givenName} still needs to be able to activate it for break-fix.`,
    });
    return {
      title: `Convert standing Global Admin to eligible: ${u.displayName}`,
      ticketIds: [t.id], mailIds: [], params: { sam: u.sam, upn: u.upn },
      checks: [
        check('Global Administrator is eligible, not active', { k: 'entraRole', upn: u.upn, role: 'Global Administrator', assignment: 'eligible' }, true),
        check('Ticket resolved as fulfilled', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'Open the Entra admin center > Privileged Identity Management for this user.',
        'Removing the role entirely would break their break-fix duties. What assignment type does the standard require?',
        'Change the Global Administrator assignment from active to eligible (with a justification), then resolve.',
      ],
      debrief: '"Temporary" permanent admin is the most common PIM finding. Making it eligible keeps the person able to do their job while removing the standing exposure: the role is only active for a few audited hours after an MFA-backed activation.',
      interview: { question: 'What is the difference between an eligible and an active role assignment?', modelAnswer: 'An active assignment grants the permissions all the time. An eligible one grants nothing until the user activates it in PIM for a limited time, usually with MFA, justification and sometimes approval, and every activation is audited. Eligible assignments remove standing privilege without removing capability.' },
    };
  },
  solve(w, s) {
    if (s.twist === 'request-permanent') {
      close(w, s.ticketIds[0]!, 'Rejected - Policy', 'SEC-STD-007: no standing privilege; Tier 0 changes go through the Domain Admin CHG. Offered a PIM eligible, least-privilege role assignment instead.');
      return;
    }
    assignRole(w, s.params.upn!, 'Global Administrator', 'eligible', { permanent: true, justification: `Converted from standing assignment per ${s.ticketIds[0]}` });
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Converted permanent active Global Administrator to PIM eligible.');
  },
  naive(w, s) {
    if (s.twist === 'request-permanent') {
      assignRole(w, s.params.upn!, 'Global Administrator', 'active', { permanent: true, justification: 'Manager approved' });
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Granted as approved by the manager.');
    } else {
      removeRole(w, s.params.upn!, 'Global Administrator');
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Removed the role.');
    }
  },
};

// ------------------------------------------------------------------- Service account

export const serviceAccount: Template = {
  id: 'service-account',
  title: 'Service account hygiene',
  category: 'Privileged Access',
  difficulty: 2,
  skills: ['Service account governance', 'Tier 0 protection', 'Change risk'],
  summary: 'A backup service account is a Domain Admin with no owner. Fix the privilege without breaking the backups.',
  twists: [{ id: 'backup-domain-admin', label: 'svc-backup is in Domain Admins', trap: true }],
  build(ctx): Built {
    const { w } = ctx;
    addMember(w, 'Domain Admins', 'svc-backup', SVC);
    setUser(w, 'svc-backup', { description: 'Backup' }, SVC);
    const t = openTicket(w, {
      type: 'Request', category: 'Audit Finding', priority: 2, caller: 'Internal Audit', scenarioId: ctx.id, openedMinutesAgo: 2880,
      short: 'SOX finding IA-2026-09: svc-backup is a Domain Admin with no documented owner',
      description: 'svc-backup is a member of Domain Admins, has "password never expires", and its description does not name an owner.\n\nRemediate per the Service Account Standard. Backups run nightly at 01:00 and must not fail.',
    });
    return {
      title: 'Remediate svc-backup',
      ticketIds: [t.id], mailIds: [], params: { svcSam: 'svc-backup' },
      checks: [
        check('svc-backup removed from Domain Admins', { k: 'adMember', sam: 'svc-backup', group: 'Domain Admins', value: false }, true),
        check('Still in grp-backup-operators (backups keep working)', { k: 'adMember', sam: 'svc-backup', group: 'grp-backup-operators', value: true }, true),
        check('Still enabled (do not break production)', { k: 'adEnabled', sam: 'svc-backup', value: true }, true),
        check('Description names an owner', { k: 'adAttr', sam: 'svc-backup', attr: 'description', contains: 'owner' }),
        check('Finding resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'Read Service-Account-Standard.md. What does a backup service account actually need?',
        'Removing privilege is right; disabling the account is not. Which group gives backup rights without Domain Admin?',
        'Remove svc-backup from Domain Admins, keep grp-backup-operators, set the description with "Owner: <name>", and resolve.',
      ],
      debrief: 'Service accounts in Domain Admins are a favourite attacker target: their passwords rarely change and they are often stored in scripts. The fix is to remove the Tier 0 membership while keeping the narrower right the service needs (grp-backup-operators), and to record an owner so someone is accountable for rotation. Disabling it would have "fixed" the finding and broken last night\'s backups.',
      interview: { question: 'How do you secure service accounts?', modelAnswer: 'Inventory them, give each an owner and purpose, remove interactive and Tier 0 rights, grant only the specific rights the service needs, prefer gMSAs with automatic rotation, otherwise rotate on a schedule, keep them out of cloud sync, and monitor their logons. Change them carefully, because they run production.' },
    };
  },
  solve(w, s) {
    removeMember(w, 'Domain Admins', 'svc-backup');
    setUser(w, 'svc-backup', { description: 'Veeam backup jobs. Owner: Grace Hopper. Rights via grp-backup-operators.' });
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Removed svc-backup from Domain Admins; backup rights via grp-backup-operators retained; owner documented.');
  },
  naive(w, s) {
    setUser(w, 'svc-backup', { description: 'Disabled per audit' });
    getUser(w, 'svc-backup').enabled = false;
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Disabled the service account.');
  },
};

// ------------------------------------------------------------------- Conditional Access

export const caPolicy: Template = {
  id: 'ca-policy',
  title: 'Conditional Access policy',
  category: 'Federation & SSO',
  difficulty: 2,
  skills: ['Conditional Access', 'Break-glass design', 'Change management'],
  summary: 'Security wants MFA for everyone. Build the policy without locking out the emergency accounts.',
  twists: [
    { id: 'report-only', label: 'Standard rollout (report-only first)' },
    { id: 'enforce-approved', label: 'CISO approved immediate enforcement' },
  ],
  build(ctx): Built {
    const { w, twist } = ctx;
    const sec = securityUser(w);
    const t = openTicket(w, {
      type: 'Change', category: 'Conditional Access', priority: 3, caller: sec.displayName, scenarioId: ctx.id, openedMinutesAgo: 240,
      short: 'Create Conditional Access policy: require MFA for all users',
      description: `Following last month's phishing incident, create a Conditional Access policy:\n- Users: All users\n- Target resources: All cloud apps\n- Grant: Require multifactor authentication\n\n${twist === 'enforce-approved' ? 'CHG-2231 is approved by the CISO for immediate enforcement (state On).' : 'Roll out according to the Conditional Access baseline.'}`,
      approvals: [{ approver: sec.displayName, role: 'Security Manager', state: 'Approved', time: minutesAgo(230) }, ...(twist === 'enforce-approved' ? [{ approver: 'CISO', role: 'CAB', state: 'Approved' as const, time: minutesAgo(200) }] : [])],
    });
    return {
      title: 'Require MFA for all users',
      ticketIds: [t.id], mailIds: [], params: {},
      checks: [
        check('Policy requires MFA for All users and All cloud apps', { k: 'caPolicy', grant: 'require-mfa', mustExclude: [], states: ['on', 'report-only'] }),
        check('Both break-glass accounts are excluded', { k: 'caPolicy', grant: 'require-mfa', mustExclude: [...BREAK_GLASS], states: ['on', 'report-only'] }, true),
        twist === 'enforce-approved'
          ? check('Enforced (On) as the CHG approves', { k: 'caPolicy', grant: 'require-mfa', mustExclude: [...BREAK_GLASS], states: ['on'] })
          : check('Starts in Report-only per the baseline', { k: 'caPolicy', grant: 'require-mfa', mustExclude: [...BREAK_GLASS], states: ['report-only'] }),
        check('Change ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'Before creating anything, read Conditional-Access-Baseline.md.',
        'Which two accounts must never be blocked by a tenant-wide policy, and what state should a new policy start in?',
        `Create the policy for All users / All cloud apps / Require MFA, exclude ${BREAK_GLASS.join(' and ')}, set it to ${twist === 'enforce-approved' ? 'On' : 'Report-only'}, and resolve.`,
      ],
      debrief: `A tenant-wide policy that includes the break-glass accounts can lock everyone out, permanently, the day MFA or a federation dependency breaks. Excluding them (and alerting on their use) is the baseline. ${twist === 'enforce-approved' ? 'Here the CISO approved immediate enforcement, so On is correct.' : 'Report-only first shows who would be blocked before anyone actually is.'}`,
      interview: { question: 'What are break-glass accounts and how should Conditional Access treat them?', modelAnswer: 'Cloud-only emergency Global Admin accounts with strong, separately stored credentials (often FIDO2 in a safe). They are excluded from Conditional Access policies that could lock the tenant out, monitored with alerts on every sign-in, and tested regularly. New CA policies roll out in report-only first to check impact.' },
    };
  },
  solve(w, s) {
    saveCaPolicy(w, { name: 'CA010 - Require MFA for all users', state: s.twist === 'enforce-approved' ? 'on' : 'report-only', includeUsers: 'All users', excludeUsers: [...BREAK_GLASS], apps: 'All cloud apps', condition: 'none', grant: 'require-mfa' });
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Created CA010 for All users / All cloud apps requiring MFA, break-glass accounts excluded, state per CHG.');
  },
  naive(w, s) {
    saveCaPolicy(w, { name: 'Require MFA', state: 'on', includeUsers: 'All users', excludeUsers: [], apps: 'All cloud apps', condition: 'none', grant: 'require-mfa' });
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Created the policy.');
  },
};

// ------------------------------------------------------------------- Hybrid sync

export const hybridSync: Template = {
  id: 'hybrid-sync',
  title: 'Hybrid identity sync problem',
  category: 'Hybrid Identity',
  difficulty: 3,
  skills: ['Entra Connect', 'Sync scope', 'Soft match', 'Troubleshooting'],
  summary: 'Something is right in AD and wrong in the cloud. Work out why the sync did not carry it.',
  twists: [
    { id: 'staging-ou', label: 'New starter created in an unsynced OU' },
    { id: 'name-change', label: 'Name change not showing in Teams' },
    { id: 'soft-match-blocked', label: 'InvalidSoftMatch against a cloud admin account' },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    if (twist === 'name-change') {
      const u = pickEmployee(ctx);
      const newLast = rng.pick(['Whitaker', 'Moreno', 'Kaplan', 'Ndiaye', 'Sorensen', 'Albright']);
      const oldName = u.displayName;
      const worker = w.hr.workers.find((x) => x.employeeId === u.employeeId)!;
      worker.last = newLast;
      w.hr.transactions.push({ time: daysAgo(1), employeeId: u.employeeId, type: 'Title Change', detail: `Legal name change: ${oldName} -> ${u.givenName} ${newLast}`, effective: daysAgo(1) });
      setUser(w, u.sam, { surname: newLast, displayName: `${u.givenName} ${newLast}` }, 'MERIDIAN\\svc-hrsync');
      const t = openTicket(w, {
        type: 'Incident', category: 'Directory', priority: 4, caller: `${u.givenName} ${newLast}`, scenarioId: ctx.id, openedMinutesAgo: 60,
        short: 'My new surname still shows the old one in Teams and Outlook',
        description: `HR updated my name yesterday (I got married!) and my laptop login shows the new name, but Teams, Outlook and the company directory still show "${oldName}". Can this be fixed?`,
      });
      return {
        title: `Name change not in the cloud: ${u.givenName} ${newLast}`,
        ticketIds: [t.id], mailIds: [], params: { sam: u.sam },
        checks: [
          check('Entra ID shows the new name (sync run)', { k: 'entraMatchesAd', sam: u.sam }, true),
          check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
        ],
        hints: [
          'AD already shows the new name. Where does Teams get the name from?',
          'Compare the user in AD and in the Entra admin center. When did Entra Connect last run?',
          'Run Start-ADSyncSyncCycle -PolicyType Delta in PowerShell, then confirm in Entra and resolve.',
        ],
        debrief: 'AD was right; Entra had not caught up. In a hybrid tenant synced attributes are mastered on-premises and can only change in the cloud through a sync, and the cloud blocks editing them directly. A delta sync carries the change; Teams and the address book follow within a few hours.',
        interview: { question: 'A change made in AD is not showing in Microsoft 365. How do you troubleshoot?', modelAnswer: 'Confirm the AD change, check the object is in a synced OU, check Entra Connect sync status and errors (Synchronization Service Manager or Entra Connect Health), run a delta sync, then verify the attribute in Entra. Remember Exchange and Teams caches can lag further, and that synced attributes cannot be edited in the cloud.' },
      };
    }
    const dept = pickDepartment(ctx);
    const role = roleFor(dept, false);
    const lead = leadOf(w, dept);
    const p = newPerson(ctx);
    const employeeId = nextEmployeeId(w);
    w.hr.workers.push({ employeeId, first: p.first, last: p.last, department: dept, title: role.title, managerId: lead.employeeId, location: 'Boston Main Campus', status: 'Active', hireDate: nowIso(), termDate: null, termType: null, phoneLast4: String(rng.int(1000, 9999)), workerType: 'Employee' });
    w.hr.transactions.push({ time: daysAgo(3), employeeId, type: 'Hire', detail: `${role.title}, ${dept}`, effective: nowIso() });
    const ou = twist === 'staging-ou' ? STAGING_OU : deptOu(dept);
    const hd = w.ad.users.find((x) => x.title === 'Service Desk Analyst')!;
    // What the ticket says must be true in the systems: the service desk built the
    // account before the start date, and the new starter signed in on their own
    // laptop this morning (temporary password, forced change, then a 4624).
    const temp = labSecret(rng);
    atTime(daysAgo(2), () => {
      createUser(w, { sam: p.sam, givenName: p.first, surname: p.last, ou, department: dept, title: role.title, manager: lead.sam, employeeId, office: 'Boston Main Campus', enabled: true, passwordSet: true, password: temp, mustChangePassword: true }, hd.sam);
      for (const g of birthright(role.group)) addMember(w, g, p.sam, hd.sam);
    });
    const firstLogon = minutesAgo(rng.int(70, 110));
    const laptop = issueLaptop(w, rng, p.sam, firstLogon);
    atTime(firstLogon, () => {
      const own = labSecret(rng);
      changeOwnPassword(w, p.sam, temp, own, laptop);
      signIn(w, p.sam, own, laptop, { logonType: 2 });
    });
    let ticketText = `${p.first} ${p.last} started today in ${dept}. They signed in to their laptop (${laptop}) earlier today, but there is no mailbox, no Teams and no SSO apps. Their manager is asking what's going on.`;
    if (twist === 'soft-match-blocked') {
      w.entra.users.push({ id: `c10d0000-0000-4000-a000-${String(rng.int(100000, 999999)).padStart(12, '0')}`, upn: `${p.sam}@meridianhealth.test`, displayName: `${p.first} ${p.last}`, source: 'cloud', onPremSam: null, accountEnabled: true, department: '', jobTitle: '', groups: [], mfaMethods: [], mfaResetAt: null, sessionsValidFrom: daysAgo(2), sessions: [], roles: [{ role: 'Helpdesk Administrator', assignment: 'active', permanent: true, expires: null, justification: 'Created early so they could shadow the service desk' }], licenses: [], riskLevel: 'none', deleted: false });
      runEntraSync(w);
      ticketText += `\n\nEntra Connect is showing an export error for ${p.sam}@meridianhealth.test. Someone created a cloud account for them last week "to get a head start".`;
    } else {
      runEntraSync(w);
    }
    const t = openTicket(w, {
      type: 'Incident', category: 'Directory', priority: 2, caller: lead.displayName, requestedFor: `${p.first} ${p.last}`, scenarioId: ctx.id, openedMinutesAgo: 40,
      short: `New starter ${p.first} ${p.last} has no email or Teams`, description: ticketText,
    });
    return {
      title: `New starter missing in the cloud: ${p.first} ${p.last}`,
      ticketIds: [t.id], mailIds: [], params: { sam: p.sam, upn: `${p.sam}@meridianhealth.test`, dept },
      checks: [
        ...(twist === 'staging-ou' ? [check(`Moved out of ${STAGING_OU} into ${deptOu(dept)}`, { k: 'adOu', sam: p.sam, ou: deptOu(dept) } as const, true)] : []),
        ...(twist === 'soft-match-blocked' ? [
          check('Sync error cleared', { k: 'noSyncError', sam: p.sam } as const, true),
          check('Standing Helpdesk Administrator removed from the cloud account', { k: 'entraRole', upn: `${p.sam}@meridianhealth.test`, role: 'Helpdesk Administrator', assignment: 'none' } as const),
        ] : []),
        check('Synced to Entra ID and matching AD', { k: 'entraMatchesAd', sam: p.sam }, true),
        check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'AD has the account, Entra does not. List the reasons an AD object might not sync.',
        twist === 'staging-ou' ? `Where is the account? Compare its OU with OU-Design.md's sync scope.` : 'Open the Entra Connect page in the Entra admin center and read the sync error.',
        twist === 'staging-ou'
          ? `Move ${p.sam} from ${STAGING_OU} to ${deptOu(dept)}, run a delta sync, confirm in Entra.`
          : `Soft match is blocked because the cloud account holds an admin role. Remove the Helpdesk Administrator role from ${p.sam}@meridianhealth.test in PIM, run a delta sync, confirm the objects joined.`,
      ],
      debrief: twist === 'staging-ou'
        ? `${STAGING_OU} is deliberately outside the Entra Connect scope, so an account created there never reaches the cloud: no license, no mailbox, no SSO. Moving it into the department OU puts it in scope and the next sync creates it.`
        : 'Entra Connect tries to soft-match a new on-premises object to an existing cloud account with the same UPN, but refuses when the cloud account holds an admin role, because that would let an on-premises admin take over a cloud admin. Removing the role (which should never have been standing anyway) lets the match complete and the duplicate disappear.',
      interview: { question: 'What are soft match and hard match in Entra Connect?', modelAnswer: 'When a new on-premises object syncs, Entra Connect looks for an existing cloud object to join. Hard match uses the immutable ID (sourceAnchor). Soft match falls back to UPN or proxyAddresses. Soft match is blocked for cloud accounts holding admin roles to prevent takeover, which shows up as InvalidSoftMatch. Fix by removing the role or hard-matching deliberately.' },
    };
  },
  solve(w, s) {
    if (s.twist === 'name-change') {
      runEntraSync(w);
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'AD had the new name; ran a delta sync and confirmed in Entra ID.');
      return;
    }
    if (s.twist === 'staging-ou') moveUser(w, s.params.sam!, deptOu(s.params.dept as Parameters<typeof deptOu>[0]));
    if (s.twist === 'soft-match-blocked') removeRole(w, s.params.upn!, 'Helpdesk Administrator');
    syncAll(w);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Fixed the sync blocker and ran a delta sync; user now present in Entra ID with license.');
  },
};


