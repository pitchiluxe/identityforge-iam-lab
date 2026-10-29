# MSP Stage 4 (ServiceNow: tickets that police the work) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ServiceNow instance where the learner picks a company, clicks **Generate**, and works a realistic queue (JML, access, MFA, licences, RBAC, guests, plus suspicious requests) that the Range checks: Resolve is refused while the work is wrong, escalations get a verdict, and every lab ends with a report card.

**Architecture:** Reuse the scenario engine (templates build evidence, return `CheckSpec` data; only `grader.ts` evaluates). New company-generic templates in `scenarios/msp/` read the world's profile. New world logic in `world/servicenow.ts`: gated resolve (grade first, revert and hint on failure), escalation with template-declared verdicts, lab generation and the report card. New check kinds in `grader.ts`. The site `ui/sites/servicenow.ts` at `msp.service-now.range` lists every company's tickets, with the company picker and Generate. Ollama only rewords (existing `rewordTicket` + `factTokens`, extended for company names/domains).

**Spec:** `docs/superpowers/specs/2026-10-28-msp-companies-azure-servicenow-design.md` sections 6–8, decisions 3, 7, 8.

## Global Constraints
- Ollama never decides facts or grades; with Ollama off, template wording is used.
- Every MSP template has `solve` and (for traps/suspicious) `naive`; tests replay template × twist × 5 seeds × every company it fits: untouched fails, solve passes, naive fails a critical check.
- A ticket may only name people, machines, groups and apps the company's systems show (MSP consistency test).
- Suspicious tickets pass only with the right escalation/decline **and** no matching change in the audit since the ticket opened (scoped to target + action).
- Lab records live in career storage (survive company resets); company worlds hold tickets/scenarios.
- Meridian's ServiceDesk, templates and tests unchanged.

## Stage 4a — engine and templates (this session)

### Task 1: New check kinds
`grader.ts` + `CheckSpec`:
- `{ k: 'neverChanged'; target: string; actions: string[]; since: string }` — no audit event with that target (case-insensitive, also matched in detail) and an action in the list after `since`, excluding setup audit.
- `{ k: 'escalatedTo'; ticket: string; team: EscalationTeam }`.
- `{ k: 'cloudGroupMember'; upn; group; value }`, `{ k: 'entraLicense'; upn; sku; value }`, `{ k: 'azureRole'; principal; role; scope; value }` (direct assignment at exactly that scope), `{ k: 'tapIssuedSince'; upn; since }`, `{ k: 'entraGuest'; email; value }`, `{ k: 'adOuExists'; ou; value }`.
Tests: each kind pass/fail.

### Task 2: Escalation and gated resolve (`world/servicenow.ts`)
- `EscalationTeam = 'Security Operations' | 'Customer approver' | 'Change Advisory Board' | 'Tier 3 Engineering'`.
- `Built.escalation?: { team; outcome: 'closed' | 'returned'; response: string }` stored on the instance; instance gains `attempts?: number; escalations?: { team; verdict: 'accepted' | 'declined' | 'redirected'; time }[]`.
- `escalateTicket(w, ticketId, team, reason) -> { verdict, response }`: expected & same team → accepted (closed: ticket resolved `Escalated to Security`/`Rejected - Not Approved` per template; returned: state In Progress + response as work note); expected & other team → redirected; not expected → declined ("This is a standard request in your scope: proceed."); always a work note + audit.
- `resolveGated(w, ticketId, code, notes) -> { accepted; message; hint? }`: applies the resolution, grades; if a critical check fails, restores the ticket (state, resolution) and returns a hint from a ladder (attempt 1: failing check's label; 2: its detail; 3+: the template's next hint); on success marks scenario passed and records the result. Tickets without a scenario resolve normally.
Tests: verdict matrix; gated resolve rejects then accepts after the fix; attempts counted.

### Task 3: MSP templates (`scenarios/msp/*.ts`, registered in `MSP_TEMPLATES`)
Company-generic (read `profileById(w.profileId)`), each with `fits(w)`:
1. `msp-joiner` — HR pending/new hire → AD account in the dept OU with exact birthright, enabled with must-change, synced to Entra. Twist `contractor` (end date → account expiry).
2. `msp-leaver` — termination → disable, remove role groups, revoke Entra sessions; twist `urgent` (involuntary, same day).
3. `msp-mover` — transfer → title/department/OU, birthright swap.
4. `msp-mfa-reset` — new phone → (activate PIM) require re-register; identity verified via HR phone last 4 in the ticket.
5. `msp-license` — P2 for a security reviewer (needs usage location).
6. `msp-rbac-reader` — Reader on a resource group for an auditor (Azure portal).
7. `msp-guest` — invite a named partner guest (allowed domain).
8. `msp-greenfield-ou` — Harborline only: create OU tree (Users/Groups/Computers/Disabled) and first department OUs.
Suspicious (all `trap`):
9. `msp-sus-global-admin` — "CEO" asks to make an outside consultant Global Administrator today → escalate Security Operations (closed); neverChanged role on target.
10. `msp-sus-mfa-unverified` — caller from personal mail, wrong phone last 4, asks MFA reset → resolve `Unable to Verify Identity` or escalate Security (closed); neverChanged MFA on target.
11. `msp-sus-lookalike` — request from a lookalike domain to add an external address to a finance group → escalate Security (closed); no guest from that domain, no membership change.
12. `msp-sus-export` — manager asks for a full user export to a personal address → `Rejected - Policy`; neverChanged (no mail sent externally).
Plus a non-suspicious **escalation** case: 13. `msp-role-request` — legitimate request for Helpdesk Administrator for the new service desk lead → MSP lacks rights: escalate to Customer approver (returned with instruction to raise via the customer's Global Admin) — resolve `Rejected - Not Approved` after the response.
Tests: replay matrix; MSP consistency (names exist).

### Task 4: Lab generation and report card (pure)
- `generateLab(w, opts: { count: 3..8; difficulty: 1|2|3; seed }) -> ScenarioInstance[]` — picks fitting templates, no duplicate targets, ~1 in 5 suspicious (at least one when count ≥ 4).
- `labReport(w, scenarioIds, escalations) -> { tickets: { id, title, passed, attempts, escalation, missed: string[], senior: string }[]; score; summary }` — score = mean check pass % minus 10 per extra resolve attempt and 15 per wrong escalation (min 0); `senior` = the template's `debrief`.
Tests: generator respects fits/size/suspicious share; report penalties.

## Stage 4b — ServiceNow site (next session)
- `ui/sites/servicenow.ts` at `msp.service-now.range` (new bookmark): Lab picker (company list with staff/open tickets/last score), Generate (size, difficulty), queue across companies, ticket form (work notes, Resolve with code, Escalate with team + reason, On hold), report card on lab completion; Ollama rewording on generate (setting `rewordTickets`), company names/domains/hosts added to `factTokens`.
- IAM Coach > Lab accounts lists company passwords.
- Manual run through a full lab per company type.
