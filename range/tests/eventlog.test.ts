import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/seed.ts';
import { LOGS, buildEventLogs, idFilter } from '../src/world/eventlog.ts';
import { audit } from '../src/world/audit.ts';

test('every Windows log has events; Security mirrors the AD audit trail', () => {
  const w = createWorld(7);
  audit(w, { source: 'AD', action: 'Account locked out', target: 'jdoe', eventId: 4740, detail: 'Caller Computer Name: MHS-WKS042', time: w.created });
  audit(w, { source: 'AD', action: 'Kerberos pre-auth failed', target: 'jdoe', eventId: 4771, origin: '10.20.4.15', time: w.created });
  const now = Date.parse(w.created) + 3 * 86400000;
  const logs = buildEventLogs(w, { now });
  for (const l of LOGS) if (l !== 'Forwarded Events') assert.ok(logs[l].length > 0, `${l} has events`);
  assert.equal(logs['Forwarded Events'].length, 0);
  const sec = logs.Security;
  assert.equal(sec.length, w.audit.filter((e) => e.source === 'AD' && e.eventId).length);
  const lock = sec.find((e) => e.eventId === 4740)!;
  assert.match(lock.message, /Account That Was Locked Out/);
  assert.match(lock.details, /CallerComputerName MHS-WKS042/);
  assert.equal(sec.find((e) => e.eventId === 4771)!.level, 'Audit Failure');
  assert.ok(logs['Directory Service'].some((e) => e.eventId === 2889 && /Binding Type:\n0/.test(e.message)), 'unsigned LDAP bind by a service account');
  for (const l of LOGS) for (let i = 1; i < logs[l].length; i++) assert.ok(logs[l][i - 1]!.time >= logs[l][i]!.time, `${l} newest first`);
  assert.ok(Object.values(logs).flat().every((e) => Date.parse(e.time) <= now), 'nothing from the future');
});

test('Defender events come from Windows Security; clearing a log is itself logged', () => {
  const w = createWorld(3);
  const t0 = Date.parse(w.created) + 3600000;
  const at = (m: number): string => new Date(t0 + m * 60000).toISOString();
  const logs = buildEventLogs(w, {
    now: t0 + 86400000,
    defender: { lastScan: { time: at(1), scope: 'Quick scan', files: 40, threats: 1 }, history: [{ time: at(2), name: 'HackTool:Win32/Mimikatz', path: 'C:\\x\\m.ps1', severity: 'Severe', action: 'Quarantined' }] },
    clears: [{ log: 'Security', time: at(5), by: 'adm-admin' }, { log: 'Application', time: at(6), by: 'adm-admin' }],
  });
  const def = logs['Microsoft-Windows-Windows Defender/Operational'].map((e) => e.eventId);
  for (const id of [1000, 1001, 1116, 1117]) assert.ok(def.includes(id), `Defender ${id}`);
  const sec = logs.Security;
  assert.ok(sec.every((e) => Date.parse(e.time) >= Date.parse(at(5))), 'cleared events are gone');
  assert.equal(sec.find((e) => e.eventId === 1102)?.user, `${w.ad.netbios}\\adm-admin`);
  assert.ok(logs.System.some((e) => e.eventId === 104 && /Application log file was cleared/.test(e.message)));
});

test('Event ID filter: lists, ranges and exclusions', () => {
  const f = idFilter('4720-4729, 4740, -4724')!;
  assert.deepEqual([4720, 4724, 4728, 4740, 4625].map(f), [true, false, true, true, false]);
  assert.deepEqual([4624, 4625].map(idFilter('-4624')!), [false, true]);
  assert.equal(idFilter('  '), null);
});
