import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'public'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'src/index.html'),
        login: path.resolve(__dirname, 'src/login.html')
      }
    }
  }
});