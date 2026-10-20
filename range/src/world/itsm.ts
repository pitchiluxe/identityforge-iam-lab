/**
 * world/itsm.ts — ServiceDesk (ServiceNow-style) tickets, mail and HR lookups.
 */
import type { Approval, MailMessage, ResolutionCode, Ticket, TicketType, Worker, World } from '../core/types.ts';
import { nowIso, nowMs } from '../core/time.ts';
import { audit } from './audit.ts';

export class ItsmError extends Error {}

const PREFIX: Record<TicketType, string> = { Incident: 'INC', Request: 'RITM', 'Security Incident': 'SIR', Change: 'CHG' };
/** SLA per priority, in hours. */
const SLA_HOURS: Record<Ticket['priority'], number> = { 1: 1, 2: 4, 3: 24, 4: 72 };

export interface NewTicket {
  type: TicketType;
  short: string;
  description: string;
  caller: string;
  requestedFor?: string;
  category: string;
  priority: Ticket['priority'];
  approvals?: Approval[];
  variables?: Record<string, string>;
  scenarioId?: string | null;
  openedMinutesAgo?: number;
  state?: Ticket['state'];
}

export function openTicket(w: World, t: NewTicket): Ticket {
  const n = ++w.counters.ticket;
  const opened = new Date(nowMs() - (t.openedMinutesAgo ?? 0) * 60_000);
  const ticket: Ticket = {
    id: `${PREFIX[t.type]}00${String(10400 + n).padStart(5, '0')}`,
    type: t.type,
    short: t.short,
    description: t.description,
    caller: t.caller,
    requestedFor: t.requestedFor ?? t.caller,
    category: t.category,
    priority: t.priority,
    state: t.state ?? 'New',
    assignmentGroup: t.type === 'Security Incident' ? 'Security Operations' : 'IAM Operations',
    opened: opened.toISOString(),
    slaDue: new Date(opened.getTime() + SLA_HOURS[t.priority] * 3_600_000).toISOString(),
    approvals: t.approvals ?? [],
    variables: t.variables ?? {},
    workNotes: [],
    resolution: null,
    scenarioId: t.scenarioId ?? null,
  };
  w.tickets.push(ticket);
  audit(w, { source: 'ServiceDesk', action: `${t.type} opened`, target: ticket.id, actor: t.caller, detail: t.short });
  return ticket;
}

export function getTicket(w: World, id: string): Ticket {
  const t = w.tickets.find((x) => x.id.toLowerCase() === id.trim().toLowerCase());
  if (!t) throw new ItsmError(`Ticket ${id} not found.`);
  return t;
}

export function addWorkNote(w: World, id: string, text: string, author = w.player.displayName): Ticket {
  const t = getTicket(w, id);
  if (!text.trim()) throw new ItsmError('Work note is empty.');
  t.workNotes.push({ time: nowIso(), author, text: text.trim() });
  if (t.state === 'New') t.state = 'In Progress';
  audit(w, { source: 'ServiceDesk', action: 'Work note added', target: t.id, actor: w.player.sam, detail: text.trim().slice(0, 120) });
  return t;
}

export function setTicketState(w: World, id: string, state: Ticket['state']): Ticket {
  const t = getTicket(w, id);
  if (state === 'Resolved') throw new ItsmError('Use Resolve so a resolution code and notes are recorded.');
  if (t.state === 'Resolved' && state !== 'In Progress') throw new ItsmError('Reopen the ticket (In Progress) before changing its state.');
  t.state = state;
  if (state === 'In Progress' && t.resolution) t.resolution = null;
  audit(w, { source: 'ServiceDesk', action: `State changed to ${state}`, target: t.id, actor: w.player.sam });
  return t;
}

export function resolveTicket(w: World, id: string, code: ResolutionCode, notes: string): Ticket {
  const t = getTicket(w, id);
  if (notes.trim().length < 15) throw new ItsmError('Resolution notes must explain what was done and why (at least 15 characters). An auditor reads these.');
  t.state = 'Resolved';
  t.resolution = { code, notes: notes.trim(), time: nowIso() };
  audit(w, { source: 'ServiceDesk', action: 'Resolved', target: t.id, actor: w.player.sam, detail: `${code}: ${notes.trim().slice(0, 120)}` });
  return t;
}

export function slaState(t: Ticket): 'ok' | 'warning' | 'breached' | 'met' {
  if (t.state === 'Resolved' || t.state === 'Cancelled') {
    return t.resolution && Date.parse(t.resolution.time) > Date.parse(t.slaDue) ? 'breached' : 'met';
  }
  const left = Date.parse(t.slaDue) - nowMs();
  if (left < 0) return 'breached';
  const total = Date.parse(t.slaDue) - Date.parse(t.opened);
  return left < total * 0.25 ? 'warning' : 'ok';
}

// ------------------------------------------------------------------------- Mail

export interface NewMail {
  from: string;
  fromName: string;
  subject: string;
  body: string;
  minutesAgo?: number;
  external?: boolean;
  to?: string;
}

export function deliverMail(w: World, m: NewMail): MailMessage {
  const msg: MailMessage = {
    id: `msg-${++w.counters.mail}`,
    from: m.from,
    fromName: m.fromName,
    to: m.to ?? w.player.sam + '@meridianhealth.test',
    subject: m.subject,
    body: m.body,
    time: new Date(nowMs() - (m.minutesAgo ?? 0) * 60_000).toISOString(),
    read: false,
    folder: 'Inbox',
    external: !!m.external,
  };
  w.mail.push(msg);
  return msg;
}

export function reportPhishing(w: World, id: string): MailMessage {
  const m = w.mail.find((x) => x.id === id);
  if (!m) throw new ItsmError('Message not found.');
  m.folder = 'Reported';
  m.read = true;
  audit(w, { source: 'Mail', action: 'Message reported as phishing', target: m.from, actor: w.player.sam, detail: m.subject });
  return m;
}

export function sendMail(w: World, to: string, subject: string, body: string): MailMessage {
  if (!to.trim() || !subject.trim()) throw new ItsmError('To and Subject are required.');
  const msg: MailMessage = { id: `msg-${++w.counters.mail}`, from: w.player.sam + '@meridianhealth.test', fromName: w.player.displayName, to: to.trim(), subject: subject.trim(), body, time: nowIso(), read: true, folder: 'Sent', external: false };
  w.mail.push(msg);
  audit(w, { source: 'Mail', action: 'Message sent', target: to.trim(), actor: w.player.sam, detail: subject.trim() });
  return msg;
}

// ------------------------------------------------------------------------- HR

export function worker(w: World, employeeId: string): Worker | undefined {
  return w.hr.workers.find((x) => x.employeeId === employeeId);
}

export function workerName(w: World, employeeId: string | null): string {
  const x = employeeId ? worker(w, employeeId) : undefined;
  return x ? `${x.first} ${x.last}` : '—';
}

export function nextEmployeeId(w: World): string {
  const max = Math.max(...w.hr.workers.map((x) => Number(x.employeeId.replace(/\D/g, '')) || 0), 100400);
  return `E${max + 1}`;
}
