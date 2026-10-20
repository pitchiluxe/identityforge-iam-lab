import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backdropProblems, defaultModel, factTokens, validateDesign } from '../src/ai/ollama.ts';
import { TEMPLATES } from '../src/scenarios/engine.ts';

test('designs off the menu are rejected; bad twists fall back', () => {
  assert.throws(() => validateDesign({ templateId: 'hack-the-planet', twist: 'x' }, TEMPLATES), /unknown template/);
  const d = validateDesign({ templateId: 'leaver', twist: 'nonsense', department: 'finance', title: '<b>x</b>', context: 'ok' }, TEMPLATES);
  assert.equal(d.twist, 'voluntary');
  assert.equal(d.department, 'Finance');
  assert.doesNotMatch(d.title, /</);
});

test('fact tokens cover IDs, accounts, groups and IPs', () => {
  const f = factTokens('RITM0010401 for E100404 tbello@meridianhealth.test in grp-sec-ops from 192.0.2.66 on 2026-10-19');
  for (const x of ['RITM0010401', 'E100404', 'tbello@meridianhealth.test', 'grp-sec-ops', '192.0.2.66', '2026-10-19']) assert.ok(f.includes(x), x);
});

test('a backdrop that invents places or numbers is rejected', () => {
  const ticket = 'Entra ID Protection raised high user risk for olund@meridianhealth.test: Boston, then Sao Paulo, BR (192.0.2.140) 48 minutes later.';
  assert.deepEqual(backdropProblems('Security Operations is stretched this week after a phishing wave. Contain fast and hand over to SecOps.', ticket), []);
  assert.ok(backdropProblems('A sign-in from London followed by New York within forty minutes.', ticket).length > 0);
  assert.ok(backdropProblems('It happened 3 times.', ticket).includes('3'));
});

test('default model is local and prefers llama3.2', () => {
  assert.equal(defaultModel([{ name: 'gpt-oss:20b-cloud', cloud: true }, { name: 'qwen3.5:latest', cloud: false }, { name: 'llama3.2:latest', cloud: false }]), 'llama3.2:latest');
  assert.equal(defaultModel([{ name: 'x:cloud', cloud: true }]), null);
});

test('model preambles and sign-offs are stripped from reworded tickets', async () => {
  const { stripPreamble } = await import('../src/ai/ollama.ts');
  assert.equal(stripPreamble("Here's the rewritten ticket:\n\nHey team,\nI need access.\nThanks!"), 'Hey team,\nI need access.\nThanks!');
  assert.equal(stripPreamble('Sure! Here is a more natural version:\nHi,\nPlease help.\nLet me know if you want changes.'), 'Hi,\nPlease help.');
  assert.equal(stripPreamble('Hi,\nHere is the export you asked for: file.csv'), 'Hi,\nHere is the export you asked for: file.csv');
});
