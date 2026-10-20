/**
 * scenarios/template.ts — what a scenario template is, and helpers they share.
 *
 * A template builds a situation into the world (so the evidence is true before
 * the ticket arrives), opens the ticket or mail that starts the work, and
 * declares checks the grader can evaluate. `solve` is the reference solution
 * and `naive` the tempting wrong answer to a trap; both are only for tests.
 */
import type { AdUser, Category, Check, CheckSpec, Department, ScenarioInstance, Worker, World } from '../core/types.ts';
import type { Rng } from '../core/rng.ts';
import { CANDIDATES, DEPARTMENTS, JOB_ROLES, samFor } from '../world/company.ts';
import { findUser } from '../world/directory.ts';
import { runEntraSync, runOktaImport } from '../world/cloud.ts';
import { addWorkNote, openTicket, resolveTicket } from '../world/itsm.ts';
import type { ResolutionCode } from '../core/types.ts';
import { nowIso } from '../core/time.ts';

export interface BuildCtx {
  w: World;
  rng: Rng;
  twist: string;
  id: string;
  started: string;
  /** Optional hint from the AI designer, e.g. a preferred department. */
  department?: Department;
}

export interface Built {
  title: string;
  ticketIds: string[];
  mailIds: string[];
  params: Record<string, string>;
  checks: Check[];
  hints: string[];
  debrief: string;
  interview: { question: string; modelAnswer: string };
}

export interface Twist {
  id: string;
  label: string;
  /** A trap: the obvious action is the wrong one. */
  trap?: boolean;
}

export interface Template {
  id: string;
  title: string;
  category: Category;
  difficulty: 1 | 2 | 3;
  skills: string[];
  summary: string;
  twists: Twist[];
  build(ctx: BuildCtx): Built;
  solve(w: World, s: ScenarioInstance): void;
  naive?(w: World, s: ScenarioInstance): void;
}

let checkSeq = 0;
export function check(label: string, spec: CheckSpec, critical = false): Check {
  return { id: `c${++checkSeq}`, label, critical, spec };
}

/** sam values already in use by an active scenario, so two tickets never fight over one person. */
export function busySams(w: World): Set<string> {
  const out = new Set<string>();
  for (const s of w.scenarios) {
    if (s.status !== 'active') continue;
    for (const [k, v] of Object.entries(s.params)) if (/sam/i.test(k)) for (const x of v.split(',')) out.add(x);
  }
  return out;
}

export function workerOf(w: World, u: AdUser): Worker | undefined {
  return w.hr.workers.find((x) => x.employeeId === u.employeeId);
}

export function employees(ctx: BuildCtx, pred: (u: AdUser, hr: Worker) => boolean = () => true): AdUser[] {
  const busy = busySams(ctx.w);
  return ctx.w.ad.users.filter((u) => {
    if (u.kind !== 'user' || !u.enabled || u.sam === ctx.w.player.sam || busy.has(u.sam)) return false;
    const hr = workerOf(ctx.w, u);
    return !!hr && hr.status === 'Active' && pred(u, hr);
  });
}

export function pickEmployee(ctx: BuildCtx, pred?: (u: AdUser, hr: Worker) => boolean): AdUser {
  const pool = employees(ctx, pred);
  const preferred = ctx.department ? pool.filter((u) => u.department === ctx.department) : [];
  const list = preferred.length ? preferred : pool;
  if (!list.length) throw new Error('No eligible employee is free for this scenario. Finish or abandon an active scenario first.');
  return ctx.rng.pick(list);
}

export function isLead(u: AdUser): boolean {
  return JOB_ROLES.some((r) => r.title === u.title && r.lead);
}

export function leadOf(w: World, dept: string): AdUser {
  const r = JOB_ROLES.find((j) => j.department === dept && j.lead);
  const u = w.ad.users.find((x) => x.kind === 'user' && x.title === r?.title && x.enabled);
  if (!u) throw new Error(`No lead for ${dept}`);
  return u;
}

export function pickDepartment(ctx: BuildCtx, exclude: string[] = []): Department {
  const options = DEPARTMENTS.filter((d) => !exclude.includes(d));
  if (ctx.department && options.includes(ctx.department)) return ctx.department;
  return ctx.rng.pick(options);
}

export function newPerson(ctx: BuildCtx): { first: string; last: string; sam: string } {
  const free = CANDIDATES.filter(([f, l]) => !ctx.w.hr.workers.some((x) => x.first === f && x.last === l));
  const [first, last] = ctx.rng.pick(free.length ? free : CANDIDATES);
  const sam = samFor(first, last, (s) => !!findUser(ctx.w, s) || busySams(ctx.w).has(s));
  return { first, last, sam };
}

export function hrUser(w: World): AdUser {
  const u = w.ad.users.find((x) => x.title === 'HR Business Partner' && x.enabled);
  return u ?? leadOf(w, 'HR');
}

export function securityUser(w: World): AdUser {
  return leadOf(w, 'Security');
}

export function helpdeskUser(w: World): AdUser {
  return w.ad.users.find((x) => x.title === 'Service Desk Analyst' && x.enabled) ?? leadOf(w, 'Help Desk');
}

export function syncAll(w: World): void {
  runEntraSync(w);
  runOktaImport(w);
}

export function close(w: World, ticket: string, code: ResolutionCode, notes: string): void {
  addWorkNote(w, ticket, notes);
  resolveTicket(w, ticket, code, notes);
}

export function today(): string {
  return nowIso().slice(0, 10);
}

export function vary<T>(rng: Rng, options: readonly T[]): T {
  return rng.pick(options);
}

/** Raise a Security Incident the way the player would, from the IAM side. */
export function raiseSir(w: World, short: string, description: string): void {
  openTicket(w, { type: 'Security Incident', category: 'Security', priority: 2, caller: w.player.displayName, short, description });
}
