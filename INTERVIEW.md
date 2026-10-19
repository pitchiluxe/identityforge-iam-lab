# Independent interview practice

Use one question at a time. Record a two-minute answer before scrolling to its feedback. If working alone, cover the model responses until you finish. Save your answer and scored reflection in evidence. No automatic AI grading is built into this environment.

For each answer score technical correctness, operational sequence, stakeholder communication, and measurable result from 0–2 each. Strong Match = 7–8 with no critical safety gap; Needs Refinement = 4–6; Gap Identified = 0–3 or a critical gap such as leaving a known compromise active. The rubric guides practice and does not predict hiring outcomes. Adapt the hypothetical model answers to your actual experience; do not claim invented work history.

## Question 1

A manager refuses access-certification cleanup because it slows the team. What do you do?

Feedback focus: ownership, risk, evidence, least privilege, time-bound exceptions, escalation, business continuity.

Model STAR: Situation: A certification identifies unused sensitive access and the manager objects. Task: Reduce exposure without disrupting legitimate work. Action: Validate usage and role need with the owner, show the specific risk, propose staged removal or narrower access, and record the decision. Route any justified exception through risk approval with an owner, expiry and compensating controls. Escalate overdue high-risk items through governance. Result: Track closure, exception expiry and service impact; report actual outcomes rather than assumed savings.

## Question 2

A user is trapped in an SSO login loop. Walk through your investigation.

Feedback focus: scope, correlation IDs, redirect URI, cookies/session, claims, assignments, issuer/audience, expiry, signing keys, clock skew; avoid disabling protections.

Model STAR: Situation: An application repeatedly redirects a user to the IdP. Task: Restore access while retaining authentication controls. Action: Establish affected users, time and recent changes; correlate browser redirects with sanitized app and IdP logs. Check redirect configuration, session cookies, assignment, required claims, issuer/audience, token lifetime and trusted signing keys. Reproduce safely, correct the identified configuration and retest an affected and unaffected account. Result: Confirm session establishment and monitor recurrence, documenting root cause and rollback.

## Question 3

Explain AM versus IGA to a nontechnical executive.

Feedback focus: runtime sign-in decisions versus lifecycle/entitlement governance; complementary controls and clear business impact.

Model STAR: Situation: Leadership must prioritize identity investment. Task: Explain two complementary capabilities. Action: Describe AM as the front door that verifies identity and controls sign-in to applications, while IGA manages who should have which access, why, and for how long across employment changes. Use a transfer example: IGA removes the old department role; AM authenticates the employee and enforces sign-in policy. Result: Agree distinct success measures: secure successful sign-ins for AM and timely, approved, reviewable access for IGA.

## Question 4

A high-severity alert identifies an active compromised privileged account. What are your immediate actions?

Feedback focus: validate quickly, incident declaration, targeted containment, sessions/tokens, credentials, evidence, scope and continuity.

Model STAR: Situation: A privileged session shows likely compromise. Task: Stop misuse while preserving evidence and critical service. Action: Validate the alert and page incident response; preserve session and identity logs; revoke active grants, terminate relevant sessions and revoke tokens using supported controls. Restrict the identity and isolate affected hosts as justified, rotate exposed secrets and assess dependencies. Investigate lateral movement and data access with system owners. Result: Verify containment, recover through approved change controls, monitor recurrence and document a factual timeline and control improvements.

## Question 5

HR sends a department change at the same time an application connector fails. How do you prevent privilege creep and prove recovery?

Feedback focus: authoritative identity key, reconciliation, retry/idempotency, partial failure, removal priority, alerting and evidence.

Model STAR: Situation: A transfer partially provisions because a connector is unavailable. Task: Reach the approved target access without silently retaining old privileges. Action: Correlate by immutable employee ID, compute desired access and record per-system results. Prioritize removal of incompatible access, queue bounded idempotent retries, alert on failed revocation, and use an approved manual containment path for high-risk exposure. Reconcile actual versus desired state after recovery and capture owner review where needed. Result: Close only when target systems confirm removal and grant outcomes; report revocation delay and unresolved exceptions accurately.
