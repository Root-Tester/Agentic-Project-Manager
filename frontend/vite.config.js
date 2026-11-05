
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '..',

  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 3000,
    strictPort: true,

    allowedHosts: [
      'agentic-project-manager.onrender.com',
      'localhost',
      '127.0.0.1'
    ],

    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000',
        changeOrigin: true
      },

      '/healthz': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000',
        changeOrigin: true
      }
    }
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
