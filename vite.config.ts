import { writeFile } from 'node:fs/promises';
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

function neutralizeDownloadHtml(html: string): string {
  return html
    .replace(
      /<div class="app-download-meta" data-i18n="downloads\.ios\.meta">[^<]*<\/div>/,
      '<div class="app-download-meta" id="iosDownloadMeta">正在读取发布状态…</div>',
    )
    .replace(
      /<a class="btn primary web-download-action" id="iosDownload"[^>]*>[^<]*<\/a>/,
      '<a class="btn web-download-action" id="iosDownload" aria-disabled="true">正在读取发布状态…</a>',
    )
    .replace(
      /<div class="app-download-meta" data-i18n="downloads\.android\.meta">[^<]*<\/div>/,
      '<div class="app-download-meta" id="androidDownloadMeta">正在读取发布状态…</div>',
    )
    .replace(
      /<a class="btn primary web-download-action" id="androidDownload"[^>]*>[^<]*<\/a>/,
      '<a class="btn web-download-action" id="androidDownload" aria-disabled="true" type="application/vnd.android.package-archive">正在读取发布状态…</a>',
    )
    .replace(
      /<div class="app-download-meta" data-i18n="downloads\.windows\.meta">[^<]*<\/div>/,
      '<div class="app-download-meta" id="windowsDownloadMeta">正在读取发布状态…</div>',
    )
    .replace(
      /<button class="btn" id="windowsDownload" type="button" disabled data-i18n="downloads\.unavailable">[^<]*<\/button>/,
      '<button class="btn" id="windowsDownload" type="button" disabled>正在读取发布状态…</button>',
    );
}

function currentArtifact(distribution: string, urls: Record<string, string>) {
  return {
    available: true,
    distribution,
    version: appVersion,
    build: buildNumber,
    commit: buildCommit,
    urls,
    checksum: null,
  };
}

function unavailableArtifact(distribution: string) {
  return {
    available: false,
    distribution,
    version: null,
    build: null,
    commit: null,
    urls: {},
    checksum: null,
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD__: JSON.stringify(buildNumber),
    __APP_COMMIT__: JSON.stringify(buildCommit),
  },
  root: '.',
  base: nativeBuild ? './' : '/Knowledge-Ball/',
  publicDir: nativeBuild ? false : 'public',
  plugins: [
    {
      name: 'knowledge-ball-runtime-shell',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          const scripts: HtmlTagDescriptor[] = [
            { tag: 'meta', attrs: { name: 'knowledge-ball-build', content: buildCommit }, injectTo: 'head-prepend' },
            { tag: 'script', attrs: { type: 'module', src: '/src/ui/BuildFreshness.ts' }, injectTo: 'body-prepend' },
            { tag: 'script', attrs: { type: 'module', src: '/src/ui/ReleaseDownloads.ts' }, injectTo: 'body-prepend' },
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

          return { html: neutralizeDownloadHtml(html), tags: scripts };
        },
      },
    },
    {
      name: 'knowledge-ball-release-manifest',
      async closeBundle() {
        if (nativeBuild) return;
        const manifest = {
          schema: 1 as const,
          version: appVersion,
          build: buildNumber,
          commit: buildCommit,
          platforms: {
            web: currentArtifact('web', { launch: publicSiteUrl }),
            android: unavailableArtifact('apk'),
            iosWeb: currentArtifact('web-app', { install: `${publicSiteUrl}ios-install.html` }),
            ios: unavailableArtifact('testflight'),
            windows: unavailableArtifact('installer'),
          },
        };
        await writeFile('dist/downloads/latest.json', `${JSON.stringify(manifest, null, 2)}\n`);
      },
    },
  ],
  build: { outDir: 'dist', target: 'es2020' },
});
