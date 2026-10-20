/**
 * Authentication work: lockouts, resets, MFA and compromised accounts. Half of
 * these are traps, because social engineering of the service desk is how
 * real breaches start.
 */
import { daysAgo, minutesAgo } from '../../core/time.ts';
import { failLogons, findUser, resetPassword, unlock } from '../../world/directory.ts';
import { addSignIn, findEntraUser, oktaClearSessions, requireMfaReregistration, revokeSessions, setRisk } from '../../world/cloud.ts';
import { deliverMail, openTicket, reportPhishing } from '../../world/itsm.ts';
import { OFFICE_IPS } from '../../world/seed.ts';
import { type Built, type Template, check, close, employees, helpdeskUser, pickEmployee, raiseSir, workerOf } from '../template.ts';

const ATTACKER_IPS = ['192.0.2.66', '192.0.2.140', '192.0.2.201', '192.0.2.17'];
const ATTACKER_PLACES = ['Lagos, NG', 'Bucharest, RO', 'Sao Paulo, BR', 'Hanoi, VN', 'Lisbon, PT'];


// ------------------------------------------------------------------- Lockout

export const lockout: Template = {
  id: 'lockout',
  title: 'Account lockout investigation',
  category: 'Authentication',
  difficulty: 2,
  skills: ['Event log investigation', 'Root cause analysis', 'Threat recognition'],
  summary: 'Lockouts have a cause. Find it in the DC security log before you unlock, and know when a lockout is an attack.',
  twists: [
    { id: 'stale-device', label: 'Keeps locking: an old device still has the old password' },
    { id: 'password-spray', label: 'Many users locked at once from one address', trap: true },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    const hd = helpdeskUser(w);
    if (twist === 'password-spray') {
      const ip = rng.pick(ATTACKER_IPS);
      const victims = rng.shuffle(employees(ctx, (u) => !u.lockedOut)).slice(0, 6);
      for (const [i, v] of victims.entries()) {
        failLogons(w, v.sam, 5, ip, minutesAgo(18 - i * 2));
        addSignIn(w, { time: minutesAgo(18 - i * 2), upn: v.upn, app: 'Exchange ActiveSync', ip, location: 'Unknown', device: 'Unknown', result: 'Failure', failureReason: 'Invalid username or password', mfa: 'Not required', ca: 'Not applied', risk: 'medium' });
      }
      const t = openTicket(w, {
        type: 'Incident', category: 'Account Lockout', priority: 2, caller: hd.displayName, scenarioId: ctx.id, openedMinutesAgo: 6,
        short: `${victims.length} users locked out in the last 20 minutes`,
        description: `Phones are ringing. These users are all locked out and none of them changed their password recently:\n${victims.map((v) => `- ${v.displayName} (${v.sam})`).join('\n')}\n\nCan you bulk-unlock them? Tier 1 doesn't have rights for this many.`,
      });
      return {
        title: 'Mass lockout: bulk unlock request',
        ticketIds: [t.id], mailIds: [],
        params: { sams: victims.map((v) => v.sam).join(','), ip },
        checks: [
          check(`Raised a Security Incident naming the source IP ${ip}`, { k: 'securityTicketRaised', since: ctx.started, anyOf: [ip] }, true),
          check('IAM ticket escalated to Security', { k: 'ticketResolved', ticket: t.id, codes: ['Escalated to Security'] }, true),
          check('Work notes record the source address', { k: 'ticketNote', ticket: t.id, anyOf: [ip] }),
        ],
        hints: [
          'Six people locked out within minutes, none of whom changed a password. What do they have in common?',
          'Open Event Viewer on the DC (Security log, event 4740 and 4771). Look at the Caller Computer and Client Address fields.',
          `Every failure comes from ${ip}, an external address. That is a password spray. Raise a Security Incident with the IP and escalate; unlocking just hands the attacker another five guesses each.`,
        ],
        debrief: `Every lockout came from ${ip}, an address outside the company, within minutes, against accounts with no recent password change. That is a password spray: the attacker tries a common password against many accounts and stays under the lockout threshold per account. Bulk-unlocking without telling Security only resets the attacker's counter. The IAM job here is to recognise the pattern, preserve the evidence (the 4740 and 4771 events and the Entra sign-in failures) and get Security Operations blocking the source.`,
        interview: { question: 'Several users get locked out at once. How do you troubleshoot?', modelAnswer: 'Check the DC security log: event 4740 names the caller computer, and 4771/4625 show the client address. One internal device for one user usually means a stale credential on a phone, drive mapping or task. Many users from one external address is a password spray: escalate to Security with the IOC, check Entra sign-in logs for any successes, and only then unlock, ideally after the source is blocked.' },
      };
    }
    const u = pickEmployee(ctx);
    const old = `MHS-LT-0${rng.int(10, 99)}`;
    w.ad.computers.push({ name: old, ou: 'Corp/Workstations', os: 'Windows 10 Enterprise (replaced)', enabled: false, lastLogon: daysAgo(rng.int(18, 40)), primaryUser: u.sam, ip: `10.10.${rng.int(30, 60)}.${rng.int(10, 250)}` });
    failLogons(w, u.sam, 5, old, minutesAgo(2 * 24 * 60));
    unlock(w, u.sam, helpdeskUser(w).sam);
    failLogons(w, u.sam, 5, old, minutesAgo(26 * 60));
    unlock(w, u.sam, helpdeskUser(w).sam);
    failLogons(w, u.sam, 5, old, minutesAgo(14));
    const t = openTicket(w, {
      type: 'Incident', category: 'Account Lockout', priority: 3, caller: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 10,
      short: `Locked out AGAIN (third time this week) — ${u.displayName}`,
      description: `I keep getting locked out. The service desk has unlocked me twice this week and it happens again a few hours later. I changed my password last week when I got my new laptop. Please fix it properly this time!\n\n(Tier 1 note: identity verified by callback to number on file. Escalating because unlocks don't stick.)`,
      variables: { 'Caller': u.displayName, 'Verified': 'Callback to number on file' },
    });
    return {
      title: `Repeated lockouts: ${u.displayName}`,
      ticketIds: [t.id], mailIds: [],
      params: { sam: u.sam, device: old },
      checks: [
        check(`${u.sam} unlocked`, { k: 'adLocked', sam: u.sam, value: false }),
        check(`Root cause recorded: lockouts come from ${old}`, { k: 'ticketNote', ticket: t.id, anyOf: [old] }, true),
        check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)', 'Solved (Workaround)'] }),
      ],
      hints: [
        'Unlocking has already failed twice. What is still trying the old password?',
        `Event 4740 on the DC records a "Caller Computer Name". Filter the Security log for ${u.sam}.`,
        `The lockouts come from ${old}, the replaced laptop that still has the old password cached. Unlock, record the device in the work notes, and ask for it to be wiped or turned off.`,
      ],
      debrief: `Every 4740 for ${u.sam} names ${old}, the laptop they were given before last week's replacement. It is still on and still trying the old password (a mapped drive, Outlook profile or scheduled task). Unlocking without finding that only buys a few hours. Naming the source in the ticket is what turns a repeat incident into a fixed one.`,
      interview: { question: 'A user keeps getting locked out after the service desk unlocks them. What do you check?', modelAnswer: 'The PDC emulator\'s Security log: event 4740 gives the Caller Computer Name, and 4771 gives the client IP. That points to the device holding a stale password: an old laptop, a phone with saved mail credentials, a mapped drive or a service. Remove the stale credential at the source, then unlock, and record the root cause.' },
    };
  },
  solve(w, s) {
    if (s.twist === 'password-spray') {
      raiseSir(w, `Password spray from ${s.params.ip}`, `Lockouts for ${s.params.sams} from external IP ${s.params.ip}. Event 4740/4771 evidence attached. Please block the source.`);
      close(w, s.ticketIds[0]!, 'Escalated to Security', `Pattern is a password spray from ${s.params.ip}; escalated to Security Operations before unlocking.`);
      return;
    }
    unlock(w, s.params.sam!);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `Event 4740 caller computer is ${s.params.device} (replaced laptop with cached old password). Unlocked; asked desktop team to wipe ${s.params.device}.`);
  },
  naive(w, s) {
    for (const sam of (s.params.sams ?? s.params.sam ?? '').split(',').filter(Boolean)) unlock(w, sam);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Unlocked the accounts as requested.');
  },
};

// ------------------------------------------------------------------- Password reset

export const passwordReset: Template = {
  id: 'password-reset',
  title: 'Password reset with identity verification',
  category: 'Authentication',
  difficulty: 1,
  skills: ['Identity verification', 'Social engineering defence', 'Active Directory'],
  summary: 'A caller wants a password reset. Verify who they are against PeopleHub before you touch the account.',
  twists: [
    { id: 'verified', label: 'Genuine caller, details match' },
    { id: 'social-engineering', label: 'Details do not match', trap: true },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    const u = pickEmployee(ctx, (x) => !!x.manager);
    const hr = workerOf(w, u)!;
    const manager = findUser(w, u.manager!)!;
    const genuine = twist === 'verified';
    if (genuine) failLogons(w, u.sam, 5, w.ad.computers.find((c) => c.primaryUser === u.sam)?.name ?? 'MHS-FS01', minutesAgo(25));
    const wrongManager = rng.pick(w.ad.users.filter((x) => x.kind === 'user' && x.sam !== manager.sam && x.sam !== u.sam)).displayName;
    const idGiven = genuine ? u.employeeId : `E${Number(u.employeeId.slice(1)) + rng.int(3, 40)}`;
    const t = openTicket(w, {
      type: 'Incident', category: 'Password Reset', priority: 3, caller: genuine ? u.displayName : `${u.displayName} (unverified caller)`, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 12,
      short: `Password reset request — ${u.displayName}`,
      description: genuine
        ? `Caller says they are locked out after the weekend and forgot the new password.\n\nTier 1 verification collected:\n- Employee ID given: ${idGiven}\n- Manager named: ${manager.displayName}\n- Called back on the number on file ending ${hr.phoneLast4}: caller answered.\n\nEscalated to IAM because Tier 1 cannot reset accounts in ${u.department}.`
        : `Caller says they are ${u.displayName} and is "about to present to the board". Wants the password reset and the temporary password read out over the phone now.\n\nTier 1 verification collected:\n- Employee ID given: ${idGiven}\n- Manager named: ${wrongManager}\n- Caller asked us NOT to use the number on file ("that's my old phone") and to call back on +1 555 0199 instead.\n\nCaller was very insistent. Escalated to IAM.`,
      variables: { 'Employee ID given': idGiven, 'Manager named': genuine ? manager.displayName : wrongManager, 'Callback': genuine ? `Number on file ending ${hr.phoneLast4}` : 'Requested a new number: +1 555 0199' },
    });
    return {
      title: `Password reset: ${u.displayName}`,
      ticketIds: [t.id], mailIds: [],
      params: { sam: u.sam },
      checks: genuine
        ? [
            check('Password reset', { k: 'adPwdResetSince', sam: u.sam, since: ctx.started, value: true }, true),
            check('Must change password at next logon', { k: 'adMustChange', sam: u.sam, value: true }),
            check('Account unlocked', { k: 'adLocked', sam: u.sam, value: false }),
            check('Ticket resolved as fulfilled', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
          ]
        : [
            check('Password NOT reset for an unverified caller', { k: 'adPwdResetSince', sam: u.sam, since: ctx.started, value: false }, true),
            check('Resolved as Unable to Verify Identity (or escalated)', { k: 'ticketResolved', ticket: t.id, codes: ['Unable to Verify Identity', 'Escalated to Security'] }, true),
            check('Notes record which verification checks failed', { k: 'ticketNote', ticket: t.id, anyOf: ['manager', 'employee id', 'callback', 'did not match', 'mismatch', 'verification'] }),
          ],
      hints: [
        'Open Identity-Verification-Procedure.md. What has to match, and against which system?',
        `Look up ${u.displayName} in PeopleHub and compare the employee ID, the manager and the phone on file with what the caller gave.`,
        genuine
          ? 'Everything matches PeopleHub. Reset with "must change at next logon", unlock, and resolve.'
          : 'The ID is wrong, the manager is wrong, and they refused the callback number on file. Do not reset. Resolve as Unable to Verify Identity and note what failed.',
      ],
      debrief: genuine
        ? `The employee ID, manager and callback to the number on file all matched PeopleHub, which is two of three and more. A verified reset always sets "must change at next logon" so that IAM never knows the user's real password, and unlocking in the same step saves a second call.`
        : `Three red flags: an employee ID that does not match PeopleHub, the wrong manager, and a refusal to be called back on the number on file, together with urgency and an executive pretext. This is the help-desk social engineering pattern behind several well-known breaches. The control only works if IAM is willing to say no to an annoyed caller.`,
      interview: { question: 'How do you verify a caller before a password or MFA reset?', modelAnswer: 'Against the HR system of record, not the caller\'s own claims: employee ID, manager name, and a callback to the number already on file (never a number the caller gives). Treat urgency, executive pressure, new callback numbers and requests to read out a password as red flags. If it fails, do not reset, record why, and alert security if it looks like social engineering.' },
    };
  },
  solve(w, s) {
    if (s.twist === 'verified') {
      resetPassword(w, s.params.sam!, { mustChange: true, unlock: true });
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Verified employee ID, manager and callback to number on file against PeopleHub. Reset with must-change and unlocked.');
    } else {
      close(w, s.ticketIds[0]!, 'Unable to Verify Identity', 'Employee ID and manager did not match PeopleHub and caller refused callback to number on file. No reset performed; Security informed.');
    }
  },
  naive(w, s) {
    resetPassword(w, s.params.sam!, { mustChange: true, unlock: true });
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Reset the password for the caller.');
  },
};

// ------------------------------------------------------------------- MFA reset

export const mfaReset: Template = {
  id: 'mfa-reset',
  title: 'MFA reset request',
  category: 'Authentication',
  difficulty: 2,
  skills: ['Identity verification', 'Entra ID authentication methods', 'Threat recognition'],
  summary: 'Someone cannot complete MFA. Re-registering their methods is a powerful action: make sure it is really them.',
  twists: [
    { id: 'new-phone', label: 'Genuine new phone, verified' },
    { id: 'bypass-attempt', label: 'Email from a personal address while sign-ins fail MFA', trap: true },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    const u = pickEmployee(ctx, (x) => !!x.manager && !!findEntraUser(w, x.upn)?.mfaMethods.length);
    const hr = workerOf(w, u)!;
    const manager = findUser(w, u.manager!)!;
    if (twist === 'new-phone') {
      addSignIn(w, { time: minutesAgo(40), upn: u.upn, app: 'Office 365', ip: OFFICE_IPS[u.office] ?? '203.0.113.10', location: 'Boston, US', device: 'Windows 11 · Edge', result: 'Interrupted', failureReason: 'Strong authentication is required', mfa: 'Pending', ca: 'Success', risk: 'none' });
      const t = openTicket(w, {
        type: 'Incident', category: 'MFA', priority: 3, caller: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 30,
        short: `New phone — can't approve sign-in prompts (${u.displayName})`,
        description: `Got a new phone yesterday and traded the old one in. Now I can't approve the Authenticator prompts so I can't get into email.\n\nTier 1 verification:\n- Employee ID given: ${u.employeeId}\n- Manager named: ${manager.displayName}\n- Called back on number on file ending ${hr.phoneLast4}: confirmed.`,
        variables: { 'Employee ID given': u.employeeId, 'Manager named': manager.displayName, 'Callback': `Number on file ending ${hr.phoneLast4}` },
      });
      return {
        title: `MFA re-registration: ${u.displayName}`,
        ticketIds: [t.id], mailIds: [], params: { sam: u.sam, upn: u.upn },
        checks: [
          check('MFA methods removed so the new phone can be registered', { k: 'entraMfaClearedSince', upn: u.upn, since: ctx.started, value: true }, true),
          check('Sessions from the traded-in phone revoked', { k: 'entraSessionsRevokedSince', upn: u.upn, since: ctx.started }),
          check('Ticket resolved as fulfilled', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
        ],
        hints: [
          'Is the verification on this ticket good enough under IAM-SOP-002?',
          `Compare the details with PeopleHub, then look at ${u.upn} in the Entra admin center under Authentication methods.`,
          'Verification passes. Require re-registration of MFA (delete the old methods) and revoke sessions, because the old phone still holds tokens.',
        ],
        debrief: 'Verification matched PeopleHub, so removing the old Authenticator registration is right. Revoking sessions matters too: the traded-in phone may still hold refresh tokens for Outlook and Teams. The user registers the new phone at their next sign-in.',
        interview: { question: 'A user lost their MFA device. What do you do?', modelAnswer: 'Verify identity to the same standard as a password reset, then remove the lost method (or require re-registration), revoke sessions so tokens on the lost device stop working, have the user register the new device, and check sign-in logs for anything unusual on the account in the meantime.' },
      };
    }
    const ip = rng.pick(ATTACKER_IPS);
    const place = rng.pick(ATTACKER_PLACES);
    for (let i = 0; i < 6; i++) {
      addSignIn(w, { time: minutesAgo(50 - i * 6), upn: u.upn, app: 'Office 365', ip, location: place, device: 'Linux · Chrome', result: 'Failure', failureReason: 'MFA denied; user declined the authentication', mfa: 'Denied by user', ca: 'Success', risk: 'medium' });
    }
    const external = `${u.givenName.toLowerCase()}.${u.surname.toLowerCase()}.home@mailbox.example`;
    const m = deliverMail(w, {
      from: external, fromName: u.displayName, external: true, minutesAgo: 9,
      subject: 'URGENT pls remove my MFA',
      body: `Hi IT,\n\nThis is ${u.givenName} from ${u.department}. I'm travelling (${place.split(',')[0]}) and lost my phone, so I can't do the Authenticator thing. I have a client call in an hour and need email NOW.\n\nCan you just turn off MFA on my account or remove the old phone so I can set up a new one? I'm writing from my personal email because obviously I can't get into work email lol.\n\nThanks!!\n${u.givenName}`,
    });
    const t = openTicket(w, {
      type: 'Incident', category: 'MFA', priority: 2, caller: external, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 8,
      short: `Email request: remove MFA for ${u.displayName}`,
      description: `Auto-created from an email to servicedesk@meridianhealth.test.\nFrom: ${external}\nSubject: URGENT pls remove my MFA\n\nSee the email in your inbox for the full text.`,
    });
    return {
      title: `MFA removal request: ${u.displayName}`,
      ticketIds: [t.id], mailIds: [m.id], params: { sam: u.sam, upn: u.upn, ip },
      checks: [
        check('MFA was NOT removed for an unverified requester', { k: 'entraMfaClearedSince', upn: u.upn, since: ctx.started, value: false }, true),
        check('Email reported as phishing', { k: 'mailReported', mail: m.id, value: true }),
        check('Resolved as Unable to Verify Identity / Escalated', { k: 'ticketResolved', ticket: t.id, codes: ['Unable to Verify Identity', 'Escalated to Security'] }, true),
        check(`Security Incident raised (password is being used from ${ip})`, { k: 'securityTicketRaised', since: ctx.started, anyOf: [ip, u.upn, u.sam] }),
        check('Password reset because someone has it', { k: 'adPwdResetSince', sam: u.sam, since: ctx.started, value: true }),
      ],
      hints: [
        'Where did this request come from, and what is happening in the sign-in logs for this account right now?',
        `Check ${u.upn}'s sign-ins in the Entra admin center. Who is failing MFA from ${place}, and what does that tell you about the password?`,
        `Someone at ${ip} has the password and is being stopped only by MFA. Do not remove MFA. Report the email, raise a Security Incident, reset the password, and resolve as Unable to Verify Identity.`,
      ],
      debrief: `The request came from a personal address, with travel and urgency as pressure, while the sign-in log showed someone at ${ip} (${place}) entering the correct password and being stopped only by MFA. Removing MFA would have completed the attack. The right moves: refuse, report the email, reset the password (it is clearly known to someone else), and hand Security the IP.`,
      interview: { question: 'You get an urgent request to disable MFA for a travelling executive. What do you do?', modelAnswer: 'Treat it as a likely attack until proven otherwise: verify through PeopleHub data and a callback to the number on file, check sign-in logs for failed MFA from unusual locations (which means the password is compromised), never disable MFA on request, report the email, reset the password if there is evidence, and escalate to security.' },
    };
  },
  solve(w, s) {
    if (s.twist === 'new-phone') {
      requireMfaReregistration(w, s.params.upn!);
      revokeSessions(w, s.params.upn!);
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Verified against PeopleHub (ID, manager, callback). Required MFA re-registration and revoked sessions.');
      return;
    }
    reportPhishing(w, s.mailIds[0]!);
    resetPassword(w, s.params.sam!, { mustChange: true });
    raiseSir(w, `Credential compromise suspected: ${s.params.upn}`, `MFA denied repeatedly from ${s.params.ip} while a personal email asked us to remove MFA. Password reset; MFA kept.`);
    close(w, s.ticketIds[0]!, 'Unable to Verify Identity', `Request from personal email could not be verified; sign-ins from ${s.params.ip} show the password is known. Reported phishing, reset password, escalated.`);
  },
  naive(w, s) {
    requireMfaReregistration(w, s.params.upn!);
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Removed the MFA methods so the user can register a new phone.');
  },
};

// ------------------------------------------------------------------- Compromised account

export const compromised: Template = {
  id: 'compromised-account',
  title: 'Compromised account response',
  category: 'Incident Response',
  difficulty: 3,
  skills: ['Incident response', 'Session revocation', 'Entra ID sign-in logs', 'Containment'],
  summary: 'The sign-in logs say someone else is in. Contain fast, in the right order, and hand the evidence to Security.',
  twists: [
    { id: 'mfa-fatigue', label: 'MFA fatigue: prompts denied, then one approved' },
    { id: 'impossible-travel', label: 'Impossible travel flagged by Identity Protection' },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    const u = pickEmployee(ctx);
    const ip = rng.pick(ATTACKER_IPS);
    const place = rng.pick(ATTACKER_PLACES);
    const e = findEntraUser(w, u.upn)!;
    if (twist === 'mfa-fatigue') {
      for (let i = 0; i < 7; i++) addSignIn(w, { time: minutesAgo(40 - i * 4), upn: u.upn, app: 'Office 365', ip, location: place, device: 'Linux · Chrome', result: 'Failure', failureReason: 'MFA denied; user declined the authentication', mfa: 'Denied by user', ca: 'Success', risk: 'medium' });
      addSignIn(w, { time: minutesAgo(9), upn: u.upn, app: 'Office 365', ip, location: place, device: 'Linux · Chrome', result: 'Success', failureReason: '', mfa: 'Satisfied', ca: 'Success', risk: 'high' });
    } else {
      addSignIn(w, { time: minutesAgo(70), upn: u.upn, app: 'Outlook', ip: OFFICE_IPS[u.office] ?? '203.0.113.10', location: 'Boston, US', device: 'Windows 11 · Edge', result: 'Success', failureReason: '', mfa: 'Satisfied', ca: 'Success', risk: 'none' });
      addSignIn(w, { time: minutesAgo(22), upn: u.upn, app: 'SharePoint Online', ip, location: place, device: 'Linux · Chrome', result: 'Success', failureReason: '', mfa: 'Satisfied', ca: 'Success', risk: 'high' });
    }
    e.sessions.push({ issued: minutesAgo(twist === 'mfa-fatigue' ? 9 : 22), app: 'Office 365', device: `Linux · Chrome (${ip})` });
    e.riskLevel = 'high';
    const sec = w.ad.users.find((x) => x.title === 'Security Analyst' && x.enabled)!;
    const t = openTicket(w, {
      type: 'Incident', category: 'Security', priority: 1, caller: twist === 'mfa-fatigue' ? u.displayName : sec.displayName, requestedFor: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 5,
      short: twist === 'mfa-fatigue' ? `Getting MFA prompts I didn't start — accidentally approved one (${u.displayName})` : `Identity Protection: high-risk user ${u.upn}`,
      description: twist === 'mfa-fatigue'
        ? `My phone kept buzzing with sign-in approvals all morning. I kept pressing deny, then I was on a call and I think I pressed approve on one by mistake. Is my account OK?`
        : `Entra ID Protection raised high user risk for ${u.upn}: atypical travel. Successful sign-in from Boston, then from ${place} (${ip}) 48 minutes later. Please contain the account and hand over to SecOps.`,
    });
    return {
      title: `Contain compromised account: ${u.displayName}`,
      ticketIds: [t.id], mailIds: [], params: { sam: u.sam, upn: u.upn, ip },
      checks: [
        check('Entra ID sessions revoked (attacker kicked out)', { k: 'entraSessionsRevokedSince', upn: u.upn, since: ctx.started }, true),
        check('Password reset', { k: 'adPwdResetSince', sam: u.sam, since: ctx.started, value: true }, true),
        check('Must change password at next logon', { k: 'adMustChange', sam: u.sam, value: true }),
        check('MFA re-registration required', { k: 'entraMfaClearedSince', upn: u.upn, since: ctx.started, value: true }),
        check('Okta sessions cleared', { k: 'oktaSessionsClearedSince', login: u.upn, since: ctx.started }),
        check(`Security Incident raised with the IOC ${ip}`, { k: 'securityTicketRaised', since: ctx.started, anyOf: [ip] }, true),
        check('Account preserved, not deleted', { k: 'adExists', sam: u.sam, value: true }, true),
        check('Ticket resolved as Escalated to Security', { k: 'ticketResolved', ticket: t.id, codes: ['Escalated to Security'] }),
      ],
      hints: [
        'Open Incident-Runbook-Compromised-Account.md and the user\'s sign-in log. Is there an attacker session right now?',
        `The successful sign-in from ${ip} (${place}) holds a valid session. What kills a session that already exists?`,
        'Revoke Entra sessions and clear Okta sessions, reset the AD password with must-change, require MFA re-registration, raise a SIR with the IP and resolve as Escalated to Security.',
      ],
      debrief: `${twist === 'mfa-fatigue' ? 'Seven denied prompts followed by one approval is textbook MFA fatigue: the attacker already had the password.' : `Boston and then ${place} within an hour is physically impossible: someone else holds a valid session.`} Containment order matters: revoke sessions first (the attacker is in now), then reset the password and the MFA registration so they cannot simply sign back in. Then hand Security the IP and times. Deleting the account would destroy evidence.`,
      interview: { question: 'An account shows sign-ins from two continents within an hour. What do you do?', modelAnswer: 'Treat it as compromised: revoke all sessions in Entra and Okta, reset the password with must-change, require MFA re-registration, confirm compromised in Identity Protection, preserve the account and logs, and raise a security incident with the IPs, times and apps so SecOps can scope what was accessed. Follow up on how the password leaked and whether number matching or phishing-resistant MFA is in place.' },
    };
  },
  solve(w, s) {
    const { sam, upn, ip } = s.params as { sam: string; upn: string; ip: string };
    revokeSessions(w, upn);
    oktaClearSessions(w, upn);
    resetPassword(w, sam, { mustChange: true });
    requireMfaReregistration(w, upn);
    setRisk(w, upn, 'high');
    raiseSir(w, `Compromised account ${upn}`, `Attacker sign-ins from ${ip}. Sessions revoked, password and MFA reset.`);
    close(w, s.ticketIds[0]!, 'Escalated to Security', `Contained per SEC-IR-002: sessions revoked, password reset, MFA re-registration required, SIR raised with IOC ${ip}.`);
  },
  naive(w, s) {
    resetPassword(w, s.params.sam!, { mustChange: true });
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Reset the password.');
  },
};

