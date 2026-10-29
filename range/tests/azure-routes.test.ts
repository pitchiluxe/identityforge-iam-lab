import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { ensureAzure } from '../src/world/azure.ts';
import { ALL_SERVICES, parseRoute, portalSearch, routePath } from '../src/ui/sites/azure/routes.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

test('routes: every portal path parses and round-trips', () => {
  const id = '/subscriptions/abc/resourceGroups/rg-x/providers/Microsoft.Web/sites/app-x';
  const cases: [string, ReturnType<typeof parseRoute>][] = [
    ['/', { k: 'home' }],
    ['/signin', { k: 'signin' }],
    ['/signup', { k: 'signup' }],
    ['/allservices', { k: 'allservices' }],
    ['/entra', { k: 'entra', page: 'overview' }],
    ['/entra/users/new', { k: 'entra', page: 'users-new' }],
    ['/entra/users/a.b%40x.test', { k: 'entraUser', upn: 'a.b@x.test', tab: 'overview' }],
    ['/entra/users/a.b%40x.test/licenses', { k: 'entraUser', upn: 'a.b@x.test', tab: 'licenses' }],
    ['/entra/groups/Kiosk%20Users', { k: 'entraGroup', name: 'Kiosk Users' }],
    ['/entra/roles/User%20Administrator', { k: 'entraRole', role: 'User Administrator' }],
    ['/subscriptions/abc/iam', { k: 'subscription', id: 'abc', blade: 'iam' }],
    ['/resourcegroups/abc/rg-x', { k: 'resourcegroup', sub: 'abc', rg: 'rg-x', blade: 'overview' }],
    [`/resource/${encodeURIComponent(id)}/iam`, { k: 'resource', id, blade: 'iam' }],
    ['/resources/type/Microsoft.Web%2Fsites', { k: 'resources', type: 'Microsoft.Web/sites' }],
    ['/create/Microsoft.Web%2Fsites', { k: 'create', type: 'Microsoft.Web/sites' }],
    ['/service/Azure%20Monitor', { k: 'service', name: 'Azure Monitor' }],
    ['/entra/apps', { k: 'entra', page: 'apps' }],
    ['/entra/apps/abc-123', { k: 'appReg', appId: 'abc-123' }],
    ['/entra/enterprise', { k: 'entra', page: 'enterprise' }],
    ['/entra/enterprise/ent-abc', { k: 'entApp', id: 'ent-abc' }],
    ['/nope/nope', { k: 'notfound' }],
  ];
  for (const [path, route] of cases) {
    assert.deepEqual(parseRoute(path), route, path);
    if (route.k !== 'notfound' && path !== '/') assert.equal(routePath(route), path, `round trip ${path}`);
  }
});

test('routes: global search finds users, groups, resources and services in the current tenant', () => {
  const w = createCompanyWorld(profileById('pinecrest')!);
  ensureAzure(w);
  const someone = w.entra.users.find((e) => e.source === 'synced')!;
  const hits = portalSearch(w, someone.displayName.split(' ')[1]!);
  assert.ok(hits.some((h) => h.kind === 'User' && h.path === `/entra/users/${encodeURIComponent(someone.upn)}`));
  assert.ok(portalSearch(w, 'vnet').some((h) => h.kind === 'Resource'));
  assert.ok(portalSearch(w, 'monitor').some((h) => h.kind === 'Service' && h.path === '/service/Azure%20Monitor'));
  assert.ok(portalSearch(w, 'users').some((h) => h.label === 'Users' && h.path === '/entra/users'));
  assert.deepEqual(portalSearch(w, 'x'), [], 'needs two characters');
  assert.ok(ALL_SERVICES.length >= 30);
});
