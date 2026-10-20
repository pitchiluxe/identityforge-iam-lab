// Vercel function for the web edition's Chrome: /api/frame-check?url=...
// Returns only whether the site allows being framed. See range/frame-check.mjs.
import { checkFrame } from '../range/frame-check.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'https://local').searchParams.get('url') || '';
  const { status, body } = await checkFrame(url);
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(body));
}
