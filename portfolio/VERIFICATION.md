# Implementation verification record

Date: October 18, 2026. Environment: local Windows workspace, Windows PowerShell 5.1 and Node.js 22.21.1. No available AD module/domain endpoint or Entra lab tenant has been supplied.

## Verification lanes

- AD planner/executor: offline tests cover validation, identity collisions, mover removal order, preserved exceptions, disabled joiners, leaver ordering, convergence, preview no-write behavior, operation failure and audit fail-closed behavior.
- Initial activation: offline injected post-enable logging failure verifies containment occurs independently of logging availability. Actual password/domain-policy and activation behavior still require the lab DC.
- AD orchestration: the real runner executes against a test-only read provider to verify -Apply -WhatIf produces local evidence and never invokes AD mutations. This is not an integration test against Microsoft AD DS.
- Certification export: synthetic input verifies separate identity findings, SoD/stale-leaver detection, pending decisions and duplicate-HR rejection.
- SSO: unit tests verify configuration, tenant/audience/expiry/subject checks, deliberate mapping rejection, lack of automatic retry, safe event exports and timestamp retention. Vite builds the actual MSAL client.
- Local HTTP delivery: a temporary loopback-only server served the SSO document and transformed MSAL entry successfully, then closed. This does not prove browser authentication or a tenant callback.
- Live AD lifecycle: **NOT VERIFIED**. Requires isolated Windows Server domain, runbook execution and before/after AD evidence.
- Live Entra SSO and break/fix: **NOT VERIFIED**. User has no lab tenant yet. App registration, successful sign-in, tenant log correlation, deliberate rejection and recovery remain gates.
- Privileged compromise handling: tabletop exercise only, using a synthetic 4728 field rendering.

## Repeat the local checks

From the root: `powershell.exe -NoProfile -File .\tools\Test-Upgrade.ps1`.

Use a process-only policy override on your personal lab machine only if required and consistent with its controls. The runner produces dated JSON results under evidence/verification. Treat that file as local execution evidence, not proof of live directory or tenant behavior.

## Failures found and corrected during implementation

- PowerShell 5.1 ConvertFrom-Json array wrapping initially combined certification identities. A regression test now verifies two distinct findings.
- Duplicate HR rows could conceal a leaver; input is now rejected before export.
- WhatIf initially suppressed evidence-folder creation; only intended local evidence writes explicitly bypass WhatIf while AD writes remain disabled.
- Activation failure logging could prevent containment; containment now runs independently and a test covers logging loss after enable.
- npm-generated Windows executable shims did not tolerate the ampersand in this project's path; scripts now invoke Vite through its relative Node entry point.
- Restoring browser event history initially regenerated timestamps; sanitized restoration now preserves the original UTC timestamp.
- Windows PowerShell evaluated script-relative default output paths before PSScriptRoot was available during parameter binding; defaults now resolve inside the script body. The preview test runs a copied project with default output paths.

Do not publish raw dependency logs, raw AD snapshots, or authentication traces. The source bundle omits live configuration and unreviewed evidence by design; manually inspect anything you share.
