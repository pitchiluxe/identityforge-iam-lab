import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFrame, frameable, isBlockedAddress } from '../frame-check.mjs';

test('sites that forbid framing are recognised', () => {
  assert.equal(frameable(new Headers({ 'x-frame-options': 'SAMEORIGIN' })), false);
  assert.equal(frameable(new Headers({ 'x-frame-options': 'DENY' })), false);
  assert.equal(frameable(new Headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" })), false);
  assert.equal(frameable({ 'content-security-policy': 'frame-ancestors *' }), true);
  assert.equal(frameable(new Headers({})), true);
});

test('private, loopback, link-local and mapped addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fe80::1', 'fd00::1', 'fc00::abcd', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', 'ff02::1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '142.250.72.4', '2607:f8b0:4005:80b::200e', '::ffff:8.8.8.8']) assert.equal(isBlockedAddress(ip), false, ip);
});

test('local, private and odd forms of addresses are refused before any request', async () => {
  for (const url of ['http://localhost:5180', 'http://127.0.0.1', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://10.0.0.5', 'http://169.254.169.254/latest', 'http://intranet.corp/', 'https://user:pw@example.org/', 'https://example.org:8443/', 'file:///etc/passwd', 'not a url']) {
    const r = await checkFrame(url);
    assert.equal(r.status, 400, url);
    assert.deepEqual(Object.keys(r.body), ['error']);
  }
});
