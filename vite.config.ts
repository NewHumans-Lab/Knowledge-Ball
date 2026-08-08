import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // GitHub Pages uses a sub-path; the native WebView loads dist/index.html.
  base: process.env.CAPACITOR_BUILD === 'true' ? './' : '/Knowledge-Ball/',
  // Do not nest the downloadable APK inside the Android APK during Capacitor sync.
  publicDir: process.env.CAPACITOR_BUILD === 'true' ? false : 'public',
  build: {
    outDir: 'dist',
    target: 'es2020'
  }
});
