# MSP Stage 3b (Azure portal: apps, PIM, Conditional Access, auth methods, Identity Protection, admin units, external identities, Key Vault, managed identities, Cloud Shell, Graph tenant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the identity depth of the lab Azure portal so stage 4 tickets can cover the full set of real-world Entra/Azure requests, with every action authorised by the acting account's roles as Entra does it.

**Architecture:** New world modules, each lazy (`ensure*`), authorising via `rolesOf` (stage 3a) and auditing with portal wording: `world/apps.ts`, `world/pim.ts`, `world/authMethods.ts`, `world/adminUnits.ts`, `world/tenantSettings.ts` (external collaboration + named locations), Key Vault data on `AzureResource` in `world/azure.ts`, managed identities as a light service that creates a service principal. CA editing and What If reuse `CaPolicy`/`saveCaPolicy` with an actor check. Blades in `ui/sites/azure/*.ts`. Cloud Shell mounts the existing PowerShell host bound to the tenant. `Connect-MgGraph -TenantId` gives the shell a Graph world.

**Tech Stack:** Vanilla TypeScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-28-msp-companies-azure-servicenow-design.md` section 5.

## Global Constraints

- Same as stage 3a (simulation marker, world-only mutation, `h()` text, lazy fields, no `WORLD_VERSION` bump, Meridian Entra site untouched).
- Permissions follow real Entra built-in roles (Microsoft Learn "least privileged roles by task"):
  - App registrations/enterprise apps: Application Administrator or Cloud Application Administrator (MSP has neither → can view, not change; owners can manage their own registrations).
  - Admin consent: delegated non-Graph-privileged permissions → Cloud Application Administrator; application permissions to Microsoft Graph → Privileged Role Administrator (or GA).
  - PIM role settings and eligible assignments → Privileged Role Administrator; activating your own eligible role → the eligible user.
  - Conditional Access create/edit → Conditional Access Administrator or Security Administrator; read → Security Reader/Global Reader/any admin.
  - Authentication methods for non-admin users (reset, require re-register, Temporary Access Pass) → Authentication Administrator; for admins → Privileged Authentication Administrator; tenant method policy → Authentication Policy Administrator.
  - Identity Protection dismiss/confirm → Security Operator/Security Administrator.
  - Administrative units → Privileged Role Administrator.
  - External collaboration settings → Global Administrator only in the lab (as the strictest real setting).
- The MSP admin in companies also gets an **eligible** (PIM) Authentication Administrator assignment: MFA/TAP tickets require activating it first — real least-privilege practice.
- No git: checkpoint = `npm test` + `tsc --noEmit` green.

## Review Focus

1. The MSP admin can activate only its own eligible role, for at most the role's maximum duration, with a justification; activation expires (time from `core/time.ts`) and the permission it granted disappears with it. Task 2.
2. A Temporary Access Pass is single-use and time-boxed, and issuing one for an admin needs Privileged Authentication Administrator. Task 3.
3. CA What If returns the same verdict the sign-in simulation (`simulateSso`/sign-in logs) would, including break-glass exclusions. Task 4.
4. `Connect-MgGraph -TenantId` to an unknown tenant fails with Graph's real error; Graph cmdlets after connecting act in that tenant only; `Disconnect-MgGraph` returns to none. Task 7.
5. Removing a managed identity removes its Azure role assignments; a Key Vault in "access policy" mode ignores data-plane RBAC roles and vice versa. Task 6.

---

### Task 1: App registrations and enterprise apps (`world/apps.ts`, `ui/sites/azure/apps.ts`)
- Types: `AppRegistration { appId, objectId, name, owners: string[], redirectUris: string[], secrets: { id, description, created, expires }[], permissions: { api: 'Microsoft Graph' | string; name: string; type: 'Delegated' | 'Application'; consented: boolean }[] }` on `EntraTenant.appRegistrations?`; enterprise apps reuse `EntraApp` (+ `owners?`), seeded per company from an industry catalogue (2–4 apps, e.g. law: NetDocuments/Clio; manufacturing: SAP Concur; university: Canvas; credit union: Jack Henry; retail: Shopify; biotech: Benchling; SaaS: GitHub, Atlassian; government: Granicus; energy: Quorum), some with secrets expiring within 30 days.
- Functions: `registerApp`, `addSecret(months 6|12|24)`, `removeSecret`, `addApiPermission`, `grantAdminConsent`, `assignAppUser/Group`, `setAssignmentRequired`, `addAppOwner`. Errors: insufficient privileges text from 3a; consent for application permissions without PRA → `Insufficient privileges to complete the operation.`
- Blades: App registrations (list, new, overview, Certificates & secrets, API permissions with Grant admin consent, Owners); Enterprise applications (list, Users and groups, Properties: assignment required, Owners).
- Tests: MSP cannot register or change apps; an app owner can add/remove secrets of their own registration; consent rules by permission type; expiring-secret detection `secretsExpiringWithin(w, days)`.

### Task 2: PIM for Entra roles (`world/pim.ts`, blade)
- `pimSettings(role) -> { maxHours, requireJustification, requireApproval }` (privileged roles: 4h + approval-free in lab but justification required; others 8h).
- `activateRole(w, actorUpn, role, hours, justification)`, `deactivateRole`, `addEligible(w, actorUpn, upn, role, months)` (PRA only), `removeEligible`. Activation writes an active assignment with `expires`; `rolesOf` already ignores expired.
- Seed: company MSP admin eligible Authentication Administrator; Summit Ridge staff eligible roles from stage 1 work unchanged.
- Blade: My roles (eligible → Activate with hours + justification; active → Deactivate), Assignments (eligible/active per role), Settings (read-only).
- Tests: activation > max hours refused; empty justification refused; activating a role you are not eligible for refused; after expiry (setClock forward) the permission is gone; MSP cannot add eligible assignments.

### Task 3: Authentication methods and Temporary Access Pass (`world/authMethods.ts`, user tab + policy blade)
- Per user: list `mfaMethods`, `deleteMethod`, `requireReregister` (existing cloud.ts functions gain actor checks via wrappers here), `issueTap(w, actor, upn, minutes 60..480, oneTime)` → `{ code, expires }` stored on user (`tap?`), audit `Create Temporary Access Pass`; signIn of cloud user via portal/RDP accepts TAP once.
- Tenant policy `authMethodsPolicy`: Authenticator, FIDO2, SMS, Voice, Temporary Access Pass, Email OTP enabled flags (Authentication Policy Administrator to change).
- Tests: MSP needs activated Authentication Administrator; admin targets need Privileged Authentication Administrator; TAP single use and expiry; disabled method in policy can't be issued.

### Task 4: Conditional Access and named locations (`world/tenantSettings.ts`, CA blades)
- Seed 3 company CA policies (block legacy auth, MFA for admins, report-only high-risk block) with break-glass excluded where the company has one; named locations per company office IPs.
- `saveCaPolicyAs(w, actor, policy)` / `deleteCaPolicyAs` authorised (CA Admin/Security Admin), `addNamedLocation`, `whatIf(w, { upn, app, location, risk, legacyAuth }) -> { policy, applies: boolean, reason, grant }[]`.
- Blades: Policies list + editor (users/groups include/exclude, apps, conditions, grant, state), Named locations, What If.
- Tests: MSP read-only; What If matches policy semantics incl. exclusions and report-only (shown, not enforced).

### Task 5: Identity Protection, admin units, external identities (blades + small world functions)
- Identity Protection: risky users (riskLevel ≠ none) with Dismiss/Confirm compromised (Security Operator/Admin); risky sign-ins from sign-in logs with `risk ≠ none`. Seed 1–2 risky users in research, frontline and merger companies.
- Administrative units: `createAdminUnit`, `addAuMember`, `assignScopedRole` (PRA); blade list/members/roles.
- External identities: `externalSettings { guestInviteRestrictions: 'everyone' | 'members' | 'admins' | 'none'; allowDomains: string[]; denyDomains: string[] }`; `inviteGuest` (3a) respects deny/allow lists and restrictions (`AADSTS` wording: `The invitation is blocked because the domain is not allowed by the collaboration restrictions.`).
- Tests for each permission and the invite restriction.

### Task 6: Key Vault access and managed identities (`world/azure.ts` + blades)
- Key Vault resources gain `vault?: { model: 'rbac' | 'accessPolicy'; accessPolicies: { principal: string; secrets: ('get' | 'list' | 'set' | 'delete')[] }[]; secrets: { name: string; enabled: boolean; expires: string | null }[] }`; `canReadSecret(w, upn, vaultId)` follows the model; `setAccessPolicy` (needs Owner/Contributor on vault in policy model), `setVaultModel` (Owner).
- New light service `Microsoft.ManagedIdentity/userAssignedIdentities`; creating one adds a service principal (`principalType: 'ServicePrincipal'`) usable in IAM; system-assigned identity toggle on VMs/App Services. Deleting removes its role assignments.
- Tests: model switch changes `canReadSecret`; managed identity assignable and cleaned up on delete.

### Task 7: Cloud Shell and `Connect-MgGraph -TenantId`
- Shell: `graphWorld: World | null`; `Connect-MgGraph -TenantId <tenant id | primary domain | AD domain>` resolves through the server resolver (stage 1) + tenant ids; unknown → Graph's `AADSTS90002: Tenant '<x>' not found. Check to make sure you have the correct tenant ID and are signing into the correct cloud.`; Microsoft.Graph cmdlets use `graphWorld ?? w`; `Get-MgContext` shows the tenant; `Disconnect-MgGraph` clears it.
- Portal top bar **Cloud Shell** button opens a docked PowerShell pane (existing `mountPowerShell`) pre-connected to the current tenant (banner `Connected to <tenant> as <upn>`), AD cmdlets defaulting to that company with `-Server` implicit.
- Tests: terminal tests for connect/unknown/disconnect and that `Get-MgUser` lists only that tenant's users.

### Task 8: Integration
- `npm test`, `tsc`, vite build; manual: activate PIM role, issue TAP, run What If, consent refused, Key Vault policy, Cloud Shell `Get-MgUser -Top 3`.
