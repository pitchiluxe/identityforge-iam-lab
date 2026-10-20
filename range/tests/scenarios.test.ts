import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { TEMPLATES, checkScenario, startScenario, startShift } from '../src/scenarios/engine.ts';
import { grade } from '../src/scenarios/grader.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
// Each call moves the clock forward a second, so "since the scenario started" is meaningful.
setClock(() => (t += 1000));

const SEEDS = [1, 7, 42, 1234, 98765];

for (const tpl of TEMPLATES) {
  for (const twist of tpl.twists) {
    test(`${tpl.id} / ${twist.id}: untouched fails, reference solution passes`, () => {
      for (const seed of SEEDS) {
        const w = createWorld(seed);
        const s = startScenario(w, { templateId: tpl.id, twist: twist.id, seed });
        assert.ok(s.checks.length >= 2, 'has checks');
        assert.equal(s.hints.length, 3, 'three tiered hints');
        assert.ok(s.debrief.length > 80 && s.interview.question && s.interview.modelAnswer, 'debrief and interview drill');
        const before = grade(w, s);
        assert.equal(before.passed, false, `seed ${seed}: doing nothing must not pass`);
        tpl.solve(w, s);
        const after = checkScenario(w, s.id).result!;
        const failing = after.results.filter((r) => !r.pass).map((r) => `${r.label}: ${r.detail}`);
        assert.deepEqual(failing, [], `seed ${seed}: reference solution must pass every check`);
        assert.equal(after.passed, true);
      }
    });
    if (tpl.naive) {
      test(`${tpl.id} / ${twist.id}: the naive answer does not pass`, () => {
        for (const seed of SEEDS) {
          const w = createWorld(seed);
          const s = startScenario(w, { templateId: tpl.id, twist: twist.id, seed });
          try {
            tpl.naive!(w, s);
          } catch {
            // The naive path hitting a guard rail (e.g. Tier 0) is also a non-pass.
          }
          const r = grade(w, s);
          if (twist.trap) {
            assert.equal(r.passed, false, `seed ${seed}: trap twist must not pass with the naive answer`);
            assert.ok(r.results.some((x) => x.critical && !x.pass), `seed ${seed}: a critical check catches the trap`);
          }
        }
      });
    }
  }
}

test('a shift opens several concurrent scenarios without colliding on people', () => {
  const w = createWorld(5);
  const shift = startShift(w, 6, 3, 99);
  assert.ok(shift.length >= 5, `opened ${shift.length}`);
  const sams = shift.map((s) => s.params.sam).filter(Boolean);
  assert.equal(new Set(sams).size, sams.length, 'no person appears in two scenarios');
  for (const s of shift) {
    const tpl = TEMPLATES.find((x) => x.id === s.templateId)!;
    tpl.solve(w, s);
  }
  for (const s of shift) assert.equal(checkScenario(w, s.id).result!.passed, true, `${s.templateId}/${s.twist} passes when solved alongside others`);
});

test('the same seed builds the same scenario', () => {
  const a = startScenario(createWorld(3), { seed: 555 });
  const b = startScenario(createWorld(3), { seed: 555 });
  assert.equal(a.templateId, b.templateId);
  assert.equal(a.twist, b.twist);
  assert.equal(a.title, b.title);
});
