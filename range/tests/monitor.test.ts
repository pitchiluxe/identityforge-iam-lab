import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { TEMPLATES, startScenario } from '../src/scenarios/engine.ts';
import { copilotSystemPrompt, diff, liveStatus, nudgeText, playerActions, snapshot } from '../src/ai/monitor.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

test('a lab that just started reports nothing', () => {
  const w = createWorld(7);
  const prev = snapshot(liveStatus(w));
  startScenario(w, { templateId: TEMPLATES[0]!.id, seed: 7 });
  assert.deepEqual(diff(prev, liveStatus(w)), []);
});

test('solving a lab reports progress and ready, never a regression', () => {
  for (const tpl of TEMPLATES) {
    const w = createWorld(42);
    const s = startScenario(w, { templateId: tpl.id, seed: 42 });
    const prev = snapshot(liveStatus(w));
    tpl.solve(w, s);
    const events = diff(prev, liveStatus(w));
    assert.ok(!events.some((e) => e.kind === 'regressed' && e.check!.critical), `${tpl.id}: solve must not break a critical control`);
    assert.ok(events.some((e) => e.kind === 'ready'), `${tpl.id}: solve makes the lab ready`);
  }
});

test('falling into a trap breaks a critical control the monitor sees', () => {
  let caught = 0;
  for (const tpl of TEMPLATES) {
    if (!tpl.naive) continue;
    for (const twist of tpl.twists.filter((x) => x.trap)) {
      const w = createWorld(1234);
      const s = startScenario(w, { templateId: tpl.id, twist: twist.id, seed: 1234 });
      const prev = snapshot(liveStatus(w));
      try { tpl.naive(w, s); } catch { continue; }
      const regressions = diff(prev, liveStatus(w)).filter((e) => e.kind === 'regressed' && e.check!.critical);
      if (regressions.length) {
        caught++;
        assert.match(nudgeText(regressions[0]!), /critical control/);
      }
    }
  }
  assert.ok(caught > 0, 'at least one trap is caught the moment it happens');
});

test('the Copilot prompt carries live checks and hides the fix until hints are used', () => {
  const w = createWorld(1);
  const s = startScenario(w, { templateId: TEMPLATES[0]!.id, seed: 1 });
  let p = copilotSystemPrompt(w, liveStatus(w), w.tickets);
  assert.match(p, /Still to do/);
  assert.match(p, /Do not hand over the full fix/);
  assert.doesNotMatch(p, new RegExp(s.debrief.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  s.hintsUsed = s.hints.length;
  p = copilotSystemPrompt(w, liveStatus(w), w.tickets);
  assert.match(p, /may explain the full fix/);
  assert.equal(playerActions(w).length, 0, 'lab setup backdrop is not the learner\'s work');
  TEMPLATES[0]!.solve(w, s);
  assert.ok(playerActions(w).length > 0, 'solving leaves audit entries attributed to the learner');
});
