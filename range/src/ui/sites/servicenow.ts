/**
 * ServiceNow (simulated) for the MSP, at https://msp.service-now.range.
 *
 * Pick a customer company, Generate a lab, and work its tickets. Resolve goes
 * through the Range's gate (world/servicenow.ts): wrong work is refused with a
 * hint. Escalations get a verdict from the template. When every ticket in a lab
 * is done the report card shows, and the score is kept in career storage.
 * Ollama, when configured, only rewords tickets; the facts and checks are the
 * template's.
 */
import type { Ticket, World } from '../../core/types.ts';
import { RESOLUTION_CODES, type ResolutionCode } from '../../core/types.ts';
import type { MspLab } from '../../core/career.ts';
import { fmt, nowIso } from '../../core/time.ts';
import { randomSeed } from '../../core/rng.ts';
import { badge, h, table, toast } from '../dom.ts';
import { act, persist, store } from '../store.ts';
import { companyWorld, peekCompany } from '../companies.ts';
import { MSP_COMPANIES, profileById } from '../../world/profiles.ts';
import { addWorkNote, setTicketState } from '../../world/itsm.ts';
import { ESCALATION_TEAMS, escalateTicket, resolveGated } from '../../world/servicenow.ts';
import { generateLab, labReport, rewordFacts } from '../../scenarios/msp/lab.ts';
import { abandonScenario } from '../../scenarios/engine.ts';
import { rewordTicket } from '../../ai/ollama.ts';
import type { Site, SiteCtx } from './common.ts';

const MARKER = 'Meridian IAM Range training simulation — not a real ServiceNow instance.';
let genCompany = MSP_COMPANIES.find((p) => p.staff > 0)!.id;
let genCount = 5;
let genDifficulty: 1 | 2 | 3 = 2;
let lastGate: { ticket: string; text: string; ok: boolean } | null = null;

const labs = (): MspLab[] => (store.career.labs ??= []);
const worldOf = (company: string): World => companyWorld(company);
const companyName = (id: string): string => profileById(id)?.name ?? id;

function link(label: string, fn: () => void): HTMLAnchorElement {
  return h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); fn(); } }, label);
}

function ticketsOf(lab: MspLab): { t: Ticket; w: World; scenarioId: string }[] {
  const w = worldOf(lab.company);
  return lab.scenarioIds.flatMap((sid) => {
    const s = w.scenarios.find((x) => x.id === sid);
    return (s?.ticketIds ?? []).map((tid) => ({ t: w.tickets.find((x) => x.id === tid)!, w, scenarioId: sid })).filter((x) => x.t);
  });
}

/** A lab is done when none of its scenarios is still active; then it is scored once. */
function finishIfDone(lab: MspLab): void {
  if (lab.finished) return;
  const w = worldOf(lab.company);
  if (lab.scenarioIds.some((id) => w.scenarios.find((s) => s.id === id)?.status === 'active')) return;
  const r = labReport(w, lab.scenarioIds);
  lab.finished = { time: nowIso(), score: r.score, summary: r.summary };
  persist();
}

/** Reword a lab's tickets with Ollama; true if any wording changed. */
async function reword(lab: MspLab): Promise<boolean> {
  const model = store.settings.model;
  if (!model || !store.settings.rewordTickets) return false;
  let changed = false;
  const w = worldOf(lab.company);
  for (const { t, scenarioId } of ticketsOf(lab)) {
    const s = w.scenarios.find((x) => x.id === scenarioId);
    try {
      const text = await rewordTicket(model, t, undefined, rewordFacts(t, s));
      if (text) changed = act(() => { t.description = text; t.variables = { ...t.variables, Wording: `Reworded by ${model}; every fact checked against the original` }; }, undefined, w) || changed;
    } catch {
      // The template's own wording is complete.
    }
  }
  return changed;
}

function generate(ctx: SiteCtx): void {
  const w = worldOf(genCompany);
  let made: string[] = [];
  if (!act((x) => { made = generateLab(x, { count: genCount, difficulty: genDifficulty, seed: randomSeed() }).map((s) => s.id); }, undefined, w)) return;
  if (!made.length) { toast(`Nothing fits ${companyName(genCompany)} at this difficulty right now. Finish its open tickets or try another company.`, 'info'); return; }
  const lab: MspLab = { id: `LAB-${String(labs().length + 1).padStart(3, '0')}`, company: genCompany, scenarioIds: made, started: nowIso(), count: made.length, difficulty: genDifficulty };
  labs().push(lab);
  persist();
  toast(`${lab.id}: ${made.length} ticket${made.length > 1 ? 's' : ''} for ${companyName(genCompany)}`, 'ok');
  ctx.go(`/lab/${lab.id}`);
  // Redraw only if Ollama actually reworded something (the lab page shows the new text).
  void reword(lab).then((changed) => { if (changed) ctx.go(`/lab/${lab.id}`); });
}

function home(ctx: SiteCtx): HTMLElement {
  const company = h('select', { class: 'input', 'aria-label': 'Company', onChange: (e: Event) => { genCompany = (e.target as HTMLSelectElement).value; } },
    MSP_COMPANIES.map((p) => h('option', { value: p.id, selected: p.id === genCompany }, `${p.name} — ${p.industry}`)));
  const size = h('select', { class: 'input', 'aria-label': 'Tickets', onChange: (e: Event) => { genCount = Number((e.target as HTMLSelectElement).value); } },
    [3, 4, 5, 6, 7, 8].map((n) => h('option', { value: String(n), selected: n === genCount }, `${n} tickets`)));
  const diff = h('select', { class: 'input', 'aria-label': 'Difficulty', onChange: (e: Event) => { genDifficulty = Number((e.target as HTMLSelectElement).value) as 1; } },
    [[1, 'Foundation'], [2, 'Practitioner'], [3, 'Senior']].map(([v, l]) => h('option', { value: String(v), selected: v === genDifficulty }, String(l))));
  return h('div', null,
    h('section', { class: 'sn-card sn-generate' }, h('h2', null, 'Generate a lab'),
      h('p', { class: 'muted' }, 'A realistic queue for one customer: joiners, movers, leavers, MFA, licences, Azure access, guests, and requests you should not simply do. The Range checks your work before a ticket can close.'),
      h('div', { class: 'row wrap' }, company, size, diff, h('button', { class: 'btn primary', type: 'button', onClick: () => generate(ctx) }, 'Generate')),
      store.settings.model && store.settings.rewordTickets ? h('p', { class: 'muted' }, `Tickets are reworded by ${store.settings.model} so they read like real callers. Facts never change.`) : null),
    h('h2', null, 'Customers'),
    h('div', { class: 'sn-companies' }, MSP_COMPANIES.map((p) => {
      const w = peekCompany(p.id);
      const open = w.tickets.filter((t) => t.state !== 'Resolved' && t.state !== 'Cancelled').length;
      const last = [...labs()].reverse().find((l) => l.company === p.id && l.finished);
      return h('button', { class: `sn-company ${p.id === genCompany ? 'on' : ''}`, type: 'button', onClick: () => { genCompany = p.id; ctx.go('/'); } },
        h('strong', null, p.name), h('span', null, p.industry), h('span', null, `${w.ad.users.filter((u) => u.kind === 'user').length} staff · ${p.domain}`),
        h('span', null, `${open} open ticket${open === 1 ? '' : 's'}${last ? ` · last lab ${last.finished!.score}%` : ''}`));
    })));
}

function labList(ctx: SiteCtx): HTMLElement {
  const list = [...labs()].reverse();
  return h('div', null, h('h2', null, 'Labs'),
    list.length ? table(['Lab', 'Customer', 'Started', 'Tickets', 'Result'], list.map((l) => [link(l.id, () => ctx.go(`/lab/${l.id}`)), companyName(l.company), fmt(l.started), String(l.count), l.finished ? `${l.finished.score}%` : 'In progress']))
      : h('p', { class: 'empty' }, 'No labs yet. Generate one from Home.'));
}

function queue(ctx: SiteCtx): HTMLElement {
  const rows = labs().filter((l) => !l.finished).flatMap((l) => ticketsOf(l).map((x) => ({ ...x, lab: l }))).filter((x) => x.t.state !== 'Resolved');
  return h('div', null, h('h2', null, 'My queue'),
    rows.length ? table(['Number', 'Customer', 'Short description', 'Priority', 'State', 'Opened'], rows.map(({ t, lab }) => [link(t.id, () => ctx.go(`/ticket/${lab.company}/${t.id}`)), companyName(lab.company), t.short, `P${t.priority}`, t.state, fmt(t.opened)]))
      : h('p', { class: 'empty' }, 'Your queue is empty.'));
}

function labPage(ctx: SiteCtx, id: string): HTMLElement {
  const lab = labs().find((l) => l.id === id);
  if (!lab) return h('p', { class: 'empty' }, 'Lab not found.');
  finishIfDone(lab);
  const w = worldOf(lab.company);
  const rows = ticketsOf(lab);
  const head = h('div', { class: 'row-between' }, h('h2', null, `${lab.id} · ${companyName(lab.company)}`),
    lab.finished ? null : h('button', { class: 'btn ghost', type: 'button', onClick: () => {
      act((x) => { for (const sid of lab.scenarioIds) if (x.scenarios.find((s) => s.id === sid)?.status === 'active') abandonScenario(x, sid); }, 'Lab ended', w);
      finishIfDone(lab);
      ctx.go(ctx.path);
    } }, 'End lab now'));
  const list = table(['Number', 'Short description', 'Priority', 'State'], rows.map(({ t }) => [link(t.id, () => ctx.go(`/ticket/${lab.company}/${t.id}`)), t.short, `P${t.priority}`, t.state === 'Resolved' ? badge('Resolved', 'ok') : t.state]));
  if (!lab.finished) return h('div', null, head, h('p', { class: 'muted' }, `Work the tickets in ${companyName(lab.company)} (${w.ad.domain}): ADUC with Change Domain, PowerShell with -Server, the Azure portal, Remote Desktop. Resolve each here.`), list);
  const r = labReport(w, lab.scenarioIds);
  return h('div', null, head,
    h('section', { class: 'sn-card sn-report' }, h('h3', null, `Report card: ${r.score}%`), h('p', null, r.summary)),
    ...r.tickets.map((x) => h('section', { class: 'sn-card' },
      h('div', { class: 'row-between' }, h('strong', null, `${x.ticket} · ${x.title}`), badge(`${x.score}%`, x.passed ? 'ok' : 'bad')),
      h('p', { class: 'muted' }, `Resolve attempts refused: ${x.attempts} · Escalation: ${x.escalation}`),
      x.missed.length ? h('ul', null, x.missed.map((m) => h('li', null, m))) : h('p', null, 'Every check met.'),
      h('p', null, h('strong', null, 'What a senior engineer would do: '), x.senior))));
}

function ticketPage(ctx: SiteCtx, company: string, id: string): HTMLElement {
  const w = worldOf(company);
  const t = w.tickets.find((x) => x.id === id);
  if (!t) return h('p', { class: 'empty' }, 'Ticket not found.');
  const lab = labs().find((l) => l.company === company && l.scenarioIds.includes(t.scenarioId ?? ''));
  const done = t.state === 'Resolved';
  const note = h('textarea', { class: 'input', rows: 3, placeholder: 'Work notes (what you checked and did)', 'aria-label': 'Work note' });
  const code = h('select', { class: 'input', 'aria-label': 'Resolution code' }, RESOLUTION_CODES.map((c) => h('option', { value: c }, c)));
  const notes = h('textarea', { class: 'input', rows: 2, placeholder: 'Resolution notes: what was done and why', 'aria-label': 'Resolution notes' });
  const team = h('select', { class: 'input', 'aria-label': 'Escalate to' }, ESCALATION_TEAMS.map((x) => h('option', { value: x }, x)));
  const reason = h('input', { class: 'input', placeholder: 'Why are you escalating?', 'aria-label': 'Escalation reason' });
  const after = (): void => { if (lab) finishIfDone(lab); ctx.go(ctx.path); };
  const gate = lastGate && lastGate.ticket === t.id ? lastGate : null;
  return h('div', null,
    h('div', { class: 'row-between' }, h('h2', null, `${t.id}: ${t.short}`), lab ? link(`Back to ${lab.id}`, () => ctx.go(`/lab/${lab.id}`)) : null),
    h('div', { class: 'sn-form' }, ...[['Customer', companyName(company)], ['Caller', t.caller], ['Requested for', t.requestedFor], ['Category', t.category], ['Priority', `P${t.priority}`], ['State', t.state], ['Opened', fmt(t.opened)], ['SLA due', fmt(t.slaDue)]]
      .map(([k, v]) => h('label', { class: 'sn-field' }, h('span', null, k), h('output', null, v)))),
    h('section', { class: 'sn-card' }, h('h3', null, 'Description'), h('pre', { class: 'desc' }, t.description),
      Object.keys(t.variables).length ? table(['Variable', 'Value'], Object.entries(t.variables).map(([k, v]) => [k, v])) : null,
      t.approvals.length ? table(['Approver', 'Role', 'State'], t.approvals.map((a) => [a.approver, a.role, a.state])) : null),
    gate ? h('div', { class: `sn-gate ${gate.ok ? 'ok' : 'bad'}` }, gate.text) : null,
    done ? h('section', { class: 'sn-card' }, h('h3', null, 'Resolution'), h('p', null, `${t.resolution?.code}: ${t.resolution?.notes}`)) : h('div', null,
      h('section', { class: 'sn-card' }, h('h3', null, 'Work notes'), note, h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onClick: () => { if (act((x) => { addWorkNote(x, t.id, note.value); }, 'Work note added', w)) after(); } }, 'Post'),
        h('button', { class: 'btn ghost', type: 'button', onClick: () => { if (act((x) => { setTicketState(x, t.id, 'On Hold'); }, 'On hold', w)) after(); } }, 'Put on hold'))),
      h('section', { class: 'sn-card' }, h('h3', null, 'Resolve'), h('div', { class: 'row wrap' }, code, notes),
        h('button', { class: 'btn primary', type: 'button', onClick: () => {
          let res: ReturnType<typeof resolveGated> | null = null;
          act((x) => { res = resolveGated(x, t.id, code.value as ResolutionCode, notes.value); }, undefined, w);
          const r = res as ReturnType<typeof resolveGated> | null;
          if (r) lastGate = { ticket: t.id, ok: r.accepted, text: r.accepted ? r.message : `${r.message} ${r.hint ?? ''}` };
          after();
        } }, 'Resolve')),
      h('section', { class: 'sn-card' }, h('h3', null, 'Escalate'), h('div', { class: 'row wrap' }, team, reason,
        h('button', { class: 'btn', type: 'button', onClick: () => {
          let v: ReturnType<typeof escalateTicket> | null = null;
          act((x) => { v = escalateTicket(x, t.id, team.value as (typeof ESCALATION_TEAMS)[number], reason.value); }, undefined, w);
          const r = v as ReturnType<typeof escalateTicket> | null;
          if (r) lastGate = { ticket: t.id, ok: r.verdict === 'accepted', text: `${team.value} ${r.verdict === 'accepted' ? 'accepted' : r.verdict === 'declined' ? 'declined' : 'redirected'} the escalation: ${r.response}` };
          after();
        } }, 'Escalate')))),
    h('section', { class: 'sn-card' }, h('h3', null, 'Activity'),
      table(['Time', 'By', 'Note'], [...t.workNotes].reverse().map((n) => [fmt(n.time), n.author, n.text]))));
}

export const serviceNow: Site = {
  host: 'msp.service-now.range',
  name: 'ServiceNow',
  short: 'ServiceNow',
  color: '#1f3b3d',
  render(ctx) {
    const p = ctx.path;
    const lm = /^\/lab\/(.+)$/.exec(p);
    const tm = /^\/ticket\/([^/]+)\/(.+)$/.exec(p);
    const content = tm ? ticketPage(ctx, tm[1]!, tm[2]!) : lm ? labPage(ctx, lm[1]!) : p === '/queue' ? queue(ctx) : p === '/labs' ? labList(ctx) : home(ctx);
    const nav: [string, string][] = [['Home', '/'], ['My queue', '/queue'], ['Labs', '/labs']];
    return h('div', { class: 'sn' },
      h('header', { class: 'sn-top' }, h('strong', null, 'servicenow'), h('span', { class: 'sn-lab' }, 'MSP lab'), h('span', { class: 'sn-marker' }, MARKER)),
      h('div', { class: 'sn-body' },
        h('nav', { class: 'sn-nav', 'aria-label': 'ServiceNow navigation' }, nav.map(([label, path]) => h('a', { href: '#', class: p === path || (path !== '/' && p.startsWith(path)) ? 'on' : '', onClick: (e: Event) => { e.preventDefault(); ctx.go(path); } }, label))),
        h('main', { class: 'sn-main', 'data-keep-scroll': '' }, content)));
  },
};
