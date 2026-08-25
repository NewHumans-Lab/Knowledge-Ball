import { defineConfig } from 'vite';

const buildCommit = process.env.GITHUB_SHA ?? 'local';
const nativeBuild = process.env.CAPACITOR_BUILD === 'true';

export default defineConfig({
  root: '.',
  // GitHub Pages uses a sub-path; the frozen native WebView still consumes dist/index.html.
  base: nativeBuild ? './' : '/Knowledge-Ball/',
  publicDir: nativeBuild ? false : 'public',
  plugins: [
    {
      name: 'knowledge-ball-runtime-shell',
      transformIndexHtml: {
        order: 'pre',
        handler() {
          const scripts = [
            { tag: 'meta', attrs: { name: 'knowledge-ball-build', content: buildCommit }, injectTo: 'head-prepend' },
            { tag: 'script', attrs: { type: 'module', src: '/src/ui/BuildFreshness.ts' }, injectTo: 'body-prepend' },
          ];
          // Native shells are intentionally frozen on the legacy controller for this web-only cleanup.
          // Browser account state is now installed explicitly by app.ts instead of an injected DOM patch.
          if (nativeBuild) scripts.push({ tag: 'script', attrs: { type: 'module', src: '/src/ui/AuthUi.ts' }, injectTo: 'body-prepend' });
          return scripts;
        },
      },
    },
  ],
  build: { outDir: 'dist', target: 'es2020' },
});
