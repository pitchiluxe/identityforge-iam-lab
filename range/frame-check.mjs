// frame-check.mjs — can this website be shown inside another page?
//
// Browsers refuse to frame sites that send X-Frame-Options or a CSP
// frame-ancestors rule (google.com, microsoft.com and most sign-in pages).
// The web edition of Chrome asks this first, so it can frame the sites that
// allow it and show Chrome's own "refused to connect" page for the rest.
//
// This runs on a server, so it must never become a way to reach private
// networks (SSRF):
//   - every hostname is resolved, and the request is refused if ANY address
//     is loopback, private, link-local, unique-local, unspecified, multicast,
//     carrier-grade NAT, or an IPv4-mapped/translated form of those;
//   - the connection is pinned to the address that was checked, so DNS
//     cannot change between the check and the request (rebinding);
//   - redirects are not followed automatically: each hop is re-validated,
//     up to a small limit;
//   - only response headers are read, the body is discarded, and the caller
//     gets back a yes/no and nothing else (no status, no error text, no URL).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

const MAX_HOPS = 4;
const TIMEOUT_MS = 6000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

export function frameable(headers) {
  const get = (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k]) || '';
  const xfo = String(get('x-frame-options')).toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return false;
  const csp = String(get('content-security-policy')).toLowerCase();
  const fa = /frame-ancestors([^;]*)/.exec(csp);
  if (fa && !/(^|\s)\*(\s|$)/.test(fa[1])) return false;
  return true;
}

function v4ToInt(ip) {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

function inV4(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

/** Expand an IPv6 address to eight 16-bit groups. */
function v6Groups(ip) {
  // A dotted IPv4 tail (::ffff:127.0.0.1) becomes two hex groups first.
  const s = ip.toLowerCase().split('%')[0].replace(/(\d+\.\d+\.\d+\.\d+)$/, (m) => {
    const n = v4ToInt(m);
    return `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  });
  const [head, rest] = s.includes('::') ? s.split('::') : [s, null];
  const a = head ? head.split(':').filter(Boolean).map((x) => parseInt(x, 16)) : [];
  const b = rest ? rest.split(':').filter(Boolean).map((x) => parseInt(x, 16)) : [];
  const fill = 8 - a.length - b.length;
  const groups = rest === null ? a : [...a, ...Array(Math.max(0, fill)).fill(0), ...b];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** True when an address must never be contacted from the server. */
export function isBlockedAddress(ip) {
  const kind = isIP(ip);
  if (kind === 4) return V4_BLOCKED.some(([base, bits]) => inV4(ip, base, bits));
  if (kind !== 6) return true;
  const g = v6Groups(ip);
  if (!g) return true;
  const embeddedV4 = `${g[6] >>> 8}.${g[6] & 255}.${g[7] >>> 8}.${g[7] & 255}`;
  if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isBlockedAddress(embeddedV4); // IPv4-mapped / compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return isBlockedAddress(embeddedV4); // NAT64
  if (g[0] === 0x2002) return isBlockedAddress(`${g[1] >>> 8}.${g[1] & 255}.${g[2] >>> 8}.${g[2] & 255}`); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

/** Resolve a hostname and return one address to pin, or null if any address is not public. */
async function safeAddress(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return isBlockedAddress(host) ? null : { address: host, family: isIP(host) };
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes('.') || /\.(local|internal|localhost|test|invalid|example|home|lan|corp)$/i.test(host)) return null;
  let addrs;
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    return null;
  }
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) return null;
  return addrs[0];
}

/** One request to a validated, pinned address. Resolves with status and headers only. */
function headersOnly(url, pinned) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      // Pin the connection to the address that passed validation.
      lookup: (_host, opts, cb) => (opts && opts.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family)),
      timeout: TIMEOUT_MS,
    }, (res) => {
      resolve({ status: res.statusCode || 0, headers: res.headers, location: res.headers.location });
      res.destroy();
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Answer for a URL. Never returns anything about the fetched resource beyond
 * a boolean: { embeddable: true|false } or { unreachable: true }.
 */
export async function checkFrame(raw) {
  let url;
  try { url = new URL(raw); } catch { return { status: 400, body: { error: 'Invalid URL' } }; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return { status: 400, body: { error: 'Invalid URL' } };
  if (url.port && !['80', '443'].includes(url.port)) return { status: 400, body: { error: 'Invalid URL' } };
  if (!(await safeAddress(url.hostname))) return { status: 400, body: { error: 'Invalid URL' } };
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const pinned = await safeAddress(url.hostname);
      if (!pinned) return { status: 200, body: { unreachable: true } };
      const res = await headersOnly(url, pinned);
      if (res.status >= 300 && res.status < 400 && res.location) {
        const next = new URL(res.location, url);
        if (!/^https?:$/.test(next.protocol) || next.username || next.password || (next.port && !['80', '443'].includes(next.port))) return { status: 200, body: { unreachable: true } };
        url = next;
        continue;
      }
      return { status: 200, body: { embeddable: frameable(res.headers) } };
    }
    return { status: 200, body: { unreachable: true } };
  } catch {
    return { status: 200, body: { unreachable: true } };
  }
}
