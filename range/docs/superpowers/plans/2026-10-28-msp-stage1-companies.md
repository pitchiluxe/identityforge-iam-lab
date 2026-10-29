# MSP Stage 1 (ten companies as worlds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ten fictional MSP customer companies exist by default as their own AD domains and Entra tenants, visible in ADUC (Change Domain) and PowerShell (`-Server`), with HR feeds exported to the workstation, while Meridian behaves exactly as before.

**Architecture:** Each company is a full `World` built by `createCompanyWorld(profile, seed)` from a `CompanyProfile`. Meridian stays the focused/workstation world (`store.world`); company worlds live in `store.worlds`, persisted per company under their own key and generated lazily from a seed. The world layer stops reading Meridian constants where a company world would get Meridian values (DC string, default UPN suffix, sync scope); Meridian-only scenario templates keep their constants.

**Tech Stack:** Vanilla TypeScript (erasable syntax, explicit `.ts` imports), Vite, `node --test` on `.ts` files (Node >= 22.18).

**Spec:** `docs/superpowers/specs/2026-10-28-msp-companies-azure-servicenow-design.md` (sections 1-3, 10, decisions 1, 2, 4, 5, 6).

## Global Constraints

- Meridian unchanged: every existing test in `tests/` passes without edits to its assertions.
- World mutation only in `src/world/*`; world functions take an explicit `World`; no `Date.now()` in world code (use `core/time.ts`).
- UI text via `textContent` / `h()` only.
- Fictional data only: domains `<name>.test`, tenants `<name>.onmicrosoft.test`.
- No `WORLD_VERSION` bump for Meridian; company worlds carry `profileId`, absent means Meridian.
- Storage budget: all ten company worlds, materialised, total under 4 MB serialised.
- No git repo in `range/`: "checkpoint" = full `npm test` + `npm run typecheck` green.

## Review Focus

1. A saved Meridian world from before this change loads and plays unchanged (no `profileId`, no `store.worlds` key yet). Test in Task 4.
2. `New-ADUser` in a company via `-Server` gets that company's UPN suffix and DN, not `meridianhealth.test`. Test in Task 2 and Task 5.
3. `-Server` with an unknown domain gives the real AD error, not a silent fall-back to Meridian. Test in Task 5.
4. Entra sync on a company world only syncs that company's in-scope OUs (its own `entra.syncScope`), not Meridian's paths. Test in Task 2.
5. localStorage full / blocked: company worlds still work in memory, Meridian save is not lost. Test in Task 4.

---

## File structure

- Create `src/world/profiles.ts`: `CompanyProfile` type and `MSP_COMPANIES` (the ten profiles). Pure data plus validators.
- Create `src/world/mspSeed.ts`: `createCompanyWorld(profile, seed): World`, starting realities.
- Modify `src/world/directory.ts`: DC/UPN from `w.ad.domain`.
- Modify `src/world/cloud.ts`: `inSyncScope(w, u)` from `w.entra.syncScope`; group OU from the world.
- Modify `src/core/types.ts`: `World.profileId?: string`; `Worker.department` widened to `string`.
- Create `src/ui/companies.ts`: multi-world store (`store.worlds`, `companyWorld(id)`, `worldByDomain(domain)`, persistence, HR feed export).
- Modify `src/ui/store.ts`: `act(fn, success?, target?)`; persist company worlds.
- Modify `src/terminal/shell.ts`: `-Server` resolution via injected resolver.
- Modify `src/ui/aduc/window.ts`, `src/ui/aduc/shim/config.ts`: Change Domain switches ADUC's world.
- Tests: `tests/profiles.test.ts`, `tests/companies.test.ts`, `tests/msp-store.test.ts`, extend `tests/terminal.test.ts`, `tests/aduc-adapter.test.ts`.

---

### Task 1: Company profiles

**Files:**
- Create: `src/world/profiles.ts`
- Test: `tests/profiles.test.ts`

**Interfaces:**
- Produces:
```ts
export type StartingReality = 'greenfield' | 'clean' | 'messy' | 'churn' | 'regulated' | 'frontline' | 'research' | 'cloud-first' | 'government' | 'merger';
export interface ProfileRole { title: string; department: string; roleGroup: string; lead: boolean }
export interface CompanyProfile {
  id: string;            // 'harborline'
  name: string;          // 'Harborline Logistics'
  industry: string;
  domain: string;        // 'harborline.test'
  netbios: string;       // <= 15 chars, uppercase
  tenant: string;        // 'harborline.onmicrosoft.test'
  prefix: string;        // computer/name prefix, 3 letters, 'HBL'
  reality: StartingReality;
  staff: number;         // target seeded headcount (0 for greenfield)
  departments: string[];
  ous: string[];         // path form, root first ('' for greenfield beyond defaults)
  usersOu: string; disabledOu: string; stagingOu: string; groupsOu: string; computersOu: string;
  syncScope: string[];
  samFormat: 'first.last' | 'flast' | 'firstl';
  roles: ProfileRole[];
  baseAccess: string[];
  roleAccess: Record<string, string[]>;   // roleGroup -> groups
  groups: { name: string; description: string; privileged?: boolean }[];
  hasOkta: boolean;
  locations: string[];
  seed: number;          // fixed per company, makes the world deterministic
}
export const MSP_COMPANIES: readonly CompanyProfile[];
export function profileById(id: string): CompanyProfile | undefined;
export function profileProblems(p: CompanyProfile): string[];   // [] when valid
```

- [ ] **Step 1: Write the failing test** `tests/profiles.test.ts`:
  - `MSP_COMPANIES.length === 10`; ids, domains, netbios, prefixes all unique; none equals `meridianhealth.test`.
  - The ten ids/domains/realities exactly as the spec table: harborline/harborline.test/greenfield, brightwater/brightwaterlaw.test/clean, kestrel/kestrelmfg.test/messy, aldervalley/aldervalley.test/churn, summitridge/summitridgecu.test/regulated, pinecrest/pinecrestretail.test/frontline, lumen/lumenbio.test/research, cobalt/cobaltsoft.test/cloud-first, riverside/riversidecounty.test/government, atlas/atlasenergy.test/merger.
  - `profileProblems(p)` is `[]` for every profile; and returns a problem for a copy whose `roleAccess` names a group not in `groups`, and for `netbios` longer than 15.
  - Every domain ends `.test`, every tenant ends `.onmicrosoft.test`.
  - harborline `staff === 0`; cobalt `staff <= 10`; kestrel `staff >= 100`.
- [ ] **Step 2: Run** `node --test tests/profiles.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/world/profiles.ts`. `profileProblems` checks: netbios length/uppercase, every role's department in `departments`, every roleAccess/baseAccess group in `groups`, `syncScope` paths within `ous` (greenfield exempt: empty `ous` allowed), every department has a role. Realistic industry-appropriate departments/titles per company (law: Partners, Associates, Paralegals, Legal Ops, Finance, IT; university: Faculty, Students, Registrar, Research, IT; and so on). Group names follow each company's own convention (vary between companies: `SG-`, `GRP_`, `sec-`). Atlas: two conventions present.
- [ ] **Step 4: Run** `node --test tests/profiles.test.ts`. Expected: PASS.

---

### Task 2: World layer works on any company's world

**Files:**
- Modify: `src/world/directory.ts:20,111`, `src/world/cloud.ts:16,31-33` (+ callers of `inSyncScope`)
- Modify: `src/core/types.ts` (`World.profileId?: string`; `Worker.department: string`)
- Test: `tests/companies.test.ts` (world-layer part; uses a minimal hand-built company World literal so it doesn't depend on Task 3)

**Interfaces:**
- Produces: `inSyncScope(w: World, u: AdUser): boolean` (was `inSyncScope(u)`), reading `w.entra.syncScope`. `dnOf`, `groupDn`, `ouToDn` derive DC components from the world's domain (signature change allowed: add `w` first param where they need it; update all callers).

- [ ] **Step 1: Failing tests:**
  - `createUser(w, {...no upn})` on a world with `ad.domain = 'brightwaterlaw.test'` gives `upn` ending `@brightwaterlaw.test` and a DN ending `DC=brightwaterlaw,DC=test`.
  - `runEntraSync(w)` on that world with `entra.syncScope = ['Firm/People']` syncs a user in `Firm/People/Legal` and not one in `Firm/Staging`.
  - Meridian: `createWorld(1)` user DN still ends `DC=meridianhealth,DC=test` (guards the refactor).
- [ ] **Step 2: Run** `node --test tests/companies.test.ts`. Expected: FAIL (UPN ends `@meridianhealth.test`).
- [ ] **Step 3: Implement.** Replace `COMPANY.domain` reads in `directory.ts` with `w.ad.domain`; replace `SYNC_SCOPE`/`GROUPS_OU` reads in `cloud.ts` with `w.entra.syncScope` and the world's groups OU (`w.profileId ? profileById(w.profileId)!.groupsOu : GROUPS_OU`). Update every caller found by `npm run typecheck`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all PASS, including every pre-existing test.

---

### Task 3: Seed a company world

**Files:**
- Create: `src/world/mspSeed.ts`
- Test: `tests/companies.test.ts` (seed part)

**Interfaces:**
- Consumes: `CompanyProfile`, `MSP_COMPANIES` (Task 1); world functions (Task 2).
- Produces: `createCompanyWorld(p: CompanyProfile, seed?: number): World` (default seed `p.seed`). Result has `profileId = p.id`, `company = { name, domain }`, `ad.domain/netbios`, `entra.tenantName/primaryDomain = p.tenant`, `entra.syncScope = p.syncScope`, `okta` empty when `!p.hasOkta`, the MSP engineer account (decision 2): AD `msp-<player.sam>` in an admins OU, member of a delegated admin group that is **not** Tier 0, Entra `msp-<sam>@<tenant>` with User Administrator and Groups Administrator (not Global Administrator). `player` points at that account. Seeded audit events are inside `atTime()` before `created`.

- [ ] **Step 1: Failing tests** (loop over `MSP_COMPANIES`):
  - Deterministic: `JSON.stringify(createCompanyWorld(p))` equal across two calls (fix clock with `setClock`).
  - Employee count (kind `user`, excluding the MSP account) equals `p.staff`; harborline has 0 employees and only default containers.
  - Every active HR worker has an AD user with matching `employeeId`; every employee has birthright exactly `p.baseAccess + p.roleAccess[role.roleGroup]` **except** where the reality says otherwise (below).
  - After `runEntraSync`, every in-scope enabled user exists in Entra with the tenant UPN.
  - The MSP account is not in `TIER0_GROUPS` nor `Global Administrator`.
  - Realities: kestrel has >= 5 enabled users with `lastLogon` older than 90 days and >= 3 groups without an owner; aldervalley has >= 10 HR transactions dated in the next 30 days (term churn); lumen has >= 5 guest users in Entra; atlas has users in two sam formats; riverside contractors carry a `sponsor` (manager) and end date; summitridge has no permanent active admin roles (eligible only).
  - Size: every company materialised and serialised totals < 4,000,000 characters.
- [ ] **Step 2: Run** `node --test tests/companies.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `createCompanyWorld`, reusing `createWorld` building blocks where they are already generic; names from a seeded RNG over a profile-specific name pool (diverse, fictional). Keep employee records compact (no per-user audit backlog beyond a creation event) to hold the size budget.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

---

### Task 4: Multi-world store and persistence

**Files:**
- Create: `src/ui/companies.ts`
- Modify: `src/ui/store.ts` (`act`, `persist`)
- Test: `tests/msp-store.test.ts` (pure parts; stub `localStorage` with a Map in the test)

**Interfaces:**
- Produces:
```ts
export function companyWorld(id: string): World;           // lazy: load saved or createCompanyWorld
export function worldByDomain(domain: string): World | undefined;  // meridian or any company (case-insensitive, accepts netbios)
export function allDomains(): { id: string; domain: string; name: string }[];  // meridian first
export function persistCompanies(): void;                  // only materialised + changed ones
export function exportHrFeeds(workstation: World): void;   // writes C:\MSP\<Name>\hr-feed.csv into workstation.files
// store.ts
export function act(fn: (w: World) => void, success?: string, target?: World): boolean;
```
- Storage key per company: `identityforge-range-company-<id>`; value is the full world JSON once touched; absent means "generate from seed".

- [ ] **Step 1: Failing tests:**
  - `worldByDomain('BRIGHTWATERLAW.test')` and `worldByDomain('BRIGHTWATER')` (netbios) return the brightwater world; `worldByDomain('nope.test')` is `undefined`.
  - `companyWorld('kestrel')` twice returns the same object; after a mutation and `persistCompanies()`, a fresh module load returns the mutated world.
  - Only touched companies are written to storage.
  - `localStorage.setItem` throwing: `persistCompanies()` does not throw and the in-memory world keeps the change.
  - A storage snapshot holding only the old Meridian key (no company keys) loads: Meridian unchanged and all ten companies available.
  - `exportHrFeeds` creates one CSV per company, header `EmployeeId,FirstName,LastName,Department,Title,Manager,Location,StartDate,EndDate,Status`, rows matching that company's `hr.workers`.
- [ ] **Step 2: Run** `node --test tests/msp-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `act(fn, success, target = store.world)` runs against `target`, then persists (Meridian + companies) and notifies. `exportHrFeeds` runs at startup and after any act that changed a company's `hr`. The existing auto-sync timer (`settings.autoSync`) iterates every materialised world, not only `store.world` (spec decision 6); add `materialisedWorlds(): World[]` and a test that a pending AD change in a non-focused company syncs on the next tick.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.

---

### Task 5: PowerShell `-Server`

**Files:**
- Modify: `src/terminal/shell.ts` (ctx construction at ~513 and ~566)
- Modify: where the console/ISE/Terminal create a `Shell` (`ui/apps/console.ts`, `ui/apps/ise.ts`, `ui/apps/terminal.ts`) to pass the resolver
- Test: extend `tests/terminal.test.ts`

**Interfaces:**
- Consumes: `worldByDomain` (Task 4).
- Produces: `Shell.resolveServer: ((server: string) => World | undefined) | null` (default `null` = only own world). When an `ActiveDirectory`-module cmdlet has `-Server`, `ctx.w` is the resolved world; acts on that world persist it.

- [ ] **Step 1: Failing tests** (shell with resolver over Meridian + one company world):
  - `New-ADUser -Name 'Ana Ruiz' -SamAccountName aruiz -Server brightwaterlaw.test` creates the user in the brightwater world, not Meridian; `Get-ADUser aruiz -Server brightwaterlaw.test` finds it; `Get-ADUser aruiz` (no -Server) errors with Meridian's real not-found text.
  - `Get-ADUser x -Server nope.test` raises PowerShell 5.1 record with message `Unable to contact the server. This may be because this server does not exist, it is currently down, or it does not have the Active Directory Web Services running.` and `FullyQualifiedErrorId` `ActiveDirectoryServer:0,Microsoft.ActiveDirectory.Management.Commands.GetADUser`, category `ResourceUnavailable`.
  - `-Server` on a non-AD cmdlet is ignored as today.
- [ ] **Step 2: Run** `node --test tests/terminal.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** resolution where ctx is built; raise via `PsError(message, 'ResourceUnavailable', { exception: 'Microsoft.ActiveDirectory.Management.ADServerDownException', errorId: 'ActiveDirectoryServer:0' , target })`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (console-fidelity included).

---

### Task 6: ADUC Change Domain

**Files:**
- Modify: `src/ui/aduc/window.ts:1120-1124` and the ADUC model/shim that read `COMPANY`/`store.world` (`ui/aduc/shim/config.ts`, `adObjects.ts`)
- Test: extend `tests/aduc-adapter.test.ts`

**Interfaces:**
- Consumes: `allDomains`, `worldByDomain`, `act(..., target)`.
- Produces: ADUC instance holds its own `world` (default Meridian). Config (`domain`, `netbiosDomain`, departments list) is derived from that world (profile or Meridian constants) instead of module constants.

- [ ] **Step 1: Failing test:** the ADUC adapter built over the kestrel world shows root `kestrelmfg.test`, its OUs, and creating a user through the adapter lands in the kestrel world with `@kestrelmfg.test`.
- [ ] **Step 2: Run** `node --test tests/aduc-adapter.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Change Domain dialog lists `allDomains()`; OK re-mounts the tree on the chosen world; the title shows `Active Directory Users and Computers [<dc>.<domain>]`. Change Domain Controller lists `<PREFIX>-DC01.<domain>` for the current world. All ADUC writes go through `act(fn, msg, world)`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Manual check** in the dev server (http://localhost:5180): sign in, open ADUC, Change Domain to `harborline.test` (empty), create OU `Harborline`, create a user; PowerShell `Get-ADUser <sam> -Server harborline.test` returns it; `C:\MSP\Harborline\hr-feed.csv` opens in Notepad/Excel. Reload page: changes persist.

---

## Stages 2-4 (outline; each gets its own plan when stage 1 ships)

**Stage 2: workstations and RDP.** Profile-driven hook in `createUser` (company worlds only) that adds `<PREFIX>-WKS-####` with `primaryUser`, in `computersOu`; Entra device on sync; leaver marks machine disabled. `rdp.ts` connect screen: company folder → user → machine; both modes use the target world's `signIn`. New check kind `verifiedSignIn` in `grader.ts`. Tests: workstation per user on every creation route, RDP refusal reasons per company.

**Stage 3: Azure portal.** `world/azure.ts` (`ensureAzure`: subscriptions, resource groups, resources, role assignments, Azure PIM) and Entra extensions (dynamic groups, admin units, app registrations/secrets, auth methods policy, risky users, licences, guests) in `world/cloud.ts` or a new `world/entraext.ts`. Site `ui/sites/azure.ts` (+ `ui/sites/azure/*` blade modules) at `portal.azure.range` with directory switcher over `allDomains()`, lab sign-in / create account with the simulation marker, `Connect-MgGraph -TenantId <tenant>` setting the shell's Graph world (decision 5), CSP/branding test updates, new bookmark. Light services list/create/delete + IAM blade.

**Stage 4: ServiceNow.** Site `ui/sites/servicenow.ts` at `msp.service-now.range`; shared-layer `labs` record; `scenarios/msp/*` company-generic templates with `solve`/`naive`; generator choosing by company state; Ollama rewording with `factTokens`; gated Resolve with hint ladder; Escalate with template-declared verdicts (`closed`/`returned`/`declined`/`redirected`); new check kinds (`azureRole`, `pimEligible`, `escalatedTo`, `neverChanged` scoped to target+action, `resolutionCode`); report card into career. Tests: template × twist × 5 seeds × applicable companies; MSP consistency test.
