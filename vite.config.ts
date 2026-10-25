import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'src/renderer/index.html'),
        preview: path.resolve(__dirname, 'src/renderer/preview.html'),
      },
    },
  },
  server: {
    strictPort: true,
    port: 5173,
  },
});
