/**
 * Joiner, mover and leaver: the work an IAM team does every single day.
 */
import type { Department } from '../../core/types.ts';
import { daysFromNow, fmtDate, minutesAgo, nowIso } from '../../core/time.ts';
import { DISABLED_OU, birthright, deptOu, roleFor, LOCATIONS } from '../../world/company.ts';
import {
  addMember, createUser, getUser, moveUser, removeMember, resetPassword, setEnabled, setUser,
} from '../../world/directory.ts';
import { addSignIn, revokeSessions, setSaasAccount, findEntraUser, oktaClearSessions } from '../../world/cloud.ts';
import { deliverMail, nextEmployeeId, openTicket } from '../../world/itsm.ts';
import {
  type Built, type Template, check, close, hrUser, isLead, leadOf, newPerson, pickDepartment, pickEmployee, syncAll, workerOf,
} from '../template.ts';

// ------------------------------------------------------------------- Joiner

export const joiner: Template = {
  id: 'joiner',
  title: 'New hire onboarding',
  category: 'Joiner',
  difficulty: 1,
  skills: ['Joiner provisioning', 'RBAC / birthright access', 'Active Directory', 'Hybrid sync'],
  summary: 'HR raises a new-hire request. Build the account from PeopleHub and the birthright matrix, then sync it to the cloud.',
  twists: [
    { id: 'future-start', label: 'Starts next week: account must stay disabled' },
    { id: 'start-today', label: 'Starts today: enable with a temporary password' },
    { id: 'mirror-request', label: 'Manager asks to "copy a colleague\'s access"', trap: true },
    { id: 'no-hr-record', label: 'Request for someone HR has never heard of', trap: true },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    const dept = pickDepartment(ctx);
    const role = roleFor(dept, false);
    const lead = leadOf(w, dept);
    const p = newPerson(ctx);
    const employeeId = nextEmployeeId(w);
    const location = rng.pick(LOCATIONS);
    const startDate = twist === 'start-today' ? nowIso() : daysFromNow(rng.int(3, 7));
    const hr = hrUser(w);
    if (twist === 'no-hr-record') {
      const t = openTicket(w, {
        type: 'Request', category: 'Account Request', priority: 3, caller: lead.displayName, requestedFor: `${p.first} ${p.last}`, scenarioId: ctx.id, openedMinutesAgo: 35,
        short: `Account needed for ${p.first} ${p.last} starting Monday`,
        description: `Hi IAM team,\n\n${p.first} ${p.last} is joining my team on Monday as a ${role.title}. HR is "still doing the paperwork" but I need the account ready so they can start on day one. Please set up the usual ${dept} access.\n\nThanks,\n${lead.displayName}`,
        variables: { 'Requested by': lead.displayName, 'Department': dept, 'Job title': role.title, 'Employee ID': '(not provided)' },
        approvals: [{ approver: lead.displayName, role: 'Manager', state: 'Approved', time: minutesAgo(30) }],
      });
      return {
        title: `Account request without an HR record: ${p.first} ${p.last}`,
        ticketIds: [t.id], mailIds: [], params: { sam: p.sam, dept },
        checks: [
          check(`No account created for ${p.first} ${p.last}`, { k: 'adExists', sam: p.sam, value: false }, true),
          check('Request rejected under the JML SOP (no HR record, no account)', { k: 'ticketResolved', ticket: t.id, codes: ['Rejected - Policy', 'Rejected - Not Approved'], allowOnHold: true }, true),
          check('Notes say why: PeopleHub has no record', { k: 'ticketNote', ticket: t.id, anyOf: ['peoplehub', 'hr record', 'no record', 'not in hr', 'pending hire'] }),
        ],
        hints: [
          'Before building anything, ask: who says this person works here?',
          `Search PeopleHub for ${p.first} ${p.last}. What does the JML SOP say when there is no HR record?`,
          'No HR record means no account. Put the ticket On Hold or reject it under policy, and tell the manager to have HR complete the hire.',
        ],
        debrief: `PeopleHub has no worker called ${p.first} ${p.last}. Creating an account "to get ahead" makes an identity no system of record will ever terminate: it becomes an orphan the day the plan changes. The right outcome is no account, with the ticket held or rejected and a note sending the manager to HR. Day-one readiness comes from HR entering the hire early, not from IAM skipping the control.`,
        interview: { question: 'A manager asks you to create an account before HR has entered the hire. What do you do?', modelAnswer: 'Decline politely and explain that HR is the source of truth: without a worker record nothing would ever deprovision the account. Hold the ticket, ask the manager to get HR to enter the Pending Hire, and offer to build it as soon as the record exists, so day-one readiness is still possible.' },
      };
    }
    w.hr.workers.push({ employeeId, first: p.first, last: p.last, department: dept, title: role.title, managerId: lead.employeeId, location, status: 'Pending Hire', hireDate: startDate, termDate: null, termType: null, phoneLast4: String(rng.int(1000, 9999)), workerType: 'Employee' });
    w.hr.transactions.push({ time: minutesAgo(90), employeeId, type: 'Hire', detail: `${role.title}, ${dept}, reports to ${lead.displayName}`, effective: startDate });
    const peer = rng.pick(w.ad.users.filter((u) => u.department === dept && u.kind === 'user' && !isLead(u) && u.enabled));
    let extra = '';
    if (twist === 'mirror-request') {
      extra = rng.pick(['grp-finance-analysts', 'grp-hr-readers', 'app-imagevault', 'grp-sec-ops', 'app-carechart'].filter((g) => !birthright(role.group).includes(g)));
      if (!peer.memberOf.includes(extra)) addMember(w, extra, peer.sam, 'MERIDIAN\\svc-provisioning');
    }
    const t = openTicket(w, {
      type: 'Request', category: 'Onboarding', priority: twist === 'start-today' ? 2 : 3, caller: hr.displayName, requestedFor: `${p.first} ${p.last}`, scenarioId: ctx.id, openedMinutesAgo: 80,
      short: `New hire: ${p.first} ${p.last} — ${role.title} (${dept})${twist === 'start-today' ? ' — STARTS TODAY' : ''}`,
      description: `New hire onboarding request generated from PeopleHub hire transaction.\n\nWorker: ${p.first} ${p.last}\nEmployee ID: ${employeeId}\nJob title: ${role.title}\nDepartment: ${dept}\nManager: ${lead.displayName}\nLocation: ${location}\nStart date: ${fmtDate(startDate)}\n\nPlease provision standard access per the JML SOP.${twist === 'start-today' ? '\n\nNote from HR: paperwork was late. They are in the lobby now, please prioritise.' : ''}${twist === 'mirror-request' ? `\n\nComment from ${lead.displayName}: "Easiest is to just give ${p.first} exactly the same access as ${peer.displayName}, they'll be doing the same work."` : ''}`,
      variables: { 'Employee ID': employeeId, 'Job title': role.title, 'Department': dept, 'Manager': lead.displayName, 'Location': location, 'Start date': fmtDate(startDate) },
      approvals: [{ approver: hr.displayName, role: 'HR', state: 'Approved', time: minutesAgo(85) }],
    });
    const groups = birthright(role.group);
    const checks = [
      check(`Account ${p.sam} exists (naming standard)`, { k: 'adExists', sam: p.sam, value: true }, true),
      check(`In ${deptOu(dept)}`, { k: 'adOu', sam: p.sam, ou: deptOu(dept) }),
      check('Employee ID from PeopleHub', { k: 'adAttr', sam: p.sam, attr: 'employeeId', equals: employeeId }),
      check('Job title from PeopleHub', { k: 'adAttr', sam: p.sam, attr: 'title', equals: role.title }),
      check('Department set', { k: 'adAttr', sam: p.sam, attr: 'department', equals: dept }),
      check(`Manager is ${lead.displayName}`, { k: 'adAttr', sam: p.sam, attr: 'manager', equals: lead.sam }),
      check('Exactly the birthright groups for the role, nothing more', { k: 'adOnlyGroups', sam: p.sam, groups }, twist === 'mirror-request'),
      twist === 'start-today'
        ? check('Enabled today with a temporary password', { k: 'adEnabled', sam: p.sam, value: true })
        : check('Left disabled until the start date', { k: 'adEnabled', sam: p.sam, value: false }),
      check('Must change password at next logon', { k: 'adMustChange', sam: p.sam, value: true }),
      check('Synced to Entra ID (delta sync run)', { k: 'entraMatchesAd', sam: p.sam }),
      check('Ticket resolved as fulfilled', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
    ];
    if (twist === 'mirror-request') checks.splice(7, 0, check(`Did NOT copy ${extra} from ${peer.displayName}`, { k: 'adMember', sam: p.sam, group: extra, value: false }, true));
    return {
      title: `Onboard ${p.first} ${p.last} (${role.title})`,
      ticketIds: [t.id], mailIds: [],
      params: { sam: p.sam, first: p.first, last: p.last, employeeId, dept, role: role.group, manager: lead.sam, location, extra, peer: peer.sam },
      checks,
      hints: [
        'Start in PeopleHub and the JML SOP. What does HR say about this person, and when do they start?',
        `The account name follows AD-Naming-Standard.md, and the groups come from Birthright-Access-Matrix.csv for "${role.title}".`,
        `Create ${p.sam} in ${deptOu(dept)} with employee ID, title, department and manager, add exactly the birthright groups, ${twist === 'start-today' ? 'reset the password with must-change and enable it' : 'leave it disabled'}, then run Start-ADSyncSyncCycle -PolicyType Delta.`,
      ],
      debrief: `A joiner is built from the system of record, not from the request text: PeopleHub gives the name, ID, title and manager, and the birthright matrix gives the access. ${twist === 'future-start' ? 'Because the start date is in the future, the account stays disabled; an enabled, unused account is an attack surface.' : ''}${twist === 'start-today' ? 'They start today, so the account is enabled with a temporary password that must be changed at first sign-in.' : ''}${twist === 'mirror-request' ? `"Same as ${peer.displayName}" would have copied ${extra}, which ${peer.displayName} picked up outside their role. Mirroring is how privilege creep spreads, which is why the SOP bans it.` : ''} The delta sync is what makes the Microsoft 365 license and SSO apps arrive; without it the person turns up to an account that works on-premises only.`,
      interview: { question: 'Walk me through onboarding a new employee in a hybrid AD and Entra ID environment.', modelAnswer: 'Confirm the hire in the HR system, create the AD account from HR attributes using the naming standard in the department OU, assign birthright access from the role matrix (not by copying a colleague), keep it disabled until the start date or set a temporary must-change password, run or wait for an Entra Connect delta sync so licensing and SSO apps follow, verify in Entra and the apps, and document it on the ticket.' },
    };
  },
  solve(w, s) {
    const p = s.params;
    if (s.twist === 'no-hr-record') {
      close(w, s.ticketIds[0]!, 'Rejected - Policy', 'No PeopleHub record exists for this person. Per IAM-SOP-001, no HR record means no account. Asked the manager to have HR enter the Pending Hire.');
      return;
    }
    createUser(w, { sam: p.sam!, givenName: p.first!, surname: p.last!, ou: deptOu(p.dept as Department), department: p.dept, title: roleFor(p.dept as Department, false).title, manager: p.manager, employeeId: p.employeeId, office: p.location, enabled: false, mustChangePassword: true });
    for (const g of birthright(p.role!)) addMember(w, g, p.sam!);
    if (s.twist === 'start-today') { resetPassword(w, p.sam!, { mustChange: true }); setEnabled(w, p.sam!, true); }
    syncAll(w);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `Created ${p.sam} from PeopleHub ${p.employeeId}; birthright groups per matrix; delta sync run and verified in Entra ID.`);
  },
  naive(w, s) {
    const p = s.params;
    if (s.twist === 'no-hr-record') {
      createUser(w, { sam: p.sam!, givenName: p.sam!, surname: 'x', ou: deptOu(p.dept as Department), enabled: false });
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Created the account as the manager asked.');
      return;
    }
    if (s.twist === 'mirror-request') {
      createUser(w, { sam: p.sam!, givenName: p.first!, surname: p.last!, ou: deptOu(p.dept as Department), department: p.dept, title: roleFor(p.dept as Department, false).title, manager: p.manager, employeeId: p.employeeId, enabled: false });
      for (const g of getUser(w, p.peer!).memberOf) addMember(w, g, p.sam!);
      syncAll(w);
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Copied access from the colleague as requested by the manager.');
    }
  },
};

// ------------------------------------------------------------------- Mover

export const mover: Template = {
  id: 'mover',
  title: 'Internal transfer',
  category: 'Mover',
  difficulty: 2,
  skills: ['Mover processing', 'Privilege creep prevention', 'RBAC / birthright access', 'Hybrid sync'],
  summary: 'Someone changes department. Their old access has to go the same day, or it becomes privilege creep.',
  twists: [
    { id: 'standard', label: 'Straight transfer' },
    { id: 'approved-exception', label: 'Owner-approved handover exception to keep' },
    { id: 'old-leftovers', label: 'Already carrying access from an earlier job' },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    const u = pickEmployee(ctx, (x) => !isLead(x));
    const from = u.department as Department;
    const to = pickDepartment({ ...ctx, department: undefined }, [from]);
    const newRole = roleFor(to, false);
    const newLead = leadOf(w, to);
    const hr = workerOf(w, u)!;
    const oldTitle = u.title;
    hr.department = to;
    hr.title = newRole.title;
    hr.managerId = newLead.employeeId;
    w.hr.transactions.push({ time: minutesAgo(120), employeeId: u.employeeId, type: 'Transfer', detail: `${oldTitle} (${from}) -> ${newRole.title} (${to})`, effective: nowIso() });
    const expected = birthright(newRole.group);
    let exception = '';
    let leftover = '';
    if (twist === 'approved-exception') {
      exception = u.memberOf.find((g) => !expected.includes(g) && !g.startsWith('role-')) ?? '';
      if (exception) expected.push(exception);
    }
    if (twist === 'old-leftovers') {
      leftover = rng.pick(['grp-hr-managers', 'grp-sec-ops', 'grp-finance-analysts', 'app-carechart', 'grp-radiology-pacs'].filter((g) => !expected.includes(g) && !u.memberOf.includes(g)));
      addMember(w, leftover, u.sam, 'MERIDIAN\\svc-provisioning');
    }
    const oldLead = leadOf(w, from);
    const exceptionOwner = exception ? (w.ad.groups.find((g) => g.name === exception)?.managedBy ?? oldLead.sam) : '';
    const t = openTicket(w, {
      type: 'Request', category: 'Transfer', priority: 3, caller: hrUser(w).displayName, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 100,
      short: `Transfer: ${u.displayName} — ${from} to ${to}, effective today`,
      description: `PeopleHub transfer transaction.\n\nWorker: ${u.displayName} (${u.employeeId})\nFrom: ${oldTitle}, ${from} (manager ${oldLead.displayName})\nTo: ${newRole.title}, ${to} (manager ${newLead.displayName})\nEffective: today\n\nPlease update their account and access per the JML SOP.${exception ? `\n\nApproved exception: keep ${exception} for 14 days for handover. Approved by the group owner (see approvals).` : ''}`,
      variables: { 'Worker': u.displayName, 'Employee ID': u.employeeId, 'New department': to, 'New title': newRole.title, 'New manager': newLead.displayName, ...(exception ? { 'Exception (14 days)': exception } : {}) },
      approvals: [
        { approver: hrUser(w).displayName, role: 'HR', state: 'Approved', time: minutesAgo(110) },
        ...(exception ? [{ approver: w.ad.users.find((x) => x.sam === exceptionOwner)?.displayName ?? oldLead.displayName, role: `Owner of ${exception}`, state: 'Approved' as const, time: minutesAgo(95) }] : []),
      ],
    });
    return {
      title: `Transfer ${u.displayName} from ${from} to ${to}`,
      ticketIds: [t.id], mailIds: [],
      params: { sam: u.sam, from, to, role: newRole.group, manager: newLead.sam, exception, leftover },
      checks: [
        check(`Moved to ${deptOu(to)}`, { k: 'adOu', sam: u.sam, ou: deptOu(to) }),
        check(`Title is ${newRole.title}`, { k: 'adAttr', sam: u.sam, attr: 'title', equals: newRole.title }),
        check(`Department is ${to}`, { k: 'adAttr', sam: u.sam, attr: 'department', equals: to }),
        check(`Manager is ${newLead.displayName}`, { k: 'adAttr', sam: u.sam, attr: 'manager', equals: newLead.sam }),
        check(`Groups are the ${newRole.title} birthright${exception ? ` plus the approved exception ${exception}` : ''}`, { k: 'adOnlyGroups', sam: u.sam, groups: expected }, true),
        ...(leftover ? [check(`Removed leftover ${leftover}`, { k: 'adMember', sam: u.sam, group: leftover, value: false } as const)] : []),
        ...(exception ? [check(`Kept owner-approved exception ${exception}`, { k: 'adMember', sam: u.sam, group: exception, value: true } as const, true)] : []),
        check('Entra ID reflects the change', { k: 'entraMatchesAd', sam: u.sam }),
        check('Ticket resolved as fulfilled', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'A transfer is two jobs: give the new access, and take the old access away. Which one do people forget?',
        `Compare ${u.sam}'s current groups with Birthright-Access-Matrix.csv for "${newRole.title}". Every group not on that row needs a reason to stay.`,
        `Update title/department/manager, move to ${deptOu(to)}, remove every group not in the new birthright${exception ? ` except ${exception}` : ''}, add the missing ones, then delta sync.`,
      ],
      debrief: `Movers are where privilege creep comes from: the new access is always requested, and the old access is rarely removed. The answer is to make the new job's birthright the target state and justify anything else.${exception ? ` ${exception} stays because its owner approved a time-boxed exception in the ticket; removing it would break an approved handover.` : ''}${leftover ? ` ${leftover} came from an earlier job and had no approval, so it goes.` : ''} Updating the manager matters too: access reviews and approvals route to the manager attribute.`,
      interview: { question: 'What is privilege creep and how do you prevent it in a mover process?', modelAnswer: 'Privilege creep is access accumulating as people change roles because old access is never removed. Prevent it by treating the new role\'s birthright as the target state: remove what the new role does not include on the transfer date, keep only owner-approved, time-boxed exceptions, update manager and attributes so reviews route correctly, and back it up with periodic access reviews.' },
    };
  },
  solve(w, s) {
    const p = s.params;
    const to = p.to as Department;
    setUser(w, p.sam!, { title: roleFor(to, false).title, department: to, manager: p.manager! });
    moveUser(w, p.sam!, deptOu(to));
    const target = new Set([...birthright(p.role!), ...(p.exception ? [p.exception] : [])]);
    for (const g of [...getUser(w, p.sam!).memberOf]) if (!target.has(g)) removeMember(w, g, p.sam!);
    for (const g of target) if (!getUser(w, p.sam!).memberOf.includes(g)) addMember(w, g, p.sam!);
    syncAll(w);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Updated attributes, moved OU, replaced role access with new birthright, kept only approved exceptions, synced.');
  },
};

// ------------------------------------------------------------------- Leaver

export const leaver: Template = {
  id: 'leaver',
  title: 'Employee offboarding',
  category: 'Leaver',
  difficulty: 2,
  skills: ['Leaver deprovisioning', 'Session revocation', 'SaaS deprovisioning', 'Audit evidence'],
  summary: 'Cut access everywhere: AD, Entra, Okta and the apps without SCIM. Disabling the account alone is not enough.',
  twists: [
    { id: 'voluntary', label: 'Voluntary leaver, last day today' },
    { id: 'involuntary', label: 'Involuntary termination with live sessions (P1)' },
    { id: 'finance-payroll', label: 'Finance leaver with a manual PayrollPro account' },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    const u = pickEmployee(twist === 'finance-payroll' ? { ...ctx, department: 'Finance' } : ctx, (x) => !isLead(x) && (twist !== 'finance-payroll' || x.memberOf.includes('app-payrollpro')));
    const hr = workerOf(w, u)!;
    hr.status = 'Terminated';
    hr.termDate = nowIso();
    hr.termType = twist === 'involuntary' ? 'Involuntary' : 'Voluntary';
    w.hr.transactions.push({ time: minutesAgo(twist === 'involuntary' ? 12 : 240), employeeId: u.employeeId, type: 'Termination', detail: `${hr.termType} termination`, effective: nowIso() });
    const e = findEntraUser(w, u.upn);
    if (twist === 'involuntary' && e) {
      e.sessions.push({ issued: minutesAgo(6), app: 'SharePoint Online', device: 'Windows 11 · Edge' }, { issued: minutesAgo(3), app: 'Outlook Mobile', device: 'iOS' });
      addSignIn(w, { time: minutesAgo(3), upn: u.upn, app: 'SharePoint Online', ip: '198.51.100.23', location: 'Boston, US', device: 'iOS', result: 'Success', failureReason: '', mfa: 'Satisfied', ca: 'Success', risk: 'none' });
      addSignIn(w, { time: minutesAgo(2), upn: u.upn, app: 'SharePoint Online', ip: '198.51.100.23', location: 'Boston, US', device: 'iOS', result: 'Success', failureReason: '', mfa: 'Not required', ca: 'Success', risk: 'none' });
    }
    const hrp = hrUser(w);
    const t = openTicket(w, {
      type: 'Request', category: 'Offboarding', priority: twist === 'involuntary' ? 1 : 3, caller: hrp.displayName, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: twist === 'involuntary' ? 8 : 200,
      short: twist === 'involuntary' ? `CONFIDENTIAL — Immediate termination: ${u.displayName}` : `Offboarding: ${u.displayName} — last day today`,
      description: twist === 'involuntary'
        ? `CONFIDENTIAL. ${u.displayName} (${u.employeeId}, ${u.title}) is being terminated right now. HR and their manager are in the meeting.\n\nRemove all access immediately. They were on SharePoint a few minutes ago and are still holding their phone.\n\nDo not contact the employee.`
        : `PeopleHub termination transaction.\n\nWorker: ${u.displayName} (${u.employeeId})\nTitle: ${u.title}, ${u.department}\nLast working day: today\nReason: Voluntary resignation\n\nPlease offboard at end of day per the JML SOP.`,
      variables: { 'Worker': u.displayName, 'Employee ID': u.employeeId, 'Termination type': hr.termType, 'Effective': fmtDate(nowIso()) },
      approvals: [{ approver: hrp.displayName, role: 'HR', state: 'Approved', time: minutesAgo(10) }],
    });
    const mailIds: string[] = [];
    if (twist === 'involuntary') {
      mailIds.push(deliverMail(w, { from: `${hrp.sam}@meridianhealth.test`, fromName: hrp.displayName, minutesAgo: 7, subject: `URGENT ${t.id}`, body: `Admin, please action ${t.id} right now. ${u.givenName} is in the room with us and we expect them to try to download files when they leave. Thanks. ${hrp.givenName}` }).id);
    }
    const payroll = w.saas.find((a) => a.id === 'payrollpro')!.accounts.find((a) => a.login === u.upn && a.active);
    const scimApps = w.saas.filter((a) => a.provisioning !== 'Manual' && a.accounts.some((x) => x.login === u.upn && x.active));
    void rng;
    return {
      title: twist === 'involuntary' ? `Immediate termination: ${u.displayName}` : `Offboard ${u.displayName}`,
      ticketIds: [t.id], mailIds,
      params: { sam: u.sam, upn: u.upn, payroll: payroll ? 'yes' : 'no' },
      checks: [
        check('AD account disabled', { k: 'adEnabled', sam: u.sam, value: false }, true),
        check('Account kept, not deleted (30-day retention)', { k: 'adExists', sam: u.sam, value: true }, true),
        check('All group memberships removed (Domain Users stays)', { k: 'adOnlyGroups', sam: u.sam, groups: [] }),
        check(`Description records the ticket (${t.id})`, { k: 'adAttr', sam: u.sam, attr: 'description', contains: t.id }),
        check(`Moved to ${DISABLED_OU}`, { k: 'adOu', sam: u.sam, ou: DISABLED_OU }),
        check('Entra ID account disabled (synced)', { k: 'entraEnabled', upn: u.upn, value: false }),
        check('Entra ID sign-in sessions revoked', { k: 'entraSessionsRevokedSince', upn: u.upn, since: ctx.started }, twist === 'involuntary'),
        check('Okta user deactivated', { k: 'oktaStatus', login: u.upn, statuses: ['DEPROVISIONED', 'SUSPENDED'] }),
        ...(twist === 'involuntary' ? [check('Okta sessions cleared', { k: 'oktaSessionsClearedSince', login: u.upn, since: ctx.started } as const)] : []),
        ...(payroll ? [check('PayrollPro account deactivated by hand (no SCIM)', { k: 'saasActive', app: 'payrollpro', login: u.upn, value: false } as const, true)] : []),
        ...scimApps.map((a) => check(`${a.name} account deprovisioned by SCIM`, { k: 'saasActive', app: a.id, login: u.upn, value: false } as const)),
        check('Ticket resolved as fulfilled', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'Where can this person still get in? List every system, not just AD.',
        'Disabling AD does not end existing cloud sessions, and a disable only reaches Entra and Okta after a sync or import. Check Application-Catalog.csv for apps without SCIM.',
        `Disable ${u.sam}, revoke Entra sessions (and clear Okta sessions), strip groups, set the description with ${t.id}, move to Disabled Users, sync, then deactivate anything Manual${payroll ? ' (PayrollPro)' : ''}.`,
      ],
      debrief: `A leaver is only done when every route in is closed. Disabling AD stops new Kerberos logons, but refresh tokens in Entra and Okta sessions stay valid until they are revoked, and the change itself only reaches the cloud after a sync.${twist === 'involuntary' ? ' For an involuntary termination, revoking sessions is part of the first five minutes: the sign-in log showed SharePoint access minutes ago.' : ''}${payroll ? ' PayrollPro has no SCIM connector, so it is invisible to the identity provider: this is the most common leaver finding in an audit.' : ''} Keeping the object (disabled, described, moved) preserves the audit trail and the mailbox for 30 days.`,
      interview: { question: 'A user was disabled in AD an hour ago but is still reading email on their phone. Why, and what do you do?', modelAnswer: 'Disabling AD blocks new on-premises authentication, but the cloud only learns about it after an Entra Connect sync, and existing refresh tokens and app sessions stay valid until revoked. Force a delta sync, revoke Entra sign-in sessions and clear Okta sessions, then check the SaaS apps, especially ones without SCIM, and confirm in the sign-in logs that access stopped.' },
    };
  },
  solve(w, s) {
    const { sam, upn } = s.params as { sam: string; upn: string };
    const ticket = s.ticketIds[0]!;
    setEnabled(w, sam, false);
    syncAll(w);
    revokeSessions(w, upn);
    if (s.twist === 'involuntary') oktaClearSessions(w, upn);
    for (const g of [...getUser(w, sam).memberOf]) removeMember(w, g, sam);
    setUser(w, sam, { description: `Disabled ${nowIso().slice(0, 10)} per ${ticket}` });
    moveUser(w, sam, DISABLED_OU);
    syncAll(w);
    if (s.params.payroll === 'yes') setSaasAccount(w, 'payrollpro', upn, false);
    close(w, ticket, 'Solved (Fulfilled)', 'Disabled, revoked sessions, removed groups, moved to Disabled Users, synced, PayrollPro deactivated manually.');
  },
  naive(w, s) {
    setEnabled(w, s.params.sam!, false);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Disabled the account in Active Directory.');
  },
};
