import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';

setClock(() => Date.parse('2026-10-19T14:00:00Z'));

test('seed builds a consistent company', () => {
  const w = createWorld(42);
  const employees = w.ad.users.filter((u) => u.kind === 'user');
  assert.equal(employees.length, 36);
  assert.equal(w.hr.workers.length, 36);
  assert.ok(w.entra.users.filter((u) => u.source === 'synced').length >= 36);
  assert.equal(w.entra.syncErrors.length, 0);
  assert.ok(w.okta.users.length >= 36);
  const carechart = w.saas.find((s) => s.id === 'carechart')!;
  assert.ok(carechart.accounts.length > 0, 'SCIM provisioned CareChart EHR');
  assert.ok(w.saas.find((s) => s.id === 'payrollpro')!.accounts.length >= 5);
  assert.ok(w.files.length > 10);
  assert.equal(JSON.stringify(createWorld(42).ad), JSON.stringify(w.ad), 'seed is deterministic');
});
