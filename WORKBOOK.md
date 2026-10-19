# IAM lab workbook

Work at your own pace. Finish the evidence and explanation at each gate before moving on. Read ANSWER-KEY.md only after attempting a checkpoint. Each attempt can be reset from the menu.

## 0. Environment

Launch Start-Lab.cmd and choose 3 to open the practice console. Inside that console, select 1. Confirm three directory identities and four HR records. Verify `workspace/state.json` and `evidence/audit.jsonl` exist. The working directory is your mock directory; department codes represent OUs: HR = HR, ENG = Engineering, FIN = Finance, SUP = Support. OUs organize identities; group membership represents authorization.

Gate: screenshot the baseline and record the difference between HR truth and directory state. All screenshots should show synthetic data only; crop personal paths.

## 1. IGA: lifecycle and compliance

Business context: terminations remain active, department transfers accumulate access, and Finance has conflicting payment privileges. You own provisioning and certification evidence.

1. Select 2 **before applying any rules**. Preserve `evidence/access-review.csv` as `access-review-before.csv`. Identify the two high-risk findings. Write who should approve remediation and what evidence closes each finding.
2. Open `workspace/rules.json`. Fill the department arrays using this mapping:

| Code | Birthright groups |
|---|---|
| HR | AllEmployees, HR-Portal |
| ENG | AllEmployees, Engineering-Tools |
| FIN | AllEmployees, Finance-Read |
| SUP | AllEmployees, Support-Tickets |

3. Explain your rule in plain language: an active employee receives exactly their department's managed birthright groups; terminated employees are disabled and lose all simulated access. Unknown department mappings must fail for review.
4. Select 3. Inspect Casey's new account, Alex's Support-to-Engineering move, and Taylor's disabled account. Note that this lab treats every group as managed by the reconciliation engine. Production systems must distinguish birthright groups from approved exceptional access rather than erase all grants indiscriminately.
5. Select 2 again. Save the clean report as `access-review-after.csv`. Explain why automated remediation does not replace owner certification. In this exercise Jordan's conflicting grants are removed by full birthright reconciliation; a real certification workflow would record an owner decision before revoking exceptional grants.
6. Select 3 a second time. Confirm no duplicate identities or groups. Reconciliation should converge on the same state, although audit events are still appended.
7. Select 9. IGA should be True.

Gate: retain before/after CSVs, directory screenshot, rule screenshot, and a short explanation of mover removal, leaver revocation, idempotency, and separation of duties.

LinkedIn draft prompt: "Write 120 words about my simulated IGA lab. Explain the stale-account and privilege-creep problems, HR-driven birthright mapping, removal of old mover access, and a payment creator/approver conflict. Use only results I observed. Clearly call it a local simulation. Include one lesson about audit evidence."

## 2. AM: federation reasoning and adaptive access

Business context: many separate logins and reused passwords cause account takeover risk. Your job is to understand federation boundaries, implement risk decisions, and isolate a claim failure.

1. Sketch this simulated flow: user -> application -> IdP -> returned token -> application validation -> session. Label issuer, audience, subject, expiry, signing verification, and mandatory application claims. Real OIDC uses authorization code flow with PKCE where applicable, plus state/nonce checks; this fixture only exercises claim reasoning.
2. Select 4. Record the intentionally unsafe policy results and missing-email error.
3. Edit `workspace/access-policy.json`. Use these decisions: HighRisk = Block; Unmanaged = Block; CorporateManaged = Allow; RemoteManaged = RequirePhishingResistantMFA. High risk must override corporate location. Corporate IP alone is not proof of trust: the seamless case also assumes an already authenticated session on a managed device satisfying baseline controls.
4. Select 4. Confirm all four policy cases show Pass = True. The MFA result is a policy decision, not an actual MFA challenge.
5. Open `workspace/state.json`. Find Token and set Email to `alex.morgan@example.invalid`. Preserve valid JSON. Select 4 again. If the lab has been idle more than 24 hours, the token can also be expired: set ExpiresUtc to a future UTC timestamp and document that this represents issuing a new fixture, not bypassing expiry on a real token.
6. Write a troubleshooting record: symptom, issuer/audience checks, expiry, mandatory claim, mapping correction, and retest. Explain why a valid signature alone would not fix a missing claim. Real tokens require cryptographic verification against trusted keys; never trust an edited token.
7. Select 9. AM should be True. Also retain the token-check screenshot; the progress check alone does not verify every token property.

Gate: policy results CSV, claim-error screenshot, corrected-check screenshot, flow sketch, and troubleshooting record.

LinkedIn draft prompt: "Describe a day in my simulated IAM analyst lab: integrate an application conceptually with an IdP, prioritize device/risk signals over IP location, require phishing-resistant MFA for a remote managed device, and troubleshoot a missing claim. Explicitly distinguish simulated checks from a deployed IdP or real MFA."

## 3. PAM: JIT and privileged-session investigation

Business context: scripts contain standing admin passwords and vendors have unsupervised sessions. You must reduce standing privilege, document approval, and detect misuse.

1. Write a vault design with secret reference `vault://lab/break-glass`, named owner, emergency approval path, limited retrieval rights, access logging, rotation after use, and periodic recovery testing. Do not put a password in JSON. This is a vault-design exercise; no secure vault is installed by this environment.
2. Select 6: access should be denied before a grant.
3. Select 5. Enter a fictional change ticket and reason. Type APPROVE to simulate a second person's decision. Explain why typing both roles yourself is not real separation of duties.
4. Save the grant details. Verify ExpiresUtc minus StartUtc is exactly two hours. Select 6: access is allowed by the simulated grant.
5. Select 7 to advance the clock exactly two hours. Access should be denied at the expiry boundary. Select 6 again to confirm denial. Explain the difference between removing a role assignment, expiring a token, and terminating an existing admin session.
6. Select 8. Identify the unauthorized payroll export and audit-logging disable command. Create `evidence/incident-notes.txt`: timeline, affected identity/session, immediate containment, evidence preservation, secret/session revocation, escalation, scope investigation, and recovery criteria. Do not execute any command from the log.
7. Select 9. PAM should be True. This checks grant duration and expired status; review your incident notes and vault design separately.

Gate: deny/allow/expired screenshots, grant duration, vault design, and incident notes. Production JIT should grant the smallest task-specific role rather than default Domain Admin; the role name here is deliberately a high-risk simulation.

LinkedIn draft prompt: "Explain standing privileges versus my simulated two-hour JIT grant. Mention ticket justification, independent approval in a real implementation, authorization at expiry, session controls, and two suspicious audit events. Clearly state no real domain privileges or secure vault were deployed."

## 4. Portfolio and interview

When all three checks pass and all written evidence is complete, use INTERVIEW.md. Create a portfolio summary with problem, design, screenshots, observed outcomes, limitations, and what would change in production. Never claim real vendor-product deployment based on these simulations.
