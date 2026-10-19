# Advanced milestone posts - use only after their gates pass

## A. Implementation milestone - suitable before live AD execution

I expanded IdentityForge from a JSON-based exercise into an AD automation codebase.

The PowerShell workflow validates HR CSV input, plans joiner/mover/leaver changes, reconciles managed birthright groups and records per-operation intent and outcomes. New accounts remain disabled until an explicitly reviewed activation step.

My local tests cover [insert checks you actually ran], including a failed operation that stops further changes for that identity and an audit-loss case that still attempts containment.

The important distinction: these are offline results. Live AD execution is my next verification gate, not an accomplishment I am claiming yet.

Image: a cropped passing-test result and a simple planner -> reviewed changes -> AD -> verification diagram. Label OFFLINE IMPLEMENTATION CHECKS.

#ActiveDirectory #PowerShell #IdentityGovernance #IAM

## B. Actual AD lifecycle - only after live verification

I completed the real AD lifecycle stage of my IdentityForge lab in an isolated Windows Server domain.

I used an HR CSV to provision disabled joiners, reviewed and activated the appropriate accounts, moved a synthetic employee from Support to Engineering, and processed a termination. The mover lost old managed access before the new role was granted; the leaver was disabled, expired and moved to the Terminated OU.

I verified [insert observed groups/OU/status results] and preserved a reviewed change plan, audit trail and remaining-state check. My failure/recovery lesson was [actual observation].

This is lab experience, not a production deployment. Session termination, application deprovisioning and cloud token revocation remain separate controls.

Images: actual AD before/after membership and OU view; redacted run summary. Do not publish raw snapshots.

#ActiveDirectory #PowerShell #IdentityLifecycle #LeastPrivilege

## C. Real Entra SSO break/fix - only after a live tenant run

I connected the IdentityForge browser application to my isolated Entra lab tenant using MSAL.

After verifying a successful sign-in against the tenant logs, I deliberately introduced a bad application claim requirement. Authentication still succeeded, but the application rejected the missing mapping. Reauthenticating would not fix the contract, so I corrected the application requirement and verified recovery without a redirect loop.

Observed evidence: [baseline / rejection / recovery and tenant-log correlation]. My key lesson: authentication success and application acceptance are different layers.

This demonstrates browser SSO and mapping troubleshooting. It does not claim a protected backend API, hybrid synchronization or Conditional Access enforcement.

Images: sanitized app baseline/rejection/recovery sequence plus a redacted tenant sign-in result. Never publish a token or unreviewed HAR.

#MicrosoftEntra #SSO #IAM #Troubleshooting

## D. Operational judgment - name the evidence type

I added an operational decision layer to my IdentityForge portfolio.

In a [tabletop / offline / actual isolated lab] exercise, I investigated [specific provisioning or privileged-access finding], distinguished confirmed facts from assumptions, and documented containment and owner decisions before reporting closure.

My certification decision was [actual decision and rationale]. My recovery check was [observed verification]. The main lesson was [what changed in your approach].

This post describes training evidence at the scope stated above; it is not an account of a production incident.

Image: sanitized timeline and decision record. Label the source type prominently.

#IdentityGovernance #IncidentResponse #IAM #CybersecurityPortfolio
