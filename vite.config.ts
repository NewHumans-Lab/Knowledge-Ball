import { defineConfig } from 'vite';

const buildCommit = process.env.GITHUB_SHA ?? 'local';
const nativeBuild = process.env.CAPACITOR_BUILD === 'true';
const canonicalVisibilityButton = '<button class="btn" id="btnPersonal" data-visibility-mode="current" title="当前：只显示每个主题的当前知识；点击切换到个人">当前</button>';

export default defineConfig({
  root: '.',
  // GitHub Pages uses a sub-path; the frozen native WebView still consumes dist/index.html.
  base: nativeBuild ? './' : '/Knowledge-Ball/',
  publicDir: nativeBuild ? false : 'public',
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
          scripts.push({ tag: 'script', attrs: { type: 'module', src: '/src/ui/ExitUi.ts' }, injectTo: 'body-prepend' });
          return scripts;
        },
      },
    },
  ],
  build: { outDir: 'dist', target: 'es2020' },
});
