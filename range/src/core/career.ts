/**
 * core/career.ts — progress that survives a world reset.
 *
 * Kept apart from the World on purpose: resetting the company to practise
 * again should not erase what you have already demonstrated.
 */
import type { AuditEvent, ScenarioInstance, Ticket, World } from './types.ts';
import { fmt } from './time.ts';

export interface Attempt {
  scenarioId: string;
  templateId: string;
  twist: string;
  title: string;
  category: string;
  skills: string[];
  difficulty: number;
  score: number;
  passed: boolean;
  hintsUsed: number;
  time: string;
  designedBy: string | null;
  interviewScore: number | null;
}

export interface Career {
  attempts: Attempt[];
}

/** What job descriptions for IAM Analyst / Engineer roles ask for, mapped to range skills. */
export const JOB_COMPETENCIES: { area: string; ask: string; skills: string[] }[] = [
  { area: 'Identity lifecycle (JML)', ask: 'Provision, modify and deprovision accounts from HR events', skills: ['Joiner provisioning', 'Mover processing', 'Leaver deprovisioning'] },
  { area: 'Access governance', ask: 'Run access reviews and certifications, remove inappropriate access', skills: ['Access certification', 'Privilege creep detection', 'Dormant account management', 'AD to HR reconciliation'] },
  { area: 'Access requests and RBAC', ask: 'Fulfil access requests with approvals, enforce RBAC and SoD', skills: ['Access request fulfilment', 'Approval workflow', 'Segregation of duties', 'RBAC / birthright access'] },
  { area: 'Authentication and MFA', ask: 'Support MFA, password resets and identity verification', skills: ['Identity verification', 'Entra ID authentication methods', 'Social engineering defence'] },
  { area: 'Privileged access', ask: 'Manage PIM/PAM, remove standing privilege, secure service accounts', skills: ['Privileged Identity Management', 'Least privilege', 'Service account governance', 'Tier 0 protection'] },
  { area: 'SSO and federation', ask: 'Onboard and troubleshoot SSO apps, SCIM and Conditional Access', skills: ['Okta application assignment', 'SCIM provisioning', 'Group-based access', 'Conditional Access', 'Break-glass design'] },
  { area: 'Hybrid identity', ask: 'Troubleshoot AD to Entra ID synchronization', skills: ['Entra Connect', 'Sync scope', 'Soft match', 'Hybrid sync'] },
  { area: 'Security operations', ask: 'Investigate sign-in logs, respond to compromised accounts', skills: ['Incident response', 'Session revocation', 'Entra ID sign-in logs', 'Event log investigation', 'Threat recognition', 'Phishing recognition'] },
  { area: 'Automation', ask: 'Automate identity tasks with PowerShell', skills: ['PowerShell reporting', 'Active Directory'] },
];

export function record(c: Career, s: ScenarioInstance): Attempt | null {
  if (!s.result) return null;
  const existing = c.attempts.find((a) => a.scenarioId === s.id && a.time.slice(0, 10) === s.result!.time.slice(0, 10) && a.templateId === s.templateId);
  const attempt: Attempt = {
    scenarioId: s.id, templateId: s.templateId, twist: s.twist, title: s.title, category: s.category, skills: s.skills,
    difficulty: s.difficulty, score: s.result.score, passed: s.result.passed, hintsUsed: s.hintsUsed, time: s.result.time,
    designedBy: s.designedBy, interviewScore: existing?.interviewScore ?? null,
  };
  if (existing) Object.assign(existing, attempt);
  else c.attempts.push(attempt);
  return attempt;
}

export interface Readiness {
  area: string;
  ask: string;
  passedSkills: number;
  totalSkills: number;
  passes: number;
  level: 'Not started' | 'Practising' | 'Demonstrated' | 'Strong';
}

export function readiness(c: Career): Readiness[] {
  return JOB_COMPETENCIES.map((jc) => {
    const passes = c.attempts.filter((a) => a.passed && a.skills.some((s) => jc.skills.includes(s)));
    const tried = c.attempts.some((a) => a.skills.some((s) => jc.skills.includes(s)));
    const covered = jc.skills.filter((s) => passes.some((a) => a.skills.includes(s))).length;
    const level = passes.length >= 3 && covered >= Math.ceil(jc.skills.length / 2) ? 'Strong' : passes.length ? 'Demonstrated' : tried ? 'Practising' : 'Not started';
    return { area: jc.area, ask: jc.ask, passedSkills: covered, totalSkills: jc.skills.length, passes: passes.length, level };
  });
}

function actionsFor(w: World, s: ScenarioInstance): AuditEvent[] {
  const end = s.result?.time ?? new Date().toISOString();
  return w.audit.filter((e) => (e.actor === w.player.adminSam || e.actor === w.player.sam) && e.time >= s.started && e.time <= end);
}

/** A Markdown evidence pack for one scenario, honest about being simulated. */
export function evidenceMarkdown(w: World, s: ScenarioInstance, interviewAnswer = ''): string {
  const tickets = s.ticketIds.map((id) => w.tickets.find((t) => t.id === id)).filter(Boolean) as Ticket[];
  const r = s.result;
  const lines = [
    `# ${s.title}`,
    '',
    `> Simulated environment: IdentityForge Range (fictional company ${w.company.name}). Not a production system or a live tenant.`,
    '',
    `- Scenario: ${s.id} (${s.templateId} / ${s.twist})${s.designedBy ? `, designed with ${s.designedBy}` : ''}`,
    `- Category: ${s.category}; difficulty ${s.difficulty}/3`,
    `- Started: ${fmt(s.started)}; checked: ${fmt(r?.time)}`,
    `- Result: ${r ? `${r.passed ? 'PASSED' : 'NOT PASSED'}, ${r.score}%` : 'not graded'}; hints used: ${s.hintsUsed}`,
    '',
    '## The request',
    ...tickets.flatMap((t) => [`**${t.id}: ${t.short}** (${t.type}, P${t.priority})`, '', t.description.split('\n').map((l) => `> ${l}`).join('\n'), '']),
    '## What I did (audit log)',
    ...(actionsFor(w, s).map((e) => `- ${fmt(e.time)} [${e.source}${e.eventId ? ` ${e.eventId}` : ''}] ${e.action}: ${e.target}${e.detail ? ` (${e.detail})` : ''}`)),
    '',
    '## Verification',
    ...(r ? r.results.map((x) => `- [${x.pass ? 'x' : ' '}] ${x.label}${x.critical ? ' (critical)' : ''}: ${x.detail}`) : ['- Not graded yet.']),
    '',
    '## Resolution notes',
    ...tickets.map((t) => (t.resolution ? `- ${t.id}: ${t.resolution.code}. ${t.resolution.notes}` : `- ${t.id}: not resolved`)),
    '',
    '## Why it matters',
    s.debrief,
    '',
    '## Interview drill',
    `**Q:** ${s.interview.question}`,
    '',
    interviewAnswer ? `**My answer:** ${interviewAnswer}` : '_Answer not recorded._',
    '',
  ];
  return lines.join('\n');
}
