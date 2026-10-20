// frame-check.mjs — can this website be shown inside another page?
//
// Browsers refuse to frame sites that send X-Frame-Options or a CSP
// frame-ancestors rule (google.com, microsoft.com and most sign-in pages).
// The web edition of Chrome asks this first, so it can frame the sites that
// allow it and show Chrome's own "refused to connect" page for the rest.
//
// Only response headers are read and only a yes/no is returned: this is not
// a proxy, and private or local addresses are refused.

const PRIVATE = /^(localhost|.*\.local|.*\.internal|.*\.test|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

export function frameable(headers) {
  const xfo = (headers.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return false;
  const csp = (headers.get('content-security-policy') || '').toLowerCase();
  const fa = /frame-ancestors([^;]*)/.exec(csp);
  if (fa && !/(^|\s)\*(\s|$)/.test(fa[1])) return false;
  return true;
}

export async function checkFrame(raw) {
  let url;
  try { url = new URL(raw); } catch { return { status: 400, body: { error: 'Not a URL' } }; }
  if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname)) return { status: 400, body: { error: 'Only public websites can be checked' } };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' } });
    const body = { embeddable: frameable(res.headers), finalUrl: res.url, status: res.status };
    ctl.abort();
    return { status: 200, body };
  } catch (e) {
    return { status: 200, body: { embeddable: false, error: String(e && e.name === 'AbortError' ? 'timeout' : e && e.message || e), unreachable: true } };
  } finally {
    clearTimeout(timer);
  }
}
