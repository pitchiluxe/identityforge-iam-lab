/**
 * scenarios/msp/lab.ts — generate a ServiceNow lab for a company, and the
 * report card at the end of it.
 *
 * A lab is a batch of tickets that fit the company as it is now (no leaver
 * where nobody works, no OU build-out where the tree exists), about one in five
 * suspicious. The report comes from the grader, the Resolve attempts the gate
 * refused and the escalation verdicts: never from a model.
 */
import type { ScenarioInstance, World } from '../../core/types.ts';
import { createRng } from '../../core/rng.ts';
import { startScenario } from '../engine.ts';
import { grade } from '../grader.ts';
import { MSP_TEMPLATES, type MspTemplate } from './index.ts';

export function generateLab(w: World, opts: { count: number; difficulty: 1 | 2 | 3; seed: number }): ScenarioInstance[] {
  const rng = createRng(opts.seed);
  const count = Math.max(1, Math.min(8, opts.count));
  const active = new Set(w.scenarios.filter((s) => s.status === 'active').map((s) => s.templateId));
  const fitting = MSP_TEMPLATES.filter((t) => t.difficulty <= opts.difficulty && t.fits(w) && !active.has(t.id));
  const sus = rng.shuffle(fitting.filter((t) => t.suspicious));
  const normal = rng.shuffle(fitting.filter((t) => !t.suspicious));
  const wantSus = Math.min(sus.length, count >= 4 ? Math.max(1, Math.round(count / 5)) : rng.chance(0.2) ? 1 : 0);
  const plan: MspTemplate[] = [...sus.slice(0, wantSus), ...normal.slice(0, count - wantSus)];
  const out: ScenarioInstance[] = [];
  for (const t of rng.shuffle(plan)) {
    try {
      out.push(startScenario(w, { templateId: t.id, seed: rng.int(1, 2 ** 30) }));
    } catch {
      // Nobody suitable is free for this ticket right now: the lab is just shorter.
    }
  }
  return out;
}

/** Words a trap or a verification hinges on; rewording must keep them when the ticket uses them. */
const KEY_TERMS = ['Global Administrator', 'Contributor', 'Reader', 'Helpdesk Administrator', 'Microsoft Entra ID P2', 'personal email', 'guest'];

/**
 * Facts Ollama must keep when rewording a ticket: who is involved, everything
 * the template recorded (logon names, groups, addresses, phone digits), any
 * four-digit number, and the role names a trap depends on.
 */
export function rewordFacts(t: import('../../core/types.ts').Ticket, s: ScenarioInstance | undefined): string[] {
  const d = t.description;
  const values = [t.caller, t.requestedFor, ...Object.values(s?.params ?? {}).flatMap((v) => v.split('|')), ...(d.match(/\b\d{4}\b/g) ?? []), ...KEY_TERMS];
  return [...new Set(values.filter((v) => v && v.length >= 2 && d.includes(v)))];
}

export interface LabTicketReport {
  id: string;
  title: string;
  ticket: string;
  passed: boolean;
  score: number;
  attempts: number;
  wrongEscalations: number;
  escalation: string;
  missed: string[];
  senior: string;
}

export interface LabReport {
  tickets: LabTicketReport[];
  score: number;
  summary: string;
}

/** Points lost for each Resolve the gate refused, and for each declined or misdirected escalation. */
const ATTEMPT_PENALTY = 10;
const ESCALATION_PENALTY = 15;

export function labReport(w: World, scenarioIds: string[]): LabReport {
  const tickets = scenarioIds.map((id): LabTicketReport | null => {
    const s = w.scenarios.find((x) => x.id === id);
    if (!s) return null;
    const result = s.result ?? grade(w, s);
    const tk = w.tickets.find((x) => x.id === s.ticketIds[0]);
    const escalations = tk?.escalations ?? [];
    const wrong = escalations.filter((e) => e.verdict !== 'accepted').length;
    const attempts = s.attempts ?? 0;
    const passed = result.passed;
    const base = passed ? result.score : Math.min(result.score, 50);
    return {
      id: s.id, title: s.title, ticket: s.ticketIds[0] ?? '', passed,
      score: Math.max(0, base - ATTEMPT_PENALTY * attempts - ESCALATION_PENALTY * wrong),
      attempts, wrongEscalations: wrong,
      escalation: escalations.length ? escalations.map((e) => `${e.team}: ${e.verdict}`).join(', ') : s.escalation ? `Expected: ${s.escalation.team}` : 'Not needed',
      missed: result.results.filter((r) => !r.pass).map((r) => `${r.label} (${r.detail})`),
      senior: s.debrief,
    };
  }).filter((x): x is LabTicketReport => !!x);
  const score = tickets.length ? Math.round(tickets.reduce((n, t) => n + t.score, 0) / tickets.length) : 0;
  const done = tickets.filter((t) => t.passed).length;
  const summary = `${done} of ${tickets.length} tickets met every required outcome. ${tickets.reduce((n, t) => n + t.attempts, 0)} resolution(s) were refused and ${tickets.reduce((n, t) => n + t.wrongEscalations, 0)} escalation(s) went to the wrong place or were not needed.`;
  return { tickets, score, summary };
}
