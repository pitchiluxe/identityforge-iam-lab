# Provisioning failure investigation

Evidence type: [actual AD lab / offline injected failure]. Date: [UTC]. Investigator: [name]. Change ticket/run ID: [reference].

## Trigger and impact

- Expected HR change and immutable employee ID:
- Failed operation, target system and observed error:
- Last successful operation before failure:
- Current account enabled/disabled, OU and actual groups:
- Exposure or business impact while incomplete:

## Investigation and decision

1. Validate the authoritative HR record and correlate EmployeeID, account and ObjectGUID.
2. Check required OU/group existence, delegated permissions, selected DC, DNS/connectivity and replication. Distinguish invalid input from access denied or transient infrastructure failure.
3. Inspect the specific run's intent/result events and remaining-plan.csv. Do not infer rollback.
4. Identify temporary containment and the owner who approves it. Revocation failure may require urgent owner/incident escalation; never silently leave high-risk old access active.
5. Record the smallest approved correction; avoid granting Domain Admin just to make a connector work.

Root cause: [specific finding, not simply script failed]. Correction: [change/ticket]. Retry and reconciliation result: [observed]. Independent verification: [evidence]. Unresolved items/owner/due date: [details].

## Completion gate

The target directory confirms desired state, remaining operations are understood, partial changes are accounted for, and evidence supports the reported result. Offline tests are labeled offline. Report repeatability, not invented success percentages.
