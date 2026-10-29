import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MSP_COMPANIES, profileById, profileProblems } from '../src/world/profiles.ts';

const EXPECTED: [string, string, string][] = [
  ['harborline', 'harborline.test', 'greenfield'],
  ['brightwater', 'brightwaterlaw.test', 'clean'],
  ['kestrel', 'kestrelmfg.test', 'messy'],
  ['aldervalley', 'aldervalley.test', 'churn'],
  ['summitridge', 'summitridgecu.test', 'regulated'],
  ['pinecrest', 'pinecrestretail.test', 'frontline'],
  ['lumen', 'lumenbio.test', 'research'],
  ['cobalt', 'cobaltsoft.test', 'cloud-first'],
  ['riverside', 'riversidecounty.test', 'government'],
  ['atlas', 'atlasenergy.test', 'merger'],
];

test('profiles: ten companies with the ids, domains and realities the design names', () => {
  assert.equal(MSP_COMPANIES.length, 10);
  assert.deepEqual(MSP_COMPANIES.map((p) => [p.id, p.domain, p.reality]), EXPECTED);
});

test('profiles: identities are unique and never Meridian', () => {
  for (const key of ['id', 'domain', 'netbios', 'prefix', 'tenant'] as const) {
    assert.equal(new Set(MSP_COMPANIES.map((p) => p[key])).size, 10, key);
  }
  assert.ok(MSP_COMPANIES.every((p) => p.domain !== 'meridianhealth.test'));
  assert.ok(MSP_COMPANIES.every((p) => p.domain.endsWith('.test') && p.tenant.endsWith('.onmicrosoft.test')));
});

test('profiles: every profile is internally consistent', () => {
  for (const p of MSP_COMPANIES) assert.deepEqual(profileProblems(p), [], p.id);
});

test('profiles: profileProblems catches broken profiles', () => {
  const p = profileById('brightwater')!;
  const role = p.roles[0].roleGroup;
  assert.ok(profileProblems({ ...p, roleAccess: { ...p.roleAccess, [role]: ['no-such-group'] } }).length > 0);
  assert.ok(profileProblems({ ...p, netbios: 'BRIGHTWATERLAWLLP' }).length > 0);
});

test('profiles: headcounts match each starting reality', () => {
  assert.equal(profileById('harborline')!.staff, 0);
  assert.ok(profileById('cobalt')!.staff <= 10);
  assert.ok(profileById('kestrel')!.staff >= 100);
  assert.equal(profileById('nope'), undefined);
});
