import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PRODUCT } from '../src/product.ts';

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the installer, the window and the updater carry the product name and repository', () => {
  const pkg = JSON.parse(read('../package.json')) as { productName: string; build: { productName: string; publish: { owner: string; repo: string }[] } };
  assert.equal(pkg.productName, PRODUCT.name);
  assert.equal(pkg.build.productName, PRODUCT.name);
  const [owner, repo] = PRODUCT.repo.split('/');
  assert.deepEqual([pkg.build.publish[0]!.owner, pkg.build.publish[0]!.repo], [owner, repo], 'installed copies update from this repository');
  const main = read('../electron/main.cjs');
  assert.ok(main.includes(`const PRODUCT_NAME = '${PRODUCT.name}';`));
  assert.ok(main.includes(`const WINDOW_TITLE = '${PRODUCT.windowTitle}';`));
  assert.match(read('../index.html'), new RegExp(`<title>${PRODUCT.name}</title>`));
});

test('the landing page downloads from the same releases the app updates from', { skip: !existsSync(new URL('../../site/index.html', import.meta.url)) }, () => {
  const site = read('../../site/index.html') + read('../../site/main.js');
  assert.ok(site.includes(`github.com/${PRODUCT.repo}/releases`), 'download links point at the release feed');
  assert.ok(site.includes(PRODUCT.name));
});

test('the website carries the web edition of the lab under /lab/', { skip: !existsSync(new URL('../../site/lab/index.html', import.meta.url)) }, () => {
  const lab = read('../../site/lab/index.html');
  assert.match(lab, /src="\/lab\/assets\/[^"]+\.js"/, 'built with --base=/lab/ (npm run build:web)');
  assert.ok(read('../../site/index.html').includes('href="/lab/"'), 'the landing page links to it');
});
