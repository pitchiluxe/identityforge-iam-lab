/**
 * scenarios/msp/suspicious.ts — requests a good MSP engineer does not just do.
 *
 * Each passes only with the right escalation or decline AND no matching change
 * in the audit since the ticket opened (scoped to the target and the action),
 * so "do it, then escalate" still fails.
 */
import { daysAgo } from '../../core/time.ts';
import { activateRole } from '../../world/pim.ts';
import { requireReregisterAs } from '../../world/authMethods.ts';
import { inviteGuest } from '../../world/entraAdmin.ts';
import { openTicket, sendMail } from '../../world/itsm.ts';
import { escalateTicket } from '../../world/servicenow.ts';
import { check, close, type Built } from '../template.ts';
import { executive, hasStaff, mspUpn, pickStaff, profileOf } from './common.ts';
import type { MspTemplate } from './lifecycle.ts';

/** A domain one glance away from the real one, and never equal to it (rn for m, 1 for l, 0 for o, or two letters swapped). */
export function lookalike(name: string): string {
  const tries = [name.replace('m', 'rn'), name.replace('l', '1'), name.replace('o', '0'), name.length > 4 ? `${name.slice(0, 2)}${name[3]}${name[2]}${name.slice(4)}` : name];
  return tries.find((x) => x !== name) ?? `${name}-secure`;
}

const SECURITY_TAKEOVER = 'Security Operations: thank you. We have taken this over as a suspected social-engineering attempt and will contact the requester through a verified channel. No change should be made.';

export const susGlobalAdmin: MspTemplate = {
  id: 'msp-sus-global-admin', title: 'Urgent Global Admin for a "consultant"', category: 'Privileged Access', difficulty: 2, suspicious: true,
  skills: ['Social engineering', 'Privileged access', 'Escalation'],
  summary: 'An executive "urgently" wants an outside consultant made Global Administrator today.',
  twists: [{ id: 'urgent', label: 'Executive pressure', trap: true }],
  fits: hasStaff,
  build(ctx): Built {
    const { w, rng } = ctx;
    const exec = executive(w);
    const email = `${rng.pick(['d.hale', 'm.carter', 'j.okoye'])}.consulting@${rng.pick(['gmail.test', 'outlook-mail.test', 'proton-mail.test'])}`;
    const t = openTicket(w, {
      type: 'Request', category: 'Access', priority: 1, caller: exec.displayName, requestedFor: email, scenarioId: ctx.id, openedMinutesAgo: 4,
      short: 'URGENT - admin access for our consultant today',
      description: `I'm boarding a flight so I can't call. Our new security consultant needs Global Administrator in our Microsoft tenant today to finish the board report. Their address is ${email}. Please set it up right away and send them the login. This is approved by me, don't hold it up.\n\n${exec.displayName}\nSent from my phone`,
    });
    const mark = w.counters.audit;
    return {
      title: 'Urgent admin access request', ticketIds: [t.id], mailIds: [], params: { email },
      checks: [
        check('Escalated to Security Operations', { k: 'escalatedTo', ticket: t.id, team: 'Security Operations' }, true),
        check('No guest invited or role granted for the address', { k: 'neverChanged', target: email, actions: ['Invite external user', 'Add member to role', 'Create role assignment'], afterAudit: mark }, true),
        check('Closed as escalated to Security', { k: 'ticketResolved', ticket: t.id, codes: ['Escalated to Security'] }, true),
      ],
      hints: ['Urgency, a personal address, no call-back and the highest privilege: count the red flags.', 'Do not change anything. Escalate to Security Operations with what you noticed.'],
      debrief: 'Classic executive-impersonation pressure: urgency, travel, an outside personal address and the most powerful role. Nobody gets Global Administrator from a ticket, and an MSP cannot grant it anyway. Escalate to security, who verify through a known channel.',
      interview: { question: 'An executive demands Global Admin for an outsider by email, today. What do you do?', modelAnswer: 'Make no change, escalate to security, and verify through a known channel. Global Admin is never granted from a ticket; privileged roles go through PIM and the customer\'s approvers.' },
      escalation: { team: 'Security Operations', outcome: 'closed', code: 'Escalated to Security', response: SECURITY_TAKEOVER },
    };
  },
  solve(w, s) {
    escalateTicket(w, s.ticketIds[0]!, 'Security Operations', 'Urgent request for Global Admin for an external personal address, no call-back possible: likely impersonation.');
  },
  naive(w, s) {
    inviteGuest(w, mspUpn(w), s.params.email!, 'Consultant');
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Invited the consultant; role assignment pending.');
  },
};

export const susMfaUnverified: MspTemplate = {
  id: 'msp-sus-mfa-unverified', title: 'MFA reset from an unverified caller', category: 'Authentication', difficulty: 2, suspicious: true,
  skills: ['Identity verification', 'Social engineering'],
  summary: 'Someone asks for an MFA reset from a personal address and gets the verification details wrong.',
  twists: [{ id: 'wrong-phone', label: 'Wrong phone digits, personal email', trap: true }],
  fits: (w) => hasStaff(w) && w.entra.users.some((e) => e.source === 'synced' && e.accountEnabled),
  build(ctx): Built {
    const { w, rng } = ctx;
    const u = pickStaff(ctx, (x) => !!ctx.w.entra.users.find((e) => e.upn === x.upn)?.accountEnabled);
    const e = w.entra.users.find((x) => x.upn === u.upn)!;
    if (!e.mfaMethods.length) e.mfaMethods = [{ type: 'Microsoft Authenticator', detail: 'iPhone', added: daysAgo(300) }];
    const real = w.hr.workers.find((x) => x.employeeId === u.employeeId)!.phoneLast4;
    let wrong = String(rng.int(1000, 9999));
    if (wrong === real) wrong = String((Number(real) + 1111) % 9000 + 1000);
    const personal = `${u.givenName.toLowerCase()}${rng.int(70, 99)}@mail-box.test`;
    const t = openTicket(w, {
      type: 'Incident', category: 'Authentication', priority: 2, caller: personal, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 15,
      short: 'locked out - reset my authenticator please',
      description: `Hi it's ${u.displayName}. I'm locked out of my work account, my phone was stolen. I'm writing from my personal email. Please reset my MFA and send me a temporary pass to this address so I can get back in, I have a deadline.\n\nPhone last 4 is ${wrong}.`,
    });
    const mark = w.counters.audit;
    return {
      title: `MFA reset request for ${u.displayName}`, ticketIds: [t.id], mailIds: [], params: { upn: u.upn, sam: u.sam, phone: wrong },
      checks: [
        check('No MFA reset, Temporary Access Pass or password reset for the account', { k: 'neverChanged', target: u.upn, actions: ['Admin deleted security info', 'Create Temporary Access Pass', 'Reset user password'], afterAudit: mark }, true),
        check('No AD password reset or unlock for the account', { k: 'neverChanged', target: u.sam, actions: ['Password reset', 'Account unlocked'], afterAudit: mark }, true),
        check('Closed as unable to verify identity (or escalated to Security)', { k: 'ticketResolved', ticket: t.id, codes: ['Unable to Verify Identity', 'Escalated to Security'] }, true),
      ],
      hints: ['Compare the phone digits with HR before anything else.', 'Wrong digits, a personal address and a request to send a pass there: decline as unable to verify, or escalate to Security.'],
      debrief: 'The verification failed (the phone digits do not match HR) and the request routes the result to an address the company does not control. That is the pattern of an account-takeover attempt. Decline and tell the real user through a known channel; escalating to security is also right.',
      interview: { question: 'A caller fails verification but has a convincing story and a deadline. What do you do?', modelAnswer: 'Nothing changes on the account. Decline as unable to verify, offer a verified route (in person, manager confirmation, call-back to the number on file), and report it.' },
      escalation: { team: 'Security Operations', outcome: 'closed', code: 'Escalated to Security', response: SECURITY_TAKEOVER },
    };
  },
  solve(w, s) {
    close(w, s.ticketIds[0]!, 'Unable to Verify Identity', 'Phone digits do not match HR and the request came from a personal address. No change made; real user to be contacted via the number on file.');
  },
  naive(w, s) {
    const me = mspUpn(w);
    activateRole(w, me, 'Authentication Administrator', 1, `${s.ticketIds[0]} MFA reset`);
    requireReregisterAs(w, me, s.params.upn!);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Reset MFA for the caller.');
  },
};

export const susLookalike: MspTemplate = {
  id: 'msp-sus-lookalike', title: 'Request from a lookalike domain', category: 'Incident Response', difficulty: 3, suspicious: true,
  skills: ['Phishing recognition', 'B2B collaboration', 'Escalation'],
  summary: 'A "colleague" from a domain one character off asks you to invite an outside address.',
  twists: [{ id: 'lookalike', label: 'Lookalike sender domain', trap: true }],
  fits: hasStaff,
  build(ctx): Built {
    const { w, rng } = ctx;
    const p = profileOf(w);
    const victim = pickStaff(ctx, (_x, r) => r.lead);
    const [name, tld] = [p.domain.slice(0, p.domain.lastIndexOf('.')), p.domain.slice(p.domain.lastIndexOf('.'))];
    const fake = `${victim.sam.replace(/\./g, '')}@${lookalike(name)}${tld}`;
    const guest = `${rng.pick(['billing', 'invoices', 'accounts'])}.desk@${rng.pick(['secure-docs.test', 'fileshare-portal.test'])}`;
    const t = openTicket(w, {
      type: 'Request', category: 'Access', priority: 2, caller: fake, requestedFor: guest, scenarioId: ctx.id, openedMinutesAgo: 25,
      short: 'Please add our new billing partner as a guest',
      description: `Hello,\n\nWe've moved invoice processing to a new partner. Please invite ${guest} as a guest today so they can access our finance files. I've already cleared it.\n\nThanks,\n${victim.displayName}\n${victim.title}\n(${fake})`,
    });
    const mark = w.counters.audit;
    return {
      title: 'Guest request from a lookalike domain', ticketIds: [t.id], mailIds: [], params: { guest },
      checks: [
        check('Escalated to Security Operations', { k: 'escalatedTo', ticket: t.id, team: 'Security Operations' }, true),
        check('No guest invited for the address', { k: 'neverChanged', target: guest, actions: ['Invite external user'], afterAudit: mark }, true),
        check('Closed as escalated to Security', { k: 'ticketResolved', ticket: t.id, codes: ['Escalated to Security'] }, true),
      ],
      hints: [`Read the sender address letter by letter and compare it with ${p.domain}.`, 'A spoofed colleague asking for finance access for an outsider: escalate to Security, change nothing.'],
      debrief: `The request came from ${fake.split('@')[1]}, not ${p.domain}: a lookalike domain. Combined with a new "billing partner" and finance access, it is invoice fraud in progress. Escalate so Security can warn finance and block the domain.`,
      interview: { question: 'How do you spot a lookalike-domain request?', modelAnswer: 'Check the sender domain exactly against the company domain, be suspicious of urgency plus money or access, and verify with the named person through a known channel.' },
      escalation: { team: 'Security Operations', outcome: 'closed', code: 'Escalated to Security', response: SECURITY_TAKEOVER },
    };
  },
  solve(w, s) {
    escalateTicket(w, s.ticketIds[0]!, 'Security Operations', 'Sender domain is a lookalike of ours; request for finance access for an outside address.');
  },
  naive(w, s) {
    inviteGuest(w, mspUpn(w), s.params.guest!, 'Billing partner');
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Invited the billing partner.');
  },
};

export const susExport: MspTemplate = {
  id: 'msp-sus-export', title: 'Staff list to a personal address', category: 'Governance', difficulty: 1, suspicious: true,
  skills: ['Data protection', 'Policy'],
  summary: 'A manager wants every user\'s details exported and sent to their personal email.',
  twists: [{ id: 'export', label: 'Bulk export request', trap: true }],
  fits: hasStaff,
  build(ctx): Built {
    const { w, rng } = ctx;
    const m = pickStaff(ctx, (_x, r) => r.lead);
    const personal = `${m.givenName.toLowerCase()}.${rng.pick(['home', 'personal', 'private'])}@mail-box.test`;
    const t = openTicket(w, {
      type: 'Request', category: 'Data', priority: 4, caller: m.displayName, requestedFor: m.displayName, scenarioId: ctx.id, openedMinutesAgo: 300,
      short: 'Export of all staff details',
      description: `Can you export the full user list (names, titles, phone numbers, managers) for the whole company and email it to ${personal}? I want to work on the org chart at home this weekend.\n\n${m.displayName}`,
    });
    const mark = w.counters.audit;
    return {
      title: 'Bulk export request', ticketIds: [t.id], mailIds: [], params: { personal },
      checks: [
        check('Nothing sent to the personal address', { k: 'neverChanged', target: personal, actions: ['Message sent'], afterAudit: mark }, true),
        check('Rejected under the data policy (or escalated to Security)', { k: 'ticketResolved', ticket: t.id, codes: ['Rejected - Policy', 'Escalated to Security'] }, true),
      ],
      hints: ['Personal data of every employee, to an address the company does not control.', 'Decline under policy; offer a compliant alternative.'],
      debrief: 'Bulk personal data to a personal mailbox is a data-protection breach whatever the intent. Decline under policy and offer the compliant route (the org chart in the company tenant, or HR\'s own reporting).',
      interview: { question: 'A manager wants staff data sent to their personal email. What do you say?', modelAnswer: 'No: company personal data stays in company systems. Decline under policy and offer a way to do the work inside the tenant.' },
      escalation: { team: 'Security Operations', outcome: 'closed', code: 'Escalated to Security', response: 'Security Operations: agreed, this would be a data-protection breach. We will follow up with the requester and their manager. No export should be sent.' },
    };
  },
  solve(w, s) {
    close(w, s.ticketIds[0]!, 'Rejected - Policy', 'Bulk personal data cannot go to a personal mailbox. Offered the org chart within the company tenant instead.');
  },
  naive(w, s) {
    sendMail(w, s.params.personal!, 'Staff export', 'Attached: full user list.');
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Sent the export.');
  },
};

