/**
 * IAM Coach: start labs and shifts, check your work, hints, debrief,
 * interview drill, evidence export, and the AI mentor.
 */
import type { Department, ScenarioInstance } from '../../core/types.ts';
import { fmt } from '../../core/time.ts';
import { evidenceMarkdown } from '../../core/career.ts';
import { DEPARTMENTS } from '../../world/company.ts';
import { deliverMail } from '../../world/itsm.ts';
import { labAccounts } from '../../world/labaccounts.ts';
import { TEMPLATES, abandonScenario, checkScenario, startScenario, startShift, takeHint, templateById } from '../../scenarios/engine.ts';
import { type ChatMessage, backdropProblems, chat, coachSystemPrompt, designScenario, gradeInterview, rewordTicket } from '../../ai/ollama.ts';
import { badge, button, clear, h, markdown, toast } from '../dom.ts';
import { appIcon } from '../icons.ts';
import { act, persist, store } from '../store.ts';
import { allDomains, worldByDomain } from '../companies.ts';
import { ai } from '../aiState.ts';
import type { AppDef } from '../wm.ts';

let openUrl: (url: string) => void = () => {};
export function setUrlOpener(fn: (url: string) => void): void {
  openUrl = fn;
}

const chats = new Map<string, ChatMessage[]>();
const feedback = new Map<string, string>();

export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function reword(s: ScenarioInstance): Promise<void> {
  const model = ai.model;
  if (!store.settings.rewordTickets || ai.status !== 'online' || !model) return;
  for (const id of s.ticketIds) {
    const t = store.world.tickets.find((x) => x.id === id);
    if (!t) continue;
    try {
      const text = await rewordTicket(model, t);
      if (text) act(() => { t.description = text; t.variables = { ...t.variables, Wording: `Reworded by ${model}; every fact checked against the original` }; });
    } catch {
      // Keep the built-in wording; it is complete on its own.
    }
  }
}

export const coachApp: AppDef = {
  id: 'coach',
  title: 'IAM Coach',
  icon: 'coach',
  width: 1260,
  height: 760,
  mount(host) {
    let selected: string | null = store.world.scenarios.filter((s) => s.status === 'active').at(-1)?.id ?? null;
    let busy = '';
    let tpl = '';
    let twist = '';
    let dept = '';
    let difficulty: 1 | 2 | 3 = 3;
    let focus = '';
    let accounts = false;
    let reveal = false;

    const start = (fn: () => ScenarioInstance | ScenarioInstance[], label: string): void => {
      let made: ScenarioInstance[] = [];
      if (act(() => { const r = fn(); made = Array.isArray(r) ? r : [r]; }, label)) {
        selected = made.at(-1)?.id ?? selected;
        for (const s of made) void reword(s);
        const first = made[0];
        if (first?.ticketIds[0]) openUrl(`https://servicedesk.meridianhealth.test/ticket/${first.ticketIds[0]}`);
        else if (first?.mailIds[0]) openUrl(`https://mail.meridianhealth.test/msg/${first.mailIds[0]}`);
        draw();
      }
    };

    async function aiDesign(): Promise<void> {
      const model = ai.model;
      if (!model) return void toast('Ollama is not answering. Start Ollama, then check Settings.', 'err');
      busy = `Designing a scenario with ${model}…`;
      draw();
      try {
        const d = await designScenario(model, store.world, TEMPLATES, focus);
        start(() => {
          const s = startScenario(store.world, { templateId: d.templateId, twist: d.twist, department: d.department, designedBy: model });
          const truth = [...s.ticketIds.map((id) => store.world.tickets.find((t) => t.id === id)), ...s.mailIds.map((id) => store.world.mail.find((m) => m.id === id))].map((x) => (x ? `${'short' in x ? x.short : x.subject} ${'description' in x ? x.description : x.body}` : '')).join(' ');
          const invented = d.context ? backdropProblems(d.context, truth) : [];
          if (invented.length) toast(`The model's background note was discarded because it added details the systems do not support (${invented.slice(0, 3).join(', ')}).`, 'info');
          if (d.context && !invented.length) {
            const lead = store.world.ad.users.find((u) => u.title === 'Security Manager');
            const m = deliverMail(store.world, { from: `${lead?.sam ?? 'hkovacs'}@meridianhealth.test`, fromName: lead?.displayName ?? 'Shift lead', subject: `Heads up: ${d.title || s.title}`, body: `${d.context}\n\nThe ticket in ServiceDesk and our systems are the source of truth; this note is background only.\n\n(Background written by the local model ${model}.)` });
            s.mailIds.push(m.id);
          }
          return s;
        }, `New AI-designed lab: ${d.title || d.templateId}`);
      } catch (e) {
        toast(`The model's design was rejected (${e instanceof Error ? e.message : e}). Starting a random lab instead.`, 'err');
        start(() => startScenario(store.world, { maxDifficulty: difficulty }), 'Random lab started');
      } finally {
        busy = '';
        draw();
      }
    }

    function launcher(): HTMLElement {
      const t = templateById(tpl);
      const tplSel = h('select', { class: 'input', 'aria-label': 'Scenario', onChange: (e: Event) => { tpl = (e.target as HTMLSelectElement).value; twist = ''; draw(); } },
        h('option', { value: '' }, 'Any scenario'), TEMPLATES.map((x) => h('option', { value: x.id, selected: x.id === tpl }, `${x.category}: ${x.title}`)));
      const twistSel = h('select', { class: 'input', 'aria-label': 'Variation', disabled: !t, onChange: (e: Event) => { twist = (e.target as HTMLSelectElement).value; } },
        h('option', { value: '' }, 'Random variation'), (t?.twists ?? []).map((x) => h('option', { value: x.id, selected: x.id === twist }, x.label)));
      const deptSel = h('select', { class: 'input', 'aria-label': 'Department', onChange: (e: Event) => { dept = (e.target as HTMLSelectElement).value; } },
        h('option', { value: '' }, 'Any department'), DEPARTMENTS.map((d) => h('option', { value: d, selected: d === dept }, d)));
      const diffSel = h('select', { class: 'input', 'aria-label': 'Maximum difficulty', onChange: (e: Event) => { difficulty = Number((e.target as HTMLSelectElement).value) as 1; } },
        [[1, 'Foundation'], [2, 'Working level'], [3, 'Senior']].map(([v, l]) => h('option', { value: String(v), selected: v === difficulty }, `Up to ${l}`)));
      const focusIn = h('input', { class: 'input', value: focus, placeholder: 'Optional focus, e.g. "insider threat", "audit season", "M&A integration"', 'aria-label': 'AI focus', onInput: (e: Event) => { focus = (e.target as HTMLInputElement).value; } });
      return h('section', { class: 'launch' },
        h('div', { class: 'launch-col' },
          h('h3', null, 'One ticket'),
          tplSel, h('div', { class: 'launch-pair' }, twistSel, deptSel),
          h('div', { class: 'row' },
            button('Start this lab', () => start(() => startScenario(store.world, { templateId: tpl || undefined, twist: twist || undefined, department: (dept || undefined) as Department | undefined, maxDifficulty: difficulty }), 'Lab started. The ticket is in ServiceDesk.'), 'btn primary'),
            diffSel)),
        h('div', { class: 'launch-col' },
          h('h3', null, 'A shift'),
          h('p', { class: 'muted' }, 'Several unrelated tickets at once, with SLAs, like a real Monday.'),
          h('div', { class: 'row' },
            button('Start a 3-ticket shift', () => start(() => startShift(store.world, 3, difficulty), 'Shift started: 3 tickets in your queue')),
            button('Start a 5-ticket shift', () => start(() => startShift(store.world, 5, difficulty), 'Shift started: 5 tickets in your queue')))),
        h('div', { class: 'launch-col' },
          h('h3', null, 'Designed by your local model'),
          h('p', { class: 'muted' }, ai.status === 'online' ? `Using ${ai.model}. The model picks the situation and writes the backdrop; the range builds the evidence and grades it.` : ai.status === 'checking' ? 'Checking for Ollama…' : 'Ollama is not answering. Random and chosen labs still work.'),
          h('div', { class: 'row' }, focusIn, button(busy ? 'Designing…' : 'Design a new lab', () => void aiDesign(), 'btn', ai.status !== 'online' ? 'Start Ollama to use this' : undefined)),
          busy ? h('p', { class: 'muted' }, busy) : null));
    }

    function stamp(s: ScenarioInstance): HTMLElement | null {
      if (!s.result) return null;
      const r = s.result;
      return h('div', { class: `stamp ${r.passed ? 'pass' : 'fail'}` },
        h('div', { class: 'stamp-mark' }, r.passed ? 'Passed' : 'Not yet'),
        h('div', { class: 'stamp-meta' }, `${r.score}% of checks, ${fmt(r.time)}`, r.results.some((x) => x.critical && !x.pass) ? h('span', null, ' A critical control failed.') : null));
    }

    function detail(s: ScenarioInstance): HTMLElement {
      const done = s.status !== 'active';
      const answer = h('textarea', { class: 'input', rows: '4', placeholder: 'Answer as you would in an interview: what, in what order, and why.', 'aria-label': 'Interview answer' }, store.interviewAnswers[s.id] ?? '');
      const msgs = chats.get(s.id) ?? [];
      const online = ai.status === 'online' && !!ai.model;
      const ask = h('textarea', { class: 'co-input', rows: 1, placeholder: 'Ask your mentor about this lab...', 'aria-label': 'Ask the mentor' });
      const bubble = (m: ChatMessage): HTMLElement => m.role === 'user'
        ? h('div', { class: 'co-msg me' }, h('div', { class: 'co-bubble' }, m.content))
        : h('div', { class: 'co-msg ai' }, h('div', { class: 'co-bubble' }, m.content ? markdown(m.content) : h('span', { class: 'co-typing' }, h('i'), h('i'), h('i'))));
      const log = h('div', { class: 'mentor-log', 'data-keep-scroll': '' },
        msgs.length ? msgs.filter((m) => m.role !== 'system').map(bubble)
          : h('div', { class: 'mentor-hello' }, h('strong', null, 'Your mentor for this lab'), h('p', null, online ? `Answering with ${ai.model} on your computer. Ask what to check first, which policy applies, or how to word your work note.` : 'Ollama is not answering, so answers come from the lab checks and hints. Start Ollama and run "ollama pull llama3.2" for full chat.')));
      const offline = (): string => {
        const r = s.result;
        const next = r?.results.find((x) => x.critical && !x.pass) ?? r?.results.find((x) => !x.pass);
        return [
          'Ollama is not answering, so here is what the lab itself can tell you.',
          '',
          r ? `Last Check my work: ${r.score}% of checks.${next ? ` Focus next: **${next.label}**.` : ''}` : 'Run **Check my work** once to see which checks still fail.',
          s.hintsUsed < s.hints.length ? `Take hint ${s.hintsUsed + 1} of ${s.hints.length} if you are stuck.` : 'You have seen every hint; the debrief appears when you give up or pass.',
          '',
          'Start Ollama (`ollama serve`) and run `ollama pull llama3.2` for full mentor chat.',
        ].join('\n');
      };
      const send = async (text?: string): Promise<void> => {
        const q = (text ?? ask.value).trim();
        if (!q) return;
        const tickets = s.ticketIds.map((id) => store.world.tickets.find((t) => t.id === id)!).filter(Boolean);
        const history = chats.get(s.id) ?? [];
        history.push({ role: 'user', content: q });
        const reply: ChatMessage = { role: 'assistant', content: '' };
        history.push(reply);
        chats.set(s.id, history);
        ask.value = '';
        draw();
        const model = ai.model;
        if (ai.status !== 'online' || !model) { reply.content = offline(); draw(); return; }
        try {
          await chat(model, [{ role: 'system', content: coachSystemPrompt(store.world, s, tickets) }, ...history.slice(0, -1)], { onToken: (tk) => {
            reply.content += tk;
            // Looked up per token: a background redraw replaces the bubble.
            const el = host.querySelector('.mentor-log .co-msg.ai:last-child .co-bubble') as HTMLElement | null;
            if (el) { el.textContent = reply.content; el.closest('.mentor-log')!.scrollTop = 1e9; }
          } });
          if (!reply.content.trim()) reply.content = 'The model returned nothing. Ask again.';
        } catch (e) {
          reply.content = `The model did not answer (${e instanceof Error ? e.message : e}).\n\n${offline()}`;
        }
        draw();
      };
      const mentor = h('aside', { class: 'mentor', 'aria-label': 'Mentor chat' },
        h('div', { class: 'mentor-head' }, appIcon('copilot', 20), h('strong', null, 'Mentor'), h('span', { class: `mentor-status ${online ? 'on' : ''}` }, online ? ai.model! : 'Offline: answers from the checks'),
          msgs.length ? h('button', { class: 'co-ib', type: 'button', title: 'Clear conversation', onClick: () => { chats.delete(s.id); draw(); } }, '\uE74D') : null),
        log,
        h('div', { class: 'co-chips' }, ['What should I check first?', 'Which policy applies?', 'Review my work so far', 'Draft my work note'].map((c) => h('button', { class: 'co-chip', type: 'button', onClick: () => void send(c) }, c))),
        h('div', { class: 'co-compose' }, ask, h('button', { class: 'co-send', type: 'button', title: 'Send (Enter)', 'aria-label': 'Send', onClick: () => void send() }, '\uE724')));
      ask.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } });
      return h('div', { class: 'detail-wrap' }, h('section', { class: 'detail' },
        h('div', { class: 'row-between' },
          h('div', null, h('h2', null, s.title), h('p', { class: 'muted' }, `${s.category}, difficulty ${s.difficulty} of 3. Started ${fmt(s.started)}.${s.designedBy ? ` Designed with ${s.designedBy}.` : ''}`)),
          stamp(s)),
        h('div', { class: 'row wrap' },
          s.ticketIds.map((id) => button(`Open ${id}`, () => openUrl(`https://servicedesk.meridianhealth.test/ticket/${id}`))),
          s.mailIds.map((id, i) => button(i === 0 && !s.ticketIds.length ? 'Open the email' : 'Open related email', () => openUrl(`https://mail.meridianhealth.test/msg/${id}`))),
          !done ? button('Check my work', () => act((w) => { const r = checkScenario(w, s.id); toast(r.result!.passed ? 'Passed. Read the debrief, then try the interview drill.' : `Not yet: ${r.result!.results.filter((x) => !x.pass).length} check(s) to fix.`, r.result!.passed ? 'ok' : 'info'); }), 'btn primary') : null,
          !done ? button(`Hint (${s.hintsUsed}/${s.hints.length})`, () => act((w) => { if (!takeHint(w, s.id)) toast('No more hints. The coach can explain the full fix now.'); }), 'btn', 'Each hint is more direct than the last') : null,
          !done ? button('Give up and see the answer', () => act((w) => abandonScenario(w, s.id)), 'btn ghost') : null,
          s.result ? button('Export evidence (.md)', () => download(`${s.id}-${s.templateId}.md`, evidenceMarkdown(store.world, s, store.interviewAnswers[s.id] ?? ''))) : null),
        s.hintsUsed ? h('ol', { class: 'hints' }, s.hints.slice(0, s.hintsUsed).map((x) => h('li', null, x))) : null,
        s.result ? h('div', null, h('h3', null, 'Checks'),
          h('ul', { class: 'checks-list' }, s.result.results.map((r) => h('li', { class: r.pass ? 'pass' : 'fail' }, h('span', { class: 'mark', 'aria-label': r.pass ? 'Passed' : 'Failed' }, r.pass ? '✓' : '✗'), h('div', null, h('strong', null, r.label), r.critical ? badge('Critical', 'bad') : null, h('div', { class: 'muted' }, r.detail))))))
          : h('p', { class: 'muted' }, 'The ticket is your specification, as in a real job. The checks appear after your first Check my work.'),
        done ? h('div', { class: 'debrief' }, h('h3', null, 'Debrief'), h('p', null, s.debrief)) : null,
        done ? h('div', { class: 'stack' }, h('h3', null, 'Interview drill'), h('p', null, h('strong', null, s.interview.question)), answer,
          h('div', { class: 'row' },
            button('Save answer', () => { store.interviewAnswers[s.id] = answer.value; persist(); toast('Answer saved', 'ok'); }),
            ai.status === 'online' ? button('Get feedback from the model', async () => {
              store.interviewAnswers[s.id] = answer.value;
              persist();
              feedback.set(s.id, 'Scoring…');
              draw();
              try {
                const fb = await gradeInterview(ai.model!, s.interview.question, s.interview.modelAnswer, answer.value);
                feedback.set(s.id, `${fb.score}/5. Strengths: ${fb.strengths} Gaps: ${fb.gaps}\n\nStronger answer: ${fb.betterAnswer}`);
                const a = store.career.attempts.find((x) => x.scenarioId === s.id);
                if (a) a.interviewScore = fb.score;
                persist();
              } catch (e) {
                feedback.set(s.id, `No feedback (${e instanceof Error ? e.message : e}).`);
              }
              draw();
            }, 'btn primary') : null,
            button('Show the reference answer', () => { feedback.set(s.id, `Reference answer: ${s.interview.modelAnswer}`); draw(); }, 'btn ghost')),
          feedback.get(s.id) ? h('pre', { class: 'desc' }, feedback.get(s.id)!) : null) : null),
        mentor);
    }

    let accountsDomain = store.world.ad.domain;

    function accountsView(): HTMLElement {
      const companyW = accountsDomain === store.world.ad.domain ? store.world : worldByDomain(accountsDomain) ?? store.world;
      const rows = labAccounts(companyW);
      const picker = h('select', { class: 'input', 'aria-label': 'Company', onChange: (e: Event) => { accountsDomain = (e.target as HTMLSelectElement).value; draw(); } },
        allDomains().map((d) => h('option', { value: d.domain, selected: d.domain === accountsDomain }, `${d.name} (${d.domain})`)));
      const csv = ['Name,SamAccountName,UserPrincipalName,Department,OU,Password,Status,In Entra ID', ...rows.map((r) => [r.name, r.sam, r.upn, r.department, r.ou, r.password ?? '(unknown: reset it)', r.status, r.inEntra ? 'Yes' : 'No'].map((v) => `"${v.replace(/"/g, '""')}"`).join(','))].join('\r\n');
      return h('section', { class: 'detail' },
        h('h2', null, 'Lab accounts'),
        h('p', null, 'Passwords for testing a sign-in as an employee (Remote Desktop > verify a sign-in). Synced accounts use the same password in Entra ID and Okta. In a real company nobody can read a user\'s password: you reset it, and so do the labs.'),
        h('p', { class: 'muted' }, `Your own accounts: admin and adm-admin use your sign-in password. Admin (adm-*), service (svc-*) and break-glass credentials are checked out from the PAM vault (https://vault.meridianhealth.test), which is part of the PAM labs. "Unknown" means the password was last set through Read-Host or by you without the range seeing it; reset it to get a known one.`),
        h('div', { class: 'row' },
          picker,
          button(reveal ? 'Hide passwords' : 'Show passwords', () => { reveal = !reveal; draw(); }, 'btn primary'),
          button('Download CSV', () => download('Meridian-Lab-Accounts.csv', csv)),
          button('Back to labs', () => { accounts = false; draw(); })),
        h('table', { class: 'grid' },
          h('thead', null, h('tr', null, ['Name', 'Account', 'Department', 'OU', 'Password', 'Status', 'Entra ID'].map((c) => h('th', null, c)))),
          h('tbody', null, rows.map((r) => h('tr', null,
            h('td', null, r.name), h('td', null, r.sam), h('td', null, r.department), h('td', null, r.ou),
            h('td', null, r.password ? (reveal ? h('code', null, r.password) : '••••••••••') : h('span', { class: 'muted' }, 'Unknown: reset it')),
            h('td', null, r.status), h('td', null, r.inEntra ? 'Synced' : 'Not in cloud'))))));
    }

    function draw(): void {
      clear(host);
      const all = [...store.world.scenarios].reverse();
      const active = all.filter((s) => s.status === 'active');
      const recent = all.filter((s) => s.status !== 'active').slice(0, 12);
      const sel = store.world.scenarios.find((s) => s.id === selected) ?? active[0] ?? recent[0];
      const item = (s: ScenarioInstance): HTMLElement => h('button', { class: `scn ${s === sel && !accounts ? 'on' : ''}`, type: 'button', onClick: () => { selected = s.id; accounts = false; draw(); } },
        h('span', { class: 'scn-title' }, s.title),
        h('span', { class: 'scn-meta' }, s.ticketIds[0] ?? 'Email', ' ', s.status === 'passed' ? badge('Passed', 'ok') : s.status === 'abandoned' ? badge('Answer shown', 'warn') : s.result ? badge(`${s.result.score}%`, '') : badge('Open', 'info')));
      host.appendChild(h('div', { class: 'coach' },
        launcher(),
        h('div', { class: 'coach-main' },
          h('aside', { class: 'scn-list', 'aria-label': 'Scenarios' },
            h('h3', null, `In progress (${active.length})`), active.length ? active.map(item) : h('p', { class: 'muted' }, 'Nothing open. Start a lab or a shift above.'),
            recent.length ? [h('h3', null, 'Recent'), recent.map(item)] : null,
            h('h3', null, 'Reference'),
            h('button', { class: `scn ${accounts ? 'on' : ''}`, type: 'button', onClick: () => { accounts = true; draw(); } }, h('span', { class: 'scn-title' }, 'Lab accounts and passwords'), h('span', { class: 'scn-meta' }, 'For testing sign-ins'))),
          accounts ? accountsView() : sel ? detail(sel) : h('section', { class: 'detail' }, h('h2', null, 'Your first shift'), h('p', null, 'Start a lab above. The work arrives as a ticket in ServiceDesk (browser bookmark) or as an email. Read the policies, use ADUC, PowerShell and the admin portals, write work notes, resolve the ticket, then come back and check your work.')))));
      const chatEl = host.querySelector('.mentor-log');
      if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
    }
    draw();
    return { redraw: draw };
  },
};
