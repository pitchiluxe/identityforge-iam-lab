/**
 * world/docs.ts — the files on the IAM engineer's workstation.
 *
 * Scenarios are graded against these policies, so a learner who reads the
 * SOP before acting gets the right answer, which is how the job works. The
 * matrices are generated from company.ts so they cannot drift from the grader.
 */
import type { VFile, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { samplePdfs } from './pdfSamples.ts';
import { BREAK_GLASS, COMPANY, DEPARTMENTS, DISABLED_OU, JOB_ROLES, OUS, SAAS_CATALOG, STAGING_OU, birthright } from './company.ts';

export function homeDir(w: World): string {
  return `C:\\Users\\${w.player.sam}`;
}

const POLICIES: Record<string, string> = {
  'Identity-Verification-Procedure.md': `# Identity Verification Procedure (IAM-SOP-002)

Applies to: password resets, unlocks, MFA resets, and any change requested by phone, chat or email.

## Rule
Verify the requester BEFORE you change anything. Information supplied in the request itself is not proof.

## How to verify (two of three must match PeopleHub)
1. Employee ID.
2. Manager's full name.
3. Callback to the phone number on file in PeopleHub (compare the last 4 digits). Never call a number the requester gives you.

## Red flags. Stop and escalate
- Request comes from a personal or external email address, or a look-alike domain (for example meridian-health.co or rneridianhealth.test).
- Pressure or urgency ("I'm the CFO, I'm about to board, do it now").
- Requester asks you to send the password or a code to a new number or address.
- Details do not match PeopleHub, or the worker is Terminated or on Leave.

## When verification fails
- Do NOT reset, unlock or change MFA.
- Resolve the ticket with code **Unable to Verify Identity** and record which checks failed.
- If the request looks like social engineering, report the email as phishing and raise a Security Incident (SIR) for Security Operations.
`,
  'JML-Standard-Operating-Procedure.md': `# Joiner / Mover / Leaver Standard Operating Procedure (IAM-SOP-001)

PeopleHub (HR) is the source of truth for who works here, in which job, from when.

## Joiner
1. Confirm the Pending Hire exists in PeopleHub. No HR record, no account.
2. Create the account in **${'Corp/Users/<Department>'}** using the naming standard (AD-Naming-Standard.md).
3. Set employeeID, title, department, manager and office from PeopleHub.
4. Add exactly the birthright groups in Birthright-Access-Matrix.csv for the job title. Nothing more.
5. Start date in the future: leave the account **disabled**. Start date today: set a temporary password, require change at next logon and enable it.
6. Run a delta sync (Start-ADSyncSyncCycle -PolicyType Delta) so the Microsoft 365 license and SSO apps arrive.
7. Resolve the request with code Solved (Fulfilled).

"Give them the same access as <colleague>" is not a valid request. Birthright comes from the matrix; anything extra needs its own access request with owner approval.

## Mover (transfer)
1. Update title, department and manager from PeopleHub and move the account to the new department OU.
2. Remove the old job-role group and every birthright group the new job does not include, on the same day.
3. Add the new job's birthright groups.
4. Keep non-birthright access only if the ticket shows an approved exception from the resource owner.
5. Run a delta sync.

## Leaver (termination)
Voluntary leaver: at the end of the last working day. Involuntary: immediately, Priority 1.
1. Disable the AD account.
2. Revoke Entra ID sign-in sessions, and confirm Okta is deactivated (run an Okta import or deactivate the user and clear sessions).
3. Remove every group membership except Domain Users.
4. Set the description to "Disabled <yyyy-mm-dd> per <ticket number>".
5. Move the account to **${DISABLED_OU}**.
6. Run a delta sync, then check each application in Application-Catalog.csv. Apps with **Manual** provisioning (PayrollPro) must be deactivated by hand.
7. Do not delete the account. Deletion happens after 30 days through a change request.
`,
  'Access-Request-and-Approval-Policy.md': `# Access Request and Approval Policy (IAM-POL-004)

- Any access outside a person's birthright needs: (1) their **manager's** approval and (2) the **resource owner's** approval (the group's managedBy).
- Check the approvals on the ticket. "Requested" is not "Approved". Without both approvals: set the ticket On Hold or resolve it as Rejected - Not Approved. Never grant early.
- Check SoD-Matrix.csv before granting. A request that creates a toxic combination is rejected with code Rejected - Policy, even if it is approved.
- Grant access through the access group (for example app-carechart), never by assigning an individual user directly in Okta or Entra. Direct assignments are invisible to access reviews.
- Privileged access is never granted through a standard access request. See Privileged-Access-Standard.md.
`,
  'HIPAA-Access-Control-Policy.md': `# HIPAA Access Control Policy (PRV-POL-001)

Meridian Health System is a covered entity. Every account that can reach protected health information (PHI) falls under the HIPAA Security Rule, 45 CFR 164.312.

## Minimum necessary
- Clinical access follows the job role. A nurse gets CareChart EHR through app-carechart because the Registered Nurse role needs it, not because a colleague has it.
- "Same access as my colleague" is not a valid justification. Grant the birthright for the job title in Birthright-Access-Matrix.csv and route anything else through an approved access request.
- Imaging (ImageVault PACS) is limited to Radiology and to clinicians with an approved request naming the patient-care reason.

## Unique user identification (164.312(a)(2)(i))
- One person, one account. Shared logins on nursing stations are not permitted; badge tap-in signs each clinician in to their own session.
- Never reset a password or MFA method for a clinician without verifying identity (Identity-Verification-Procedure.md). Social engineering of the service desk is the most common path to PHI.

## Emergency access (break-the-glass)
- CareChart EHR offers break-the-glass for emergencies. Every use is logged and reviewed by the Privacy Office within 24 hours.
- The directory break-glass accounts are for losing all administrative access, not for clinical emergencies.

## Termination (164.308(a)(3)(ii)(C))
- Access to PHI ends when employment ends. For an involuntary termination, disable the account and revoke cloud sessions before the person leaves the building.
- Accounts with no active worker in PeopleHub are treated as an incident until shown otherwise: check whether they were used after the person left.

## Audit (164.312(b))
- Directory, Entra ID and Okta logs are retained for six years. Write what you did, why, and the ticket number in every work note.
`,
  'Privileged-Access-Standard.md': `# Privileged Access Standard (SEC-STD-007)

1. **No standing privilege.** Entra ID admin roles are assigned as PIM **eligible**, activated for at most 8 hours with a justification.
2. The only permanent active Global Administrators are the break-glass accounts: ${BREAK_GLASS.join(', ')}.
3. **Additions** to Tier 0 groups (Domain Admins, Enterprise Admins, Account Operators) are made only by the Domain Admin team through an approved CHG with CISO approval. IAM Operations must reject requests for them. IAM Operations **may remove** members when an approved ticket or audit finding requires it.
4. Service accounts must never be members of Tier 0 groups (Service-Account-Standard.md).
5. A request for "permanent admin" is resolved as **Rejected - Policy**, with the eligible-assignment alternative explained.
`,
  'Password-and-MFA-Standard.md': `# Password and MFA Standard (SEC-STD-003)

- Lockout threshold: 5 bad attempts. Accounts unlock after 30 minutes or by an administrator.
- **Repeated lockouts:** before unlocking, find the source. Event ID 4740 on the DC names the Caller Computer. Record it in the ticket. Typical causes: an old phone with saved mail credentials, a mapped drive or a scheduled task using an old password.
- **Many accounts locked from one external address** is a password spray. Do not just unlock. Escalate to Security (SIR) with the source IP.
- A password reset by an administrator always sets "User must change password at next logon".
- MFA method resets need the same identity verification as a password reset.
- After a suspected compromise: revoke sessions, reset the password, require MFA re-registration (Incident-Runbook-Compromised-Account.md).
`,
  'Service-Account-Standard.md': `# Service Account Standard (SEC-STD-009)

- Service accounts live in Corp/ServiceAccounts. They are not synchronized to Entra ID.
- Every service account has an **owner** (managedBy on its access group, or the description field "Owner: <name>") and a purpose in the description.
- Service accounts are never members of Tier 0 groups. Backup software uses grp-backup-operators.
- "Password never expires" is allowed only with a documented exception and annual rotation; prefer a gMSA.
`,
  'Access-Review-Procedure.md': `# User Access Review Procedure (IAM-SOP-006)

1. For each person in scope, compare their groups with Birthright-Access-Matrix.csv for their CURRENT job title.
2. Groups left over from a previous job are **privilege creep**: remove them.
3. Access backed by an approved exception (listed in the review ticket) is kept.
4. Record each decision in the review ticket's work notes, then resolve it.
`,
  'Stale-Account-Procedure.md': `# Stale and Orphaned Account Procedure (IAM-SOP-007)

- **Stale:** an enabled user account with no sign-in for 90 days or more. Disable it (do not delete) and set the description "Disabled <date> stale per <ticket>".
- **Exceptions:** workers on Leave of Absence in PeopleHub (keep them enabled and note the exception) and service accounts (handled by their owners).
- **Orphaned:** an enabled account with no matching worker in PeopleHub, or whose worker is Terminated. Disable it, remove its groups, move it to ${DISABLED_OU} and record it.
- Find candidates with: Search-ADAccount -AccountInactive -TimeSpan 90.00:00:00 -UsersOnly
`,
  'Incident-Runbook-Compromised-Account.md': `# Incident Runbook: Compromised Account (SEC-IR-002)

## Indicators
Sign-ins from unfamiliar countries or IPs, impossible travel, many MFA prompts **denied** followed by one **approved** (MFA fatigue), or a user reporting prompts they did not start.

## Contain (in this order)
1. Revoke Entra ID sign-in sessions, and clear Okta sessions.
2. Reset the AD password with "must change at next logon".
3. Require MFA re-registration (delete existing methods).
4. Mark the user as compromised in Entra ID Protection.
5. Raise a Security Incident (SIR) for Security Operations with the suspicious IP addresses and times, then resolve the IAM ticket as **Escalated to Security**.

Do not delete the account. Evidence must be preserved.
`,
  'Conditional-Access-Baseline.md': `# Conditional Access Baseline (SEC-STD-011)

- Every policy that targets All users must **exclude both break-glass accounts**: ${BREAK_GLASS.join(', ')}. A policy that locks out the break-glass accounts can lock the whole company out of its tenant.
- New policies start in **Report-only**, unless Security has approved enforcing them immediately.
- Legacy authentication is blocked for all users (policy CA001).
`,
  'Identity-Governance-and-Certification-Procedure.md': `# Identity Governance and Certification Procedure (IAM-SOP-006)

The identity governance platform (Governance console, https://iga.meridianhealth.test) is modelled on SailPoint Identity Security Cloud. Saviynt names are given in brackets.

## Sources and aggregation [security systems / endpoints, imports]
- PeopleHub is the **authoritative source**: every identity is an HR worker.
- The platform only knows what it last **aggregated**. After a change in a source, aggregate it before you trust what the console shows.
- Correlation rule: Active Directory by employeeID; applications by login = UPN, or by the employee ID the application stores.

## Uncorrelated accounts [orphan / unlinked accounts]
1. Aggregate the source.
2. For each uncorrelated account, find the person by **employee ID**, never by display name. Two people can share a name; an employee ID cannot.
3. If the employee ID belongs to a worker, correlate the account to that identity, whatever their status. If that worker is **Terminated**, the account must also be disabled.
4. If the account belongs to nobody (shared, agency, test), mark it as **no identity** and disable it.
5. Record every decision on the ticket.

## Certification campaigns [access reviews]
- Every line is decided: **Approve** (matches the person's job, or a current approved exception) or **Revoke**.
- Revoke: access of **Terminated** identities; **SoD** conflicts (keep the right that belongs to the job, revoke the other); access **outside the role** with no exception on file.
- Approve: birthright access for the current role, and lines covered by an exception listed in Governance > Access exceptions (check the expiry date).
- Never certify your own access, and never approve in bulk without reading the flags. A campaign that changes nothing is a finding, not a pass.
- **Sign off** only when every line is decided. Revocations on connected sources are provisioned automatically.
- Applications with no connector (PayrollPro) produce **manual work items**: deactivate the account in the application, then resolve the work item. Remediation is not finished until the account is gone.
`,
  'Privileged-Access-Vault-Standard.md': `# Privileged Access Vault Standard (SEC-STD-009)

The vault (https://vault.meridianhealth.test) is modelled on CyberArk Privileged Access Manager.

## Safes and roles
- **Use**: connect through a recorded session (PSM). You never see the password.
- **Retrieve**: show or copy the password. Every retrieval is audited and must be justified.
- **Approve**: second person for dual-control safes.
- **Manage**: onboard accounts, change passwords, register usages.

## Tier 0 (safe T0-DomainAdmins)
1. Raise or reference an **approved Change** (CHG) or a P1 incident.
2. Request access in the vault with the ticket number. A second person approves (dual control).
3. **Connect** through a session. Do not show or copy the password.
4. End the session when done. The password changes automatically at check-in.

## Passwords are never shared
Nobody (colleague, vendor or manager) is given a privileged password by email, chat or phone. Vendors work through a supervised, recorded session. A password that has been disclosed must be changed immediately.

## Service accounts
- Every privileged service account is in the vault with **automatic management** on (change every 30 days).
- Before the first change, register every **usage** (Windows service, scheduled task, application pool) on every server. The CPM updates registered usages; anything not registered keeps the old password and fails on its next restart.

## Break-glass accounts (safe BreakGlass)
Use only when normal administration is impossible (for example an Entra ID or MFA outage), under a P1 incident. After any use: change the password (reconcile), review the sign-in, and record it. A use with no matching incident is a security incident: raise a SIR, revoke the account's sessions and change the password.
`,
  'SSO-Troubleshooting-Runbook.md': `# SSO Troubleshooting Runbook (IAM-RB-003)

Single sign-on is a trust between Entra ID (the identity provider) and the application (the service provider). Both sides hold configuration and they must agree. Start every SSO ticket by reproducing it with **Test single sign-on** on the enterprise app, then read the error and the decoded response.

## SAML
| Error | Meaning | Fix |
|---|---|---|
| AADSTS700016 | The Identifier the app sends (its Entity ID) is not configured in Entra | Set **Identifier (Entity ID)** in Basic SAML Configuration to exactly what the app sends |
| AADSTS50011 | The app's ACS (Reply URL) is not in Entra's list | Add the exact Reply URL. No wildcards |
| AADSTS50105 | User not assigned | Fix the **group** that grants the app (birthright). Do not assign users directly |
| Signature / certificate error in the app | The signing certificate expired, or the app trusts a different certificate | New certificate in Entra > make active > give the new **thumbprint** to the app's SSO settings. Rotate before expiry |
| "User not found" in the app | NameID is not what the app looks users up by | Set the Unique User Identifier (Name ID) to user.userprincipalname or user.mail |

## OIDC
| Error | Meaning | Fix |
|---|---|---|
| AADSTS50011 | redirect_uri not registered | Add the exact redirect URI under Authentication |
| AADSTS7000222 | Client secret expired | New client secret (max 24 months), put the new secret in the app, then delete the old one |
| AADSTS7000215 | The app sends a secret Entra does not know | Give the app the secret **value**, not the secret ID |

Read the ID token: **aud** must be the app's client ID, **iss** the tenant, **exp** in the future.
`,
  'SoD-Matrix.csv': `RightA,RightB,Reason
grp-payroll-submit,grp-payroll-approve,The same person must not create and approve a pay run
grp-hr-managers,grp-finance-analysts,HR record write access combined with finance close is restricted
grp-iam-admins,grp-sec-ops,IAM administrators must not review their own audit logs
`,
};

function birthrightCsv(): string {
  const rows = JOB_ROLES.map((r) => `${r.department},${r.title},${r.group},"${birthright(r.group).join('; ')}"`);
  return ['Department,JobTitle,RoleGroup,BirthrightGroups', ...rows].join('\n') + '\n';
}

function appCatalogCsv(): string {
  return ['Application,IdentityProvider,Provisioning,AccessGroup,OwnerTitle,Notes', ...SAAS_CATALOG.map((a) => `${a.name},${a.idp},${a.provisioning},${a.group},${a.ownerTitle},"${a.description}"`), 'Microsoft 365,Entra ID,Entra Connect,grp-all-staff,IT Manager,"E3 license by group"'].join('\n') + '\n';
}

const REFERENCE: Record<string, () => string> = {
  'Birthright-Access-Matrix.csv': birthrightCsv,
  'Application-Catalog.csv': appCatalogCsv,
  'AD-Naming-Standard.md': () => `# AD Naming Standard

- sAMAccountName: first initial + surname, lower case (Grace Hopper -> ghopper). On a collision, append 2, 3 ... (ghopper2).
- userPrincipalName and mail: <sAMAccountName>@${COMPANY.domain}
- Display name: "First Last". Description is reserved for status notes (for example "Disabled 2026-10-19 per RITM0010412").
- Admin accounts: adm-<sAMAccountName>, in Corp/Admins.
- Service accounts: svc-<purpose>, in Corp/ServiceAccounts.
- Groups: grp-<resource> for resources, role-<job> for job roles, app-<application> for SSO assignment.
`,
  'OU-Design.md': () => `# OU Design: ${COMPANY.domain}

${OUS.map((o) => `- ${o}`).join('\n')}

Entra Connect sync scope: Corp/Users (and its children), Corp/Disabled Users, Corp/Admins.
Not synchronized: ${STAGING_OU} (pre-hire staging) and Corp/ServiceAccounts.
Departments: ${DEPARTMENTS.join(', ')}.
`,
  'Escalation-Contacts.txt': () => `ESCALATION CONTACTS (internal)
Security Operations ........ raise a Security Incident (SIR) in ServiceDesk; P1 = call the on-call phone
Domain Admin team ......... CHG ticket, CISO approval for Tier 0
HR Operations ............. hr-ops@${COMPANY.domain}
Application owners ........ see Application-Catalog.csv (OwnerTitle) and the group's managedBy
`,
};

const SCRIPTS: Record<string, string> = {
  'Get-StaleAccounts.ps1': `# Lists enabled users with no sign-in for 90 days. Review before acting.
Search-ADAccount -AccountInactive -TimeSpan 90.00:00:00 -UsersOnly | Where-Object { $_.Enabled -eq $true } | Select-Object SamAccountName, LastLogonDate, DistinguishedName
`,
  'Offboard-Template.ps1': `# Leaver template. Replace the values, run line by line, and read each result.
$sam = 'jdoe'
$ticket = 'RITM00XXXXX'
Disable-ADAccount -Identity $sam
Get-ADPrincipalGroupMembership -Identity $sam | Where-Object { $_.Name -ne 'Domain Users' } | ForEach-Object { Remove-ADGroupMember -Identity $_.Name -Members $sam -Confirm:$false }
Set-ADUser -Identity $sam -Description "Disabled $(Get-Date -Format yyyy-MM-dd) per $ticket"
Move-ADObject -Identity (Get-ADUser $sam).DistinguishedName -TargetPath 'OU=Disabled Users,OU=Corp,DC=meridianhealth,DC=test'
Start-ADSyncSyncCycle -PolicyType Delta
`,
  'Onboard-Template.ps1': `# Joiner template. Values come from PeopleHub, groups from Birthright-Access-Matrix.csv.
$first = 'First'; $last = 'Last'; $sam = 'flast'
New-ADUser -Name "$first $last" -GivenName $first -Surname $last -SamAccountName $sam -UserPrincipalName "$sam@meridianhealth.test" -Path 'OU=Finance,OU=Users,OU=Corp,DC=meridianhealth,DC=test' -Title 'Financial Analyst' -Department 'Finance' -EmployeeID 'E100500' -Manager 'vhale' -Enabled $false
Add-ADGroupMember -Identity 'grp-all-staff' -Members $sam
`,
};

export function seedFiles(w: World): VFile[] {
  const home = homeDir(w);
  const t = nowIso();
  const files: VFile[] = [];
  const add = (path: string, content: string, readOnly = true): void => {
    files.push({ path, content, modified: t, readOnly });
  };
  add(`${home}\\Desktop\\START-HERE.txt`, `Welcome to IAM Operations at ${COMPANY.name}, ${w.player.displayName}.

How we work here:
  1. Your work arrives in ServiceDesk (browser bookmark). Assignment group: IAM Operations.
  2. PeopleHub is the source of truth for every worker. Check it before you create, change or remove an account.
  3. Read the SOPs in Documents\\Policies before acting. Auditors compare our tickets against them.
  4. Make changes in AD Users and Computers or PowerShell. Entra ID and Okta follow on-premises AD after a sync.
  5. Write work notes as you go, and resolve with the right code. "Done" is not a resolution note.

Your normal account is ${w.player.sam}. Admin changes run as ${w.player.adminSam}.
Open the IAM Coach to start a lab or a full shift.
`, false);
  for (const [name, body] of Object.entries(POLICIES)) add(`${home}\\Documents\\Policies\\${name}`, body);
  for (const [name, fn] of Object.entries(REFERENCE)) add(`${home}\\Documents\\Reference\\${name}`, fn());
  for (const [name, body] of Object.entries(SCRIPTS)) add(`${home}\\Documents\\Scripts\\${name}`, body, false);
  for (const pdf of samplePdfs(COMPANY.name, COMPANY.domain)) add(`${home}\\${pdf.folder}\\${pdf.name}`, pdf.content, false);
  add(`${home}\\Documents\\Evidence\\README.txt`, 'Save your own notes and evidence here (Notepad > Save As). Everything in this range is simulated; label it that way in your portfolio.\n', false);
  return files;
}

/** Worlds saved before PDF-XChange Editor was added get its sample PDFs on load. */
export function ensureSamplePdfs(w: World): World {
  const home = homeDir(w);
  for (const pdf of samplePdfs(COMPANY.name, COMPANY.domain)) {
    const path = `${home}\\${pdf.folder}\\${pdf.name}`;
    if (!w.files.some((f) => f.path.toLowerCase() === path.toLowerCase())) w.files.push({ path, content: pdf.content, modified: w.created, readOnly: false });
  }
  return w;
}

/** Worlds created before a policy was added get it the first time a lab needs it. */
export function ensurePolicyDocs(w: World): void {
  const home = homeDir(w);
  for (const [name, body] of Object.entries(POLICIES)) {
    const path = `${home}\\Documents\\Policies\\${name}`;
    if (!w.files.some((f) => f.path.toLowerCase() === path.toLowerCase())) w.files.push({ path, content: body, modified: nowIso(), readOnly: true });
  }
}

export function writeFile(w: World, path: string, content: string): void {
  const existing = w.files.find((f) => f.path.toLowerCase() === path.toLowerCase() && !f.deleted);
  if (existing) {
    if (existing.readOnly) throw new Error(`Access to the path '${path}' is denied. (Policy documents are read-only.)`);
    existing.content = content;
    existing.modified = nowIso();
    return;
  }
  w.files.push({ path, content, modified: nowIso(), readOnly: false });
}

export function readFile(w: World, path: string): string {
  const f = w.files.find((x) => x.path.toLowerCase() === path.toLowerCase() && !x.deleted);
  if (!f) throw new Error(`Cannot find path '${path}' because it does not exist.`);
  return f.content;
}

// ------------------------------------------------------------------- file operations (Explorer, desktop)

const live = (w: World): VFile[] => w.files.filter((f) => !f.deleted);

export function fileExists(w: World, path: string): boolean {
  return live(w).some((f) => f.path.toLowerCase() === path.toLowerCase());
}

/** "New Text Document.txt", then "New Text Document (2).txt", as Explorer names them. */
export function newFile(w: World, dir: string, base: string, ext: string, content = ''): string {
  let path = `${dir}\\${base}${ext}`;
  for (let n = 2; fileExists(w, path); n++) path = `${dir}\\${base} (${n})${ext}`;
  w.files.push({ path, content, modified: nowIso(), readOnly: false });
  return path;
}

export function renameFile(w: World, path: string, newName: string): string {
  const f = live(w).find((x) => x.path.toLowerCase() === path.toLowerCase());
  if (!f) throw new Error(`Cannot find path '${path}' because it does not exist.`);
  const name = newName.trim();
  if (!name || /[\\/:*?"<>|]/.test(name)) throw new Error('A file name can\'t contain any of the following characters: \\ / : * ? " < > |');
  const next = `${path.split('\\').slice(0, -1).join('\\')}\\${name}`;
  if (next.toLowerCase() !== path.toLowerCase() && fileExists(w, next)) throw new Error(`There is already a file with the same name in this location.`);
  if (f.readOnly) throw new Error('You need permission to perform this action. (Policy documents are read-only.)');
  f.path = next;
  f.modified = nowIso();
  return next;
}

export function deleteFile(w: World, path: string): void {
  const f = live(w).find((x) => x.path.toLowerCase() === path.toLowerCase());
  if (!f) throw new Error(`Cannot find path '${path}' because it does not exist.`);
  if (f.readOnly) throw new Error('You need permission to perform this action. (Policy documents are read-only.)');
  f.deleted = { from: f.path, at: nowIso() };
}

export function restoreFile(w: World, path: string): void {
  const f = w.files.find((x) => x.deleted && x.path === path);
  if (!f) return;
  if (fileExists(w, f.path)) f.path = f.path.replace(/(\.[^.\\]+)?$/, ' (restored)$1');
  f.deleted = undefined;
}

export function emptyRecycleBin(w: World): void {
  w.files = w.files.filter((f) => !f.deleted);
}

export function copyFile(w: World, from: string, toDir: string): string {
  const f = live(w).find((x) => x.path.toLowerCase() === from.toLowerCase());
  if (!f) throw new Error(`Cannot find path '${from}' because it does not exist.`);
  const name = f.path.split('\\').pop()!;
  const dot = name.lastIndexOf('.');
  return newFile(w, toDir, dot > 0 ? name.slice(0, dot) : name, dot > 0 ? name.slice(dot) : '', f.content);
}
