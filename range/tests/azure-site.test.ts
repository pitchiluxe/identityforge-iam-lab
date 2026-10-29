import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const browser = readFileSync(new URL('../src/ui/apps/browser.ts', import.meta.url), 'utf8');
const site = readFileSync(new URL('../src/ui/sites/azure.ts', import.meta.url), 'utf8');
const frame = readFileSync(new URL('../src/ui/sites/azure/frame.ts', import.meta.url), 'utf8');
const signin = readFileSync(new URL('../src/ui/sites/azure/signin.ts', import.meta.url), 'utf8');

test('azure site: added to the browser without removing any existing site or real-portal bookmark', () => {
  const sites = /export const SITES: Site\[\] = \[([^\]]+)\]/.exec(browser)![1]!.split(',').map((s) => s.trim());
  assert.deepEqual(sites, ['serviceDesk', 'peopleHub', 'webMail', 'entra', 'okta', 'iga', 'vault', 'saasAdmin', 'shiftwise', 'wiki', 'azurePortal', 'serviceNow']);
  assert.match(browser, /\['Azure portal', 'https:\/\/portal\.azure\.com'\]/, 'real Azure portal bookmark kept');
  assert.match(site, /host: 'portal\.azure\.range'/);
});

test('azure site: the simulation marker is on the portal frame and the sign-in page, and no Microsoft logo asset is used', () => {
  assert.match(frame, /never type a real Microsoft password here/);
  assert.match(site, /MARKER/);
  assert.match(signin, /az-login-marker/);
  for (const src of [site, frame, signin]) assert.doesNotMatch(src, /\.(svg|png|jpg)['"]/i);
});
