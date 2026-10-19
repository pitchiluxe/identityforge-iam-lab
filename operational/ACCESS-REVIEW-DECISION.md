# Access certification decision

Review ID: [reference]. Evidence source/run ID: [reference]. Scope: [actual AD snapshot / offline fixture].

Identity/employee ID: [synthetic identity]. Resource/group: [exact LAB group]. Business owner/reviewer: [name]. Review date and deadline: [UTC].

Finding: [e.g., LAB-Payment-Creator plus LAB-Payment-Approver]. Risk: the same identity can create and approve a payment in this policy model. These lab groups have no actual payment-system permissions unless you separately assign them.

Decision: [retain / revoke / time-bound exception]. Business justification: [specific task]. Approved change ticket: [reference]. Exception expiry, compensating controls and accountable owner: [required if retained by exception].

## Execute an approved revocation

Use a lab administrative account against the explicitly verified lab DC. Resolve the LAB group and user, confirm both are inside IAM-Training, record an approved decision **before** removal, then preview Remove-ADGroupMember with -WhatIf. Apply only the approved group removal; preserve unrelated valid access. Reread direct and relevant nested membership afterwards and save the evidence. Never substitute a production group.

Requested by: [name]. Approved by: [independent owner]. Executed by: [name]. Verified by: [name/evidence]. Actual removal time: [UTC]. Remaining risk: [details].

If the manager refuses: explain the concrete conflict, validate task need, propose narrower access or staged change, document the refusal, route any exception through risk approval with expiry, and escalate overdue high-risk exposure through the governance process. Do not invent approval or close an unresolved finding.
