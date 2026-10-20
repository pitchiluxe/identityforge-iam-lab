import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFrame, frameable } from '../frame-check.mjs';

test('sites that forbid framing are recognised', () => {
  assert.equal(frameable(new Headers({ 'x-frame-options': 'SAMEORIGIN' })), false);
  assert.equal(frameable(new Headers({ 'x-frame-options': 'DENY' })), false);
  assert.equal(frameable(new Headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" })), false);
  assert.equal(frameable(new Headers({ 'content-security-policy': 'frame-ancestors *' })), true);
  assert.equal(frameable(new Headers({})), true);
});

test('local and private addresses are never fetched', async () => {
  for (const url of ['http://localhost:5180', 'http://127.0.0.1', 'http://10.0.0.5', 'http://192.168.1.1', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'not a url']) {
    assert.equal((await checkFrame(url)).status, 400, url);
  }
});
