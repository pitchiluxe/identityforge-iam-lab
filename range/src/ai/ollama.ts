/**
 * ai/ollama.ts — the local model, used for variety and coaching only.
 *
 * Same rule as IAM Range: the model never decides facts. It may choose a
 * template and twist from a validated menu, write flavour text that is
 * labelled as such, reword a ticket only if every fact survives, and coach
 * from a frozen copy of the grader's results. Grading is always deterministic.
 */
import type { Department, ScenarioInstance, Ticket, World } from '../core/types.ts';
import { DEPARTMENTS } from '../world/company.ts';
import type { Template } from '../scenarios/template.ts';

/**
 * Where the local model is reached. In development and in the desktop app a
 * same-origin /ollama proxy forwards to 127.0.0.1:11434 with no Origin header.
 * The web edition (served over https) has no proxy, so it calls Ollama on the
 * learner's own computer directly; Ollama answers only if OLLAMA_ORIGINS
 * allows the site (see WEB_OLLAMA_HELP).
 */
export const WEB_EDITION = typeof location !== 'undefined' && location.protocol === 'https:';
const BASE = WEB_EDITION ? 'http://127.0.0.1:11434' : '/ollama';
// Only this site's exact origin: a wildcard would let every website you visit use your local model.
export const WEB_OLLAMA_HELP = `In the web edition, Ollama must allow this website. In PowerShell run: setx OLLAMA_ORIGINS "${typeof location !== 'undefined' ? location.origin : 'https://this-site'}" then quit Ollama from the tray and start it again. Do not use "*": that would let any website use your local model. Or install the desktop app, which needs no setting.`;
const PREFERRED = ['llama3.2', 'qwen3.5', 'gemma4', 'qwen2.5', 'llama3.1', 'mistral', 'gemma2', 'phi3'];

export interface ModelInfo {
  name: string;
  cloud: boolean;
}

export async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const res = await fetch(`${BASE}/api/tags`, { signal });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? [])
    .map((m) => m.name)
    .filter((n) => !/embed/i.test(n))
    .map((name) => ({ name, cloud: /cloud/i.test(name) }));
}

/** Prefer a capable local model; never pick a cloud-hosted one by default. */
export function defaultModel(models: ModelInfo[]): string | null {
  const local = models.filter((m) => !m.cloud);
  for (const p of PREFERRED) {
    const hit = local.find((m) => m.name.startsWith(p));
    if (hit) return hit.name;
  }
  return local[0]?.name ?? null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chat(model: string, messages: ChatMessage[], opts: { format?: object; onToken?: (t: string) => void; signal?: AbortSignal } = {}): Promise<string> {
  const stream = !!opts.onToken;
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({ model, messages, stream, think: false, format: opts.format, options: { temperature: opts.format ? 0.8 : 0.4 } }),
  });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (!stream) {
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? '';
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const part = JSON.parse(line) as { message?: { content?: string } };
      const tok = part.message?.content ?? '';
      if (tok) { full += tok; opts.onToken!(tok); }
    }
  }
  return full;
}

// ------------------------------------------------------------------- designer

export interface Design {
  templateId: string;
  twist: string;
  department: Department | undefined;
  title: string;
  context: string;
}

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    templateId: { type: 'string' },
    twist: { type: 'string' },
    department: { type: 'string' },
    title: { type: 'string' },
    context: { type: 'string' },
  },
  required: ['templateId', 'twist', 'department', 'title', 'context'],
};

/** Validate whatever the model returned against the real menu. Anything off-menu is rejected. */
export function validateDesign(raw: unknown, templates: readonly Template[]): Design {
  const d = raw as Partial<Record<keyof Design, unknown>>;
  const t = templates.find((x) => x.id === d.templateId);
  if (!t) throw new Error(`Model chose an unknown template "${String(d.templateId)}".`);
  const twist = t.twists.find((x) => x.id === d.twist)?.id ?? t.twists[0]!.id;
  const department = DEPARTMENTS.find((x) => x.toLowerCase() === String(d.department ?? '').toLowerCase());
  const clean = (s: unknown, n: number): string => String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  return { templateId: t.id, twist, department, title: clean(d.title, 90), context: clean(d.context, 700) };
}

export async function designScenario(model: string, w: World, templates: readonly Template[], focus: string, signal?: AbortSignal): Promise<Design> {
  const done = w.scenarios.slice(-8).map((s) => `${s.templateId}/${s.twist}`).join(', ') || 'none yet';
  const menu = templates.map((t) => `- ${t.id} (${t.category}, difficulty ${t.difficulty}): ${t.summary} Twists: ${t.twists.map((x) => `${x.id} = ${x.label}`).join('; ')}`).join('\n');
  const prompt = `You design realistic IAM practice scenarios for a learner preparing for an IAM Analyst/Engineer job at a fictional company, ${w.company.name}.

Choose ONE template and ONE of its twists from this menu (ids must match exactly):
${menu}

Departments: ${DEPARTMENTS.join(', ')}.
Recently practised (avoid repeating): ${done}.
Learner focus: ${focus || 'surprise me with something realistic they have not done recently'}.

Then write:
- title: a short, specific ticket-queue style title (no person names).
- context: 2-3 sentences of business backdrop a shift lead might say (a quarter-end, an audit, a reorg, a busy week). Do NOT name people, places, cities, countries, accounts, groups, IP addresses, numbers, times or ticket numbers; the systems hold those facts. Do NOT give instructions or steps; the learner must work those out from policy.

Return JSON only.`;
  const text = await chat(model, [{ role: 'user', content: prompt }], { format: DESIGN_SCHEMA, signal });
  return validateDesign(JSON.parse(text), templates);
}

// ------------------------------------------------------------------- rewording

/** Facts that must survive any rewording: IDs, accounts, groups, IPs, dates, numbers. */
export function factTokens(text: string): string[] {
  const re = /\b(?:[A-Z]{2,5}\d{5,}|E\d{6}|[a-z]+[a-z0-9.-]*@[a-z0-9.-]+|(?:grp|app|role|svc|adm)-[a-z0-9-]+|\d{1,3}(?:\.\d{1,3}){3}|\d{4}-\d{2}-\d{2}|\+?\d[\d ]{6,}\d|MHS-[A-Z0-9-]+)\b/g;
  return [...new Set(text.match(re) ?? [])];
}

/**
 * Small models announce their answer ("Here's the rewritten ticket:") and sign
 * off ("Let me know if..."). Neither belongs in a ticket from a caller.
 */
export function stripPreamble(text: string): string {
  const lines = text.trim().split('\n');
  while (lines.length && /^(here('s| is| are)|sure|certainly|of course|okay|ok)\b.*:\s*$/i.test(lines[0]!.trim()) && lines[0]!.trim().length < 90) lines.shift();
  while (lines.length && /^(let me know|i hope|feel free|i've kept|note:)/i.test(lines.at(-1)!.trim())) lines.pop();
  return lines.join('\n').trim();
}

export async function rewordTicket(model: string, t: Ticket, signal?: AbortSignal): Promise<string | null> {
  const facts = factTokens(t.description);
  const prompt = `Rewrite this IT ticket so it reads like a real person wrote it (natural, a little informal, the caller's tone). Keep every fact. You MUST keep these exact strings unchanged: ${facts.join(', ') || '(none)'}. Do not add new facts, names, numbers or instructions. Plain text only.

Ticket from ${t.caller}, subject "${t.short}":
${t.description}`;
  const out = stripPreamble(await chat(model, [{ role: 'user', content: prompt }], { signal }));
  const ok = out.length > 40 && out.length < t.description.length * 3 + 400 && facts.every((f) => out.includes(f));
  return ok ? out : null;
}

// ------------------------------------------------------------------- coach

export function coachSystemPrompt(w: World, s: ScenarioInstance, tickets: Ticket[]): string {
  const graded = s.result
    ? `Latest deterministic check results (score ${s.result.score}%, ${s.result.passed ? 'PASSED' : 'not passed'}):\n${s.result.results.map((r) => `- ${r.pass ? 'PASS' : 'FAIL'}${r.critical ? ' [critical]' : ''}: ${r.label} (${r.detail})`).join('\n')}`
    : 'The learner has not run Check my work yet.';
  const reveal = s.status !== 'active' || s.hintsUsed >= s.hints.length;
  return `You are a senior IAM engineer mentoring a junior colleague at ${w.company.name} (a fictional, simulated company). Be Socratic, concise and practical. Use plain language and the real tool names (ADUC, PowerShell, Entra admin center, Okta admin console, ServiceDesk, PeopleHub).

Rules:
- You cannot see or change the systems. Never claim something was done. The checks below are the only truth.
- ${reveal ? 'The learner has used all hints or finished, so you may explain the full fix.' : 'Do not give the full fix. Ask a guiding question or point to the policy, log or system to look at.'}
- Tie advice to the company policies (Documents\\Policies) and to how this works in real jobs and interviews.
- Keep answers under 180 words.

Scenario: ${s.title} (${s.category}).
Tickets:
${tickets.map((t) => `${t.id}: ${t.short}\n${t.description}`).join('\n\n') || '(started from an email)'}

Hints the learner has seen: ${s.hints.slice(0, s.hintsUsed).join(' | ') || 'none'}.
${graded}
${reveal ? `Debrief (for you): ${s.debrief}` : ''}`;
}

export interface InterviewFeedback {
  score: number;
  strengths: string;
  gaps: string;
  betterAnswer: string;
}

export async function gradeInterview(model: string, question: string, modelAnswer: string, answer: string, signal?: AbortSignal): Promise<InterviewFeedback> {
  const schema = { type: 'object', properties: { score: { type: 'integer' }, strengths: { type: 'string' }, gaps: { type: 'string' }, betterAnswer: { type: 'string' } }, required: ['score', 'strengths', 'gaps', 'betterAnswer'] };
  const text = await chat(model, [{ role: 'user', content: `You are interviewing a candidate for an IAM Engineer role. Score their answer 1-5 against the reference (5 = hire-level: correct, ordered, mentions verification and risk). Be specific and brief.\n\nQuestion: ${question}\nReference answer: ${modelAnswer}\nCandidate answer: ${answer}\n\nReturn JSON.` }], { format: schema, signal });
  const r = JSON.parse(text) as Partial<InterviewFeedback>;
  return { score: Math.max(1, Math.min(5, Math.round(Number(r.score) || 1))), strengths: String(r.strengths ?? ''), gaps: String(r.gaps ?? ''), betterAnswer: String(r.betterAnswer ?? '') };
}

// ------------------------------------------------------------------- backdrop guard

const BACKDROP_ALLOWED = new Set(['meridian', 'health', 'system', 'hospital', 'entra', 'id', 'okta', 'servicedesk', 'peoplehub', 'security', 'operations', 'secops', 'iam', 'ad', 'active', 'directory', 'identity', 'protection', 'microsoft', 'scim', 'sso', 'mfa', 'hr', 'it', 'finance', 'engineering', 'sales', 'help', 'desk', 'audit', 'internal', 'q1', 'q2', 'q3', 'q4', 'sox', 'soc', 'ciso', 'cfo', 'ceo', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'the', 'a', 'an', 'this', 'our', 'we', 'with', 'after', 'before', 'during', 'since', 'last', 'next', 'today', 'conditional', 'access', 'pim', 'powershell', 'aduc', 'payrollpro', 'imagevault', 'carechart', 'expenseflow', 'office', 'teams', 'outlook']);
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred)\b/i;

/**
 * Background text must not add facts. Every number and every capitalised word
 * (other than at the start of a sentence) must already appear in the scenario's
 * own ticket or email text, or be a system name. Otherwise the backdrop is dropped.
 */
export function backdropProblems(context: string, groundTruth: string): string[] {
  const truth = groundTruth.toLowerCase();
  const problems: string[] = [];
  for (const n of context.match(/\d[\d.:,]*/g) ?? []) if (!truth.includes(n.toLowerCase())) problems.push(n);
  const nw = NUMBER_WORDS.exec(context);
  if (nw && !truth.includes(nw[1]!.toLowerCase())) problems.push(nw[1]!);
  const sentences = context.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const words = s.split(/\s+/).slice(1);
    for (const raw of words) {
      const wd = raw.replace(/[^A-Za-z'-]/g, '');
      if (!/^[A-Z]/.test(wd)) continue;
      const k = wd.toLowerCase().replace(/'s$/, '');
      if (!BACKDROP_ALLOWED.has(k) && !truth.includes(k)) problems.push(wd);
    }
  }
  return [...new Set(problems)];
}
