import { defineConfig } from 'vite';

// Ollama is reached through this proxy so the page never needs OLLAMA_ORIGINS
// changed on the learner's computer. Only the local model is ever contacted.
const ollama = { '/ollama': { target: 'http://127.0.0.1:11434', changeOrigin: true, rewrite: (p) => p.replace(/^\/ollama/, '') } };

export default defineConfig({
  server: { host: 'localhost', port: 5180, strictPort: true, allowedHosts: ['localhost'], proxy: ollama },
  preview: { host: 'localhost', port: 5180, strictPort: true, allowedHosts: ['localhost'], proxy: ollama },
  build: { target: 'es2022' },
});
