import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  envPrefix: ['VITE_'],
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
