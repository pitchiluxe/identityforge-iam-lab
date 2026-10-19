# Advanced AD / Entra ID / Okta track

This is a second track beside the portable simulation. Start with **CHECKPOINT-01.md**, then **lifecycle/README.md** for the implemented CSV joiner/mover/leaver workflow. The initial standalone lab remains fully available. The Entra SSO client is in ../sso; it requires a lab tenant and has not been live-verified. Hybrid synchronization, live cloud policy enforcement and real privileged AD automation remain outside the implemented scope.

## Prerequisites and boundary

Use a dedicated isolated Windows Server AD DS lab domain, with a snapshot or backup and a lab administrative account. A Windows 11 host alone is not an AD domain controller. The ActiveDirectory PowerShell module (RSAT on a supported client, or AD management tools on Windows Server), DNS resolution and connectivity to the selected domain controller are required. This package does not install/promote AD DS, change host networking, create a tenant, configure synchronization or connect your real accounts. Do not run these exercises in an employer's domain.

With 16 GB host RAM, begin with one lab DC VM and avoid running large models simultaneously. VM provisioning is a separate prerequisite if you have no test domain. Do not connect an experimental DC or sync server to production tenants. No Entra ID or Okta subscription is required for Checkpoint 1.

## Upgraded progression

1. IGA checkpoint 1: actual protected OUs, security groups, and a disabled seed identity through AD cmdlets; preview and verify.
2. IGA implemented in lifecycle/: stable employee-ID lookup, New-ADUser/Set-ADUser, explicit managed birthright-group reconciliation using Add-ADGroupMember/Remove-ADGroupMember, mover access removal and per-run evidence. EmployeeID uniqueness is checked by the automation, not inherently enforced as immutable by AD.
3. IGA hybrid/leaver: attribute mapping and sync-scope review; Disable-ADAccount, Set-ADAccountExpiration, removal of direct removable group memberships, Move-ADObject into Terminated. Account expiration alone does not end existing sessions. Primary-group membership, nested access, cloud sessions and application access need separate treatment. Moving out of sync scope may cause cloud deletion; never treat it as harmless archiving.
4. AM: separate Entra/Okta application configuration worksheets, SAML/OIDC claims, provider-specific policy design, device/network risk precedence and authentication-loop investigation. Their policy syntaxes and feature licensing differ; do not submit one provider's policy to the other. No tenant writes until an explicit lab tenant is identified.
5. PAM: audit classic AD tiers 0/1/2 and map their boundaries to Microsoft's broader enterprise access model. Use a dedicated unprivileged LAB-Tier0-Simulation group, never Domain Admins. Native TTL membership requires appropriate forest capability and enabling the PAM optional feature, which is a consequential forest change; it will not be enabled automatically. An alternative scheduled expiry workflow needs durable retries, monitoring, startup recovery and an authorization/session strategy, not just a timer.
6. PAM audit: Event 4728 exercises for security-enabled global groups, including actor, member, target group, timestamp and correlation. Event 4732 applies to local/domain-local groups and 4756 to universal groups; auditing must be enabled to obtain the relevant events. Neither group membership nor a scheduler alone guarantees that an existing access token loses privilege immediately.

## Hybrid attribute principles

EmployeeID is our HR correlation key, not a value to invent as the Entra sourceAnchor. Department is business metadata. mailNickname is an alias attribute when present in the schema; do not assume it exists in every lab forest. Actual mappings depend on connector configuration and selected synchronization features. A routable UPN suffix must be verified in the target tenant for the intended sign-in design. This checkpoint uses the lab domain suffix for local identities only.

Do not edit sourceAnchor/immutableID to fix a login loop. The Entra onPremisesImmutableId represents the configured source anchor, commonly based on mS-DS-ConsistencyGuid in applicable deployments; it is not simply the UPN. Diagnose the app's actual expected NameID/subject and mapping before contemplating a supported identity-matching change.

## Sources

- [New-ADOrganizationalUnit](https://learn.microsoft.com/powershell/module/activedirectory/new-adorganizationalunit)
- [New-ADGroup](https://learn.microsoft.com/powershell/module/activedirectory/new-adgroup)
- [New-ADUser](https://learn.microsoft.com/powershell/module/activedirectory/new-aduser)
- [Attributes synchronized by Entra Connect](https://learn.microsoft.com/entra/identity/hybrid/connect/reference-connect-sync-attributes-synchronized)
- [Entra Connect design concepts and sourceAnchor](https://learn.microsoft.com/entra/identity/hybrid/connect/plan-connect-design-concepts)
