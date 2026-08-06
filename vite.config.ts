import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/Knowledge-Ball/',
  build: {
    outDir: 'dist',
    target: 'es2020'
  }
});
