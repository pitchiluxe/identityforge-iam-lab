import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');

test('remote desktop: the session shows the IAM Range workstation, bundled with the app', () => {
  assert.ok(existsSync(new URL('public/remote-pc/index.html', root)), 'IAM Range build is vendored under public/remote-pc');
  const html = read('public/remote-pc/index.html');
  assert.match(html, /src="\.\/assets\//, 'relative asset paths, so it works under /remote-pc/ and the web edition base');
  const rdp = read('src/ui/apps/rdp.ts');
  assert.match(rdp, /import\.meta\.env\.BASE_URL\}remote-pc\/index\.html/, 'session frame uses the base URL');
});

test('remote desktop: the page CSP lets the app frame its own origin (app://range in the desktop edition)', () => {
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(read('index.html'))![1]!;
  assert.match(/frame-src ([^;]+)/.exec(csp)![1]!, /'self'/);
});
