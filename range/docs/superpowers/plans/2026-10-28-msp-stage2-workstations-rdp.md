# MSP Stage 2 (workstations and Remote Desktop by company) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every person created in an MSP company gets a workstation, and Remote Desktop lists machines by company → user → machine so the learner can help a user or sign in as them on their own machine, with sign-ins the grader can check.

**Architecture:** A profile-driven hook in the world layer (`createUser` → `assignWorkstation`, company worlds only) so every creation route (seed, ADUC, PowerShell, later the Azure portal and ServiceNow) gets a machine. Entra Connect projects workstations as hybrid-joined devices. Remote Desktop gains a company picker and acts on the chosen company's world through `act(fn, msg, target)` from stage 1. A new grader check kind `signedInOn` reads 4624 events.

**Tech Stack:** Vanilla TypeScript (erasable syntax, explicit `.ts` imports), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-28-msp-companies-azure-servicenow-design.md` section 4 (Workstations and Remote Desktop).

## Global Constraints

- Meridian unchanged: no hook for worlds without `profileId`; every pre-existing test passes untouched; Meridian's RDP flow (MHS-TEST-WKS01) works as before.
- World mutation only in `src/world/*`; time from `core/time.ts`; UI text via `h()`/`textContent`.
- Names: `<PREFIX>-WKS-<4 digits>` (`KMF-WKS-1001`), unique per company.
- New `World` fields optional (lazy), no `WORLD_VERSION` bump.
- No git: checkpoint = `npm test` + `tsc --noEmit` green.

## Review Focus

1. A user created by any route in a company (seed, `New-ADUser -Server`, ADUC) gets exactly one workstation; renaming the sam keeps the machine's `primaryUser` pointing at them. Test in Task 1.
2. Deleting a user leaves the machine listed as reclaimed (`primaryUser` null), never a dangling sam. Test in Task 1.
3. Greenfield Harborline (no Computers OU yet): new machines land in the default `Computers` container and appear in ADUC. Test in Task 1.
4. Verify-a-sign-in on a company machine audits in that company, not Meridian, and wrong passwords lock out with the company DC named in 4740. Test in Task 3.
5. `signedInOn` does not pass on a sign-in from before the ticket, or on a failed (4625) attempt. Test in Task 3.

---

### Task 1: Workstation per person

**Files:**
- Create: `src/world/workstations.ts`
- Modify: `src/world/directory.ts` (`createUser`, `deleteUser`, `renameUserSam`)
- Test: `tests/workstations.test.ts`

**Interfaces:**
- Produces:
```ts
export function assignWorkstation(w: World, sam: string): AdComputer;      // idempotent: returns the existing machine if they have one
export function workstationOf(w: World, sam: string): AdComputer | undefined;
```
- Computer: `{ name: '<PREFIX>-WKS-<n>', ou: profile.computersOu if in w.ad.ous else 'Computers', os: 'Windows 11 Enterprise', enabled: true, lastLogon: user.lastLogon ?? nowIso(), primaryUser: sam, ip: '10.50.<20-59>.<10-250>' }`, n = highest existing WKS number + 1, starting at 1001.

- [ ] **Step 1: Failing tests:**
  - every employee in every seeded company has exactly one machine with `primaryUser === sam`, named `^[A-Z]{3}-WKS-\d{4}$`, names unique;
  - `New-ADUser`-equivalent `createUser` on kestrel adds one machine; calling `assignWorkstation` again returns the same machine;
  - admin/service accounts (`kind !== 'user'`) get none; Meridian `createUser` adds no computer;
  - harborline `createUser(..., ou: 'Users')` → machine in `Computers`;
  - `deleteUser` → machine remains, `primaryUser === null`, description `Reclaimed from <displayName>`;
  - `renameUserSam` → machine `primaryUser` is the new sam.
- [ ] **Step 2: Run** `node --test tests/workstations.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Hook at the end of `createUser`: `if (w.profileId && (input.kind ?? 'user') === 'user') assignWorkstation(w, sam)`. `deleteUser` and `renameUserSam` update `primaryUser`. AdComputer gains optional `description?: string`.
- [ ] **Step 4: Run** `npm test` (seed size test must still pass). Expected: PASS.

### Task 2: Devices in Entra

**Files:**
- Modify: `src/core/types.ts` (`EntraDevice`, `EntraTenant.devices?`), `src/world/cloud.ts` (`runEntraSync`)
- Test: `tests/workstations.test.ts`

**Interfaces:**
- Produces: `interface EntraDevice { id: string; name: string; trustType: 'Hybrid Azure AD joined'; ownerUpn: string | null; accountEnabled: boolean; os: string; registered: string }`; `w.entra.devices` filled by `runEntraSync` for computers whose OU is in sync scope or whose primary user is (workstations follow their user), `id = objectIdFor(w.seed, 'device:' + name)`.

- [ ] **Step 1: Failing test:** after seed + sync, every enabled employee's machine is an Entra device with `ownerUpn` = their UPN; disabling the computer and syncing sets `accountEnabled false`; Meridian's devices list is created only for company worlds (Meridian `entra.devices` stays undefined).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** in `runEntraSync` for `w.profileId` worlds only; audit `Add device` / `Update device` with source `Entra ID`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

### Task 3: Sign-ins on a company machine, and the `signedInOn` check

**Files:**
- Modify: `src/world/directory.ts` (`failLogons` 4740 origin uses `dcHostOf(w)`), `src/core/types.ts` (`CheckSpec`), `src/scenarios/grader.ts`
- Test: `tests/workstations.test.ts`, `tests/signin.test.ts` (unchanged assertions must still pass)

**Interfaces:**
- Produces: `CheckSpec` variant `{ k: 'signedInOn'; sam: string; host?: string; after: string; label?: string }` — passes when `w.audit` has eventId 4624 with `target === sam`, `origin === host` (when given), `time >= after`. Message on fail: `No successful sign-in by <sam><host ? ` on ${host}` : ''> since the ticket was opened.`

- [ ] **Step 1: Failing tests:**
  - `signIn(k, sam, labPassword, '<their machine>')` writes 4624 in the kestrel world with origin = machine; `signedInOn` with `after` = before the sign-in passes, with `after` = after it fails;
  - a wrong password writes 4625 and `signedInOn` fails;
  - 5 wrong passwords lock out with 4740 origin `KMF-DC01`;
  - Meridian lockout origin still `MHS-DC01`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the check case in `grader.ts` (follow the existing `ok(pass, message)` pattern) and the `dcHostOf` change.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

### Task 4: Remote Desktop by company

**Files:**
- Modify: `src/ui/apps/rdp.ts`
- Create: `src/ui/rdpTargets.ts` (pure, DOM-free)
- Test: `tests/rdp-targets.test.ts`

**Interfaces:**
- Consumes: `allDomains`, `worldByDomain` (stage 1), `workstationOf` (Task 1), `act(fn, msg, target)`.
- Produces:
```ts
export interface RdpFolder { id: string; name: string; domain: string; people: { sam: string; displayName: string; machine: string; state: 'ok' | 'disabled' | 'locked' | 'expired' }[]; reclaimed: string[] }
export function rdpFolders(worlds: { id: string; w: World }[]): RdpFolder[];   // people sorted by display name; Meridian folder uses its existing laptops
```

- [ ] **Step 1: Failing tests** for `rdpFolders`: one folder per world in order given; kestrel folder lists every employee with their machine; a disabled user shows `state: 'disabled'`; a deleted user's machine is in `reclaimed`; Meridian folder lists Meridian laptops.
- [ ] **Step 2: Run** `node --test tests/rdp-targets.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `rdpFolders`, then the UI: connect screen gets a **Company** select (Meridian first, then the ten), a **User** select from that folder (label `Display Name — MACHINE (state)`), and both cards act on that company's world:
  - Help a user: credentials prompt shows `<NETBIOS>\<player.adminSam>`, 4624 type 10 audited in the company world.
  - Verify a sign-in: for a company, sign in on the selected user's own machine (origin = machine, banner `Connecting to <ip> (<machine>)`); Meridian keeps `MHS-TEST-WKS01`.
  - Every `act` passes the company world as `target`. Sign-in screen datalist lists that company's people. Session and sign-out audit in that world.
- [ ] **Step 4: Run** `npm test && tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Manual check** in the dev server: Remote Desktop → Company: Kestrel → pick a user → Verify a sign-in with their lab password (IAM Coach > Lab accounts shows it, or reset it in ADUC on kestrelmfg.test) → session opens on their machine; Event Viewer / `Get-ADUser -Server` unaffected in Meridian.
