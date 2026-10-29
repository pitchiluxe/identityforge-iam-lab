import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { createCompanyWorld } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { deleteUser, setEnabled } from '../src/world/directory.ts';
import { workstationOf } from '../src/world/workstations.ts';
import { rdpFolders } from '../src/ui/rdpTargets.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

test('rdp: one folder per company, every person with their machine and account state', () => {
  const m = createWorld(3);
  const k = createCompanyWorld(profileById('kestrel')!);
  const people = k.ad.users.filter((u) => u.kind === 'user');
  setEnabled(k, people[0].sam, false);
  const gone = people[1];
  const goneMachine = workstationOf(k, gone.sam)!.name;
  deleteUser(k, gone.sam);

  const folders = rdpFolders([{ id: 'meridian', w: m }, { id: 'kestrel', w: k }]);
  assert.deepEqual(folders.map((f) => f.id), ['meridian', 'kestrel']);
  const kf = folders[1];
  assert.equal(kf.name, 'Kestrel Manufacturing');
  assert.equal(kf.domain, 'kestrelmfg.test');
  assert.equal(kf.people.length, people.length - 1);
  assert.deepEqual(kf.people.map((p) => p.displayName), [...kf.people.map((p) => p.displayName)].sort((a, b) => a.localeCompare(b)));
  const first = kf.people.find((p) => p.sam === people[0].sam)!;
  assert.equal(first.state, 'disabled');
  assert.equal(first.machine, workstationOf(k, people[0].sam)!.name);
  assert.ok(kf.reclaimed.includes(goneMachine));

  const mf = folders[0];
  assert.equal(mf.name, 'Meridian Health System');
  assert.ok(mf.people.some((p) => p.sam === 'vhale' && /^MHS-LT-\d+$/.test(p.machine)));
});

// ---------------------------------------------------------------- review fixes (stage 2)

test('rdp review: one row per machine, disabled machines hidden, as Meridian always listed them', () => {
  const m = createWorld(3);
  const lt = m.ad.computers.find((c) => c.primaryUser === 'vhale')!;
  m.ad.computers.push({ ...lt, name: 'MHS-LT-0099', ip: '10.10.40.99' });
  const off = m.ad.computers.find((c) => c.primaryUser === 'praman')!;
  off.enabled = false;
  const [mf] = rdpFolders([{ id: 'meridian', w: m }]);
  assert.deepEqual(mf.people.filter((p) => p.sam === 'vhale').map((p) => p.machine).sort(), [lt.name, 'MHS-LT-0099'].sort());
  assert.ok(!mf.people.some((p) => p.machine === off.name), 'disabled computer not offered');
});
