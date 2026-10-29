import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { MSP_COMPANIES } from '../src/world/profiles.ts';
import { createCompanyWorld } from '../src/world/mspSeed.ts';
import { startScenario } from '../src/scenarios/engine.ts';
import { grade } from '../src/scenarios/grader.ts';
import { MSP_TEMPLATES } from '../src/scenarios/msp/index.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

const SEEDS = [11, 22, 33, 44, 55];

for (const tpl of MSP_TEMPLATES) {
  test(`msp ${tpl.id}: untouched fails, solve passes, naive fails a critical check — every twist, seed and fitting company`, () => {
    let ran = 0;
    for (const p of MSP_COMPANIES) {
      if (!tpl.fits(createCompanyWorld(p))) continue;
      for (const twist of tpl.twists) {
        for (const seed of SEEDS) {
          const run = (mode: 'none' | 'solve' | 'naive') => {
            const w = createCompanyWorld(p);
            const s = startScenario(w, { templateId: tpl.id, twist: twist.id, seed });
            if (mode === 'solve') tpl.solve(w, s);
            if (mode === 'naive') tpl.naive!(w, s);
            return grade(w, s);
          };
          const label = `${p.id}/${twist.id}/${seed}`;
          assert.equal(run('none').passed, false, `${label}: untouched must fail`);
          const solved = run('solve');
          assert.equal(solved.passed, true, `${label}: solve must pass — ${solved.results.filter((r) => !r.pass).map((r) => `${r.label}: ${r.detail}`).join(' | ')}`);
          if (tpl.naive) {
            const naive = run('naive');
            assert.ok(naive.results.some((r) => r.critical && !r.pass), `${label}: naive must fail a critical check`);
          }
          ran++;
        }
      }
    }
    assert.ok(ran > 0, `${tpl.id} fits at least one company`);
  });
}

test('msp: every ticket names only people and groups the company systems show', () => {
  for (const p of MSP_COMPANIES) {
    for (const tpl of MSP_TEMPLATES) {
      const w = createCompanyWorld(p);
      if (!tpl.fits(w)) continue;
      const s = startScenario(w, { templateId: tpl.id, seed: 7 });
      for (const id of s.ticketIds) {
        const tk = w.tickets.find((x) => x.id === id)!;
        const people = w.ad.users.map((u) => u.displayName);
        // The caller is a staff member, an outside address (suspicious/guest tickets), or the MSP's own service delivery desk.
        assert.ok(people.includes(tk.caller) || tk.caller.includes('@') || tk.caller === 'MSP Service Delivery', `${p.id}/${tpl.id}: caller ${tk.caller} exists`);
        for (const word of tk.description.match(/\b[A-Z]{3}\d{6}\b/g) ?? []) {
          assert.ok(w.hr.workers.some((x) => x.employeeId === word), `${p.id}/${tpl.id}: employee ID ${word} exists in HR`);
        }
      }
    }
  }
});
