import { readFile } from 'node:fs/promises';

const siteUrl = 'https://rushow111.github.io/Knowledge-Ball/';
const sitemapUrl = `${siteUrl}sitemap.xml`;
const siteDescription =
  'Knowledge Ball is a living knowledge network that organizes knowledge, reasoning, evidence, and relationships in an interactive 3D knowledge graph.';

const [html, robots, sitemap] = await Promise.all([
  readFile('dist/index.html', 'utf8'),
  readFile('dist/robots.txt', 'utf8'),
  readFile('dist/sitemap.xml', 'utf8'),
]);

function assert(condition, message) {
  if (!condition) throw new Error(`SEO verification failed: ${message}`);
}

assert(/<meta\b[^>]*name=["']description["']/i.test(html), 'missing meta description');
assert(html.includes(siteDescription), 'homepage description does not match the canonical project description');
assert(/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*index[^"']*follow/i.test(html), 'robots meta must allow indexing and following');
assert(!/noindex/i.test(html), 'homepage unexpectedly contains noindex');
assert(html.includes(`rel="canonical" href="${siteUrl}"`) || html.includes(`href="${siteUrl}" rel="canonical"`), 'missing canonical homepage URL');
assert(html.includes('application/ld+json'), 'missing JSON-LD structured data');
assert(html.includes('"@type":"WebSite"'), 'JSON-LD must describe a WebSite');
assert(html.includes('<noscript>'), 'missing static no-JavaScript homepage description');
assert(html.includes('About Knowledge Ball'), 'static homepage introduction is missing');

assert(/^User-agent:\s*\*$/m.test(robots), 'robots.txt must target all crawlers');
assert(/^Allow:\s*\/$/m.test(robots), 'robots.txt must explicitly allow the site');
assert(robots.includes(`Sitemap: ${sitemapUrl}`), 'robots.txt must point at the production sitemap');
assert(!/^Disallow:\s*\/$/m.test(robots), 'robots.txt must not block the whole site');

assert(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'sitemap namespace is missing');
assert(sitemap.includes(`<loc>${siteUrl}</loc>`), 'sitemap must contain the canonical homepage');

console.log('SEO verification passed.');
