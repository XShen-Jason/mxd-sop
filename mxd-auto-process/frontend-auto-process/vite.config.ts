import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../backend-auto-process/internal/operatorapi/assets',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 6909,
    proxy: { '/api': 'http://127.0.0.1:26909' },
  },
});
