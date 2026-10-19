# IdentityForge - concise IAM portfolio

## Problem

HR changes and disconnected access administration cause stale accounts, privilege creep and poorly evidenced remediation. This lab implements repeatable lifecycle tooling and practices evidence-driven incident and access decisions.

## Current implementation, not claimed experience

| Asset | Implemented | Verification status |
|---|---|---|
| Standalone IGA/AM/PAM console | Yes | Local simulation checks; no enterprise controls deployed |
| CSV-driven AD lifecycle planner and real-cmdlet runner | Yes | Offline automated checks; live AD run pending |
| Initial AD account activation helper | Yes | Syntax/review; live AD run pending |
| Entra MSAL sign-in application and mapping break/fix | Yes | Local unit/build checks; no tenant available; live sign-in pending |
| Access review exporter and decision worksheet | Yes | Offline fixture checks; actual owner decision pending |
| Privileged compromise investigation | Tabletop | Synthetic event; no real compromise or Domain Admin grant |
| Hybrid AD-to-cloud synchronization | No | Design concepts only |

Use VERIFICATION.md for recorded checks and the private evidence ledger below for your own runs. Do not turn Pending into Verified without an artifact.

## Your project summary - fill after doing the work

**Business problem:** [one sentence]. **Environment:** [actual isolated domain/tenant or simulation]. **What I built:** [specific scripts and integration]. **Failure I investigated:** [actual failure and correction]. **Verification:** [artifact/run IDs and observed outcomes]. **Limitations:** [pending live checks; session/token controls outside scope]. **Next step:** [specific improvement].

Resume wording after implementation but before live execution: "Built a PowerShell AD lifecycle automation lab with CSV validation, managed-group reconciliation, per-identity failure handling and JSONL audit trails; verified planning/execution behavior with offline tests."

After a verified live AD run, add what actually occurred and the isolated scope. After successful cloud sign-in plus break/fix, describe the Entra integration separately. Never describe an offline test as a production deployment or imply employment experience.

## Evidence ledger

| Stage | Artifact / run ID | Observed result | Evidence kind | Reviewer/date |
|---|---|---|---|---|
| AD baseline and joiners | [fill] | [fill] | Pending | [fill] |
| Mover and leaver | [fill] | [fill] | Pending | [fill] |
| Failure/recovery | [fill] | [fill] | Pending | [fill] |
| Certification decision | [fill] | [fill] | Pending | [fill] |
| SSO baseline/break/fix | [fill] | [fill] | Pending | [fill] |
| Privileged incident judgment | [fill] | [fill] | Tabletop until otherwise proven | [fill] |

## Share a source bundle

From the project root run `powershell.exe -NoProfile -File .\portfolio\Export-Portfolio.ps1`. It creates a ZIP under output/portfolio-bundles containing allowlisted source, runbooks and verification notes. It intentionally omits tenant configuration, node_modules, working state, raw audit/snapshot files and all unreviewed evidence. It does not publish anything.

Public evidence is a **separate manual selection**: export fixed-code SSO events, review screenshots at full size, remove identifiers and secrets, and add only sanitized copies to your own portfolio. Automated source selection is not a guarantee that future edits contain no secrets; inspect the ZIP before sharing.
