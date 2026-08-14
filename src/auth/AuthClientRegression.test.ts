import assert from 'node:assert/strict';
import { compactEnergy } from './AuthClient';
import { safeAvatarUrl } from './AuthProfilePresentation';

for (const [input, output] of [['0.000000','0'], ['-0.000001','0'], ['-0.999999','0'], ['1.999999','1'], ['-1.000000','-1']] as const) {
  assert.equal(compactEnergy(input), output, `${input} must display as ${output}`);
}
assert.equal(safeAvatarUrl('https://cdn.example/avatar.png'), 'https://cdn.example/avatar.png');
assert.equal(safeAvatarUrl('javascript:alert(1)'), null);
assert.equal(safeAvatarUrl('http://example.test/avatar.png'), null);
console.log('Account formatting regression checks passed');
