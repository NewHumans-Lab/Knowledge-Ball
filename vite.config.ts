import { defineConfig } from 'vite';

const buildCommit = process.env.GITHUB_SHA ?? 'local';
const nativeBuild = process.env.CAPACITOR_BUILD === 'true';
const publicSiteUrl = 'https://rushow111.github.io/Knowledge-Ball/';
const siteDescription =
  'Knowledge Ball is a living knowledge network that organizes knowledge, reasoning, evidence, and relationships in an interactive 3D knowledge graph.';

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

          if (!nativeBuild) {
            scripts.push(
              { tag: 'meta', attrs: { name: 'description', content: siteDescription }, injectTo: 'head' },
              {
                tag: 'meta',
                attrs: { name: 'robots', content: 'index, follow, max-image-preview:large' },
                injectTo: 'head',
              },
              { tag: 'link', attrs: { rel: 'canonical', href: publicSiteUrl }, injectTo: 'head' },
              { tag: 'meta', attrs: { property: 'og:type', content: 'website' }, injectTo: 'head' },
              { tag: 'meta', attrs: { property: 'og:site_name', content: 'Knowledge Ball' }, injectTo: 'head' },
              {
                tag: 'meta',
                attrs: { property: 'og:title', content: 'Knowledge Ball · Living Knowledge Field' },
                injectTo: 'head',
              },
              { tag: 'meta', attrs: { property: 'og:description', content: siteDescription }, injectTo: 'head' },
              { tag: 'meta', attrs: { property: 'og:url', content: publicSiteUrl }, injectTo: 'head' },
              { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' }, injectTo: 'head' },
              {
                tag: 'meta',
                attrs: { name: 'twitter:title', content: 'Knowledge Ball · Living Knowledge Field' },
                injectTo: 'head',
              },
              { tag: 'meta', attrs: { name: 'twitter:description', content: siteDescription }, injectTo: 'head' },
              {
                tag: 'script',
                attrs: { type: 'application/ld+json' },
                children: JSON.stringify({
                  '@context': 'https://schema.org',
                  '@type': 'WebSite',
                  name: 'Knowledge Ball',
                  url: publicSiteUrl,
                  description: siteDescription,
                }),
                injectTo: 'head',
              },
              {
                tag: 'noscript',
                children:
                  '<section aria-label="About Knowledge Ball" style="max-width:760px;margin:40px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.6"><h1>Knowledge Ball</h1><p>Knowledge Ball is a living knowledge network that organizes knowledge, reasoning, evidence, and relationships in an interactive 3D knowledge graph.</p><p>Enable JavaScript to explore the interactive knowledge field.</p></section>',
                injectTo: 'body-prepend',
              },
            );
          }

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
