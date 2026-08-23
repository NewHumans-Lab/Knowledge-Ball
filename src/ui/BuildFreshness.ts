const BUILD_META_NAME = 'knowledge-ball-build';
const REFRESH_PARAM = 'kb_build';

export function buildIdFromHtml(html: string): string | null {
  const match = html.match(/<meta\s+name=["']knowledge-ball-build["']\s+content=["']([^"']+)["']/i)
    ?? html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']knowledge-ball-build["']/i);
  return match?.[1] ?? null;
}

export function shouldRefreshBuild(currentBuild: string | null, latestBuild: string | null): boolean {
  return Boolean(currentBuild && latestBuild && currentBuild !== latestBuild);
}

function runningBuildId(): string | null {
  return document.querySelector(`meta[name="${BUILD_META_NAME}"]`)?.getAttribute('content') ?? null;
}

function latestIndexUrl(): URL {
  const base = document.baseURI || window.location.href;
  const url = new URL('index.html', base.endsWith('/') ? base : new URL('.', base).href);
  url.searchParams.set('kb_build_probe', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return url;
}

let checkInFlight = false;
let refreshStarted = false;

export async function ensureCurrentPagesBuild(): Promise<void> {
  if (checkInFlight || refreshStarted || !['http:', 'https:'].includes(window.location.protocol)) return;
  const currentBuild = runningBuildId();
  if (!currentBuild) return;

  checkInFlight = true;
  try {
    const response = await fetch(latestIndexUrl(), {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) return;
    const latestBuild = buildIdFromHtml(await response.text());
    if (!shouldRefreshBuild(currentBuild, latestBuild)) return;

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get(REFRESH_PARAM) === latestBuild) return;
    currentUrl.searchParams.set(REFRESH_PARAM, latestBuild!);
    refreshStarted = true;
    window.location.replace(currentUrl.toString());
  } catch {
    // Freshness checking must never make the application unavailable offline or
    // during a transient CDN/network failure. The next pageshow/foreground event retries.
  } finally {
    checkInFlight = false;
  }
}

function installBuildFreshnessGuard(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!['http:', 'https:'].includes(window.location.protocol)) return;

  void ensureCurrentPagesBuild();
  window.addEventListener('pageshow', () => { void ensureCurrentPagesBuild(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void ensureCurrentPagesBuild();
  });
}

installBuildFreshnessGuard();
