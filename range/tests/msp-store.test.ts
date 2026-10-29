import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { createUser } from '../src/world/directory.ts';
import { findEntraUser } from '../src/world/cloud.ts';
import {
  allDomains, bindMeridian, companyWorld, exportHrFeeds, materialisedWorlds, persistCompanies, resetCompanyCache, syncDue, worldByDomain,
} from '../src/ui/companies.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

/** A Map-backed localStorage, with a switch to make writes fail like a full or blocked store. */
const mem = new Map<string, string>();
let failWrites = false;
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { if (failWrites) throw new Error('QuotaExceededError'); mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
};

const meridian = createWorld(11);
bindMeridian(() => meridian);

beforeEach(() => { mem.clear(); failWrites = false; resetCompanyCache(); });

test('store: domains resolve by DNS name or NetBIOS name, Meridian included', () => {
  assert.equal(worldByDomain('BRIGHTWATERLAW.test')?.profileId, 'brightwater');
  assert.equal(worldByDomain('brightwater')?.profileId, 'brightwater');
  assert.equal(worldByDomain('meridianhealth.test'), meridian);
  assert.equal(worldByDomain('MERIDIAN'), meridian);
  assert.equal(worldByDomain('nope.test'), undefined);
  assert.equal(allDomains().length, 11);
  assert.equal(allDomains()[0].domain, 'meridianhealth.test');
});

test('store: a company world is created once and kept', () => {
  assert.equal(companyWorld('kestrel'), companyWorld('kestrel'));
});

test('store: only touched companies are saved, and saved changes come back', () => {
  const k = companyWorld('kestrel');
  createUser(k, { sam: 'zz.test', givenName: 'Zz', surname: 'Test', ou: 'Kestrel/Staging' });
  persistCompanies();
  assert.deepEqual([...mem.keys()].filter((x) => x.startsWith('identityforge-range-company-')), ['identityforge-range-company-kestrel']);
  resetCompanyCache();
  assert.ok(companyWorld('kestrel').ad.users.some((u) => u.sam === 'zz.test'));
});

test('store: a full or blocked localStorage does not lose the change in memory', () => {
  const b = companyWorld('brightwater');
  createUser(b, { sam: 'keepme', givenName: 'Keep', surname: 'Me', ou: 'Firm/Staging' });
  failWrites = true;
  assert.doesNotThrow(() => persistCompanies());
  assert.ok(companyWorld('brightwater').ad.users.some((u) => u.sam === 'keepme'));
});

test('store: an old save with only Meridian still offers all ten companies', () => {
  mem.set('identityforge-range-world', JSON.stringify(meridian));
  assert.equal(allDomains().length, 11);
  assert.equal(companyWorld('atlas').profileId, 'atlas');
});

test('store: background sync runs in companies that are not on screen', () => {
  const b = companyWorld('brightwater');
  const u = createUser(b, { sam: 'newjoin', givenName: 'New', surname: 'Join', ou: 'Firm/Users/Associates', enabled: true, passwordSet: true });
  assert.equal(findEntraUser(b, u.upn), undefined);
  assert.ok(materialisedWorlds().includes(b));
  const changed = syncDue([meridian, ...materialisedWorlds()], Date.parse(b.entra.lastSync) + 31 * 60_000);
  assert.ok(changed.includes(b));
  assert.ok(findEntraUser(b, u.upn), 'synced on the scheduler tick');
});

test('store: HR feeds are exported to the workstation, one CSV per company', () => {
  exportHrFeeds(meridian);
  const feeds = meridian.files.filter((f) => /^C:\\MSP\\.+\\hr-feed\.csv$/.test(f.path));
  assert.equal(feeds.length, 10);
  const k = feeds.find((f) => f.path.includes('Kestrel Manufacturing'))!;
  const lines = k.content.trim().split('\n');
  assert.equal(lines[0], 'EmployeeId,FirstName,LastName,Department,Title,Manager,Location,StartDate,EndDate,Status');
  assert.equal(lines.length - 1, companyWorld('kestrel').hr.workers.length);
  exportHrFeeds(meridian);
  assert.equal(meridian.files.filter((f) => /^C:\\MSP\\/.test(f.path)).length, 10, 're-export replaces, never duplicates');
});

// ---------------------------------------------------------------- review fixes (MSP stage 1)
test('review: exporting HR feeds does not open every company', () => {
  exportHrFeeds(meridian);
  assert.equal(materialisedWorlds().length, 0);
});

test('review: company saves stop at their budget so Meridian always has room', () => {
  const k = companyWorld('kestrel');
  const a = companyWorld('atlas');
  createUser(k, { sam: 'b1', givenName: 'B', surname: 'One', ou: 'Kestrel/Staging' });
  createUser(a, { sam: 'b2', givenName: 'B', surname: 'Two', ou: 'Atlas/Staging' });
  const saved = persistCompanies(300_000);
  assert.ok([...mem.keys()].filter((x) => x.startsWith('identityforge-range-company-')).reduce((n, x) => n + mem.get(x)!.length, 0) <= 300_000);
  assert.ok(saved.skipped.length >= 1, 'over-budget company reported, not silently dropped');
});

// ---------------------------------------------------------------- stage 2: saves from before workstations
test('store: a company saved before workstations existed gets them when it loads', () => {
  const k = companyWorld('kestrel');
  const people = k.ad.users.filter((u) => u.kind === 'user').length;
  k.ad.computers = k.ad.computers.filter((c) => !/-WKS-/.test(c.name));
  createUser(k, { sam: 'force.save', givenName: 'Force', surname: 'Save', ou: 'Kestrel/Staging', kind: 'service' });
  persistCompanies();
  resetCompanyCache();
  const again = companyWorld('kestrel');
  assert.equal(again.ad.computers.filter((c) => /-WKS-/.test(c.name)).length, people);
});

// ---------------------------------------------------------------- stage 2 review: looking is not opening
import { peekCompany } from '../src/ui/companies.ts';

test('store: peeking at a company (Remote Desktop list) does not open it; opening reuses the same world', () => {
  const p = peekCompany('kestrel');
  assert.equal(materialisedWorlds().length, 0);
  assert.equal(companyWorld('kestrel'), p);
  assert.equal(peekCompany('kestrel'), p);
});
