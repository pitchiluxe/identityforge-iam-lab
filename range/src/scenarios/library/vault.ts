/**
 * Privileged access through the vault (PAM): a Tier 0 change done through a
 * recorded session, a vendor who wants a password, onboarding an unmanaged
 * service account without breaking it, and a break-glass sign-in.
 */
import { daysAgo, minutesAgo } from '../../core/time.ts';
import { BREAK_GLASS } from '../../world/company.ts';
import { getUser, setPasswordFlags } from '../../world/directory.ts';
import { addSignIn, revokeSessions } from '../../world/cloud.ts';
import { addWorkNote, deliverMail, openTicket } from '../../world/itsm.ts';
import { ensurePolicyDocs } from '../../world/docs.ts';
import { addUsage, connect, endSession, ensurePam, getAccount, onboard, requestAccess, rotate, showPassword, syncUsages } from '../../world/pam.ts';
import { type Built, type Template, check, close, leadOf, raiseSir, securityUser } from '../template.ts';

// ------------------------------------------------------------------- Tier 0 change, or a vendor who wants a password

export const pamSession: Template = {
  id: 'pam-privileged-session',
  title: 'Privileged work through the vault',
  category: 'Privileged Access',
  difficulty: 2,
  skills: ['PAM vault (CyberArk model)', 'Dual control and change control', 'Recorded privileged sessions', 'Credential hygiene'],
  summary: 'Use a privileged account the way the standard requires: request it against a change, connect through a recorded session, and never handle the password.',
  twists: [
    { id: 'tier0-change', label: 'An approved change that needs Domain Admin' },
    { id: 'vendor-password', label: 'A vendor asks you to email them a service account password', trap: true },
  ],
  build(ctx): Built {
    const { w, rng, twist } = ctx;
    const pam = ensurePam(w);
    ensurePolicyDocs(w);
    const it = leadOf(w, 'IT');
    if (twist === 'tier0-change') {
      const task = rng.pick([
        ['Raise the minimum password length in the Default Domain Policy to 14', 'Audit finding IA-2026-09: Default Domain Policy minimum length is 12.'],
        ['Enable the AD Recycle Bin', 'Required before the OU clean-up next month; needs Enterprise/Domain Admin.'],
        ['Reset the KRBTGT password (first of two resets)', 'Annual KRBTGT rotation per SEC-STD-003.'],
      ] as const);
      const chg = openTicket(w, {
        type: 'Change', category: 'Active Directory', priority: 3, caller: it.displayName, scenarioId: ctx.id, openedMinutesAgo: 60 * 26,
        short: task[0], description: `${task[1]}\n\nImplementation window: today. Implementer: IAM Operations (${w.player.displayName}).\nAccount: adm-ghopper is the domain administration account; use it through the vault (SEC-STD-009). Record the session ID in the work notes.`,
        approvals: [{ approver: it.displayName, role: 'Change manager', state: 'Approved', time: minutesAgo(60 * 20) }, { approver: securityUser(w).displayName, role: 'CAB (Security)', state: 'Approved', time: minutesAgo(60 * 19) }],
        state: 'In Progress',
      });
      return {
        title: `Tier 0 change ${chg.id}`,
        ticketIds: [chg.id], mailIds: [], params: { change: chg.id, account: 't0-adm-ghopper' },
        checks: [
          check(`Vault access requested against ${chg.id} and approved (dual control)`, { k: 'pamRequestWithTicket', account: 't0-adm-ghopper', since: ctx.started, ticket: chg.id }, true),
          check('Work done through a recorded PSM session', { k: 'pamSession', account: 't0-adm-ghopper', since: ctx.started }, true),
          check('The Domain Admin password was never shown', { k: 'pamPasswordShown', account: 't0-adm-ghopper', since: ctx.started, value: false }, true),
          check('Password changed at check-in (session ended)', { k: 'pamRotatedSince', account: 't0-adm-ghopper', since: ctx.started }),
          check('Session recorded on the change', { k: 'ticketNote', ticket: chg.id, anyOf: ['psm-', 'session'] }),
          check('Change closed', { k: 'ticketResolved', ticket: chg.id, codes: ['Solved (Fulfilled)'] }),
        ],
        hints: [
          'Tier 0 credentials live in the vault (https://vault.meridianhealth.test). Read SEC-STD-009 first.',
          `Open T0-DomainAdmins > adm-ghopper. Request access with ${chg.id} as the ticket, then Connect. You only have Use, which is the point: you never see the password.`,
          `Connect, do the work, End session (the CPM changes the password), then note the PSM session ID on ${chg.id} and close it.`,
        ],
        debrief: 'Domain Admin was used for minutes, against an approved change, with a second person approving, inside a recorded session, and its password changed the moment the session ended. That is what "just-in-time" and "zero standing knowledge" mean in practice: nobody, including you, knows the Tier 0 password, so it cannot be phished, reused or left in a script.',
        interview: { question: 'How should an administrator use a Domain Admin account?', modelAnswer: 'Never as a daily account and never by knowing its password. Request it in the PAM vault against an approved change, with dual control for Tier 0; connect through a session manager that isolates and records the session; and let the vault rotate the password at check-in. Use a separate, privileged-access workstation where possible. The result is short-lived, attributable, recorded access with no reusable credential.' },
      };
    }
    // Vendor asks for svc-backup's password. The real problem: a usage the vault does not know about.
    pam.usages['svc-backup']!.push({ type: 'Windows Service', host: 'MHS-BKP02', name: 'Veeam Proxy Service' });
    const acct = getAccount(w, 'svc-backup');
    acct.passwordVersion++;
    acct.lastRotated = daysAgo(1);
    for (const d of acct.dependencies) d.syncedVersion = acct.passwordVersion;
    const m = deliverMail(w, {
      from: 'support@veeam-support.example', fromName: 'Veeam Support (Case 07731204)', external: true, minutesAgo: 30,
      subject: 'Backup proxy failing - need service account password',
      body: `Hello,\n\nYour proxy MHS-BKP02 has failed every job since yesterday with "Logon failure: unknown user name or bad password" for MERIDIAN\\svc-backup.\n\nPlease reply with the current password for svc-backup so our engineer can re-enter it on the proxy. Your colleague sent it to us last year, so this should be quick.\n\nRegards,\nVeeam Technical Support`,
    });
    const t = openTicket(w, {
      type: 'Incident', category: 'Backup', priority: 2, caller: it.displayName, scenarioId: ctx.id, openedMinutesAgo: 45,
      short: 'Backup jobs failing on MHS-BKP02 since svc-backup password change',
      description: `Every job on the second backup proxy (MHS-BKP02) has failed since the vault changed svc-backup's password yesterday. MHS-BKP01 is fine. Veeam support emailed asking for the password (see your mailbox).\n\nPlease get backups running.`,
    });
    return {
      title: 'Backup failing after a password change',
      ticketIds: [t.id], mailIds: [m.id], params: { account: 'svc-backup' },
      checks: [
        check('The svc-backup password was not shown or sent', { k: 'pamPasswordShown', account: 'svc-backup', since: ctx.started, value: false }, true),
        check('Every place svc-backup runs has the current password (MHS-BKP02 registered as a usage)', { k: 'pamDependenciesInSync', account: 'svc-backup' }, true),
        check('Root cause noted: an unregistered usage', { k: 'ticketNote', ticket: t.id, anyOf: ['usage', 'dependenc', 'bkp02'] }),
        check('Incident resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)', 'Solved (Workaround)'] }),
      ],
      hints: [
        'Before anything else: does policy allow you to send a password to anyone? Read SEC-STD-009, "Passwords are never shared".',
        'In the vault, open SVC-Windows > svc-backup and look at Usages. One proxy works and one does not. Which one is the vault keeping up to date?',
        'Register the Veeam Proxy Service on MHS-BKP02 as a usage, then Sync usages (or change the password, which updates every usage). Do not show or send the password. Note the root cause.',
      ],
      debrief: 'The vault changed the password and updated the usage it knew about (MHS-BKP01). MHS-BKP02 had been set up by hand and never registered, so it kept the old password and failed. Registering the usage fixes it permanently: every future change reaches both proxies. Emailing the password would have fixed nothing for long (the next change breaks it again) and put a privileged credential in a vendor mailbox; "your colleague sent it last time" means that password should already have been considered compromised.',
      interview: { question: 'A vendor asks you for a service account password to fix an outage. What do you do?', modelAnswer: 'Decline: privileged passwords are never shared, and a vendor works through a supervised, recorded session if they need access. Then fix the cause, which is usually that the account is used somewhere the vault does not update. Register that usage so rotations reach it, sync it, and confirm the service runs. If a password was ever disclosed, rotate it.' },
    };
  },
  solve(w, s) {
    if (s.twist === 'tier0-change') {
      requestAccess(w, 't0-adm-ghopper', 'Implement approved change', s.params.change!);
      const sess = connect(w, 't0-adm-ghopper', 'MHS-DC01');
      endSession(w, sess.id);
      addWorkNote(w, s.params.change!, `Implemented through vault session ${sess.id} (recorded). Password changed by the CPM at check-in.`);
      close(w, s.params.change!, 'Solved (Fulfilled)', `Change implemented via ${sess.id}.`);
      return;
    }
    addUsage(w, 'svc-backup', { type: 'Windows Service', host: 'MHS-BKP02', name: 'Veeam Proxy Service' });
    syncUsages(w, 'svc-backup');
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Root cause: MHS-BKP02 runs as svc-backup but was not registered as a usage, so the vault did not update it. Registered the usage and synced; jobs succeed. Password not disclosed to the vendor.');
  },
  naive(w, s) {
    if (s.twist === 'tier0-change') {
      showPassword(w, 't0-adm-ghopper', 'need it for the change');
      return;
    }
    showPassword(w, 'svc-backup', 'Vendor case 07731204');
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Sent the password to Veeam support.');
  },
};

// ------------------------------------------------------------------- Onboard an unmanaged service account

export const pamOnboard: Template = {
  id: 'pam-onboard-service',
  title: 'Onboard an unmanaged service account',
  category: 'Privileged Access',
  difficulty: 3,
  skills: ['PAM onboarding', 'Password rotation (CPM)', 'Service account dependencies', 'Change without outage'],
  summary: 'Discovery found a service account whose password has not changed in years. Put it under vault management without taking SQL Server down.',
  twists: [{ id: 'discovery', label: 'Rotate it, and keep SQL Server running', trap: true }],
  build(ctx): Built {
    const { w } = ctx;
    const pam = ensurePam(w);
    ensurePolicyDocs(w);
    // A rerun in the same world starts from "discovered, not yet onboarded" again.
    pam.accounts = pam.accounts.filter((a) => a.id !== 'svc-sql01');
    if (!pam.discovered.some((d) => d.userName === 'svc-sql01')) pam.discovered.push({ userName: 'svc-sql01', address: w.ad.domain, reason: 'Found by Accounts Discovery on MHS-SQL01: runs SQL Server services; not in any safe.' });
    const svc = getUser(w, 'svc-sql01');
    setPasswordFlags(w, 'svc-sql01', { neverExpires: true }, 'MERIDIAN\\svc-provisioning');
    svc.pwdLastSet = daysAgo(1100);
    const owner = getUser(w, 'lnovak');
    const t = openTicket(w, {
      type: 'Request', category: 'Privileged Access', priority: 3, caller: securityUser(w).displayName, scenarioId: ctx.id, openedMinutesAgo: 600,
      short: 'Vault onboarding: svc-sql01 (password unchanged for 3 years)',
      description: `Accounts Discovery found MERIDIAN\\svc-sql01 on MHS-SQL01. Password never expires; last changed 3 years ago; not in any safe.\n\nPer SEC-STD-009: onboard it into SVC-Windows with automatic management (30 days), change the password now, and keep SQL Server running. The owner (${owner.displayName}) cannot accept downtime during clinic hours.`,
    });
    return {
      title: 'Onboard svc-sql01 to the vault',
      ticketIds: [t.id], mailIds: [], params: { svcSam: 'svc-sql01' },
      checks: [
        check('svc-sql01 is in the vault under automatic management', { k: 'pamManaged', account: 'svc-sql01', value: true }, true),
        check('Password changed by the vault', { k: 'pamRotatedSince', account: 'svc-sql01', since: ctx.started }, true),
        check('SQL Server services still start (every usage has the new password)', { k: 'pamDependenciesInSync', account: 'svc-sql01' }, true),
        check('AD shows the password change', { k: 'adPwdResetSince', sam: 'svc-sql01', since: ctx.started, value: true }),
        check('Ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }),
      ],
      hints: [
        'In the vault, Discovered accounts lists svc-sql01 and what discovery found running as it. Read that list before you change anything.',
        'Onboard it into SVC-Windows. Before the first password change, register every usage (both SQL Server services on MHS-SQL01).',
        'Register MSSQLSERVER and SQLSERVERAGENT on MHS-SQL01 as usages, then Change password: the CPM updates both. Check Usages shows them in sync, then resolve.',
      ],
      debrief: 'Changing a service account password is easy; changing it without an outage means knowing every place it is stored. Registering both SQL Server services as usages before the first change means the CPM updated them in the same operation. Rotating first would have left MSSQLSERVER with a three-year-old password, and the next restart (patch night, or a failover) would have taken the clinical databases down.',
      interview: { question: 'How do you bring a service account under PAM without causing an outage?', modelAnswer: 'Discover where it is used (services, tasks, app pools, config files and scripts on every server), register those usages in the vault, then let the vault change the password and push it to every usage in one operation. Test a restart in a window, set a rotation policy, remove "password never expires", and give the account an owner. Accounts that cannot be rotated safely are candidates for gMSA.' },
    };
  },
  solve(w, s) {
    onboard(w, 'svc-sql01', 'SVC-Windows', 30);
    addUsage(w, 'svc-sql01', { type: 'Windows Service', host: 'MHS-SQL01', name: 'MSSQLSERVER' });
    addUsage(w, 'svc-sql01', { type: 'Windows Service', host: 'MHS-SQL01', name: 'SQLSERVERAGENT' });
    rotate(w, 'svc-sql01');
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Onboarded svc-sql01 to SVC-Windows (30-day policy). Registered usages MSSQLSERVER and SQLSERVERAGENT on MHS-SQL01, then changed the password; both usages updated.');
  },
  naive(w, s) {
    onboard(w, 'svc-sql01', 'SVC-Windows', 30);
    rotate(w, 'svc-sql01');
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Onboarded and rotated.');
  },
};

// ------------------------------------------------------------------- Break-glass sign-in

export const pamBreakGlass: Template = {
  id: 'pam-break-glass',
  title: 'Break-glass account used',
  category: 'Privileged Access',
  difficulty: 3,
  skills: ['Emergency access review', 'Credential rotation', 'Incident recognition', 'Entra ID sign-in logs'],
  summary: 'An alert says a break-glass Global Administrator signed in. Decide whether it was legitimate, and close it out either way.',
  twists: [
    { id: 'authorized', label: 'Used during a declared outage' },
    { id: 'unauthorized', label: 'No incident, no change, unfamiliar location', trap: true },
  ],
  build(ctx): Built {
    const { w, twist } = ctx;
    ensurePam(w);
    ensurePolicyDocs(w);
    const upn = BREAK_GLASS[0];
    const sec = securityUser(w);
    const when = minutesAgo(95);
    const authorized = twist === 'authorized';
    addSignIn(w, { time: when, upn, app: 'Microsoft Entra admin center', ip: authorized ? '10.10.20.31' : '203.0.113.77', location: authorized ? 'Boston, US' : 'Bucharest, RO', device: authorized ? 'Windows 11 · Edge' : 'Linux · Firefox', result: 'Success', failureReason: '', mfa: 'Satisfied', ca: 'Not applied (excluded)', risk: authorized ? 'none' : 'medium' });
    const e = w.entra.users.find((x) => x.upn === upn)!;
    e.sessions.push({ issued: when, app: 'Microsoft Entra admin center', device: authorized ? 'Windows 11 · Edge' : 'Linux · Firefox' });
    let incident = '';
    if (authorized) {
      const inc = openTicket(w, {
        type: 'Incident', category: 'Identity', priority: 1, caller: sec.displayName, scenarioId: ctx.id, openedMinutesAgo: 130, state: 'In Progress',
        short: 'P1: Entra ID MFA outage, no administrator can sign in',
        description: 'Microsoft Authenticator push failing tenant-wide (service health MO123456). Administrators cannot complete MFA.',
      });
      addWorkNote(w, inc.id, `Break-glass ${upn} used by ${sec.displayName} at ${new Date(when).toISOString().slice(11, 16)} UTC from the CISO office to put CA002 into report-only during the outage. Restored at 14:05.`, sec.displayName);
      incident = inc.id;
    }
    const t = openTicket(w, {
      type: 'Request', category: 'Privileged Access', priority: authorized ? 3 : 1, caller: 'Sentinel (automated)', scenarioId: ctx.id, openedMinutesAgo: 80,
      short: `Alert: break-glass account ${upn} signed in`,
      description: `Analytics rule "Break-glass account sign-in" fired.\n\nAccount: ${upn} (Global Administrator)\nTime: ${when}\n\nSEC-STD-009 requires a post-use review of every break-glass sign-in: confirm it matches a declared incident, change the password, and record the outcome.`,
    });
    return {
      title: `Break-glass sign-in review${authorized ? '' : ' (no incident on record)'}`,
      ticketIds: [t.id, ...(incident ? [incident] : [])], mailIds: [], params: { upn, incident },
      checks: authorized
        ? [
            check('Break-glass password changed after use', { k: 'pamRotatedSince', account: 'bg-01', since: ctx.started }, true),
            check(`Review references the incident ${incident}`, { k: 'ticketNote', ticket: t.id, anyOf: [incident] }),
            check('Alert ticket resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)'] }, true),
          ]
        : [
            check('Security Incident raised for the unexplained Global Administrator sign-in', { k: 'securityTicketRaised', since: ctx.started, anyOf: [upn, 'break-glass', 'break glass', '203.0.113.77'] }, true),
            check('Break-glass sessions revoked', { k: 'entraSessionsRevokedSince', upn, since: ctx.started }, true),
            check('Break-glass password changed', { k: 'pamRotatedSince', account: 'bg-01', since: ctx.started }, true),
            check('Alert escalated to Security', { k: 'ticketResolved', ticket: t.id, codes: ['Escalated to Security'] }),
          ],
      hints: [
        'Who used it, from where, and is there a P1 incident or change that explains it? Check the Entra sign-in log and ServiceDesk.',
        authorized ? `${incident} describes the outage and who used the account. The account still needs its password changed after any use.` : 'There is no incident or change, the location is unfamiliar, and Conditional Access does not apply to this account. Treat it as a compromise of a Global Administrator.',
        authorized ? 'Vault > BreakGlass > Change password for bg-01, then resolve the alert noting the incident number.' : `Raise a Security Incident, revoke ${upn}'s sessions in Entra, change its password in the vault (BreakGlass), and resolve the alert as Escalated to Security.`,
      ],
      debrief: authorized
        ? `The sign-in matched ${incident}: a declared MFA outage, by a named person, from the office. That is exactly what break-glass is for. Its password was still changed afterwards, because a credential that has been taken out of the safe is no longer secret.`
        : 'A Global Administrator that bypasses Conditional Access signed in from an unfamiliar country with no incident or change on record. That is a tenant-level compromise until proven otherwise: revoke its sessions, change the password in the vault, and hand it to Security Operations with the sign-in details. Changing the password alone would leave the attacker\'s session alive.',
      interview: { question: 'What controls should surround break-glass accounts?', modelAnswer: 'Two cloud-only accounts, excluded from Conditional Access so they work during an outage, protected by phishing-resistant MFA (FIDO2) and a long password held in the vault under dual control. Alert on every sign-in, require a matching P1 incident, review every use, and rotate the password afterwards. Test them on a schedule so they work when needed.' },
    };
  },
  solve(w, s) {
    if (s.twist === 'authorized') {
      rotate(w, 'bg-01');
      close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `Use matched ${s.params.incident} (declared MFA outage). Password changed in the vault after use.`);
      return;
    }
    raiseSir(w, `Unexplained break-glass sign-in: ${s.params.upn}`, `Global Administrator ${s.params.upn} signed in from 203.0.113.77 (Bucharest, RO) with no incident or change on record. Sessions revoked and password changed.`);
    revokeSessions(w, s.params.upn!);
    rotate(w, 'bg-01');
    close(w, s.ticketIds[0]!, 'Escalated to Security', 'No matching incident or change. Sessions revoked, password changed in the vault, Security Incident raised.');
  },
  naive(w, s) {
    rotate(w, 'bg-01');
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Password changed.');
  },
};

