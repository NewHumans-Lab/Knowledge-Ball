import assert from 'node:assert/strict';
import { compactEnergy } from './AuthClient';

for (const [input, output] of [['0.000000','0'], ['-0.000001','0'], ['-0.999999','0'], ['1.999999','1'], ['-1.000000','-1']] as const) {
  assert.equal(compactEnergy(input), output, `${input} must display as ${output}`);
}
console.log('Account formatting regression checks passed');
