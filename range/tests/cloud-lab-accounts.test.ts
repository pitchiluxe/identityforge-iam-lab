import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { createCloudUser } from '../src/world/entraAdmin.ts';
import { createLabAccount } from '../src/world/portalAccounts.ts';
import { cloudLabAccounts } from '../src/world/labaccounts.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

test('lab accounts: cloud-only Azure portal accounts are listed with their passwords; the MSP admin points to the sign-in password', () => {
  const w = createCompanyWorld(profileById('kestrel')!);
  const me = `${MSP_ADMIN}@${w.entra.primaryDomain}`;
  createCloudUser(w, me, { displayName: 'Kiosk Line 3', mailNickname: 'kiosk.line3', password: 'Kiosk-Passw0rd!', forceChange: false });
  createLabAccount(w, { displayName: 'Lab Learner', nickname: 'lab.learner', password: 'Lab-Learner-2026!' });
  const rows = cloudLabAccounts(w);
  const kiosk = rows.find((r) => r.upn === 'kiosk.line3@kestrelmfg.onmicrosoft.test')!;
  assert.equal(kiosk.password, 'Kiosk-Passw0rd!');
  assert.equal(rows.find((r) => r.upn === 'lab.learner@kestrelmfg.onmicrosoft.test')!.password, 'Lab-Learner-2026!');
  const msp = rows.find((r) => r.upn === me)!;
  assert.equal(msp.password, null);
  assert.match(msp.note, /workstation sign-in password/);
  assert.ok(!rows.some((r) => r.upn.startsWith('bg-emergency')), 'break-glass is not a lab login');
});
