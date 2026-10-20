/**
 * scenarios/engine.ts — starts, grades and closes scenarios.
 *
 * Randomness lives here: which template, which twist, which person. A seed
 * makes any scenario reproducible, which is how a learner can retry the same
 * lab or a mentor can hand out the same one to a cohort.
 */
import type { Department, ScenarioInstance, World } from '../core/types.ts';
import { createRng, randomSeed } from '../core/rng.ts';
import { nowIso } from '../core/time.ts';
import { grade } from './grader.ts';
import type { Template } from './template.ts';
import { joiner, leaver, mover } from './library/lifecycle.ts';
import { compromised, lockout, mfaReset, passwordReset } from './library/auth.ts';
import { accessRequest, accessReview, execEmail, orphanAccounts, ssoAccess, staleAccounts } from './library/governance.ts';
import { caPolicy, hybridSync, serviceAccount, standingPrivilege } from './library/privileged.ts';

export const TEMPLATES: readonly Template[] = [
  joiner, mover, leaver,
  passwordReset, lockout, mfaReset, compromised,
  accessRequest, accessReview, staleAccounts, orphanAccounts, ssoAccess, execEmail,
  standingPrivilege, serviceAccount, caPolicy, hybridSync,
];

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export interface StartOptions {
  templateId?: string;
  twist?: string;
  seed?: number;
  department?: Department;
  designedBy?: string | null;
  /** Difficulty ceiling for random picks. */
  maxDifficulty?: 1 | 2 | 3;
}

export function startScenario(w: World, opts: StartOptions = {}): ScenarioInstance {
  const seed = opts.seed ?? randomSeed();
  const rng = createRng(seed);
  let template: Template | undefined;
  if (opts.templateId) {
    template = templateById(opts.templateId);
    if (!template) throw new Error(`Unknown scenario template: ${opts.templateId}`);
  } else {
    const recent = new Set(w.scenarios.slice(-4).map((s) => s.templateId));
    const active = new Set(w.scenarios.filter((s) => s.status === 'active').map((s) => s.templateId));
    const pool = TEMPLATES.filter((t) => t.difficulty <= (opts.maxDifficulty ?? 3) && !active.has(t.id));
    const fresh = pool.filter((t) => !recent.has(t.id));
    template = rng.pick(fresh.length ? fresh : pool.length ? pool : TEMPLATES);
  }
  const twist = opts.twist && template.twists.some((x) => x.id === opts.twist) ? opts.twist : rng.pick(template.twists).id;
  const id = `SCN-${String(++w.counters.scenario).padStart(4, '0')}`;
  const started = nowIso();
  const auditFrom = w.counters.audit;
  const built = template.build({ w, rng, twist, id, started, department: opts.department });
  const instance: ScenarioInstance = {
    id,
    templateId: template.id,
    twist,
    title: built.title,
    category: template.category,
    difficulty: template.difficulty,
    skills: template.skills,
    started,
    ticketIds: built.ticketIds,
    mailIds: built.mailIds,
    params: { ...built.params, seed: String(seed) },
    checks: built.checks,
    hints: built.hints,
    hintsUsed: 0,
    debrief: built.debrief,
    interview: built.interview,
    designedBy: opts.designedBy ?? null,
    result: null,
    status: 'active',
    setupAudit: [auditFrom, w.counters.audit],
  };
  w.scenarios.push(instance);
  return instance;
}

/** A shift: several unrelated tickets at once, the way a real queue looks on a Monday. */
export function startShift(w: World, count: number, maxDifficulty: 1 | 2 | 3 = 3, seed = randomSeed()): ScenarioInstance[] {
  const rng = createRng(seed);
  const out: ScenarioInstance[] = [];
  const chosen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const pool = TEMPLATES.filter((t) => t.difficulty <= maxDifficulty && !chosen.has(t.id) && !w.scenarios.some((s) => s.status === 'active' && s.templateId === t.id));
    if (!pool.length) break;
    const t = rng.pick(pool);
    chosen.add(t.id);
    try {
      out.push(startScenario(w, { templateId: t.id, seed: rng.int(1, 2 ** 30) }));
    } catch {
      // A template can decline when no suitable person is free; the shift is just shorter.
    }
  }
  return out;
}

export function getScenario(w: World, id: string): ScenarioInstance {
  const s = w.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`Scenario ${id} not found.`);
  return s;
}

export function checkScenario(w: World, id: string): ScenarioInstance {
  const s = getScenario(w, id);
  s.result = grade(w, s);
  if (s.result.passed) s.status = 'passed';
  return s;
}

export function takeHint(w: World, id: string): string | null {
  const s = getScenario(w, id);
  if (s.hintsUsed >= s.hints.length) return null;
  return s.hints[s.hintsUsed++] ?? null;
}

export function abandonScenario(w: World, id: string): ScenarioInstance {
  const s = getScenario(w, id);
  s.result = grade(w, s);
  s.status = s.result.passed ? 'passed' : 'abandoned';
  return s;
}

export function activeScenarios(w: World): ScenarioInstance[] {
  return w.scenarios.filter((s) => s.status === 'active');
}
