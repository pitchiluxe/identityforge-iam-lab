# MSP companies, Azure portal and ServiceNow: design

Date: 2026-10-28. Status: draft for approval.

## Intent

The learner should practise the job of an IAM / service-desk engineer at a managed service provider: one ServiceNow queue, many customer companies, each with its own AD domain and Entra tenant, and real-world tickets (JML, access, MFA, RBAC, suspicious requests) that the Range checks before it lets them close. Today the Range has one company (Meridian) and its own ServiceDesk; this adds ten more companies, a ServiceNow instance that generates tickets for them, and an Azure portal that feels like the real one.

The Range is the police: a ticket cannot be resolved while its critical checks fail, and every batch of tickets ends with feedback.

## Goals

1. **Ten new fictional companies**, created by default, alongside Meridian (unchanged). Each has an AD domain visible in ADUC and PowerShell, an Entra tenant visible in the Azure portal, an HR feed, workstations, and its own starting reality (some empty, some with history).
2. **JML everywhere.** Joiner/mover/leaver can be done in ADUC, the PowerShell console/ISE/Windows Terminal (including the learner's own scripts), or the Azure portal for cloud-only work. Changes flow across platforms with the same rules Meridian has today.
3. **Azure portal (lab copy)** at `https://portal.azure.range`, feeling like the real portal: home, top search, Cloud Shell button, notifications, directory + subscription switcher, All services, blades and breadcrumbs.
4. **ServiceNow** at `https://msp.service-now.range`: company picker, **Generate** button, ticket list/form, work notes, resolve, escalate. Tickets are random but logical for the chosen company's current state.
5. **Ollama writes the words, templates hold the facts.** Generated tickets read like real users wrote them; every fact and every check comes from a template.
6. **Suspicious tickets** mixed in (target about 1 in 5). The right answer is escalate or decline, and the tenant must show the risky change was not made.
7. **Escalation verdicts.** Escalating gets a response from the Range: accepted (with next steps), declined ("routine, proceed" and the ticket comes back), or redirected (wrong team).
8. **Feedback** after every ticket resolve attempt and a report card after every lab (generated batch).
9. **Remote Desktop by company.** Every user gets a workstation; RDP lists machines in company folders so the learner can sign in as the user to test.
10. **New bookmarks only.** Existing sites and bookmarks (including the real `portal.azure.com` link in "Real portals") stay as they are.

## Non-goals

- No connection to real Azure, Microsoft Graph or a real ServiceNow instance. Everything lives in the Range world.
- Not every Azure service in depth (see "Azure portal scope").
- No changes to Meridian's existing labs, seed or grading.

## Anti-goals (would be a failure even if it works)

- **A ticket that can be closed while wrong.** If the grader can't check something, the template doesn't ask for it.
- **Ollama deciding facts.** A ticket naming a person, group, laptop or deadline that the systems don't show.
- **A suspicious ticket that passes because the learner clicked "Escalate" after already making the change.**
- **Something that works as a phishing page.** The lab portal must never ask for real Microsoft credentials and must be clearly a Range simulation (persistent "Meridian IAM Range training simulation" marker in the portal header and sign-in page, fictional `.range` host, no Microsoft logo assets, only lab accounts accepted). The web edition is public on Vercel, so this matters.
- Controls that do nothing (existing project rule: remove a control rather than fake it).
- Breaking saved Meridian worlds or career progress.

## Constraints (from the codebase)

- Vanilla TS, explicit `.ts` imports, erasable syntax only; tests run with `node --test`.
- `src/world/*` is the only code that mutates a world; ADUC, PowerShell and portals call it so they never disagree. Every world function takes a `World`.
- `core/time.ts` is the only clock. UI text via `textContent`/`h()` only.
- Scenario templates return `CheckSpec` data; only `grader.ts` evaluates; every template has `solve` and (for traps) `naive`; `tests/scenarios.test.ts` replays template × twist × 5 seeds; `tests/consistency.test.ts` checks tickets only name things that exist.
- Ollama rules in `ai/ollama.ts`: model output validated, `factTokens` must survive rewording, never auto-pick `:cloud` models. Ollama is optional: with it off, templates' own wording is used.
- State persists to localStorage (`ui/store.ts`), roughly 5 MB per origin. Eleven full worlds is a real risk (see "Storage").
- `index.html` CSP and `tests/branding.test.ts` apply to anything new.

## Design

### 1. Companies as worlds

**Decision:** each company is its own `World` (same type Meridian uses), so every existing world function, ADUC, the PowerShell engine, the grader and the monitor work on it unchanged. The store holds the active world plus the others:

- `store.world` remains "the world currently in focus" (what ADUC, PowerShell and the portals act on by default).
- New `store.worlds: Record<CompanyId, World>`, with Meridian under `meridian`.
- Switching focus: ADUC **Change Domain...**, AD cmdlets' `-Server <domain>`, the Azure portal's **Switch directory**, and ServiceNow (opening a ticket focuses its company). Graph-style cmdlets follow `Connect-MgGraph -TenantId <tenant>`.

**Refactor needed:** `world/company.ts` exports Meridian as module constants (`COMPANY`, `DEPARTMENTS`, OU paths, groups, roles, birthright) that world functions, seed and docs read directly. These move into a `CompanyProfile` stored on each world (`w.profile`), with Meridian's profile reproducing today's values exactly. Code reading the constants switches to the world's profile. Meridian's tests must pass unchanged; that is the proof the refactor is behaviour-preserving.

### 2. The ten companies

All fictional, `.test` domains, `.onmicrosoft.test` tenants. Each profile defines industry, departments, OU tree, naming convention (sam/UPN format), job roles, birthright groups, apps (SCIM or manual), whether Okta exists, sync scope, and its starting reality.

| # | Company | Domain | Starting reality |
|---|---|---|---|
| 1 | Harborline Logistics | harborline.test | **Greenfield.** Fresh domain, default containers only, empty tenant. First tickets build OUs, groups and first hires. |
| 2 | Brightwater Law LLP | brightwaterlaw.test | Small (~25), clean, strict matter-based access. |
| 3 | Kestrel Manufacturing | kestrelmfg.test | Mid-size (~120), **messy**: stale accounts, orphaned groups, no owners, shared accounts on the shop floor. |
| 4 | Alder Valley University | aldervalley.test | Faculty, staff, students; high churn each term; guest researchers. |
| 5 | Summit Ridge Credit Union | summitridgecu.test | Regulated finance: PIM for all admin roles, strict CA, separation of duties. |
| 6 | Pinecrest Retail Group | pinecrestretail.test | Stores plus head office; frontline and seasonal workers; shared kiosk devices. |
| 7 | Lumen BioLabs | lumenbio.test | Research; many B2B guests; external collaborators expiring. |
| 8 | Cobalt Software | cobaltsoft.test | **Near-greenfield, cloud-first:** tiny AD, most work in Entra (app registrations, managed identities, RBAC). |
| 9 | Riverside County Services | riversidecounty.test | Government: contractors with sponsors, background-check gates, records retention for leavers. |
| 10 | Atlas Energy Partners | atlasenergy.test | **Mid-merger:** acquired company's accounts with a second naming convention to reconcile. |

"Created by default" means every company appears everywhere (ADUC domain list, Azure directory list, ServiceNow picker, RDP folders) from first launch. A company's world is generated deterministically from its seed when first opened (see "Storage"), so the learner sees no difference.

### 3. JML and sync

- Each company has an HR feed (its world's `hr`) and the same JML mechanics Meridian has: joiners from HR, staging/disabled OUs, birthright from the profile, leavers disabled then cleaned up.
- The learner chooses their tool. PowerShell gets `-Server` on AD cmdlets. Each company's HR feed is also exported to the virtual disk (for example `C:\MSP\Harborline\hr-feed.csv`) so learners can write and run their own JML scripts against it.
- Sync per company follows Meridian's rules: AD changes reach Entra only after a sync cycle (`runEntraSync`), synced attributes are read-only in the cloud, disable does not revoke sessions, and out-of-scope OUs don't sync. Companies with Okta/SCIM apps push onward as Meridian does; manual apps raise work items.
- Cloud-only users (created in the Azure portal) exist only in Entra, as in reality.

### 4. Workstations and Remote Desktop

- Creating a user by any route (ADUC, PowerShell, Azure portal for joined devices, ServiceNow joiner) through the world layer also creates a computer object named by the company's convention (`HBL-WKS-0142`) with `primaryUser` set, in the company's Computers OU, and an Entra device record once synced.
- Remote Desktop's connect screen groups machines **by company folder → user → machine**. Both existing modes (help a user, verify a sign-in) work against the chosen company's directory with the real `signIn` refusal logic.
- Leavers: the machine stays listed, marked disabled/reclaimed as AD shows it.
- Tickets can require a verified sign-in. The check is an audit event of a successful sign-in on that user's machine after the fix.

### 5. Azure portal scope

`https://portal.azure.range`, Fluent-style look and navigation of the real portal. Directory switcher lists all eleven tenants.

**Full depth (identity and access):** Microsoft Entra ID overview; Users (all/deleted, create, invite guest, bulk ops, properties, authentication methods, revoke sessions, reset password, licences, groups, roles, devices, audit/sign-in logs per user); Groups (security/M365, assigned/dynamic membership rules, owners, members); Devices; Enterprise applications (provisioning, users and groups, SSO overview); App registrations (secrets/certificates, API permissions, admin consent); Roles and administrators; Administrative units; Privileged Identity Management (eligible/active, activation with justification, access reviews); Conditional Access (policies, named locations, what-if); Authentication methods policy; Identity Protection (risky users/sign-ins); Licences; Sign-in and audit logs; Entra Connect status (last sync, errors); External Identities (guests, cross-tenant settings); Subscriptions and Resource groups with **Access control (IAM)** on every scope (role assignments, check access, deny assignments view, built-in role definitions); Key Vault (access policies vs RBAC); Managed identities.

**Real but light:** the other services appear in All services and search. The common ones (virtual machines, storage accounts, virtual networks, app services, SQL databases) support list, create (minimal fields), delete and Access control (IAM), so RBAC tickets have real targets. Others open a real "No resources to display" list with a Create button that says the service is not part of the lab. That is honest, not a fake control.

New world part: `world.azure` (subscriptions, resource groups, resources, role assignments, PIM for Azure resources), created lazily (`ensureAzure`) like `ensureIga`/`ensurePam`, so saved worlds load without a version bump.

**Sign-in:** the portal shows a lab sign-in page that accepts lab admin accounts of the selected tenant, and a **Create account** flow that creates a lab admin account in that tenant (written to its audit). It states plainly that it is a Range simulation and never to type a real Microsoft password.

### 6. ServiceNow

`https://msp.service-now.range`, look of a ServiceNow workspace (list views, ticket form, work notes, activity stream), separate from the existing Meridian ServiceDesk.

- **Company picker** listing the ten companies (Meridian keeps its own ServiceDesk and is not in the MSP picker), with each one's state (staff count, open tickets, last lab score).
- **Generate** creates a lab: a batch of 3 to 8 tickets (learner picks size and difficulty) for the chosen company, chosen from templates that fit its current state. Greenfield companies get build-out work first; leaver tickets only appear if there is someone to leave; mover tickets only for existing staff. Suspicious tickets are mixed in at about 1 in 5.
- **Ollama** rewrites caller text, tone and backstory per company and industry, and must keep every `factTokens` value. Without Ollama, the template's own wording is used and everything still works.
- **Ticket actions:** work notes, Resolve (with resolution code and notes), Escalate (choose a team: Security, Manager/approver, Change Advisory Board, Tier 3, plus a reason), Put on hold awaiting caller.

### 7. Policing and feedback

- **Resolve is gated.** On Resolve, the grader runs the ticket's checks. If a critical check fails, the resolution is rejected, the ticket stays open, and the learner gets a hint that names the area, not the answer ("The account exists, but its access doesn't match a Paralegal's birthright"). After repeated failed attempts, the hint gets more specific. Each attempt is recorded and affects the score.
- **Suspicious tickets:** pass only if escalated/declined with the right resolution code **and** the world shows the risky change was never made (audit-based, so doing it then undoing it still fails the critical check).
- **Escalation verdicts** come from the template, not the model: *accepted* (correct team; Range replies as that team with what happens next and closes or returns with instructions), *declined* (routine work; "this is a standard request, proceed", ticket returns, counts as an over-escalation), *redirected* (right instinct, wrong team).
- **Per-lab report card** after the last ticket in a batch is resolved or abandoned: each ticket pass/fail, critical misses, attempts, over/under-escalations, time, and "what a senior engineer would have done" (from the template's `solve`, described in plain steps). Ollama may phrase the coaching, but results come from the grader. Saved to career progress (stored separately from worlds, as today).

### 8. Templates and checks

- New library `scenarios/msp/` of company-generic templates parameterised by the world's profile, covering: greenfield build-out (OUs, groups, first hires), joiner (hybrid and cloud-only), mover, leaver (standard, urgent/hostile, contractor end), rehire, name change, password/lockout, MFA re-registration, guest invite and expiry, licence assignment, group ownership, dynamic group rules, app access via enterprise app, app registration secret rotation, PIM activation/eligibility, CA exclusion request, Azure RBAC on a resource group/resource, Key Vault access, managed identity access, stale account cleanup, merger account reconciliation; and suspicious: urgent exec asks for Global Admin, MFA reset for an unverified caller, lookalike-domain request, request to disable auditing/CA, bulk export of users, access request on behalf of someone else without approval, a leaver's manager asking for their mailbox password.
- New check kinds in `grader.ts` as needed: Azure role assignment at scope, PIM eligibility, Entra-only attribute, device state, verified sign-in on machine, ticket escalated to team, change-never-made (audit absence since ticket open), ticket resolution code.
- Tests mirror the existing ones: every MSP template × twist × 5 seeds × every company where it applies (untouched fails, `solve` passes, `naive` fails a critical check); a consistency test that every person/machine/group a ticket names exists in that company's systems.

### 9. Bookmarks

Add `Azure portal (lab)` and `ServiceNow` as new Range sites (bookmark bar and new-tab tiles). Do not change or remove any existing site or bookmark.

### 10. Storage

Eleven worlds may exceed localStorage. Each company world is stored under its own key, generated from its seed only when first opened, and stays as just its seed until then. A size test seeds every company, runs a full batch on each, and fails if the total stored size exceeds a budget (target: under 4 MB). If it can't fit, the fallback is IndexedDB for company worlds, with loads kept synchronous to the UI through an in-memory cache. That is the builder's call if the budget test fails.

## Decisions settled after review (designer's calls)

1. **Shared workstation vs company state.** The learner's workstation is one shared layer: `files` (C: drive, scripts, HR feed exports for every company under `C:\MSP\<Company>\`), `mail`, settings and career progress. Each company world holds only its organisation: `ad`, `entra`, `okta`, `saas`, `hr`, `tickets`, `audit`, `scenarios`, `azure`, `iga`, `pam`, counters. Meridian's world keeps its own files/mail as today, and the shared layer is what the workstation shows.
2. **The learner in each company** is an MSP engineer with a delegated admin account seeded in every company (`msp-<login>` in AD, `msp-<login>@<tenant>` in Entra, scoped like real GDAP: no Tier 0 / Global Admin by default). It is that world's `player` and audit actor. The Azure portal's **Create account** adds further lab admin accounts to the tenant.
3. **Tickets and scenarios.** Each generated ticket is one `ScenarioInstance` with its ticket, stored inside its company's world, so the grader and monitor work unchanged. ServiceNow's queue is a view across worlds. A **lab** (generated batch) is a record in the shared layer listing `(companyId, scenarioId)` pairs; the report card reads it.
4. **Meridian is untouched.** It is not in the MSP picker; the workstation-per-user hook and MSP templates apply only to the ten MSP companies (hook driven by the profile, off for Meridian). Existing Meridian tests and the consistency test must stay green unchanged.
5. **`-Server` is per command,** as in real AD. World functions already take an explicit `World`; `act()` gains an optional target world, and the monitor re-grades whichever world changed. `Connect-MgGraph -TenantId` sets the Graph context for that console session. ADUC Change Domain and the Azure directory switcher change what those apps show, not the whole workstation.
6. **Every opened company keeps running.** Sync schedulers, the monitor and time-driven events run for every materialised world, not only the focused one, so no ticket depends on which company is on screen.
7. **"Change never made"** is scoped to the ticket's specific target object and action (for example: role `Global Administrator` on `user X`, MFA methods of `user Y`), from audit events since the ticket opened. Unrelated legitimate changes in the same batch don't count.
8. **Escalation outcomes** are declared per template: `closed` (the team takes over; correct escalation earns full credit and the ticket closes) or `returned` (the team replies with instructions; the ticket comes back and must then be resolved under the same gate for credit). Declined and redirected escalations always return the ticket and count against the score.

## Build order

1. Profile refactor (Meridian behaviour unchanged, all existing tests green), multi-world store, ten company profiles and seeds, ADUC Change Domain, `-Server`, HR feed export.
2. Workstations per user and RDP company folders.
3. `world.azure` and the Azure portal (identity blades first, then RBAC/resources, then light services).
4. ServiceNow site, MSP template library, generator, Ollama rewording, gated resolve, escalation verdicts, report card.

Each step ships working and tested on its own.

## Left to the builder

Exact visual details of the portal and ServiceNow pages; staff counts and names per company (seeded, realistic); exact hint wording ladder; batch-size defaults; how the PowerShell prompt shows the focused domain.
