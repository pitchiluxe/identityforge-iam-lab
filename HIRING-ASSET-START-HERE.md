# IdentityForge - build a hiring asset

This upgrade adds executable AD lifecycle tooling, an Entra SSO client, operational drills and a curated source-bundle exporter. It builds on the standalone lab without changing your saved simulation progress.

## Start with one checkpoint

1. If you do not yet have an isolated Windows Server AD domain, use the setup PDF, then advanced/CHECKPOINT-01.md. Nothing here automatically installs a DC or joins your Windows host to a domain.
2. Read advanced/lifecycle/README.md and complete its first checkpoint: validate the lab and preview the joiner CSV. Do not use -Apply before inspecting the plan.
3. Continue independently through joiners, approved activation, mover/leaver, failure/recovery and convergence. Keep each run ID and actual verification evidence.
4. Use operational/Export-AccessReview.ps1 and ACCESS-REVIEW-DECISION.md to record a certification decision. Complete PROVISIONING-FAILURE.md and PRIVILEGED-INCIDENT.md with clearly labeled evidence.
5. For real SSO, use sso/README.md. Since no tenant is currently available, local code readiness can be verified but live integration remains pending. There is no fake sign-in or automatic tenant purchase.
6. Fill portfolio/README.md only with accomplishments you actually verified. Use portfolio/Export-Portfolio.ps1 to package reviewed source for your portfolio.

## Offline checks available now

From the project root:

```powershell
powershell.exe -NoProfile -File .\advanced\lifecycle\tests\Planner.Tests.ps1
powershell.exe -NoProfile -File .\operational\tests\Review.Tests.ps1
```

In the sso folder:

```powershell
npm ci
npm test
npm run build
npm run dev
```

The local SSO page explains configuration requirements and leaves sign-in unavailable until a real lab tenant and application ID are supplied. The runner performs AD writes only when invoked explicitly against your named domain/DC with -Apply. Initial activation is separate and prompts for a SecureString password.

## Strong interview proof

Show a before state, your reviewed change plan, the exact operation/result log, independently verified after state and an example of failure/recovery. Explain which access is managed by birthright policy and which requires owner approval. Distinguish disabling an account from terminating sessions and revoking cloud tokens.

