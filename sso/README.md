# Real Microsoft Entra SSO integration - live verification pending

This is a working browser application using Microsoft MSAL, not a fake IdP. It needs an isolated Entra workforce lab tenant, a test user and your own app registration. **You currently have no tenant.** Code/tests do not establish live sign-in success, and no tenant was provisioned for you.

## Checkpoint 1 - obtain a suitable lab tenant

Use an isolated tenant you are entitled to administer. Tenant/trial availability and signup eligibility vary; check Microsoft's current account/tenant offerings. Do not connect an employer's tenant or buy a subscription merely to run an unreviewed exercise. You need permission to register the application and sign in a test user. This basic sign-in app does not require Conditional Access configuration. Device/risk policies, their licensing, and hybrid sync are separate extensions.

If no tenant is available, run npm test and review the app locally. Record status as Prepared, not Integrated. There is no mock-success button. Do not paste passwords, client secrets or tokens into this chat or source files.

## Checkpoint 2 - register an isolated SPA

1. In the Entra admin center, select your lab directory and open App registrations > New registration.
2. Name it IdentityForge SSO Lab. Select accounts in this organizational directory only.
3. Configure the **Single-page application** platform redirect URI as `http://localhost:5173/` exactly. Do not enable implicit grant or create a client secret.
4. Copy Application (client) ID and Directory (tenant) ID. These IDs are configuration identifiers, not passwords; still keep tenant details out of public screenshots unless intentionally disclosed.
5. Under API permissions, no business API is called by this app. Remove an automatically added Microsoft Graph User.Read permission if present and unused. The app requests only openid and profile for sign-in; do not grant directory-write permissions.
6. Check Enterprise applications and user assignment requirements. If assignment is required, assign only your lab test user through an authorized lab admin. Keep your tenant's existing safety controls enabled.

Gate: verify the intended tenant, single-tenant registration, SPA platform and exact redirect URI. Record the configuration privately without a client secret.

## Checkpoint 3 - run locally

Use Node.js 22.12 or later. In the sso folder:

```powershell
npm ci
Copy-Item .\public\config.example.json .\public\config.local.json
notepad .\public\config.local.json
# Replace tenantId and clientId; keep redirectUri unchanged.
npm test
npm run build
npm run dev
```

If the package lock is absent, use npm install once to generate it. Open **http://localhost:5173/**, not an IP address, another port or file://. The dev server binds only to localhost. config.local.json is ignored by Git but is served to the local browser; it must contain no secret. Do not publish the dev server. Stop with Ctrl+C.

Sign in using the explicit Sign in button. MSAL performs the authorization-code/PKCE browser flow; redirect handling runs once on page load. The app verifies its expected claim contract after MSAL returns. It does not implement a protected backend API and it does not independently verify JWT signatures. A production backend must validate its own access tokens and enforce authorization.

Gate: successful MSAL response, Healthy mapping passes, and a matching successful application sign-in exists in your Entra lab sign-in logs. Test a second sign-in with the existing lab IdP session and record the observed SSO experience; consent/MFA/session policies may still require interaction. Do not claim passwordless or MFA enforcement solely from this app's success.

## Checkpoint 4 - deliberate application mapping failure

1. With a verified Healthy session, download baseline event evidence.
2. Switch the application contract to Broken. It now incorrectly requires legacy_employee_number, a claim not configured in this lab.
3. Recheck. Expect MAPPING_CLAIM_MISSING. Authentication may have succeeded while application mapping fails: these are different layers.
4. Capture the rejection and compare the app contract with documented ID token claims. The example uses a fictional legacy field to reproduce a contract mismatch; it does not pretend Entra emits AD immutableID or UPN in every token.
5. Observe that the app **does not** automatically redirect into another login. Reauthentication cannot repair the missing mapping. In a poorly built app this unconditional retry behavior can cause a loop.
6. Restore Healthy and recheck the same session. Download the recovery evidence and write a root-cause note. Do not edit the real token, bypass tenant checks, change sourceAnchor/immutableID or disable MFA to fix the exercise.

Gate: observed baseline, rejection and recovery; no automatic retry loop; root cause names the application mapping contract. This is a fault deliberately introduced at the **application layer**, not a tenant claims-mapping deployment or a live AD-to-cloud synchronization test.

## Optional independent registration fault

Only on this disposable registration, remove its SPA redirect URI after exporting/saving the correct setting. Start a fresh sign-in; expect a redirect mismatch such as AADSTS50011. Record actual error code and matching sign-in logs, then restore the exact URI and retest. Do not make changes to another application, broad tenant settings or real users. This optional exercise is not complete until you observe and record both failure and recovery.

## Evidence and limitations

The event download contains timestamps and fixed event codes, not tokens, names or raw claims. Browser event history is editable and is not a security audit authority; corroborate it with tenant logs and your own screenshots. Never include HAR files without expert review: they can contain tokens. Identity uses tid + oid; preferred_username and email are mutable display information, not authorization keys. Domain-joined AD sign-in and this cloud sign-in remain separate unless you later configure and prove a supported hybrid integration.

References checked October 18, 2026:

- [MSAL initialization and redirect handling](https://learn.microsoft.com/entra/msal/javascript/browser/initialization)
- [MSAL user sign-in](https://learn.microsoft.com/entra/msal/javascript/browser/login-user)
- [Register an application](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app)
- [ID token claims](https://learn.microsoft.com/entra/identity-platform/id-token-claims-reference)

This implementation selects Entra ID. An Okta integration is not included or claimed.
