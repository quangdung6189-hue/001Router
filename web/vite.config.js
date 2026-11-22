import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:20128',
        changeOrigin: true,
      },
      '/v1': {
        target: 'http://localhost:20128',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:20128',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
