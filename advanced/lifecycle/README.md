# Real AD lifecycle automation

This track runs actual AD management cmdlets. It is implemented locally, tested offline and **not yet verified against a live lab domain**. Use a dedicated disposable domain with the IAM-Training tree from advanced/01-Build-ADLab.ps1. No cloud tenant is required for this track.

## Checkpoint 1 - prerequisites and preview

Copy this project to your isolated Windows Server lab VM or a domain management machine. Use Windows PowerShell 5.1 with the ActiveDirectory module and a delegated lab administrative account. Do not rerun the original foundation builder after moving lab-alex: it deliberately detects a different OU as a collision. Lifecycle reruns are the repeatable workflow from here.

Open PowerShell **in this lifecycle folder**. Substitute your actual lab values:

```powershell
$dc = 'dc01.iamlab.test'
$domain = 'iamlab.test'
.\Invoke-ADLifecycle.ps1 -Server $dc -ExpectedDomain $domain `
    -CsvPath .\data\01-joiners.csv
```

No -Apply means preview. The script reads AD, validates the whole feed and creates a unique evidence folder; it does not mutate AD. -WhatIf also prevents AD writes, even if combined with -Apply. Inspect plan.csv and the console. Confirm every target is synthetic and within IAM-Training. Unknown departments, duplicate HR/directory IDs, identity-name mismatches, privileged/protected accounts, nonstandard primary groups and out-of-scope matches stop preflight.

Gate: inspect the plan and initial evidence. **Do only this checkpoint on your first attempt.** The remaining checkpoints are available below for self-paced use after each gate passes.

## Checkpoint 2 - joiner provisioning

After reviewing the preview:

```powershell
.\Invoke-ADLifecycle.ps1 -Server $dc -ExpectedDomain $domain `
    -CsvPath .\data\01-joiners.csv -Apply
```

New-ADUser creates missing users disabled without embedded passwords. Set-ADUser reconciles HR attributes; groups use Add-ADGroupMember/Remove-ADGroupMember. The existing foundation user is initially disabled too. FollowUpRequired (exit 2) is expected until explicit activation: provisioning is not sign-in authorization. Department/OU names and birthright groups are fixed in Get-IamBirthright, not supplied as arbitrary distinguished names in HR.

The script uses EmployeeID as the HR lookup key and retains ObjectGUID for existing identities during a run. It does not implement account renames or change a cloud sourceAnchor. UserPrincipalName is generated with the local lab domain suffix; it is not proof of cloud usability or synchronization. mailNickname is not set automatically because a plain AD schema may not expose it.

Gate: four synthetic users exist with the right groups/attributes, new users are disabled, and logs match the actual outcomes.

## Checkpoint 3 - controlled initial activation

Verify the HR status is Active, initial access matches the approved role, and a fictional training change ticket is approved. Preview, then activate **one account at a time**:

```powershell
.\Enable-LabJoiner.ps1 -Server $dc -ExpectedDomain $domain `
    -EmployeeID LAB-001 -Ticket CHG-LAB-100
.\Enable-LabJoiner.ps1 -Server $dc -ExpectedDomain $domain `
    -EmployeeID LAB-001 -Ticket CHG-LAB-100 -Apply
```

The helper prompts securely for a unique lab password, requires change at next sign-in, then enables and rereads the account. Do not store passwords in CSV or audit notes. Repeat separately for LAB-002, LAB-003 and LAB-004 using approved tickets. It refuses expired/Terminated/protected accounts and does not reset an already-enabled account's password. A ticket string is training evidence, not a real approval engine. Domain password policies still apply.

Rerun the joiner lifecycle preview after activation: it should show no remaining operations. Preserve the evidence proving this convergence. A disabled existing account is never implicitly enabled by an Active HR row; rehire needs a separate process.

## Checkpoint 4 - transfer and termination

```powershell
.\Invoke-ADLifecycle.ps1 -Server $dc -ExpectedDomain $domain `
    -CsvPath .\data\02-mover-leaver.csv
# Inspect the newly generated plan.csv before the next command.
.\Invoke-ADLifecycle.ps1 -Server $dc -ExpectedDomain $domain `
    -CsvPath .\data\02-mover-leaver.csv -Apply
```

Expected for Alex: remove LAB-Support-Tickets before granting LAB-Engineering-Tools, set Department Engineering and move to the Engineering OU. Explicitly approved exceptional LAB groups remain untouched on movers; only the five managed birthright groups are reconciled.

Expected for Taylor: Disable-ADAccount first, Set-ADAccountExpiration at the run's UTC time, remove all removable direct LAB-group memberships including exceptions, then Move-ADObject to Terminated. Domain Users primary membership is preserved. Direct memberships outside recognized lab groups are reported as FollowUpRequired, not modified or described as removed. Existing logon sessions/tickets, nested or cross-system access, app sessions and cloud tokens are not revoked by this script. Lab groups nested outside the approved lab group tree block preflight.

Gate: summary.csv has Verified for completed rows, remaining-plan.csv has no outstanding mutation for those rows, and AD inspection confirms the actual groups/OU/disabled/expiration state. After replication, test access through a fresh sign-in on an optional isolated client; do not infer session termination from group removal alone.

## Checkpoint 5 - failure, recovery and repeatability

1. Preview data/03-invalid-feed.csv. Expect a terminating validation error before any AD write. Correct UNKNOWN to HR in a copy and retry. Never edit the original fixture when keeping before/after evidence.
2. Offline executor tests inject a directory-operation failure. Read tests/Planner.Tests.ps1 and observe that subsequent changes for the same identity stop while independent identities can continue. This is an **offline injected failure**, not proof of a real connector outage.
3. For a live failure exercise, use a separate delegated lab operator missing the relevant group-write permission. Do not remove production permissions or break the DC. Capture the failed operation and subsequent skipped work, then restore the approved lab delegation and rerun.
4. Re-preview the mover/leaver feed. Verified rows should generate no operations. Failed rows should converge after the underlying cause is corrected. There is no fictitious rollback: earlier successful operations remain and are reconciled on retry.

Gate: write an incident note using operational/PROVISIONING-FAILURE.md. Include failed identity/operation, ticket/run ID, actual state, temporary risk, cause, approved correction, retry result and evidence. Exit 2 means failure or follow-up, not success.

## Evidence and audit behavior

Each run gets evidence/ad-lifecycle/<run-guid> containing plan.csv, before.json, after.json, remaining-plan.csv, summary.csv and audit.jsonl. Validation failures before a run folder exists are terminating console errors: capture a transcript for the invalid-input exercise. Directory errors and attempted operations are logged with intent before mutation and success/failure afterwards. Audit write failure stops further writes. Per-identity execution stops after the first failed operation, preserving earlier successes. Local file logs are not tamper-resistant or centralized security telemetry.

A shared lock prevents simultaneous runs using the same OutputRoot. Keep OutputRoot consistent across operators; changing it bypasses that local lock. The lock does not coordinate unrelated administrative tools. No multi-object AD transaction is implied. Check replication on other DCs separately.

Raw snapshots contain lab directory identifiers. Keep them private until reviewed; the portfolio exporter excludes them by default. Do not publish passwords, Kerberos material, tokens or tenant secrets.

## Local verification

```powershell
powershell.exe -NoProfile -File .\tests\Planner.Tests.ps1
```

This tests planner/executor behavior without an AD server. Live AD checks are a separate requirement. Microsoft references: [New-ADUser](https://learn.microsoft.com/powershell/module/activedirectory/new-aduser), [Set-ADUser](https://learn.microsoft.com/powershell/module/activedirectory/set-aduser), [Remove-ADGroupMember](https://learn.microsoft.com/powershell/module/activedirectory/remove-adgroupmember), [Disable-ADAccount](https://learn.microsoft.com/powershell/module/activedirectory/disable-adaccount), [Set-ADAccountExpiration](https://learn.microsoft.com/powershell/module/activedirectory/set-adaccountexpiration).
