import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { defineConfig, type HtmlTagDescriptor } from 'vite';
import packageJson from './package.json';

const buildCommit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const buildNumber = process.env.GITHUB_RUN_NUMBER ?? buildCommit.slice(0, 12);
const appVersion = packageJson.version;
const nativeBuild = process.env.CAPACITOR_BUILD === 'true';
const publicSiteUrl = 'https://rushow111.github.io/Knowledge-Ball/';
const siteDescription =
  'Knowledge Ball is a living knowledge network that organizes knowledge, reasoning, evidence, and relationships in an interactive 3D knowledge graph.';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD__: JSON.stringify(buildNumber),
    __APP_COMMIT__: JSON.stringify(buildCommit),
  },
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
          const scripts: HtmlTagDescriptor[] = [
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

          return scripts;
        },
      },
    },
    {
      name: 'knowledge-ball-release-manifest',
      async closeBundle() {
        if (nativeBuild) return;
        const apkName = `knowledge-ball-android-v${appVersion}.apk`;
        const apk = await readFile(`dist/downloads/${apkName}`);
        const manifest = {
          version: appVersion, build: buildNumber, commit: buildCommit,
          platforms: {
            web: { available: true, distribution: 'web', urls: { launch: publicSiteUrl }, checksum: null },
            android: { available: true, distribution: 'apk', urls: { download: `${publicSiteUrl}downloads/${apkName}` }, checksum: `sha256:${createHash('sha256').update(apk).digest('hex')}` },
            ios: { available: true, distribution: 'web-app', urls: { install: `${publicSiteUrl}ios-install.html` }, checksum: null },
            windows: { available: false, distribution: 'installer', urls: {}, checksum: null },
          },
        };
        await writeFile('dist/downloads/latest.json', `${JSON.stringify(manifest, null, 2)}\n`);
      },
    },
  ],
  build: { outDir: 'dist', target: 'es2020' },
});
