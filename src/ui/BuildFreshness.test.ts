import assert from 'node:assert/strict';
import { buildIdFromHtml, shouldRefreshBuild } from './BuildFreshness';

assert.equal(
  buildIdFromHtml('<head><meta name="knowledge-ball-build" content="abc123"></head>'),
  'abc123',
  'build identity parser must read the deployed commit marker',
);
assert.equal(
  buildIdFromHtml("<head><meta content='def456' name='knowledge-ball-build'></head>"),
  'def456',
  'build identity parser must tolerate attribute order',
);
assert.equal(buildIdFromHtml('<head></head>'), null, 'obsolete shells without a build marker must be detectable');
assert.equal(shouldRefreshBuild('abc', 'def'), true, 'a newer deployed identity must trigger self-healing refresh');
assert.equal(shouldRefreshBuild('abc', 'abc'), false, 'the current build must never reload itself');
assert.equal(shouldRefreshBuild(null, 'abc'), false, 'an unidentifiable current shell cannot safely enter a reload loop');
assert.equal(shouldRefreshBuild('abc', null), false, 'a failed remote identity probe must leave the current app usable');

console.log('Build freshness identity regression tests passed');
