import { chooseBackAction } from './MobileShell';

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

assertEqual(chooseBackAction(true, true), 'close-overlay');
assertEqual(chooseBackAction(false, true), 'close-panel');
assertEqual(chooseBackAction(false, false), 'exit');
console.log('Mobile shell regression tests passed.');
