# Privileged account compromise - tabletop response

This is an operational judgment exercise. Do not execute attack commands or disable real business accounts. Evidence type: [tabletop / actual isolated lab event].

## Trigger

Synthetic Windows Security event 4728 (a member added to a security-enabled **global** group):

```text
TimeCreated: 2026-10-18T14:05:00Z
EventID: 4728
Computer: DC01.iamlab.test
SubjectUserName: lab-operator
SubjectDomainName: IAMLAB
SubjectLogonId: 0x7A12F
MemberName: CN=lab-alex,OU=Engineering,OU=IAM-Training,DC=iamlab,DC=test
MemberSid: S-1-5-21-111111111-222222222-333333333-1101
TargetUserName: LAB-Tier0-Simulation
TargetDomainName: IAMLAB
TargetSid: S-1-5-21-111111111-222222222-333333333-2201
```

This is a synthetic field rendering, not an exported Windows event. LAB-Tier0-Simulation has no real Tier 0 rights in this package. Compare the acting subject, member and target group with the approved ticket, event time and logon session. A single event proves neither compromise nor all subsequent activity. Event 4732 is for security-enabled local/domain-local groups; 4756 is for universal groups.

## Response worksheet

1. Validate severity and event origin; correlate with 4624 sign-in/session evidence, endpoint activity, membership changes and change approvals. Page incident response when compromise is credible.
2. Preserve raw event records and relevant session evidence with timestamps/access controls. Log your containment actions; do not erase evidence.
3. Through approved controls, revoke unauthorized grants, terminate applicable sessions and revoke tokens. Restrict/disable the compromised identity and isolate affected hosts as justified by impact. Account disabling alone does not invalidate every existing ticket or session.
4. Protect continuity and emergency access; coordinate with system owners before broad disruptive action. Rotate compromised credentials and identify dependent services.
5. Scope lateral movement and data exposure, recover from a trusted state, verify containment, monitor and document root cause.

Decision log: [time / observation / action / approver / result]. Assumptions: [known vs unverified]. Recovery criteria: [verifiable requirements]. Lessons: [specific control improvement].

Gate: a reasoned timeline distinguishes facts from hypotheses and explains targeted containment, evidence preservation, session/token handling and business continuity. No actual Domain Admin grant is required for this exercise.
