import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: 6173, proxy: { '/api': 'http://127.0.0.1:26906', '/health': 'http://127.0.0.1:26906' } } });
