import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // GitHub Pages uses a sub-path; the frozen native WebView still consumes dist/index.html.
  base: process.env.CAPACITOR_BUILD === 'true' ? './' : '/Knowledge-Ball/',
  publicDir: process.env.CAPACITOR_BUILD === 'true' ? false : 'public',
  plugins: [
    {
      name: 'knowledge-ball-auth-ui',
      transformIndexHtml: {
        order: 'pre',
        handler() {
          return [
            { tag: 'script', attrs: { type: 'module', src: '/src/ui/AuthUi.ts' }, injectTo: 'body-prepend' },
            { tag: 'script', attrs: { type: 'module', src: '/src/ui/ExitUi.ts' }, injectTo: 'body-prepend' },
          ];
        },
      },
    },
  ],
  build: { outDir: 'dist', target: 'es2020' },
});
