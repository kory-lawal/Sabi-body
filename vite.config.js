import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: 'localhost',
    port: 5176,
    strictPort: true,
    proxy: {
      '/api/coach': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});