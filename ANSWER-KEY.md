# Answer key — open after attempting exercises

## IGA

Baseline: LAB-002 Jordan has Payment-Creator and Payment-Approver, permitting creation and approval of the same payment. LAB-003 Taylor is terminated in HR but enabled in the directory. LAB-004 Casey is an active joiner absent from the directory. LAB-001 Alex must move from Support to Engineering.

Working rules:

```json
{
  "HR": ["AllEmployees", "HR-Portal"],
  "ENG": ["AllEmployees", "Engineering-Tools"],
  "FIN": ["AllEmployees", "Finance-Read"],
  "SUP": ["AllEmployees", "Support-Tickets"]
}
```

After reconciliation: four directory identities; Casey enabled with HR groups; Alex has Engineering-Tools and no Support-Tickets; Taylor disabled with no groups; Jordan only AllEmployees and Finance-Read. A second run changes no entitlement state. Expected review: two findings before, zero after. Business/data owners certify access; IAM implements approved changes; compliance validates evidence. Production leavers may also require session revocation, application deprovisioning, ownership transfer, and retention handling.

## AM

```json
{
  "HighRisk": "Block",
  "Unmanaged": "Block",
  "CorporateManaged": "Allow",
  "RemoteManaged": "RequirePhishingResistantMFA"
}
```

Fix Token.Email in workspace/state.json to alex.morgan@example.invalid. The missing claim is an application mapping problem in this fixture. In real federation, inspect sanitized IdP/application correlation logs, claim mapping and assignments; verify trusted issuer, audience, time, keys/signature and protocol protections. Never paste real tokens into public tools. An impossible-travel signal merits contextual investigation; this training policy intentionally blocks its high-risk fixture.

## PAM

Before grant: deny. Approved grant: allow. At StartUtc + 2h: deny, Status Expired. The simulated clock makes this repeatable and does not enforce real background expiry. Suspicious events at 14:05 and 14:06 include unapproved payroll export and disabling logging. Preserve logs, revoke the compromised identity's grants and sessions through approved controls, isolate affected systems as warranted, rotate exposed credentials, alert incident response and data owners, assess export destination and scope, then recover and monitor. Avoid deleting evidence or indiscriminate actions that break emergency access.

Break-glass accounts need a real secret store, restricted accountable retrieval, monitored usage, recovery testing, and post-use rotation. A JSON path is a reference, not secret protection.
