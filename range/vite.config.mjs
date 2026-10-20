import { defineConfig } from 'vite';
import { checkFrame } from './frame-check.mjs';

// Ollama is reached through this proxy so the page never needs OLLAMA_ORIGINS
// changed on the learner's computer. Only the local model is ever contacted.
const ollama = { '/ollama': { target: 'http://127.0.0.1:11434', changeOrigin: true, rewrite: (p) => p.replace(/^\/ollama/, '') } };

// /api/frame-check answers "can this website be framed?" for the in-app
// Chrome, the same as the Vercel function in ../api on the website.
const frameCheck = {
  name: 'frame-check',
  configureServer(server) { server.middlewares.use(handler); },
  configurePreviewServer(server) { server.middlewares.use(handler); },
};
async function handler(req, res, next) {
  if (!req.url?.startsWith('/api/frame-check')) return next();
  const { status, body } = await checkFrame(new URL(req.url, 'http://localhost').searchParams.get('url') || '');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default defineConfig({
  plugins: [frameCheck],
  server: { host: 'localhost', port: 5180, strictPort: true, allowedHosts: ['localhost'], proxy: ollama },
  preview: { host: 'localhost', port: 5180, strictPort: true, allowedHosts: ['localhost'], proxy: ollama },
  build: { target: 'es2022' },
});
