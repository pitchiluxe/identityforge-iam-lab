/**
 * world/servicenow.ts — the MSP's ServiceNow queue: a Resolve that refuses
 * wrong work, and escalations that get a verdict.
 *
 * Resolve applies the resolution, grades the lab, and if a critical check still
 * fails puts the ticket back as it was and answers with a hint that gets more
 * specific on each attempt. Escalation verdicts come from the template (never
 * from a model): the right team accepts, another team redirects, and a routine
 * ticket is declined back to the engineer.
 */
import type { EscalationTeam, ResolutionCode, Ticket, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { audit } from './audit.ts';
import { getTicket, resolveTicket } from './itsm.ts';
import { grade } from '../scenarios/grader.ts';

export const ESCALATION_TEAMS: readonly EscalationTeam[] = ['Security Operations', 'Customer approver', 'Change Advisory Board', 'Tier 3 Engineering'];

function scenarioOf(w: World, t: Ticket) {
  return t.scenarioId ? w.scenarios.find((s) => s.id === t.scenarioId && s.status === 'active') : undefined;
}

export function resolveGated(w: World, ticketId: string, code: ResolutionCode, notes: string): { accepted: boolean; message: string; hint?: string } {
  const t = getTicket(w, ticketId);
  if (t.state === 'Resolved') throw new Error(`${t.id} is already resolved.`);
  const s = scenarioOf(w, t);
  const before = { state: t.state, resolution: t.resolution };
  resolveTicket(w, ticketId, code, notes);
  if (!s) return { accepted: true, message: `${t.id} resolved.` };
  const result = grade(w, s);
  // The grader's own bar: every critical check and the overall score.
  const critical = result.results.filter((r) => r.critical && !r.pass);
  const failing = critical.length ? critical : result.passed ? [] : result.results.filter((r) => !r.pass);
  if (!result.passed) {
    t.state = before.state === 'New' ? 'In Progress' : before.state;
    t.resolution = before.resolution;
    s.attempts = (s.attempts ?? 0) + 1;
    const f = failing[0]!;
    const hint = s.attempts === 1 ? `Not done yet: ${f.label}.`
      : s.attempts === 2 ? `${f.label}: ${f.detail}`
      : `${f.label}: ${f.detail} ${s.hints[Math.min(s.attempts - 3, s.hints.length - 1)] ?? ''}`.trim();
    audit(w, { source: 'ServiceDesk', action: 'Resolution rejected', target: t.id, actor: w.player.sam, detail: `Attempt ${s.attempts}: ${f.label}` });
    return { accepted: false, message: `Resolution rejected: ${failing.length} outcome${failing.length > 1 ? 's are' : ' is'} not met yet.`, hint };
  }
  s.result = result;
  s.status = 'passed';
  return { accepted: true, message: `${t.id} resolved. All required outcomes met.` };
}

export function escalateTicket(w: World, ticketId: string, team: EscalationTeam, reason: string): { verdict: 'accepted' | 'declined' | 'redirected'; response: string } {
  const t = getTicket(w, ticketId);
  if (t.state === 'Resolved') throw new Error(`${t.id} is already resolved.`);
  if (!reason.trim()) throw new Error('Say why you are escalating: the receiving team reads it first.');
  const s = scenarioOf(w, t);
  const expected = s?.escalation;
  const verdict = expected && expected.team === team ? 'accepted' : expected ? 'redirected' : 'declined';
  const response = verdict === 'accepted' ? expected!.response
    : verdict === 'redirected' ? `${team} reviewed this and is not the right owner. Look again at what is being asked and who has authority to decide it.`
    : `${team}: this does not need ${team}. Decide it yourself under the customer's policies and your delegated rights: do it, decline it, or ask the requester for what is missing.`;
  (t.escalations ??= []).push({ team, reason: reason.trim(), time: nowIso(), verdict });
  t.workNotes.push({ time: nowIso(), author: team, text: response });
  audit(w, { source: 'ServiceDesk', action: `Escalated to ${team}`, target: t.id, actor: w.player.sam, detail: `${verdict}: ${reason.trim().slice(0, 100)}` });
  if (verdict === 'accepted' && expected!.outcome === 'closed') {
    t.state = 'Resolved';
    t.resolution = { code: expected!.code ?? 'Escalated to Security', notes: `Escalated to ${team}: ${reason.trim()}`, time: nowIso() };
    const result = grade(w, s!);
    s!.result = result;
    s!.status = result.passed ? 'passed' : 'failed';
  } else {
    t.state = 'In Progress';
  }
  return { verdict, response };
}
