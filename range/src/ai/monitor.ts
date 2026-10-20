/**
 * ai/monitor.ts — the lab monitor behind IAM Copilot.
 *
 * After every change to the world it re-grades each active scenario with the
 * same deterministic checks as "Check my work", without saving a result, and
 * reports what flipped. The model never decides whether a lab is passing; it
 * only gets to talk about what the grader found.
 */
import type { AuditEvent, CheckResult, ScenarioInstance, Ticket, World } from '../core/types.ts';
import { grade } from '../scenarios/grader.ts';

export type Snapshot = Map<string, Map<string, boolean>>;

export interface MonitorEvent {
  kind: 'regressed' | 'progress' | 'ready';
  scenarioId: string;
  scenarioTitle: string;
  check?: CheckResult;
}

export interface LiveStatus {
  scenario: ScenarioInstance;
  results: CheckResult[];
  passing: number;
  ready: boolean;
}

export function liveStatus(w: World): LiveStatus[] {
  return w.scenarios.filter((s) => s.status === 'active').map((s) => {
    const g = grade(w, s);
    return { scenario: s, results: g.results, passing: g.results.filter((r) => r.pass).length, ready: g.passed };
  });
}

export function snapshot(status: LiveStatus[]): Snapshot {
  return new Map(status.map((s) => [s.scenario.id, new Map(s.results.map((r) => [r.id, r.pass]))]));
}

/**
 * What changed since the last snapshot. A scenario that just started has no
 * previous entry and reports nothing: failing checks at the start are the task,
 * not a mistake.
 */
export function diff(prev: Snapshot, status: LiveStatus[]): MonitorEvent[] {
  const out: MonitorEvent[] = [];
  for (const s of status) {
    const before = prev.get(s.scenario.id);
    if (!before) continue;
    let gained = false;
    for (const r of s.results) {
      const was = before.get(r.id);
      if (was === undefined || was === r.pass) continue;
      if (was && !r.pass) out.push({ kind: 'regressed', scenarioId: s.scenario.id, scenarioTitle: s.scenario.title, check: r });
      else { gained = true; out.push({ kind: 'progress', scenarioId: s.scenario.id, scenarioTitle: s.scenario.title, check: r }); }
    }
    const wasReady = s.results.every((r) => before.get(r.id) || !r.critical) && [...before.values()].filter(Boolean).length / Math.max(1, before.size) >= 0.8;
    if (gained && s.ready && !wasReady) out.push({ kind: 'ready', scenarioId: s.scenario.id, scenarioTitle: s.scenario.title });
  }
  return out;
}

/**
 * Actions taken by the learner (their user or admin account), newest first.
 * Events a lab wrote while setting itself up carry the admin account too, but
 * they are backdrop, so they are left out.
 */
export function playerActions(w: World, limit = 15): AuditEvent[] {
  const me = new Set([w.player.adminSam, w.player.sam].map((x) => x.toLowerCase()));
  const setup = w.scenarios.map((s) => s.setupAudit).filter((r): r is [number, number] => !!r);
  const isSetup = (id: number): boolean => setup.some(([from, to]) => id > from && id <= to);
  return w.audit.filter((e) => me.has(e.actor.toLowerCase()) && !isSetup(e.id)).slice(-limit).reverse();
}

export function nudgeText(e: MonitorEvent): string {
  if (e.kind === 'ready') return `Every critical check in "${e.scenarioTitle}" passes now. Update the ticket with what you did and why, then run Check my work in IAM Coach.`;
  if (e.kind === 'progress') return `Good: "${e.check!.label}" now holds in "${e.scenarioTitle}".`;
  const c = e.check!;
  return c.critical
    ? `Stop for a second. Your last change broke a critical control in "${e.scenarioTitle}": ${c.label}. In a real environment this is the kind of change that ends up in an incident review. What did you just change, and can you put it back?`
    : `Heads up: "${c.label}" in "${e.scenarioTitle}" was holding and now is not. Was that intended?`;
}

/**
 * The Copilot persona: a senior IAM engineer who can see the live checks and
 * your recent actions, but not the answers unless you have earned them.
 */
export function copilotSystemPrompt(w: World, status: LiveStatus[], tickets: Ticket[]): string {
  const labs = status.map((s) => {
    const reveal = s.scenario.hintsUsed >= s.scenario.hints.length;
    return `Lab "${s.scenario.title}" (${s.scenario.category}, difficulty ${s.scenario.difficulty}), ${s.passing}/${s.results.length} checks holding${s.ready ? ', ready to submit' : ''}.
Already done (true right now):
${s.results.filter((r) => r.pass).map((r) => `- [x] ${r.label}`).join('\n') || '- nothing yet'}
Still to do (NOT true yet; the learner must make these happen):
${s.results.filter((r) => !r.pass).map((r) => `- [ ] ${r.label}${r.critical ? ' (critical)' : ''}`).join('\n') || '- nothing: the lab is ready to submit'}
Tickets: ${s.scenario.ticketIds.map((id) => { const t = tickets.find((x) => x.id === id); return t ? `${t.id} "${t.short}" (${t.state})` : id; }).join('; ') || 'started from an email'}
Hints seen: ${s.scenario.hints.slice(0, s.scenario.hintsUsed).join(' | ') || 'none'}
${reveal ? `The learner used every hint, so you may explain the full fix. Debrief: ${s.scenario.debrief}` : 'Do not hand over the full fix for this lab. Guide with a question, a log, a policy or the tool to open.'}`;
  }).join('\n\n');
  const actions = playerActions(w).map((e) => `- ${e.time.slice(11, 16)} ${e.source}: ${e.action} on ${e.target}${e.detail ? ` (${e.detail.slice(0, 80)})` : ''}`).join('\n');
  return `You are IAM Copilot, a senior IAM engineer pairing with a junior colleague (${w.player.displayName}) at ${w.company.name}, a fictional company in a training range. You have 12 years in Active Directory, Entra ID, Okta, PowerShell, SailPoint-style governance and incident response.

How you work:
- Be direct, warm and practical. Short paragraphs, under 170 words unless asked for more.
- Use real tool names: Active Directory Users and Computers, PowerShell (ActiveDirectory module), Entra admin center, Okta admin console, ServiceDesk, PeopleHub, Event Viewer.
- When you show PowerShell, use real cmdlets and parameters only.
- Tie advice to least privilege, separation of duties, change control, and the company policies in Documents\\Policies.
- When it helps, say how this comes up in IAM interviews.
- You cannot see or change systems yourself. The checklists below are the only truth about the lab and update after every action. Never describe an item under "Still to do" as done.
- Never invent times, event IDs, log entries, names or results. Cite only what is in this message; otherwise tell the learner where to look.
- If nothing is running, help with IAM concepts, career questions, or suggest starting a lab in IAM Coach.

Active labs:
${labs || '(none running)'}

The learner's recent actions, newest first:
${actions || '(none yet)'}`;
}
