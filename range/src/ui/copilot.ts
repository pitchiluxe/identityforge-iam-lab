/**
 * ui/copilot.ts — IAM Copilot, the senior engineer beside you.
 *
 * A side panel available from anywhere (taskbar button, Alt+C or Win+C). It
 * watches every running lab through the deterministic monitor, speaks up when
 * an action breaks a control, and chats through the local Ollama model with
 * the live checks and your recent actions as context.
 */
import { type ChatMessage, chat } from '../ai/ollama.ts';
import { type LiveStatus, type Snapshot, copilotSystemPrompt, diff, liveStatus, nudgeText, playerActions, snapshot } from '../ai/monitor.ts';
import { clear, h, markdown, toast } from './dom.ts';
import { store, subscribe } from './store.ts';
import { ai } from './aiState.ts';
import { appIcon } from './icons.ts';

interface Msg {
  role: 'user' | 'assistant' | 'monitor';
  text: string;
  time: string;
  tone?: 'warn' | 'good';
}

const msgs: Msg[] = [];
let panel: HTMLElement | null = null;
let log: HTMLElement;
let labsEl: HTMLElement;
let statusEl: HTMLElement;
let input: HTMLTextAreaElement;
let sendBtn: HTMLButtonElement;
let busy: AbortController | null = null;
let unread = 0;
let prev: Snapshot = new Map();
let last: LiveStatus[] = [];
let onBadge: (n: number) => void = () => {};
let unwatch: () => void = () => {};

const now = (): string => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function copilotOpen(): boolean {
  return !!panel && !panel.hidden;
}

export function setCopilotBadge(fn: (n: number) => void): void {
  onBadge = fn;
  fn(unread);
}

export function toggleCopilot(force?: boolean): void {
  if (!panel) return;
  const show = force ?? panel.hidden;
  panel.hidden = !show;
  if (show) {
    unread = 0;
    onBadge(0);
    drawLabs();
    setTimeout(() => input.focus(), 30);
  }
}

/** Ask Copilot something from elsewhere (e.g. IAM Coach). Opens the panel. */
export function askCopilot(question: string): void {
  toggleCopilot(true);
  void send(question);
}

function push(m: Msg): void {
  msgs.push(m);
  if (msgs.length > 200) msgs.splice(0, msgs.length - 200);
  drawLog();
  if (!copilotOpen()) { unread++; onBadge(unread); }
}

function bubble(m: Msg): HTMLElement {
  if (m.role === 'monitor') {
    return h('div', { class: `co-monitor ${m.tone ?? ''}` }, h('span', { class: 'mdl' }, m.tone === 'good' ? '' : ''), h('div', null, h('div', { class: 'co-monitor-head' }, 'Lab monitor', h('span', null, m.time)), m.text));
  }
  if (m.role === 'user') return h('div', { class: 'co-msg me' }, h('div', { class: 'co-bubble' }, m.text));
  return h('div', { class: 'co-msg ai' }, h('span', { class: 'co-avatar' }, appIcon('copilot', 22)), h('div', { class: 'co-bubble' }, m.text ? markdown(m.text) : h('span', { class: 'co-typing' }, h('i'), h('i'), h('i'))));
}

function drawLog(): void {
  if (!panel) return;
  clear(log);
  if (!msgs.length) {
    log.appendChild(h('div', { class: 'co-hello' },
      appIcon('copilot', 48),
      h('h2', null, `Hi ${store.world.player.displayName.split(' ')[0]}, I'm your IAM Copilot`),
      h('p', null, 'I watch every lab you run and speak up if a change breaks a control. Ask me about a ticket, a PowerShell command, a policy, or how to explain your fix in an interview.')));
  }
  for (const m of msgs) log.appendChild(bubble(m));
  log.scrollTop = log.scrollHeight;
}

function drawLabs(): void {
  if (!panel) return;
  clear(labsEl);
  if (!last.length) {
    labsEl.appendChild(h('div', { class: 'co-lab empty' }, 'No lab running. Start one in IAM Coach and I will follow along.'));
    return;
  }
  for (const s of last) {
    const pct = Math.round((s.passing / Math.max(1, s.results.length)) * 100);
    const broken = s.results.filter((r) => r.critical && !r.pass).length;
    labsEl.appendChild(h('div', { class: `co-lab ${s.ready ? 'ready' : ''}` },
      h('div', { class: 'co-lab-top' }, h('strong', null, s.scenario.title), h('span', { class: 'muted' }, `${s.passing}/${s.results.length}`)),
      h('div', { class: 'co-meter' }, h('span', { style: `width:${pct}%` })),
      h('div', { class: 'co-lab-note muted' }, s.ready ? 'Ready to submit in IAM Coach' : broken ? `${broken} critical control${broken === 1 ? '' : 's'} not yet in place` : 'In progress')));
  }
}

function drawStatus(): void {
  if (!panel) return;
  statusEl.textContent = ai.status === 'online' ? `Local model: ${ai.model}` : ai.status === 'checking' ? 'Looking for Ollama...' : 'Offline mode: monitor only';
  statusEl.className = `co-status ${ai.status}`;
}

/** The answer when no model is running: still useful, never invented. */
function offlineAnswer(): string {
  const lines: string[] = ['Ollama is not answering, so here is what I can tell you from the live checks.', ''];
  if (!last.length) lines.push('No lab is running. Open **IAM Coach** and start one.');
  for (const s of last) {
    lines.push(`**${s.scenario.title}**: ${s.passing} of ${s.results.length} checks hold.`);
    const next = s.results.find((r) => r.critical && !r.pass) ?? s.results.find((r) => !r.pass);
    if (next) lines.push(`- Focus next: ${next.label}`);
    if (s.scenario.hintsUsed < s.scenario.hints.length) lines.push('- Stuck? Take the next hint in IAM Coach.');
  }
  const acts = playerActions(store.world, 3);
  if (acts.length) lines.push('', 'Your last actions:', ...acts.map((a) => `- ${a.action} on ${a.target}`));
  lines.push('', 'To chat with me, start Ollama (`ollama serve`) and pull a model (`ollama pull llama3.2`), then reopen this panel.');
  return lines.join('\n');
}

async function send(text: string): Promise<void> {
  const q = text.trim();
  if (!q || busy) return;
  push({ role: 'user', text: q, time: now() });
  input.value = '';
  const reply: Msg = { role: 'assistant', text: '', time: now() };
  push(reply);
  const model = ai.model;
  if (ai.status !== 'online' || !model) {
    reply.text = offlineAnswer();
    drawLog();
    return;
  }
  busy = new AbortController();
  sendBtn.textContent = '';
  sendBtn.title = 'Stop responding';
  const history: ChatMessage[] = msgs.filter((m) => m.role !== 'monitor' && m !== reply).slice(-12).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text }));
  const status = liveStatus(store.world);
  const messages: ChatMessage[] = [{ role: 'system', content: copilotSystemPrompt(store.world, status, store.world.tickets) }, ...history];
  try {
    await chat(model, messages, { signal: busy.signal, onToken: (t) => { reply.text += t; drawLog(); } });
    if (!reply.text.trim()) reply.text = 'I did not get an answer from the model. Try asking again.';
  } catch (e) {
    if ((e as Error).name !== 'AbortError') reply.text = `${reply.text}\n\n_The model stopped: ${(e as Error).message}_\n\n${offlineAnswer()}`;
    else reply.text += reply.text ? '\n\n_Stopped._' : '_Stopped._';
  } finally {
    busy = null;
    sendBtn.textContent = '';
    sendBtn.title = 'Send (Enter)';
    drawLog();
  }
}

let pending = 0;
function watch(): void {
  clearTimeout(pending);
  pending = window.setTimeout(() => {
    last = liveStatus(store.world);
    const events = diff(prev, last);
    prev = snapshot(last);
    drawLabs();
    drawStatus();
    if (store.settings.copilotNudges === false) return;
    for (const e of events) {
      if (e.kind === 'progress') continue;
      const warn = e.kind === 'regressed';
      if (warn && !e.check!.critical && !copilotOpen()) continue;
      push({ role: 'monitor', text: nudgeText(e), time: now(), tone: warn ? 'warn' : 'good' });
      if (!copilotOpen()) toast(warn ? `IAM Copilot: ${e.check!.label}` : `IAM Copilot: ${e.scenarioTitle} is ready to submit`, warn ? 'err' : 'ok');
    }
  }, 350);
}

export function mountCopilot(root: HTMLElement): void {
  panel?.remove();
  log = h('div', { class: 'co-log', 'aria-live': 'polite' });
  labsEl = h('div', { class: 'co-labs' });
  statusEl = h('span', { class: 'co-status' });
  input = h('textarea', { class: 'co-input', rows: 1, placeholder: 'Ask your senior IAM engineer...', 'aria-label': 'Message IAM Copilot' });
  sendBtn = h('button', { class: 'co-send', type: 'button', title: 'Send (Enter)', 'aria-label': 'Send' }, '');
  const chips = ['What should I look at first?', 'Review my last actions', 'Explain the ticket like a senior engineer', 'Write the PowerShell to verify my fix', 'How would I explain this in an interview?'];
  panel = h('aside', { class: 'copilot', hidden: true, role: 'complementary', 'aria-label': 'IAM Copilot' },
    h('header', { class: 'co-head' }, appIcon('copilot', 22), h('div', { class: 'co-title' }, h('strong', null, 'IAM Copilot'), statusEl),
      h('button', { class: 'co-ib', type: 'button', title: 'New conversation', onClick: () => { busy?.abort(); msgs.length = 0; drawLog(); } }, ''),
      h('button', { class: 'co-ib', type: 'button', title: 'Close (Alt+C)', onClick: () => toggleCopilot(false) }, '')),
    h('details', { class: 'co-labwrap', open: true }, h('summary', null, 'Lab monitor'), labsEl),
    log,
    h('div', { class: 'co-chips' }, chips.map((c) => h('button', { class: 'co-chip', type: 'button', onClick: () => void send(c) }, c))),
    h('div', { class: 'co-compose' }, input, sendBtn),
    h('p', { class: 'co-foot' }, 'Copilot runs on your machine. It can be wrong; the lab checks are the source of truth.'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input.value); }
    if (e.key === 'Escape') toggleCopilot(false);
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; });
  sendBtn.addEventListener('click', () => { if (busy) busy.abort(); else void send(input.value); });
  root.appendChild(panel);
  last = liveStatus(store.world);
  prev = snapshot(last);
  drawLog();
  drawLabs();
  drawStatus();
  unwatch();
  unwatch = subscribe(watch);
}
