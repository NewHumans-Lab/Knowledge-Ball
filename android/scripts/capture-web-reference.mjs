import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173'], { stdio: 'inherit' });
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  await page.locator('#canvasHost canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'artifacts/android-web-reference.png' });
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
