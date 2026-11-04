import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    allowedHosts: ['127.0.0.1', 'localhost'],
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000',
      '/healthz': process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
