import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { LOCKOUT_THRESHOLD, changeOwnPassword, resetPassword, setEnabled, setExpiration, signIn } from '../src/world/directory.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));
const HOST = 'MHS-TEST-WKS01';

test('an account nobody has set a password for cannot sign in', () => {
  const w = createWorld(3);
  const r = signIn(w, 'vhale', 'anything', HOST);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.reason, 'password');
});

test('after a reset with change at next logon, sign-in demands a new password, then works', () => {
  const w = createWorld(3);
  resetPassword(w, 'vhale', { mustChange: true, password: 'Temp-Passw0rd!' });
  const first = signIn(w, 'MERIDIAN\\vhale', 'Temp-Passw0rd!', HOST);
  assert.equal(first.ok ? '' : first.reason, 'must-change');
  assert.throws(() => changeOwnPassword(w, 'vhale', 'Temp-Passw0rd!', 'short', HOST), /complexity/);
  changeOwnPassword(w, 'vhale', 'Temp-Passw0rd!', 'Victor-Hale-2026!', HOST);
  const second = signIn(w, 'vhale@meridianhealth.test', 'Victor-Hale-2026!', HOST);
  assert.equal(second.ok, true);
  assert.ok(w.audit.some((e) => e.eventId === 4624 && e.target === 'vhale'));
  assert.ok(w.audit.some((e) => e.eventId === 4723 && e.target === 'vhale'));
});

test('disabled and expired accounts are refused for the real reason, after the password is checked', () => {
  const w = createWorld(3);
  resetPassword(w, 'vhale', { mustChange: false, password: 'Temp-Passw0rd!' });
  setEnabled(w, 'vhale', false);
  const disabled = signIn(w, 'vhale', 'Temp-Passw0rd!', HOST);
  assert.equal(disabled.ok ? '' : disabled.reason, 'disabled');
  setEnabled(w, 'vhale', true);
  setExpiration(w, 'vhale', '2020-01-01T00:00:00.000Z');
  const expired = signIn(w, 'vhale', 'Temp-Passw0rd!', HOST);
  assert.equal(expired.ok ? '' : expired.reason, 'expired');
});

test('wrong passwords lock the account at the threshold and write 4771 and 4740', () => {
  const w = createWorld(3);
  resetPassword(w, 'vhale', { mustChange: false, password: 'Temp-Passw0rd!' });
  let last;
  for (let i = 0; i < LOCKOUT_THRESHOLD; i++) last = signIn(w, 'vhale', 'wrong', HOST);
  assert.equal(last && !last.ok ? last.reason : '', 'locked');
  const correct = signIn(w, 'vhale', 'Temp-Passw0rd!', HOST);
  assert.equal(correct.ok ? '' : correct.reason, 'locked', 'the right password does not help a locked account');
  assert.ok(w.audit.some((e) => e.eventId === 4740 && e.target === 'vhale' && /MHS-TEST-WKS01/.test(e.detail)));
  assert.equal(w.audit.filter((e) => e.eventId === 4771 && e.target === 'vhale').length, LOCKOUT_THRESHOLD);
});
