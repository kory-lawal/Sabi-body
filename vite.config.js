import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: 'localhost',
    port: 5176,
    strictPort: true,
    proxy: {
      // All FastAPI routes (auth cookies, account data, coaching audio). /api/src/ is
      // excluded: it holds frontend source (the shared phrase catalogue) served by Vite.
      '^/api/(?!src/)': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // The realtime socket (/api/ws) is proxied too during development.
        ws: true,
      },
    },
  },
});