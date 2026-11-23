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
    rolldownOptions: {
      output: {
        // Without this, every shared lucide icon becomes its own ~0.3 kB request once pages are
        // lazy-loaded. Group vendors into two long-cacheable chunks instead.
        advancedChunks: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
  },
});
