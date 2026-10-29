# MSP Stage 3a (Azure portal: shell, Entra core, Azure RBAC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Range-built Azure portal at `https://portal.azure.range` where the learner signs in (or creates a lab account) to any of the eleven tenants and does real identity work — cloud users, cloud groups, licences, directory roles, devices, logs, Entra Connect status — plus Azure RBAC on subscriptions, resource groups and light resources, with permissions enforced like the real portal.

**Architecture:** World logic in two new world modules (`world/entraAdmin.ts` for cloud identity operations, `world/azure.ts` for subscriptions/resources/RBAC, created lazily by `ensureAzure`), each validating and throwing the real portal/Graph error text and auditing. A pure portal-session module (`ui/azureSession.ts`) handles sign-in and lab account creation. The site (`ui/sites/azure.ts` + `ui/sites/azure/*.ts` blades) renders a portal shell with directory switcher, breadcrumbs and blades, and calls only world functions through `act(fn, msg, target)`. Stage 3b adds apps, PIM, Conditional Access, Identity Protection, Key Vault, managed identities and Cloud Shell.

**Tech Stack:** Vanilla TypeScript (erasable syntax, `.ts` imports), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-28-msp-companies-azure-servicenow-design.md` section 5 and anti-goals.

## Global Constraints

- Simulation marker on every portal page and the sign-in page: text `Meridian IAM Range training simulation — never type a real Microsoft password here.`; fictional host `portal.azure.range`; no Microsoft logo assets; only lab accounts accepted.
- Existing sites and bookmarks (including the real `https://portal.azure.com` in Real portals) unchanged; the new site is added to `SITES`.
- World mutation only in `src/world/*`; UI text via `h()`; time from `core/time.ts`; no `innerHTML`.
- Synced (AD-sourced) users and groups are read-only in the cloud: edits raise Graph's `Request_BadRequest` text used elsewhere ("Unable to update the specified properties for on-premises mastered Directory Sync objects or objects currently undergoing migration.").
- Lazy creation (`ensureAzure`, optional fields); no `WORLD_VERSION` bump. Meridian gets a portal too (its tenant is one of the eleven) but its existing data and Entra site are untouched.
- No git: checkpoint = `npm test` + `tsc --noEmit` green.

## Review Focus

1. A delegated MSP admin (User Administrator + Groups Administrator) cannot assign Global Administrator or other privileged directory roles, and gets the real "insufficient privileges" error. Test in Task 1.
2. Editing a synced user or group in the cloud is refused with the on-premises-mastered error; cloud-only objects are editable. Test in Task 1.
3. Azure RBAC inheritance: a role at subscription scope applies to every resource group and resource below; Check access shows it with its scope; group-based assignments count. Test in Task 2.
4. Removing the last Owner/User Access Administrator path the MSP holds is refused (no lock-out of the delegated admin). Test in Task 2.
5. Sign-in refuses a real-looking non-lab UPN (any domain not a tenant's) and a wrong password, and a created lab account can sign in only to its own tenant. Test in Task 3.

---

### Task 1: Cloud identity operations (`world/entraAdmin.ts`)

**Files:** Create `src/world/entraAdmin.ts`; Modify `src/core/types.ts` (`EntraUser.labPassword?`, `EntraUser.usageLocation?`, `EntraTenant.cloudGroups?`, `EntraTenant.licenses?`); Test `tests/entra-admin.test.ts`.

**Interfaces (produces):**
```ts
export const PRIVILEGED_ROLES: readonly string[];   // Global Administrator, Privileged Role Administrator, Privileged Authentication Administrator, Security Administrator, Exchange Administrator, SharePoint Administrator, Conditional Access Administrator, Application Administrator
export interface CloudGroup { id: string; name: string; type: 'Security' | 'Microsoft 365'; description: string; owners: string[]; created: string }
export interface TenantLicense { sku: string; total: number }
export function rolesOf(w: World, upn: string): string[];                      // active directory roles
export function canManageRole(w: World, actorUpn: string, role: string): boolean; // GA or Privileged Role Admin for any; User Admin for non-privileged only
export function createCloudUser(w: World, actorUpn: string, input: { displayName: string; mailNickname: string; password: string; forceChange: boolean; jobTitle?: string; department?: string; usageLocation?: string }): EntraUser;
export function inviteGuest(w: World, actorUpn: string, email: string, displayName: string): EntraUser;      // upn: <local>_<domain>#EXT#@<tenant>, userType Guest
export function updateCloudUser(w: World, actorUpn: string, upn: string, props: { displayName?: string; jobTitle?: string; department?: string; usageLocation?: string }): EntraUser;
export function resetCloudPassword(w: World, actorUpn: string, upn: string, password: string, forceChange: boolean): EntraUser;
export function deleteCloudUser(w: World, actorUpn: string, upn: string): void;   // soft delete (deleted: true)
export function restoreCloudUser(w: World, actorUpn: string, upn: string): EntraUser;
export function createCloudGroup(w: World, actorUpn: string, input: { name: string; type: CloudGroup['type']; description: string; owners: string[] }): CloudGroup;
export function setCloudGroupMember(w: World, actorUpn: string, group: string, upn: string, member: boolean): void;  // edits EntraUser.groups
export function assignLicense(w: World, actorUpn: string, upn: string, sku: string, assign: boolean): EntraUser;     // needs usageLocation; respects total
export function assignDirectoryRole(w: World, actorUpn: string, upn: string, role: string, assign: boolean): EntraUser;
export function tenantLicenses(w: World): TenantLicense[];   // lazily seeded: M365 Business Premium (or E3 for Meridian) = staff + 10, Entra ID P2 = 25
```
- Errors (exact): insufficient rights → `Insufficient privileges to complete the operation.`; synced object edit → the on-premises-mastered text above; duplicate UPN → `Another object with the same value for property userPrincipalName already exists.`; licence without usage location → `License assignment failed because service plans ... require usage location to be specified.` (use: `License assignment cannot be done for user with invalid usage location.`); no licences left → `License assignment failed because the subscription has no available licenses.`
- Audit: source `Entra ID`, actions as the portal shows (`Add user`, `Invite external user`, `Update user`, `Reset user password`, `Delete user`, `Restore user`, `Add group`, `Add member to group`, `Remove member from group`, `Change user license`, `Add member to role`, `Remove member from role`), actor = actorUpn.

- [ ] Step 1: failing tests — MSP admin creates a cloud user (UPN `<nick>@<tenant>`, source cloud, labPassword set), invites a guest, edits/reset/deletes/restores it; editing a synced user throws the on-prem error; MSP admin assigning Global Administrator throws insufficient privileges, assigning Helpdesk Administrator succeeds; group create + member add/remove changes `EntraUser.groups`; synced (AD) group membership edit refused; licence needs usage location and stops at `total`.
- [ ] Step 2: run `node --test tests/entra-admin.test.ts` → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: `npm test` + `tsc` → PASS.

### Task 2: Azure subscriptions, resources and RBAC (`world/azure.ts`)

**Files:** Create `src/world/azure.ts`; Modify `src/core/types.ts` (`World.azure?: AzureEstate`); Test `tests/azure.test.ts`.

**Interfaces (produces):**
```ts
export interface AzureResource { id: string; name: string; type: string; rg: string; subscription: string; location: string; created: string }
export interface RoleAssignment { id: string; principal: string; principalType: 'User' | 'Group' | 'ServicePrincipal'; role: string; scope: string; created: string; createdBy: string }
export interface AzureEstate { subscriptions: { id: string; name: string }[]; resourceGroups: { name: string; subscription: string; location: string }[]; resources: AzureResource[]; assignments: RoleAssignment[] }
export const AZURE_ROLES: readonly { name: string; description: string; canAssign: boolean }[]; // Owner, Contributor, Reader, User Access Administrator, Role Based Access Control Administrator, Virtual Machine Contributor, Storage Blob Data Reader, Storage Blob Data Contributor, Key Vault Secrets User, Key Vault Administrator, Website Contributor, SQL DB Contributor
export const LIGHT_SERVICES: readonly { type: string; label: string; plural: string }[];        // Microsoft.Compute/virtualMachines, Microsoft.Storage/storageAccounts, Microsoft.Network/virtualNetworks, Microsoft.Web/sites, Microsoft.Sql/servers, Microsoft.KeyVault/vaults
export function ensureAzure(w: World): AzureEstate;   // per profile: subscriptions "<Name> - Production" and "<Name> - Development", 2-4 RGs, a few resources, MSP admin = Contributor + User Access Administrator at both subscriptions, a couple of existing assignments for staff/groups
export function scopeOf(r: { subscription: string; rg?: string; resource?: string }): string;   // /subscriptions/<id>[/resourceGroups/<rg>[/providers/<type>/<name>]]
export function effectiveRoles(w: World, upn: string, scope: string): { role: string; scope: string; via: string }[];  // inherited from parents; via = 'Direct' or 'Group: <name>'
export function addRoleAssignment(w: World, actorUpn: string, principal: string, role: string, scope: string): RoleAssignment;
export function removeRoleAssignment(w: World, actorUpn: string, id: string): void;
export function createResourceGroup(w: World, actorUpn: string, subscription: string, name: string, location: string): void;
export function createResource(w: World, actorUpn: string, input: { type: string; name: string; rg: string; subscription: string; location: string }): AzureResource;
export function deleteResource(w: World, actorUpn: string, id: string): void;
```
- Rules: assigning requires Owner, User Access Administrator or RBAC Administrator at or above the scope (`The client '<upn>' ... does not have authorization to perform action 'Microsoft.Authorization/roleAssignments/write' over scope '<scope>' or the scope is invalid.`); creating/deleting requires Owner or Contributor; duplicate assignment → `The role assignment already exists.`; principal must exist (user upn or cloud/synced group name); removing an assignment that would leave the actor without write access to role assignments at that scope is refused (`You cannot remove your own access to manage role assignments at this scope.`). Audit source `Azure` with actions `Create role assignment`, `Delete role assignment`, `Create or update resource group`, `Create or update resource`, `Delete resource`.

- [ ] Step 1: failing tests — ensureAzure deterministic and lazy; MSP admin assigns Reader at RG to a user and Check access shows it, plus inherited subscription roles; group assignment counts for its members; a user without rights gets the authorization error; duplicate refused; self-lock-out refused; create/delete resource with Contributor; Meridian also gets an estate.
- [ ] Step 2–4: run → FAIL, implement, `npm test` + `tsc` → PASS.

### Task 3: Portal session and lab accounts (`ui/azureSession.ts`, pure)

**Interfaces (produces):**
```ts
export interface PortalSession { tenant: string /* domain */; upn: string }
export function authenticate(w: World, upn: string, password: string, mspPassword: string): { ok: true; upn: string } | { ok: false; message: string };
// msp-admin@<tenant> uses the learner's workstation sign-in password; other cloud lab accounts use EntraUser.labPassword; synced users use AdUser.labPassword.
export function createLabAccount(w: World, input: { displayName: string; nickname: string; password: string }): EntraUser;  // cloud user + User Administrator + Groups Administrator + Contributor at subscriptions; audit actor 'Lab account sign-up'
export function tenantForUpn(upn: string, tenants: { domain: string; tenant: string }[]): string | null;
```
- Messages: unknown domain → `This username may be incorrect. Make sure you typed it correctly. Otherwise, contact your admin.` (AADSTS50034 wording); wrong password → `Your account or password is incorrect. If you don't remember your password, reset it now.`; disabled → `Your account has been locked. Contact your support person to unlock it, then try again.`
- [ ] Steps: failing tests (msp-admin works with the workstation password; wrong password refused; outlook.com-style UPN refused; created account signs in to its tenant only; created account cannot assign Global Administrator) → implement → PASS.

### Task 4: The portal (`ui/sites/azure.ts`, `ui/sites/azure/*.ts`, `src/azure.css`)

- Site `{ host: 'portal.azure.range', name: 'Microsoft Azure', short: 'Azure', color: '#0078d4' }` added to `SITES` (browser.ts) after the existing ones; existing bookmarks untouched.
- Session per tenant held in `store.settings.azurePortal` (`{ sessions: Record<domain, upn>; current: domain }`).
- Routes: `/` sign-in or Home; `/signup`; `/home`; `/allservices`; `/entra` (Overview), `/entra/users`, `/entra/users/new`, `/entra/users/invite`, `/entra/users/deleted`, `/entra/users/<upn>` (tabs Overview, Groups, Licenses, Assigned roles, Devices, Sign-in logs, Audit logs), `/entra/groups`, `/entra/groups/new`, `/entra/groups/<name>` (Members, Owners), `/entra/devices`, `/entra/roles` and `/entra/roles/<role>`, `/entra/licenses`, `/entra/signins`, `/entra/audit`, `/entra/connect`; `/subscriptions`, `/subscriptions/<id>`, `/resourcegroups`, `/resourcegroups/<sub>/<rg>`, `/resources`, `/resources/<id>`, `/create/<type>`; any resource/RG/subscription page has an **Access control (IAM)** blade (Check access, Role assignments, Roles, Add role assignment). `/service/<name>` for non-lab services: real empty list `No <plural> to display` and a Create button explaining the service is outside the lab.
- Top bar: portal name, simulation marker, global search (users, groups, resources, services in the current tenant), notifications (last 5 own audit events), **Directory + subscription** switcher listing the eleven tenants (switching keeps per-tenant sessions; switching to a tenant without one shows its sign-in), account menu with Sign out.
- Every write goes through `act(fn, msg, tenantWorld)` with `actorUpn` = the session UPN; errors show in a portal-style red notification.
- [ ] Steps: failing tests for the pure route parser `parseRoute(path)` and global search `portalSearch(w, q)` (in `ui/sites/azure/routes.ts`) → implement site → `npm test` + `tsc` → manual check (sign in to Kestrel, create cloud user, add to new group, assign licence, attempt Global Admin (refused), assign Reader on an RG, Check access; switch to Harborline; create account flow).

### Task 5: Integration checks

- `tests/branding.test.ts` passes (site list unchanged elsewhere); add a test that `SITES` contains every pre-existing host plus `portal.azure.range` and `REAL_PORTALS` is unchanged.
- Run `npm run build` (vite build via `node node_modules/vite/bin/vite.js build`) to confirm the bundle builds.
