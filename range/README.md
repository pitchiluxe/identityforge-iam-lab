# Meridian IAM Range

A simulated IAM engineer's workstation at a fictional hospital system, Meridian Health System (`meridianhealth.test`). Work arrives as tickets and emails; you fix it with the tools the job uses, and a deterministic examiner checks the result against the hospital's policies, including HIPAA access control.

**Everything here is simulated.** No real directory, tenant, patient or account is touched. Label any evidence you export as practice in a simulated environment.

## Install (Windows)

Download `Meridian-IAM-Range-Setup-<version>.exe` from [Releases](https://github.com/pitchiluxe/identityforge-iam-lab/releases/latest) and run it. The installer is not code-signed yet, so Windows SmartScreen may stop it: choose **More info**, then **Run anyway**. It installs for your account without administrator rights.

Sign in as **Admin** with the password shown on the sign-in screen: `Meridian!2026`.

The installed app updates itself: it checks GitHub Releases when it starts and every six hours, downloads new versions in the background, and installs them on restart. Settings > Windows Update shows the version and status. Your world, settings and career record are kept.

## Use it in the browser

No install needed: the landing page's **Try it in your browser** opens the web edition at `/lab/`. It is the same lab; progress is saved in that browser. Copilot chat reaches Ollama on your own computer only if Ollama allows the site: run `setx OLLAMA_ORIGINS "https://<the site's address>"` in PowerShell (the exact address, never `"*"`, which would let any website use your local model), then quit and restart Ollama. `npm run build:web` rebuilds it into `../site/lab/` (the release script does this too).

## Run from source

```powershell
# From Start-Lab.cmd choose [9], or:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\range\Start-Range.ps1
```

Needs Node.js 22.18+. Then open http://localhost:5180 and sign in as Admin (`Meridian!2026`).

Developer commands (in `range/`):

```powershell
npm run dev          # http://localhost:5180 (proxies /ollama to 127.0.0.1:11434)
npm test             # node --test: world, every scenario, PowerShell engine, AI guards
npm run typecheck
npm run build        # dist/
npm run electron:dev # the desktop app against a fresh build
npm run build:desktop # dist-installer/Meridian-IAM-Range-Setup-<version>.exe, not published
npm run release      # build and publish a GitHub release (needs GH_TOKEN); installed copies update from it
node --test --test-name-pattern="leaver" "tests/*.test.ts"   # one scenario's tests
```

## What is on the workstation

| Tool | What you do with it |
| --- | --- |
| Google Chrome | Tabs in the title bar, omnibox (URLs or intranet search), bookmarks bar, the ⋮ menu, History (Ctrl+H), Downloads (Ctrl+J), bookmarks (Ctrl+D), find (Ctrl+F), zoom, Incognito (Ctrl+Shift+N), tab right-click menu. Sites: ServiceDesk (tickets, approvals, work notes, resolution codes, Security Incidents), PeopleHub (HR source of truth), Outlook on the web, the Entra admin center, the Okta admin console, SaaS admin consoles and the policy wiki. The **Real portals** folder opens the real Microsoft, Okta and ServiceNow sites in your own browser, for your own lab tenant. |
| Active Directory Users and Computers | The ADUC from IAM Range: every menu (Action, View, Find, Saved Queries), wizards, Properties tabs including Attribute Editor, Delegate Control, OUs, groups, computers. Each action changes the graded world. |
| Windows PowerShell / ISE | ActiveDirectory, ADSync and Microsoft.Graph cmdlets, functions, `param()`, `try/catch`, loops, `-f`, `[datetime]`/`[math]` statics, `>>` continuation, Tab completion. Write `.ps1` files in the ISE (F5/F8) and double-click them on the desktop or in File Explorer to run them. |
| Event Viewer | The DC Security log: 4740 lockouts with Caller Computer, 4771 failures, 4720/4722/4725/4728/4729 changes |
| File Explorer / Notepad | Policies, birthright matrix, app catalog, naming standard, scripts, audit exports, your evidence. New, Rename (F2), Delete to the Recycle Bin, Properties, Open in Terminal. |
| Settings / Control Panel | Wallpaper (including your own picture), dark mode, accent colour, themes, taskbar alignment, desktop icon size, mouse pointer style, colour and size, 24-hour clock, notifications, and the IAM Lab page (Ollama model, background sync, reset). Control Panel has Windows Tools and Mouse Properties. |
| IAM Copilot | A senior IAM engineer on call (taskbar button or Alt+C). It watches every running lab, warns you the moment an action breaks a critical control, and answers questions through your local Ollama model. Without Ollama it still reports what the checks say. |
| IAM Coach | Start a lab, a shift (3 or 5 tickets at once) or an AI-designed lab; Check my work; hints; debrief; interview drill; mentor chat; export evidence |
| Career Tracker | Your passes mapped to what IAM job descriptions ask for |

## Scenarios

17 templates with 35 variations, randomised by person, department and evidence, so no two runs are the same. 11 of them are traps: the obvious action is the wrong one.

Joiner (future start, start today, "copy a colleague", no HR record), mover (plain, approved exception, old leftovers), leaver (voluntary, involuntary with live sessions, manual PayrollPro), password reset (verified, social engineering), lockout (stale device, password spray), MFA reset (new phone, bypass attempt), compromised account (MFA fatigue, impossible travel), access request (approved, missing owner approval, SoD conflict), access review, stale accounts, orphaned accounts, SSO access (lost group, direct assignments), executive impersonation email, standing privilege (permanent admin request, standing Global Admin), service account in Domain Admins, Conditional Access with break-glass, hybrid sync (staging OU, name change, InvalidSoftMatch).

## Ollama

Optional. When a local model answers (default preference `llama3.2`, never a `:cloud` model automatically):

- **Design a new lab:** the model picks a template, variation and department from the real menu and writes a backdrop. Off-menu choices are rejected. Backdrops that add places, numbers or names the systems do not support are discarded.
- **Reword tickets** in the caller's voice. Rejected unless every ID, account, group, IP and date survives.
- **Mentor chat and interview scoring**, from a frozen copy of the examiner's results.
- **IAM Copilot chat**, given the live checklists (done / still to do) and your own recent actions. The lab monitor itself is deterministic and works without a model.

The model never decides facts or grades work. Without Ollama, everything except these chat and writing features works.

## Design rules (for contributors)

- The world is one JSON object (`src/core/types.ts`). All changes go through `src/world/*` functions, which validate like the real system, write the matching audit or Security event, and are shared by ADUC, PowerShell and the portals.
- Checks are data (`CheckSpec`), graded only by `src/scenarios/grader.ts`.
- Every template has a reference `solve` and, for traps, a `naive` answer. `tests/scenarios.test.ts` replays every template and variation across five seeds: untouched must fail, the reference must pass every check, and naive answers to traps must fail a critical check.
- AD design follows IAM Range (`../IAM_virtual-machine`): `omari.test`, `OU=Corp`, `grp-*`/`role-*`/`app-*`/`svc-*`, 7 departments.
