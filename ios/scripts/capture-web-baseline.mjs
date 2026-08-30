import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

await mkdir('artifacts/ios', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 });
await page.goto(process.env.WEB_BASE_URL ?? 'http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.locator('#canvasHost canvas').waitFor({ state: 'visible' });
await page.screenshot({ path: 'artifacts/ios/web-baseline.png' });
await browser.close();
