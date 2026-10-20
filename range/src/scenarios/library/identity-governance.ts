/**
 * Identity governance (IGA): aggregation and correlation of application
 * accounts, and a source-owner certification campaign at scale.
 */
import { daysAgo, daysFromNow, fmtDate, nowIso } from '../../core/time.ts';
import { DEPARTMENTS, roleByTitle } from '../../world/company.ts';
import { addMember, getUser } from '../../world/directory.ts';
import { setSaasAccount } from '../../world/cloud.ts';
import { nextEmployeeId, openTicket } from '../../world/itsm.ts';
import { ensurePolicyDocs } from '../../world/docs.ts';
import { addException, aggregate, correlate, createSourceCampaign, decide, disableAccount, ensureIga, getCampaign, signOff } from '../../world/iga.ts';
import { type Built, type Template, check, close, isLead, pickEmployee, securityUser, workerOf } from '../template.ts';

const MAIDEN = ['Okoro', 'Lindahl', 'Brennan', 'Moreau', 'Haddad', 'Varga', 'Petrov'];
const ORPHAN = 'agency.rn07@meridianhealth.test';

// ------------------------------------------------------------------- Uncorrelated accounts

export const igaCorrelation: Template = {
  id: 'iga-uncorrelated',
  title: 'Uncorrelated accounts after aggregation',
  category: 'Governance',
  difficulty: 2,
  skills: ['IGA aggregation', 'Account correlation', 'Orphan account remediation', 'SailPoint / Saviynt concepts'],
  summary: 'CareChart has just been connected to identity governance. Aggregate it, decide who each uncorrelated account belongs to, and remove the ones that belong to nobody.',
  twists: [
    { id: 'name-change', label: 'A legacy account under a previous surname, and an agency account' },
    { id: 'name-collision', label: 'An account with an active employee\'s name but a former employee\'s ID', trap: true },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    ensureIga(w);
    ensurePolicyDocs(w);
    const cc = w.saas.find((a) => a.id === 'carechart')!;
    cc.accounts.push({ login: ORPHAN, displayName: 'Agency RN 07', role: 'Clinician', active: true, lastLogin: daysAgo(rng.int(35, 60)), managedBy: 'Manual' });
    let subject: { login: string; displayName: string; employeeId: string; personSam: string; formerName?: string };
    if (twist === 'name-change') {
      const u = pickEmployee({ ...ctx, department: 'Radiology' }, (x) => x.department === 'Radiology' && !isLead(x));
      const maiden = rng.pick(MAIDEN.filter((m) => m !== u.surname));
      const login = `${u.givenName.toLowerCase()}.${maiden.toLowerCase()}@meridianhealth.test`;
      cc.accounts.push({ login, displayName: `${u.givenName} ${maiden}`, role: 'Clinician', active: true, lastLogin: daysAgo(rng.int(1, 6)), managedBy: 'Manual', employeeId: u.employeeId });
      subject = { login, displayName: `${u.givenName} ${maiden}`, employeeId: u.employeeId, personSam: u.sam, formerName: maiden };
    } else {
      const u = pickEmployee({ ...ctx, department: 'Nursing' }, (x) => x.department === 'Nursing' && !isLead(x));
      const hr = workerOf(w, u)!;
      const formerId = nextEmployeeId(w);
      w.hr.workers.push({ employeeId: formerId, first: u.givenName, last: u.surname, department: 'Nursing', title: 'Registered Nurse', managerId: hr.managerId, location: 'Worcester Medical Center', status: 'Terminated', hireDate: daysAgo(2400), termDate: daysAgo(230), termType: 'Voluntary', phoneLast4: String(rng.int(1000, 9999)), workerType: 'Employee' });
      w.hr.transactions.push({ time: daysAgo(231), employeeId: formerId, type: 'Termination', detail: 'Voluntary resignation', effective: daysAgo(230) });
      const login = `${u.givenName.toLowerCase()}.${u.surname.toLowerCase()}@meridianhealth.test`;
      cc.accounts.push({ login, displayName: `${u.givenName} ${u.surname}`, role: 'Charge Nurse', active: true, lastLogin: daysAgo(rng.int(228, 240)), managedBy: 'Manual', employeeId: formerId });
      subject = { login, displayName: `${u.givenName} ${u.surname}`, employeeId: formerId, personSam: u.sam };
    }
    const t = openTicket(w, {
      type: 'Request', category: 'Identity Governance', priority: 3, caller: securityUser(w).displayName, scenarioId: ctx.id, openedMinutesAgo: 240,
      short: 'CareChart onboarded to identity governance: review uncorrelated accounts',
      description: `CareChart EHR is now connected to the governance platform (https://iga.meridianhealth.test). Its first aggregation has not run since the vendor imported their legacy user list.\n\nPlease:\n1. Aggregate the CareChart source.\n2. Resolve every uncorrelated account per IAM-SOP-006 (Documents\\Policies\\Identity-Governance-and-Certification-Procedure.md).\n3. Remove anything that belongs to nobody or to someone who should not have access.\n4. Record each decision here.`,
    });
    const terminated = twist === 'name-collision';
    return {
      title: 'Uncorrelated CareChart accounts',
      ticketIds: [t.id], mailIds: [],
      params: { sam: subject.personSam, login: subject.login, employeeId: subject.employeeId },
      checks: [
        check('CareChart aggregated during this lab', { k: 'igaAggregatedSince', source: 'carechart', since: ctx.started }),
        check(`${subject.login} correlated by employee ID to ${subject.employeeId}${terminated ? ' (the former employee, not the namesake)' : ''}`, { k: 'igaCorrelation', source: 'carechart', account: subject.login, employeeId: subject.employeeId }, true),
        terminated
          ? check(`${subject.login} disabled: it belongs to a terminated worker`, { k: 'saasActive', app: 'carechart', login: subject.login, value: false }, true)
          : check(`${subject.login} left active: it is ${subject.displayName.split(' ')[0]}'s working account`, { k: 'saasActive', app: 'carechart', login: subject.login, value: true }, true),
        check(`${ORPHAN} marked as belonging to no identity`, { k: 'igaCorrelation', source: 'carechart', account: ORPHAN, employeeId: '' }),
        check(`${ORPHAN} disabled`, { k: 'saasActive', app: 'carechart', login: ORPHAN, value: false }, true),
        check('Decisions recorded on the ticket', { k: 'ticketNote', ticket: t.id, anyOf: ['agency', ORPHAN, 'orphan'] }),
        check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'Governance only knows what it last aggregated. Start at Sources > CareChart EHR > Aggregate, then open Uncorrelated accounts.',
        terminated
          ? `${subject.login} has the same name as a current nurse. Read the employee ID the account carries and look that ID up under Identities. Is it the same person?`
          : `${subject.login} carries an employee ID. Look it up under Identities: who is that, and did their surname change?`,
        terminated
          ? `Correlate ${subject.login} to ${subject.employeeId} (a former employee, Terminated) and disable it. Mark ${ORPHAN} as no identity and disable it. Note both decisions.`
          : `Correlate ${subject.login} to ${subject.employeeId} and leave it active. Mark ${ORPHAN} as no identity and disable it. Note both decisions.`,
      ],
      debrief: terminated
        ? `The account carries employee ID ${subject.employeeId}, which belongs to a nurse who resigned months ago and happened to share a name with a current colleague. Correlating by name would have handed a former employee's Charge Nurse account to the wrong person and kept it alive. Correlation is done on a unique key (employee ID), never a display name. The agency account belonged to nobody, so it is disabled: shared and agency accounts with no owner are exactly how unattributable access to patient records happens.`
        : `The account was created under ${subject.displayName.split(' ')[0]}'s previous surname, ${subject.formerName}, before CareChart was connected, so the login no longer matches her UPN and the correlation rule could not link it. The employee ID it carries proves who it belongs to; correlating it makes her access visible to every future review. The agency account had no owner at all and is disabled.`,
      interview: { question: 'What is an uncorrelated (orphan) account in IGA, and how do you deal with them?', modelAnswer: 'After aggregation the platform links each account to an identity with a correlation rule, usually on employee ID or login. Accounts it cannot link are uncorrelated. Investigate each on a unique key: correlate it to the right identity if it is theirs (then their access is reviewable), and disable it if it belongs to nobody or to a terminated worker. Fix the cause too: stop creating accounts outside the provisioning process.' },
    };
  },
  solve(w, s) {
    aggregate(w, 'carechart');
    correlate(w, 'carechart', s.params.login!, s.params.employeeId!);
    if (s.twist === 'name-collision') disableAccount(w, 'carechart', s.params.login!);
    correlate(w, 'carechart', ORPHAN, '');
    disableAccount(w, 'carechart', ORPHAN);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `Aggregated CareChart. ${s.params.login} correlated to ${s.params.employeeId}${s.twist === 'name-collision' ? ' (terminated former employee) and disabled' : ''}. ${ORPHAN}: agency account with no identity, disabled.`);
  },
  naive(w, s) {
    aggregate(w, 'carechart');
    correlate(w, 'carechart', s.params.login!, getUser(w, s.params.sam!).employeeId);
    correlate(w, 'carechart', ORPHAN, '');
    disableAccount(w, 'carechart', ORPHAN);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Correlated by name; agency account disabled.');
  },
};

// ------------------------------------------------------------------- Certification campaign at scale

export const certCampaign: Template = {
  id: 'cert-campaign',
  title: 'Certification campaign at scale',
  category: 'Governance',
  difficulty: 3,
  skills: ['Certification campaigns', 'Risk-based review (flags, filters, bulk decisions)', 'SoD remediation', 'Manual remediation for disconnected apps'],
  summary: 'You are the source owner for Active Directory. Certify every group membership in three departments, sign off, and finish the remediation the platform cannot do for you.',
  twists: [
    { id: 'quarterly', label: 'Quarterly source-owner campaign, 100+ items' },
    { id: 'due-today', label: 'Due in three hours, and there is an Approve All button', trap: true },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    ensureIga(w);
    ensurePolicyDocs(w);
    const others = rng.shuffle(DEPARTMENTS.filter((d) => d !== 'Finance' && d !== 'Security')).slice(0, 2);
    const scope = ['Finance', ...others];
    const finance = (pred: (s: string) => boolean): ReturnType<typeof pickEmployee> =>
      pickEmployee({ ...ctx, department: 'Finance' }, (x) => x.department === 'Finance' && !isLead(x) && x.memberOf.includes('grp-payroll-submit') && pred(x.sam));
    // 1. A leaver HR has processed but IAM has not: access still live, including the manual PayrollPro account.
    const term = finance(() => true);
    const tw = workerOf(w, term)!;
    tw.status = 'Terminated';
    tw.termDate = daysAgo(1);
    tw.termType = 'Voluntary';
    w.hr.transactions.push({ time: daysAgo(2), employeeId: term.employeeId, type: 'Termination', detail: 'Voluntary resignation (offboarding ticket still in the queue)', effective: daysAgo(1) });
    // 2. A toxic combination.
    const sod = finance((s) => s !== term.sam);
    addMember(w, 'grp-payroll-approve', sod.sam, 'MERIDIAN\\svc-provisioning');
    // 3. Privilege creep, and 4. an approved exception that must survive.
    const creep = pickEmployee({ ...ctx, department: others[0] }, (x) => x.department === others[0] && !isLead(x));
    const pool = ['grp-hr-managers', 'grp-finance-analysts', 'grp-helpdesk-tier1', 'grp-radiology-pacs', 'grp-sec-ops', 'grp-hr-readers', 'app-imagevault'];
    const creepGroups = rng.shuffle(pool.filter((g) => !creep.memberOf.includes(g))).slice(0, 2);
    for (const g of creepGroups) addMember(w, g, creep.sam, 'MERIDIAN\\svc-provisioning');
    const exc = pickEmployee({ ...ctx, department: others[1] }, (x) => x.department === others[1] && !isLead(x) && x.sam !== creep.sam);
    const excGroup = rng.pick(pool.filter((g) => !exc.memberOf.includes(g) && !creepGroups.includes(g)));
    addMember(w, excGroup, exc.sam, 'MERIDIAN\\svc-provisioning');
    const excId = `EXC-${rng.int(2000, 8999)}`;
    const owner = w.ad.groups.find((g) => g.name === excGroup)?.managedBy;
    addException(w, { id: excId, employeeId: exc.employeeId, entitlement: excGroup, approvedBy: owner ? getUser(w, owner).displayName : 'Group owner', expires: daysFromNow(60), reason: 'Cross-department project, approved by the group owner' });

    const due = twist === 'due-today' ? new Date(Date.parse(nowIso()) + 3 * 3_600_000).toISOString() : daysFromNow(9);
    const c = createSourceCampaign(w, {
      name: `Q4 Active Directory source-owner certification (${scope.join(', ')})`, departments: scope, reviewer: w.player.sam, due,
      description: `Every Active Directory group membership held by people in ${scope.join(', ')}. You are the source owner for Active Directory.`,
    });
    const t = openTicket(w, {
      type: 'Request', category: 'Identity Governance', priority: twist === 'due-today' ? 2 : 3, caller: securityUser(w).displayName, scenarioId: ctx.id, openedMinutesAgo: twist === 'due-today' ? 60 * 24 * 12 : 60 * 3,
      short: `${c.id}: certify ${c.items.length} Active Directory access items${twist === 'due-today' ? ' (DUE TODAY)' : ''}`,
      description: `Campaign ${c.id} is assigned to you as the Active Directory source owner: ${c.items.length} items for ${scope.join(', ')}.\n\nOpen it in Governance (https://iga.meridianhealth.test) > Certifications. Decide every item per IAM-SOP-006, sign off, and complete any manual work items it raises. Then resolve this ticket with a summary of what you revoked.${twist === 'due-today' ? `\n\nAudit needs this signed off by ${fmtDate(due)}. Internal Audit will sample the decisions.` : ''}`,
    });
    return {
      title: `Certification campaign: ${c.items.length} items`,
      ticketIds: [t.id], mailIds: [],
      params: { sams: [term.sam, sod.sam, creep.sam, exc.sam].join(','), campaign: c.id, termSam: term.sam, termUpn: term.upn, sodSam: sod.sam, creep: `${creep.sam}:${creepGroups.join('|')}`, exception: `${exc.sam}:${excGroup}:${excId}` },
      checks: [
        check(`${c.id} signed off`, { k: 'certSignedOff', campaign: c.id }, true),
        check(`Terminated ${term.sam}: job access revoked`, { k: 'adMember', sam: term.sam, group: roleByTitle(term.title)!.group, value: false }, true),
        check(`Terminated ${term.sam}: app-payrollpro revoked`, { k: 'adMember', sam: term.sam, group: 'app-payrollpro', value: false }),
        check(`Manual work item done: ${term.upn}'s PayrollPro account deactivated`, { k: 'saasActive', app: 'payrollpro', login: term.upn, value: false }, true),
        check(`SoD: grp-payroll-approve revoked from ${sod.sam}`, { k: 'adMember', sam: sod.sam, group: 'grp-payroll-approve', value: false }, true),
        check(`SoD: ${sod.sam} keeps grp-payroll-submit (the right that belongs to the job)`, { k: 'adMember', sam: sod.sam, group: 'grp-payroll-submit', value: true }, true),
        ...creepGroups.map((g) => check(`Out-of-role ${g} revoked from ${creep.sam}`, { k: 'adMember', sam: creep.sam, group: g, value: false } as const)),
        check(`Exception ${excId} honoured: ${exc.sam} keeps ${excGroup}`, { k: 'adMember', sam: exc.sam, group: excGroup, value: true }, true),
        ...[sod, creep, exc].map((u) => check(`${u.sam} keeps their job role (no blanket revocation)`, { k: 'adMember', sam: u.sam, group: roleByTitle(u.title)!.group, value: true } as const, true)),
        check('Ticket resolved with a summary', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        `${c.items.length} items is too many to read one by one, and too many to approve blindly. Filter by flag: Terminated, SoD, Outside role, Exception.`,
        'Revoke everything for the terminated identity, the approve side of the SoD conflict, and Outside role items. Approve exceptions that are on file and in date, and everything that matches a role. Then sign off.',
        `Sign-off raises a manual work item: PayrollPro has no connector. Deactivate ${term.upn} in SaaS apps > PayrollPro, then resolve the work item and this ticket.`,
      ],
      debrief: `The campaign had ${c.items.length} lines and four that mattered: a leaver HR processed yesterday whose access was still live, a toxic payroll combination, privilege creep, and an approved exception that looks exactly like creep until you check the exception register. Bulk approval would have certified all of it, which auditors call rubber-stamping. Sign-off provisioned the AD revocations, but PayrollPro has no connector, so its account stayed active until a person removed it. Remediation is not finished when the campaign closes; it is finished when the access is gone.`,
      interview: { question: 'How do you run a certification campaign that actually reduces risk at scale?', modelAnswer: 'Scope it so reviewers can cope, and give them context: flags for terminated identities, SoD conflicts, access outside the role, privileged and dormant access, with approved exceptions shown. Reviewers revoke what is not justified rather than approving in bulk, and the platform measures that (revocation rate, time per decision). After sign-off, verify remediation: connected sources are provisioned automatically, disconnected apps generate manual work items that must be tracked to closure. Keep the decisions as audit evidence.' },
    };
  },
  solve(w, s) {
    const c = getCampaign(w, s.params.campaign!);
    const mine = new Set(s.params.sams!.split(','));
    const [excSam, excGroup] = s.params.exception!.split(':');
    const revoke = c.items.filter((i) => {
      if (!mine.has(i.account)) return false;
      if (i.account === s.params.termSam) return true;
      if (i.account === s.params.sodSam) return i.entitlement === 'grp-payroll-approve';
      if (i.account === excSam) return i.entitlement !== excGroup && i.flags.includes('Outside role');
      return i.flags.includes('Outside role');
    });
    const ids = new Set(revoke.map((i) => i.id));
    decide(w, c.id, revoke.map((i) => i.id), 'revoke', 'Not justified: terminated, SoD conflict or outside role.');
    decide(w, c.id, c.items.filter((i) => !ids.has(i.id)).map((i) => i.id), 'approve', 'Matches role or approved exception.');
    const { manual } = signOff(w, c.id);
    setSaasAccount(w, 'payrollpro', s.params.termUpn!, false);
    for (const id of manual) close(w, id, 'Solved (Fulfilled)', 'Account deactivated in PayrollPro.');
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `${c.id} signed off. Revoked: all access for terminated ${s.params.termSam}; grp-payroll-approve from ${s.params.sodSam} (SoD-001); out-of-role groups from ${s.params.creep}. Kept ${s.params.exception} (exception on file). PayrollPro manual work item completed.`);
  },
  naive(w, s) {
    const c = getCampaign(w, s.params.campaign!);
    decide(w, c.id, c.items.map((i) => i.id), 'approve', 'Approved.');
    signOff(w, c.id);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Campaign completed on time.');
  },
};
