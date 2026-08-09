import assert from 'node:assert/strict';
import { supportsSharedKnowledgeApi } from './HostingEnvironment';

assert.equal(supportsSharedKnowledgeApi('rushow111.github.io'), false);
assert.equal(supportsSharedKnowledgeApi('RUSHOW111.GITHUB.IO'), false);
assert.equal(supportsSharedKnowledgeApi('another-project.github.io'), false);
assert.equal(supportsSharedKnowledgeApi('localhost'), true);
assert.equal(supportsSharedKnowledgeApi('knowledge.example.com'), true);

console.log('Hosting environment regression tests passed');
