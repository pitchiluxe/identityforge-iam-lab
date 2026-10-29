/**
 * scenarios/msp/cloud.ts — Entra and Azure tickets an MSP works in the lab
 * Azure portal: MFA re-registration (behind PIM), licences, Azure RBAC, guests,
 * and a role request the MSP must hand to the customer.
 */
import { daysAgo, minutesAgo } from '../../core/time.ts';
import { activateRole } from '../../world/pim.ts';
import { requireReregisterAs } from '../../world/authMethods.ts';
import { assignLicense, inviteGuest, P2, updateCloudUser } from '../../world/entraAdmin.ts';
import { addRoleAssignment, ensureAzure, scopeOf } from '../../world/azure.ts';
import { openTicket } from '../../world/itsm.ts';
import { escalateTicket } from '../../world/servicenow.ts';
import { check, close, type Built } from '../template.ts';
import { executive, hasStaff, leadOf, mspUpn, pickStaff } from './common.ts';
import type { MspTemplate } from './lifecycle.ts';

const entraOf = (w: import('../../core/types.ts').World, upn: string) => w.entra.users.find((e) => e.upn === upn);

export const mspMfaReset: MspTemplate = {
  id: 'msp-mfa-reset', title: 'MFA re-registration (new phone)', category: 'Authentication', difficulty: 2,
  skills: ['Identity verification', 'PIM activation', 'MFA administration'],
  summary: 'Verify the caller, activate Authentication Administrator through PIM, and require MFA re-registration.',
  twists: [{ id: 'standard', label: 'Lost phone' }],
  fits: (w) => hasStaff(w) && w.entra.users.some((e) => e.source === 'synced' && e.accountEnabled),
  build(ctx): Built {
    const { w } = ctx;
    const u = pickStaff(ctx, (x) => !!entraOf(ctx.w, x.upn)?.accountEnabled);
    const e = entraOf(w, u.upn)!;
    if (!e.mfaMethods.length) e.mfaMethods = [{ type: 'Microsoft Authenticator', detail: 'Old phone', added: daysAgo(400) }];
    const last4 = w.hr.workers.find((x) => x.employeeId === u.employeeId)!.phoneLast4;
    const t = openTicket(w, {
      type: 'Incident', category: 'Authentication', priority: 2, caller: u.displayName, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 20,
      short: 'New phone - can\'t get my Authenticator codes',
      description: `Hi, I got a new phone over the weekend and the Authenticator app didn't move across, so I can't sign in. Can you reset my MFA so I can set it up again?\n\nMy employee ID is ${u.employeeId} and the last four digits of the phone number HR has for me are ${last4}.\n\n${u.displayName}`,
    });
    return {
      title: `MFA reset for ${u.displayName}`, ticketIds: [t.id], mailIds: [], params: { upn: u.upn },
      checks: [
        check('MFA methods cleared for re-registration', { k: 'entraMfaClearedSince', upn: u.upn, since: ctx.started, value: true }, true),
        check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }, true),
      ],
      hints: ['Check the caller against HR first (employee ID and phone last 4).', 'You need Authentication Administrator: activate it in Privileged Identity Management with the ticket number as justification.', 'Then on the user: Authentication methods > Require re-register multifactor authentication.'],
      debrief: 'An MFA reset hands a stranger the account if the caller is not who they say. Verify against HR data first, use just-in-time privilege (PIM) with the ticket as justification, and require re-registration rather than adding a method yourself.',
      interview: { question: 'Why is MFA reset one of the riskiest service desk tasks?', modelAnswer: 'It is the step that defeats MFA: attackers social-engineer the desk into resetting it. Strong caller verification, least privilege via PIM, and auditing every reset are the controls.' },
    };
  },
  solve(w, s) {
    const me = mspUpn(w);
    activateRole(w, me, 'Authentication Administrator', 1, `${s.ticketIds[0]} MFA reset`);
    requireReregisterAs(w, me, s.params.upn!);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Verified caller against HR (employee ID, phone last 4); activated Authentication Administrator via PIM; required MFA re-registration.');
  },
};

export const mspLicense: MspTemplate = {
  id: 'msp-license', title: 'Licence for a security reviewer', category: 'Access Request', difficulty: 1,
  skills: ['Licensing', 'Entra ID'],
  summary: 'Assign Microsoft Entra ID P2 to a user (they need a usage location first).',
  twists: [{ id: 'standard', label: 'P2 for access reviews' }],
  fits: (w) => hasStaff(w) && w.entra.users.some((e) => e.source === 'synced' && e.accountEnabled),
  build(ctx): Built {
    const { w } = ctx;
    const u = pickStaff(ctx, (x) => !!entraOf(ctx.w, x.upn)?.accountEnabled && !entraOf(ctx.w, x.upn)!.licenses.includes(P2));
    const mgr = leadOf(w, u.department) ?? executive(w);
    const t = openTicket(w, {
      type: 'Request', category: 'Licensing', priority: 4, caller: mgr.displayName, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 240,
      short: `Entra ID P2 licence for ${u.displayName}`,
      description: `${u.displayName} is running our quarterly access reviews from next week and needs a Microsoft Entra ID P2 licence for it. Approved by me as their manager.\n\n${mgr.displayName}`,
      approvals: [{ approver: mgr.displayName, role: 'Manager', state: 'Approved', time: minutesAgo(230) }],
    });
    return {
      title: `P2 licence for ${u.displayName}`, ticketIds: [t.id], mailIds: [], params: { upn: u.upn },
      checks: [check(`${P2} assigned`, { k: 'entraLicense', upn: u.upn, sku: P2, value: true }, true), check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }, true)],
      hints: ['Azure portal > Users > the user > Licenses.', 'A licence needs a usage location: set it under Edit properties first.'],
      debrief: 'Licences are assigned in the cloud even for synced users, and Microsoft requires a usage location before any licence can be assigned. Check available seats before promising a date.',
      interview: { question: 'Why does a licence assignment fail with "invalid usage location"?', modelAnswer: 'Services are licensed per country; the user needs a usage location set before Entra will assign the licence.' },
    };
  },
  solve(w, s) {
    const me = mspUpn(w);
    updateCloudUser(w, me, s.params.upn!, { usageLocation: 'US' });
    assignLicense(w, me, s.params.upn!, P2, true);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Set usage location and assigned Microsoft Entra ID P2.');
  },
};

export const mspRbac: MspTemplate = {
  id: 'msp-rbac-reader', title: 'Read access for an auditor', category: 'Access Request', difficulty: 2,
  skills: ['Azure RBAC', 'Least privilege'],
  summary: 'Give an internal auditor read-only access to one resource group.',
  twists: [{ id: 'standard', label: 'Read access' }, { id: 'asks-contributor', label: 'Asks for Contributor "to look around"', trap: true }],
  fits: (w) => hasStaff(w) && w.entra.users.some((e) => e.source === 'synced' && e.accountEnabled),
  build(ctx): Built {
    const { w, twist } = ctx;
    const a = ensureAzure(w);
    const rg = a.resourceGroups.find((g) => /prod-apps/.test(g.name)) ?? a.resourceGroups[0]!;
    const u = pickStaff(ctx, (x) => !!entraOf(ctx.w, x.upn)?.accountEnabled);
    const exec = executive(w);
    const scope = scopeOf({ subscription: rg.subscription, rg: rg.name });
    const t = openTicket(w, {
      type: 'Request', category: 'Access', priority: 3, caller: exec.displayName, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 180,
      short: `Azure access for ${u.displayName} (audit)`,
      description: `${u.displayName} is reviewing our production applications for the annual audit. Please give them access to the resource group ${rg.name} so they can see how it is set up.${twist === 'asks-contributor' ? ' Contributor is probably easiest so they can look around properly.' : ' They only need to look, not change anything.'}\n\n${exec.displayName}`,
      approvals: [{ approver: exec.displayName, role: 'Business owner', state: 'Approved', time: minutesAgo(170) }],
    });
    return {
      title: `Audit access for ${u.displayName}`, ticketIds: [t.id], mailIds: [], params: { upn: u.upn, scope },
      checks: [
        check(`Reader on ${rg.name}`, { k: 'azureRole', principal: u.upn, role: 'Reader', scope, value: true }, true),
        check('No Contributor (least privilege)', { k: 'azureRole', principal: u.upn, role: 'Contributor', scope, value: false }, true),
        check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }, true),
      ],
      hints: ['Resource groups > the group > Access control (IAM) > Add role assignment.', 'Reviewing is reading: Reader is enough. Contributor can change and delete resources.'],
      debrief: 'Grant the least role at the narrowest scope that does the job. An auditor who only looks needs Reader on that resource group, not Contributor, and not anything at subscription level.',
      interview: { question: 'A business owner asks for Contributor so an auditor can "look around". What do you assign?', modelAnswer: 'Reader on the specific resource group, explaining that Contributor allows changes and deletion. Least privilege, narrowest scope.' },
    };
  },
  solve(w, s) {
    addRoleAssignment(w, mspUpn(w), s.params.upn!, 'Reader', s.params.scope!);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Assigned Reader on the resource group (least privilege for a review).');
  },
  naive(w, s) {
    addRoleAssignment(w, mspUpn(w), s.params.upn!, 'Contributor', s.params.scope!);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Assigned Contributor as requested.');
  },
};

export const mspGuest: MspTemplate = {
  id: 'msp-guest', title: 'Invite a partner guest', category: 'Access Request', difficulty: 1,
  skills: ['B2B collaboration', 'External identities'],
  summary: 'Invite an external collaborator as a guest.',
  twists: [{ id: 'standard', label: 'Partner collaborator' }],
  fits: hasStaff,
  build(ctx): Built {
    const { w, rng } = ctx;
    const owner = pickStaff(ctx, (_x, r) => r.lead);
    const first = rng.pick(['Jordan', 'Sam', 'Alex', 'Robin', 'Casey']), last = rng.pick(['Meyer', 'Novak', 'Brooks', 'Iyer', 'Moreau']);
    const domain = rng.pick(['northbridge-partners.test', 'clearwater-consulting.test', 'apexaudit.test']);
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`;
    const t = openTicket(w, {
      type: 'Request', category: 'Access', priority: 3, caller: owner.displayName, requestedFor: `${first} ${last}`, scenarioId: ctx.id, openedMinutesAgo: 90,
      short: `Guest access for ${first} ${last} (${domain})`,
      description: `We've started a project with ${domain}. Please invite ${first} ${last} (${email}) as a guest so they can join our Teams and shared files. The engagement letter is signed.\n\n${owner.displayName}, ${owner.title}`,
      approvals: [{ approver: owner.displayName, role: 'Sponsor', state: 'Approved', time: minutesAgo(80) }],
    });
    return {
      title: `Invite ${first} ${last}`, ticketIds: [t.id], mailIds: [], params: { email, name: `${first} ${last}` },
      checks: [check(`Guest ${email} invited`, { k: 'entraGuest', email, value: true }, true), check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }, true)],
      hints: ['Azure portal > Users > Invite external user.'],
      debrief: 'Guests get a #EXT# account in your tenant tied to their home identity. Record the sponsor and review guests regularly so access ends when the engagement does.',
      interview: { question: 'How do you keep guest access from outliving a project?', modelAnswer: 'A named sponsor, access reviews or expiry for guests, and removing them when the engagement ends.' },
    };
  },
  solve(w, s) {
    inviteGuest(w, mspUpn(w), s.params.email!, s.params.name!);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Invited the partner as a guest; sponsor recorded on the ticket.');
  },
};

export const mspRoleRequest: MspTemplate = {
  id: 'msp-role-request', title: 'Admin role for a new team lead', category: 'Privileged Access', difficulty: 2,
  skills: ['Delegated administration', 'Escalation'],
  summary: 'A legitimate request the MSP cannot fulfil: directory roles are assigned by the customer\'s Global or Privileged Role Administrator.',
  twists: [{ id: 'standard', label: 'Helpdesk Administrator for a new lead' }],
  fits: (w) => hasStaff(w) && w.entra.users.some((e) => e.source === 'synced' && e.accountEnabled),
  build(ctx): Built {
    const { w } = ctx;
    const u = pickStaff(ctx, (x, r) => r.lead && !!entraOf(ctx.w, x.upn)?.accountEnabled);
    const exec = executive(w);
    const t = openTicket(w, {
      type: 'Request', category: 'Access', priority: 3, caller: exec.displayName, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 60,
      short: `Helpdesk Administrator role for ${u.displayName}`,
      description: `${u.displayName} now leads first-line support for ${u.department}. Please give them the Helpdesk Administrator role in Entra so they can reset passwords for their team.\n\n${exec.displayName}`,
      approvals: [{ approver: exec.displayName, role: 'Executive', state: 'Approved', time: minutesAgo(55) }],
    });
    return {
      title: `Role request for ${u.displayName}`, ticketIds: [t.id], mailIds: [], params: { upn: u.upn },
      checks: [
        check('Escalated to the customer approver (outside MSP delegation)', { k: 'escalatedTo', ticket: t.id, team: 'Customer approver' }, true),
        check('Resolved as not approved for the MSP to action', { k: 'ticketResolved', ticket: t.id, codes: ['Rejected - Not Approved'] }, true),
      ],
      hints: ['Try it: the MSP account cannot assign directory roles.', 'Who can? Only a Global or Privileged Role Administrator: that is the customer, not the MSP. Escalate to the customer approver.'],
      debrief: 'Knowing the edge of your delegation is part of the job. An MSP with User and Groups Administrator cannot assign directory roles; the right move is to route the request to the customer\'s privileged admin with the business approval attached, not to look for a workaround.',
      interview: { question: 'You are asked to do something your delegated role does not allow. What do you do?', modelAnswer: 'Confirm it is outside my rights, escalate to the person who holds them with the approval attached, and record it on the ticket. Never look for a back door.' },
      escalation: { team: 'Customer approver', outcome: 'returned', response: `Customer approver: approved. Our Global Administrator will assign Helpdesk Administrator to ${u.displayName} directly. Please resolve the MSP ticket as "Rejected - Not Approved" (outside your delegation).` },
    };
  },
  solve(w, s) {
    escalateTicket(w, s.ticketIds[0]!, 'Customer approver', 'Directory role assignment needs the customer\'s Privileged Role Administrator.');
    close(w, s.ticketIds[0]!, 'Rejected - Not Approved', 'Outside MSP delegation; escalated to the customer, whose Global Administrator will assign the role.');
  },
  naive(w, s) {
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Assigned the role.');
  },
};
