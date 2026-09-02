import { whitePaperFilename, whitePaperUrl } from './WhitePaper';

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

assertEqual(whitePaperFilename('zh-CN'), 'Knowledge-Ball-White-Paper-ZH.pdf', 'Chinese must select the Chinese PDF');
assertEqual(whitePaperFilename('en'), 'Knowledge-Ball-White-Paper-EN.pdf', 'English must select the English PDF');
assertEqual(
  whitePaperUrl('zh-CN', false, 'https://example.test/Knowledge-Ball/'),
  'https://example.test/Knowledge-Ball/whitepapers/Knowledge-Ball-White-Paper-ZH.pdf',
  'Web must resolve the bundled Chinese PDF under the deployment base',
);
assertEqual(
  whitePaperUrl('en', true, 'capacitor://localhost/'),
  'https://newhumans-lab.github.io/Knowledge-Ball/whitepapers/Knowledge-Ball-White-Paper-EN.pdf',
  'Native clients must use the published English PDF',
);

console.log('White-paper locale and cross-platform URL regressions passed');
