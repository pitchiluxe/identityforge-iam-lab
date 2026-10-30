# Meridian IAM Range

A simulated IAM engineer's workstation at a fictional hospital system, Meridian Health System (`meridianhealth.test`). Work arrives as tickets and emails; you fix it with the tools the job uses, and a deterministic examiner checks the result against the hospital's policies, including HIPAA access control.

**Everything here is simulated.** No real directory, tenant, patient or account is touched. Label any evidence you export as practice in a simulated environment.

## Windows-style document editors

Both the installed desktop edition and the web workstation include **Notepad++** and **PDF-XChange Editor** in Start. These are independent training replicas, not the original applications.

Notepad++ supports document tabs, syntax highlighting, line numbers, bookmarks, Find/Replace (including regular expressions), encoding tools and session recovery. Right-click a lab file and choose **Edit with Notepad++**, or run `notepad++.exe`.

PDF-XChange Editor opens lab `.pdf` files and provides a ribbon, page thumbnails, text editing, search, comments, highlights, stamps, form fields, page organization and simulated protection/redaction. Run `PDFXEdit.exe` or open a sample document in Documents. Its files use Meridian's simulated PDF document format; arbitrary real PDFs are not supported, and its password feature is a lab exercise rather than PDF encryption.

Editor verification: `npm test` covers the document engines. To run the isolated browser checks, install Chromium with `node node_modules/playwright/cli.js install chromium`, then run `npm run test:editors:ui`. The check verifies script saving, Find, sample PDF rendering, replacement confirmation and the unsaved-window close prompt. It writes a screenshot and results to the project's generated `tmp/` folder.

## Azure portal additions

The Azure home page follows the portal layout: blue header, ten service shortcuts, Recent/Favorite resources, Navigate and Tools. Recent entries record actual resource visits; favorites are saved per tenant without altering the lab world. Create a resource opens the supported service gallery, Dashboard shows the current resource counts/favorites, and the header menu expands or collapses navigation. `npm run test:azure:home` checks these flows and the narrow-window layout.

Azure portal additions: cloud groups have **Properties** (description) and **Owners** controls. App registrations have editable **Owners** and **Authentication** (redirect URIs, one per line). Changes require the appropriate active role or ownership, write audit events, and preserve existing memberships and assignments. AD-synced groups remain read-only in the cloud.

**Sign-in logs** and **Audit logs** support text search, inclusive UTC date ranges, status/service filters and Clear filters. Searches apply to the full history before displaying the newest 200 matches. `npm run test:azure:ui` runs the isolated browser checks (requires the Chromium installation described above).

## Install (Windows)

Download `Meridian-IAM-Range-Setup-<version>.exe` from [Releases](https://github.com/pitchiluxe/identityforge-iam-lab/releases/latest) and run it. The installer is not code-signed yet, so Windows SmartScreen may stop it: choose **More info**, then **Run anyway**. It installs for your account without administrator rights.

Sign in as **Admin** with the password shown on the sign-in screen: `Meridian!2026`.

The desktop app has a menu bar, as IAM Range does: **File** (Open Captures Folder, Check for Updates, Restart, Exit), **Edit** (Undo, Redo, Cut, Copy, Paste, Paste as Plain Text, Select All), **View** (Reload, Zoom, Toggle Full Screen **F11**, Developer Tools), **Window** (Minimize, Maximize, Always on Top, Reset Window Size, Close) and **Help** (Keyboard Shortcuts, Release Notes, GitHub, Report an Issue, About). Full screen hides the menu bar so the workstation fills the monitor; F11 brings it back. Shortcuts the workstation uses itself (Ctrl+R, Ctrl+W, Ctrl+=) still go to the app inside the window.

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
| Identity Governance (Chrome bookmark) | Modelled on SailPoint Identity Security Cloud, with Saviynt's names alongside. Sources and aggregation (the console shows what it last aggregated), identities from PeopleHub, correlation rules and uncorrelated accounts, access exceptions, SoD policies, and certification campaigns with risk flags (Terminated, SoD, Outside role, Exception, Privileged, Dormant), filters, bulk decisions, reassignment and sign-off. Revocations are provisioned on sign-off; PayrollPro has no connector, so it raises a manual work item. |
| Privileged Access Vault (Chrome bookmark) | Modelled on CyberArk PAM. Safes with Use / Retrieve / Approve / Manage, dual control and change-ticket checks for Tier 0, recorded PSM sessions (connect without ever seeing the password), password change at check-in, CPM rotation that updates registered usages (and breaks unregistered ones), discovered accounts, break-glass, and a vault audit of every retrieval. |
| SAML and OIDC in the Entra admin center | Enterprise apps have Users and groups, Single sign-on (Identifier, Reply URLs, Name ID, claims, signing certificates, federation metadata) or Authentication & secrets (redirect URIs, client secrets), and Test single sign-on, which walks the sign-in step by step, stops with the real AADSTS code or the app's error, and shows the decoded SAML request/response or ID token. The apps' own SSO settings are on ShiftWise's admin site and CareChart's SaaS admin page. |
| Windows Terminal | Tabs (Windows PowerShell, Command Prompt), split panes (Alt+Shift+Plus/Minus), find (Ctrl+Shift+F), zoom, rename/colour/duplicate tabs, colour schemes and settings. |
| Command Prompt and .bat files | cmd.exe built-ins and the tools IAM uses (`net user <name> /domain`, `whoami /groups`, `gpresult /r`, `klist`, `ipconfig /all`), redirection, pipes into `find`/`findstr`, and batch files with labels, `call`, `if`, `for`, `set /a`, delayed expansion and arguments. Create one with New > Windows Batch File and double-click it to run. |
| Remote Desktop Connection | Help a user on their computer with your own admin credentials, or verify a sign-in as a directory account on MHS-TEST-WKS01: wrong passwords count towards lockout (4771, 4740), disabled, locked and expired accounts are refused in Windows' words, and "must change password" asks for a new one (4723). Sign-ins and sign-outs write 4624 and 4634. |
| Event Viewer | Every node opens. Overview and Summary; Custom Views > Administrative Events (every Critical, Error and Warning); Windows Logs: Security (the DC audit trail your actions write: 4740 lockouts with Caller Computer, 4771 Kerberos failures, 4720-4729 account and group changes, 4624/4625/4634 sign-ins), Application, Setup, System and Forwarded Events; Applications and Services Logs: Directory Service (2887/2889 unsigned LDAP binds by a service account), DNS Server, Windows PowerShell and Windows Defender > Operational (your Windows Security scans). Working File/Action/View/Help menus, Back/Forward, column sorting, arrow keys, Event Properties (double-click) with Copy, Filter Current Log (levels, ID ranges such as 4720-4729 and exclusions such as -4624, keywords), Find, Save All Events As CSV (opens in Excel), log Properties, and Clear Log, which writes 1102 (Security) or 104 (other logs) as Windows does. |
| Windows Security | Quick, Full and Custom scans of the virtual disk find the EICAR test file, credential-theft tools (Mimikatz, NTDS/SAM dumps) and passwords written in plain text into scripts; Quarantine, Allow and Restore, Protection history, firewall profiles, account protection (default sign-in password, lock when away). Opens from Settings > Privacy & security, the tray, or `start windowsdefender:`. |
| Markdown Viewer | Double-click any `.md` file (the policies in DocumentsPolicies are Markdown): headings, bold/italic/strikethrough, tables with alignment, task lists, code blocks with Copy, GitHub-style alerts (`> [!WARNING]`), links that open web pages in Chrome, jump to `#headings` or open other `.md` files with Back/Forward. Preview, Split (live edit and Ctrl+S) and Source views, outline, find, zoom and print. Raw HTML in a file is shown as text, never run. Right-click > Edit still opens Notepad. |
| Screen Pen | Draw on the live workstation (as in IAM Range): pen, highlighter, arrow, box and eraser in six colours and three widths, undo/redo/clear, and a toolbar you can drag anywhere. Opens in Click-through so the apps keep working under your marks; picking a tool switches to Drawing, and Esc hands the desktop back. Screenshot (the desktop app captures its own window silently) and narrated recording with a webcam bubble; files go to Documents\Meridian IAM Range\Captures (desktop) or Downloads (browser). Opens from the pen icon by the clock, Start, or Win+Shift+D. |
| Sticky Notes | Windows 11 notes: each note is its own coloured window (+ new note, the ... menu with seven colours, Notes list, Delete) with bold, italic, underline, strikethrough and bullets. The Notes list searches every note. Notes are yours, not the company's: they survive a lab reset, and notes left open come back after you sign in. |
| Word | Ribbon (Home, Insert, Layout, Review, View), fonts and sizes, colours and highlight, bullets and numbering, alignment, the styles gallery (Title, Headings, Quote), find and replace, margins and orientation, word count and zoom. Opens `.docx`, `.txt` and `.md`; saves `.docx` or exports plain text. |
| Excel | Grid with the Name Box and formula bar, keyboard navigation, drag selection, in-cell editing (click a cell while typing a formula to insert its reference), copy and paste with shifting references, formats, AutoSum, sort (keeps the header row), Remove Duplicates, column resize and auto-fit, sheet tabs, and Average/Count/Sum in the status bar. Formulas include SUM, AVERAGE, COUNT/COUNTA/COUNTIF, SUMIF, IF/IFERROR, AND/OR, VLOOKUP, TEXTJOIN, LEFT/RIGHT/MID, TRIM, UPPER/LOWER and TODAY, with Excel's error values. Double-clicking a `.csv` (access reviews, HR feeds, the birthright matrix) opens it in Excel; Export saves CSV. |
| PowerPoint | Slide thumbnails (right-click to duplicate, move or delete), layouts (Title, Title and Content, Section Header, Blank), five design themes, rich text in placeholders, speaker notes, and a full-screen Slide Show (F5, arrows, Esc). |
| File Explorer / Notepad | Policies, birthright matrix, app catalog, naming standard, scripts, audit exports, your evidence. New, Rename (F2), Delete to the Recycle Bin, Properties, Open in Terminal. |
| Settings / Control Panel | Your own account picture, sign-in password and idle lock, time zone and regional format, brightness, night light, volume and notification sounds, Bluetooth, airplane mode (stops real websites), VPN and proxy, default apps for .ps1 and .bat, startup apps, wallpaper (including your own picture), dark mode, accent colour, themes, taskbar alignment, desktop icon size, mouse pointer style, colour and size, 24-hour clock, notifications, and the IAM Lab page (Ollama model, background sync, reset). Control Panel has Windows Tools and Mouse Properties. |
| IAM Copilot | A senior IAM engineer on call (taskbar button or Alt+C). It watches every running lab, warns you the moment an action breaks a critical control, and answers questions through your local Ollama model. Without Ollama it still reports what the checks say. |
| IAM Coach | Start a lab, a shift (3 or 5 tickets at once) or an AI-designed lab; Check my work; hints; debrief; interview drill; mentor chat; export evidence |
| Career Tracker | Your passes mapped to what IAM job descriptions ask for |

## A worked example

The landing page has a walkthrough of three labs done end to end, screen by screen: onboarding a nurse who starts today, refusing a socially engineered password reset, and an involuntary termination (`site/walkthrough/`).

## Scenarios

23 templates with 51 variations, randomised by person, department and evidence, so no two runs are the same. 19 of them are traps: the obvious action is the wrong one.

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
