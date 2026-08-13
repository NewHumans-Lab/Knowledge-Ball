import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // GitHub Pages uses a sub-path; the frozen native WebView still consumes dist/index.html.
  base: process.env.CAPACITOR_BUILD === 'true' ? './' : '/Knowledge-Ball/',
  publicDir: process.env.CAPACITOR_BUILD === 'true' ? false : 'public',
  build: { outDir: 'dist', target: 'es2020' },
});
