import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import * as home from '../src/core/azureHome.ts';
import { createCompanyWorld } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { ensureAzure } from '../src/world/azure.ts';

setClock(() => Date.parse('2026-10-30T12:00:00Z'));
test('Azure home: recent resources are real visits, deduplicated, bounded and current-tenant only', () => {
  const w = createCompanyWorld(profileById('kestrel')!); ensureAzure(w);
  const state: home.HomePreferences = { recent: [], favorites: [] };
  const items = home.homeResources(w);
  assert.equal(home.recentResources(w, state).length, 0);
  home.rememberResource(state, items[0]!.id);
  home.rememberResource(state, items[1]!.id);
  home.rememberResource(state, items[0]!.id);
  assert.equal(state.recent.length, 2);
  assert.equal(home.recentResources(w, state)[0]!.id, items[0]!.id);
  const other = createCompanyWorld(profileById('lumen')!); ensureAzure(other);
  assert.equal(home.recentResources(other, state).length, 0);
  for (let i = 0; i < 40; i++) home.rememberResource(state, `lab-${i}`);
  assert.equal(state.recent.length, 20);
});
test('Azure home: favorites toggle without changing the lab world and deleted resources disappear', () => {
  const w = createCompanyWorld(profileById('kestrel')!); ensureAzure(w);
  const before = JSON.stringify(w);
  const item = home.homeResources(w).find(i => i.kind === 'resource')!;
  const prefs: home.HomePreferences = { recent: [], favorites: [] };
  home.toggleFavorite(prefs, item.id);
  assert.equal(home.favoriteResources(w, prefs).length, 1);
  home.toggleFavorite(prefs, item.id);
  assert.equal(home.favoriteResources(w, prefs).length, 0);
  assert.equal(JSON.stringify(w), before);
  home.rememberResource(prefs, item.id); home.toggleFavorite(prefs, item.id);
  w.azure!.resources = w.azure!.resources.filter(r => r.id !== item.id);
  assert.equal(home.recentResources(w, prefs).length, 0);
  assert.equal(home.favoriteResources(w, prefs).length, 0);
});
