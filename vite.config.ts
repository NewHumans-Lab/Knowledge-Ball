import { defineConfig } from 'vite';

const buildCommit = process.env.GITHUB_SHA ?? 'local';
const canonicalVisibilityButton = '<button class="btn" id="btnPersonal" data-visibility-mode="current" title="当前：只显示每个主题的当前知识；点击切换到个人">当前</button>';

export default defineConfig({
  root: '.',
  // GitHub Pages uses a sub-path; the frozen native WebView still consumes dist/index.html.
  base: process.env.CAPACITOR_BUILD === 'true' ? './' : '/Knowledge-Ball/',
  publicDir: process.env.CAPACITOR_BUILD === 'true' ? false : 'public',
  plugins: [
    {
      name: 'knowledge-ball-canonical-visibility-shell',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          const normalized = html.replace(
            /<button\s+class="btn"\s+id="btnPersonal"[^>]*>[^<]*<\/button>/,
            canonicalVisibilityButton,
          );
          if (normalized === html) {
            throw new Error('Cannot locate #btnPersonal while canonicalizing the built visibility shell');
          }
          return normalized;
        },
      },
    },
    {
      name: 'knowledge-ball-auth-ui',
      transformIndexHtml: {
        order: 'pre',
        handler() {
          return [
            { tag: 'meta', attrs: { name: 'knowledge-ball-build', content: buildCommit }, injectTo: 'head-prepend' },
            { tag: 'script', attrs: { type: 'module', src: '/src/ui/BuildFreshness.ts' }, injectTo: 'body-prepend' },
            { tag: 'script', attrs: { type: 'module', src: '/src/ui/AuthUi.ts' }, injectTo: 'body-prepend' },
            { tag: 'script', attrs: { type: 'module', src: '/src/ui/ExitUi.ts' }, injectTo: 'body-prepend' },
          ];
        },
      },
    },
  ],
  build: { outDir: 'dist', target: 'es2020' },
});
