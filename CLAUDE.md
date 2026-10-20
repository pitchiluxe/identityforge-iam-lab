# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

IdentityForge: a portable Windows IAM (identity & access management) career lab. Four loosely coupled tracks share one folder:

1. **Standalone simulation** (`Lab.ps1`, launched via `Start-Lab.cmd`) — synthetic IGA/AM/PAM exercises over JSON state. No network, no admin rights, no real Windows/AD changes.
2. **Real AD lifecycle automation** (`advanced/lifecycle/`) — CSV-driven joiner/mover/leaver against an isolated lab AD domain using real ActiveDirectory cmdlets.
3. **Entra SSO client** (`sso/`) — MSAL Browser + Vite app for a lab Entra tenant, with a claim-mapping break/fix exercise.
4. **Meridian IAM Range** (`range/`, formerly IdentityForge Range) — the main practice environment: a simulated hospital IAM workstation (ADUC, PowerShell, Entra/Okta/ServiceDesk/HR portals) with randomised, deterministically graded scenarios and optional Ollama. Start-Lab.cmd option 9.

Plus operational drills (`operational/`), a portfolio exporter (`portfolio/`), and Python generators for PDFs/images/calendar (`tools/`).

**Project status matters for every edit:** live AD and live Entra SSO are **not verified** (no lab domain/tenant available). Docs, READMEs, PDFs, and evidence must never claim live results. Keep the distinction between "offline/local checks passed" and "live verified" (see `portfolio/VERIFICATION.md`). Only fictional data (`LAB-###`, `lab-*`, `*.invalid`, `iamlab.test`); never real credentials.

## Commands

Target runtime is **Windows PowerShell 5.1** (`powershell.exe`), not pwsh — keep scripts 5.1-compatible. Run from project root.

```powershell
# Full offline verification suite (all PS tests + SSO tests + SSO build); writes evidence\verification\upgrade-<utc>.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-Upgrade.ps1

# Individual PowerShell test scripts (plain scripts with Assert helpers, not Pester; non-zero exit = failure)
powershell.exe -NoProfile -File .\advanced\lifecycle\tests\Planner.Tests.ps1   # planner/executor/activation
powershell.exe -NoProfile -File .\advanced\lifecycle\tests\Preview.Tests.ps1   # runner wiring via fake AD module
powershell.exe -NoProfile -File .\operational\tests\Review.Tests.ps1

# Simulation syntax/template self-check
powershell.exe -NoProfile -File .\Lab.ps1 -SelfTest

# Portfolio source bundle -> output\portfolio-bundles\IdentityForge-Source-<utc>-<id>.zip
powershell.exe -NoProfile -File .\portfolio\Export-Portfolio.ps1
```

SSO (in `sso/`, Node >= 22.12; scripts call vite via `node node_modules/vite/bin/vite.js`):

```powershell
npm ci; npm test; npm run build; npm run dev     # dev server fixed at http://localhost:5173/
node --test tests/policy.test.mjs                # single test file
```

Range (in `range/`, Node >= 22.18 runs the `.ts` tests directly via type stripping; no test framework):

```powershell
npm test                                   # node --test "tests/**/*.test.ts"
node --test --test-name-pattern="leaver" "tests/*.test.ts"   # one scenario
npm run typecheck; npm run build; npm run dev   # dev on http://localhost:5180, proxies /ollama -> 127.0.0.1:11434
```

Regenerate PDFs/images/schedule (requires Python with reportlab, Pillow, pypdf): `python tools/build_guides.py`, `python tools/create_lab_schedule.py`.

## Architecture

### AD lifecycle (`advanced/lifecycle/`)
Pure planner + thin side-effecting runner, so logic is testable without AD:
- `IamLifecycle.psm1` — `Get-IamBirthright` (fixed dept → OU + `LAB-*` group map; the only source of OUs/groups, never taken from CSV), `New-IamLifecyclePlan` (validates the **entire** HR batch before emitting any op, then produces ordered ops from an AD snapshot), `Invoke-IamPlan` (executor taking an `$ApplyOperation` scriptblock), `Invoke-IamActivation`.
- `Invoke-ADLifecycle.ps1` — reads AD, builds plan, applies through real cmdlets **only with `-Apply`**; `-WhatIf` overrides `-Apply`. Per-run evidence in `evidence/ad-lifecycle/<run-guid>/` (plan, before/after snapshots, remaining-plan, summary, audit.jsonl). Lock file on OutputRoot.
- `Enable-LabJoiner.ps1` — separate, per-account activation with SecureString password.

Invariants enforced by tests (preserve them when changing the planner/executor):
- Scope limited to `OU=IAM-Training,...` and `LAB-` groups; protected accounts / non-513 primary group / out-of-tree matches / duplicates / unknown depts / name collisions fail preflight.
- Joiners are created **disabled**; no op ever implicitly enables an account.
- Movers: remove old birthright groups **before** adding new; non-birthright (exception) LAB groups preserved.
- Leavers: Disable first, then Expire, remove all direct LAB groups; non-LAB memberships become `ManualFollowUp`, never silently dropped.
- Audit `Intent` is written before each mutation; audit failure must escape (stop the run), not be reported as a directory failure. First failed op stops that identity only; no rollback — reruns reconcile (replay must converge to zero ops).
- Exit code 2 = failure or follow-up required, not success.
- Activation failure must attempt containment (Disable) even if logging fails.

`Preview.Tests.ps1` injects a fake `ActiveDirectory` module via a temp `PSModulePath` to run the real runner script.

### SSO (`sso/`)
`policy.mjs` holds pure logic (config validation, post-MSAL claim-contract check with `healthy`/`broken` modes, sanitized event logging); `main.mjs` is the MSAL UI glue. This is **not** a JWT verifier and there is no fake sign-in mode — without a real `config.local.json` (gitignored; template `public/config.example.json`) sign-in stays unavailable. Redirect URI is pinned to `http://localhost:5173/`.

### Simulation (`Lab.ps1`)
Single-file menu loop. On first run it creates `workspace/state.json` and copies `templates/rules.json` + `templates/access-policy.json` into `workspace/` (editable by learner). Events append to `evidence/audit.jsonl`. `Verify-Lab` encodes the expected end state checked against `ANSWER-KEY.md`/`WORKBOOK.md` — keep those docs in sync when changing exercises or seed data.

### Publishing flow
`portfolio/Export-Portfolio.ps1` copies an **explicit allowlist** of files (plus `.ps1/.psm1/.md/.csv/.json` under `advanced/lifecycle` and `operational`, `templates/`, `sso/tests/`) into a staged bundle; every listed file must exist or it throws. New files intended for publication must be added there. `publication/identityforge-iam-lab/` is a separate git clone (GitHub `pitchiluxe/identityforge-iam-lab`) populated from a bundle; the project root itself is not a git repo and `publication/` is gitignored.

### Meridian IAM Range (`range/`)
Vanilla TypeScript + Vite, no UI framework. Imports use explicit `.ts` extensions and only erasable syntax (no enums/parameter properties) so Node can run tests without a build.
- `src/core/types.ts`: the whole world is one JSON `World` (AD, Entra, Okta, SaaS, HR, tickets, mail, files, audit, scenarios). `core/time.ts` is the only clock (`setClock` in tests); never call `Date.now()` in world/scenario code.
- `src/world/*`: the only code that mutates the world. Functions validate like the real system, throw the real error text, and write audit events (AD ones carry Windows event IDs). ADUC (`ui/apps/aduc.ts`), the PowerShell engine (`terminal/`) and the portals (`ui/sites/`) all call these, so they never disagree. `company.ts` is the single source for OUs, groups, job roles and birthright; `docs.ts` generates the policy files from it.
- AD design mirrors IAM Range (`../IAM_virtual-machine`), remapped to a hospital: Meridian Health System, `meridianhealth.test` (NetBIOS `MERIDIAN`), `OU=Corp`, `grp-*`/`role-*`/`app-*`/`svc-*`; departments IT, Help Desk, Security, HR, Finance, Nursing, Radiology; apps CareChart EHR (Entra SCIM), ImageVault PACS (Okta SCIM), PayrollPro (manual), ExpenseFlow. The learner is `Admin` (`admin` / `adm-admin`); sign-in password `Meridian!2026` is shown on the sign-in screen. Bump `WORLD_VERSION` in `world/seed.ts` when the seed changes shape. Deliberate realism to preserve: AD changes reach Entra only after `runEntraSync`; synced attributes are read-only in the cloud; disable does not revoke sessions; Staging/ServiceAccounts are outside sync scope; PayrollPro is manual (no SCIM); IAM ops cannot add to Tier 0 groups.
- `src/scenarios/`: templates (`library/*.ts`) build evidence into the world, open tickets/mail, and return checks as data (`CheckSpec`). Only `grader.ts` evaluates them. Each template has a reference `solve` and, for trap twists, a `naive`; `tests/scenarios.test.ts` replays every template x twist x 5 seeds (untouched fails, solve passes all, naive fails a critical check). Adding a template means adding it to `engine.ts` TEMPLATES and making that test pass. New check kinds need a case in `grader.ts`.
- `src/ai/ollama.ts`: the model never decides facts or grades. Designs are validated against the template menu; rewording must keep every `factTokens`; backdrops are dropped if `backdropProblems` finds invented specifics. Default model prefers `llama3.2` and never auto-picks `:cloud` models.
- `src/ai/monitor.ts` (pure, tested in `tests/monitor.test.ts`) re-grades active labs after each world change and diffs check results; `ui/copilot.ts` turns pass-to-fail flips on critical checks into nudges and gives the model done/to-do checklists. Lab setup records `ScenarioInstance.setupAudit` so backdrop audit events are not shown as the learner's actions.
- Windows shell: `ui/wm.ts` (windows, taskbar, pins; `customTitlebar` apps such as Chrome draw into `titleSlot`), `ui/ctxmenu.ts` (all right-click menus; the browser menu is suppressed globally, and handlers that call `preventDefault` win), `ui/theme.ts` (appearance applied as `data-*` attributes on `<html>` plus a generated cursor stylesheet), `ui/launch.ts` (what "open" means for files and programs: `.ps1` runs on double-click, Edit opens the ISE). Shell component CSS is in `src/shell.css`.
- Desktop edition: `electron/main.cjs` serves `dist/` from a private `app://range/` scheme (stable localStorage origin) and proxies `/ollama/*` to 127.0.0.1:11434 without an Origin header; `electron-updater` checks GitHub Releases of `pitchiluxe/identityforge-iam-lab` (auto-download, install on quit); `src/ui/updates.ts` shows the state in Settings > Windows Update. `npm run build:desktop` builds the NSIS installer into `dist-installer/`; `npm run release` publishes (needs `GH_TOKEN`); bump `version` in `range/package.json` first. Call build tools through `node node_modules/...`: the `&` in this folder's path breaks npm's `.cmd` shims. `MERIDIAN_SMOKE=<dir>` makes the packaged app write `smoke.png`/`smoke.json` and exit. Product name, window title and release repo live in `src/product.ts`; `tests/branding.test.ts` keeps `electron/main.cjs`, `package.json` and `site/` in step.
- Web edition: `npm run build:web` builds the lab with `--base=/lab/` into `site/lab/` (committed, served by Vercel). Root-absolute asset paths must use `import.meta.env.BASE_URL`. Over https the app calls Ollama at http://127.0.0.1:11434 directly (`WEB_EDITION` in `ai/ollama.ts`), which needs `OLLAMA_ORIGINS` on the learner's PC.
- Workstation system layer: `ui/system.ts` (clock/time zone, sound, brightness, account picture, sign-in password, idle lock, airplane mode, notification history, default apps, startup apps; toasts route through it) and `ui/taskbar.ts` (calendar/notification centre, Quick Settings, hidden icons). Settings pages must change something real; remove a control rather than fake it.
- Shells: `terminal/cmd.ts` is cmd.exe plus batch files (pure, tested in `tests/cmd.test.ts`; no eval, the app CSP forbids it); `ui/apps/console.ts` hosts it; `ui/apps/terminal.ts` is Windows Terminal (PowerShell and Command Prompt tabs, split panes). Consoles scroll as one area with the prompt after the last line.
- Passwords: `AdUser.labPassword` keeps the current password so sign-ins can be tested (real AD keeps a hash); every reset path sets it, `Read-Host -AsSecureString` leaves it unknown. `world/directory.ts` `signIn` / `changeOwnPassword` apply Windows' refusal order and events (tests in `tests/signin.test.ts`); `ui/apps/rdp.ts` is Remote Desktop (help-a-user and verify-a-sign-in modes).
- Event Viewer: `world/eventlog.ts` (read-only, tested in `tests/eventlog.test.ts`) builds every log: Security from AD audit events, Defender from Windows Security's history, the rest as stable baselines anchored on `world.created`. Clearing a log is recorded in settings (`eventViewer.clears`), never by editing `world.audit`, so grading is unaffected; it adds 1102/104 as Windows does. UI in `ui/apps/eventviewer.ts`.
- Office and Sticky Notes: `core/sheet.ts` (formula engine and CSV, no eval) and `core/office.ts` (Word/PowerPoint/Excel file formats as validated JSON; `.docx/.xlsx/.pptx` here are lab formats, not zip packages) are pure and tested. `ui/richdom.ts` is the one rich-text editor (contenteditable + execCommand); it saves the document model, never HTML, renders with `textContent`/`element.style`, and pastes plain text only. `ui/apps/office.ts` is the shared title bar, ribbon and File backstage. Sticky notes live in settings (`stickyNotes`), not the world.
- Chrome loads real websites: `<webview>` in the desktop app (`webviewTag`, locked down in `electron/main.cjs`), an iframe in the browser edition. `index.html` carries a CSP; new features that load blobs, frames or remote connections must be allowed there.
- Landing page: `site/` (static HTML/CSS/JS, deployed by Vercel via root `vercel.json`); its download buttons resolve the latest `Setup*.exe` from the GitHub API and fall back to `/releases/latest`.
- UI text is set via `textContent` only (`ui/dom.ts` `h()`); never use `innerHTML` with ticket, file or model text. State persists to localStorage (`ui/store.ts`); career progress is stored separately from the world so a company reset keeps it.

### Generated / non-source
`workspace/`, `evidence/`, `tmp/`, `output/portfolio-bundles/`, `sso/dist/`, `range/dist/`, `range/dist-installer/`, `range/node_modules/`, `.playwright-mcp/` are generated (gitignored). `output/pdf` and `output/images` are generated by `tools/build_guides.py` but are shipped. `MyScripts/` holds the user's personal JML scripts (`Joiner-Mover-Leaver_JML.ps1` is canonical; `hr-source.ps1` wraps it; `Verification_JML.ps1` checks the after-state); they are exported with the portfolio.

## Conventions
- Line endings set by `.gitattributes`: `.ps1/.psm1/.cmd` CRLF; `.md/.json/.mjs/.html/.css` LF.
- PowerShell style is dense (compact one-liners, `Set-StrictMode -Version 2.0`, `$ErrorActionPreference='Stop'`); match it.
- `Start-Lab.cmd` menu options and `README.md`/`HIRING-ASSET-START-HERE.md` reference each other's numbering and file paths — update together.
