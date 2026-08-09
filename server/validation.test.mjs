import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNodeBatch } from './validation.mjs';

function node(id, title, type, reasoning, premises = [], extra = {}) {
  return {
    id,
    title,
    type,
    reasoning,
    premises,
    status: 'pending',
    mastery: 'none',
    tags: [],
    domain: 'general',
    version: 1,
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    hidden: false,
    ...extra,
  };
}

test('server accepts a complete reasoning chain as one batch', () => {
  const existing = [
    node('logic', 'Implication symbol', 'logic-symbol', 'Classifies implication'),
    node('p1', 'Existing premise', 'fact', 'Existing premise description'),
  ];
  const incoming = [
    node('r1', 'Inference process', 'reasoning', 'Inference process description', ['p1'], { logicRuleId: 'logic' }),
    node('c1', 'Derived conclusion', 'theorem', 'Derived conclusion description', ['r1']),
  ];
  assert.equal(validateNodeBatch(existing, incoming), null);
});

test('server rejects partial theory batches and invalid logic classification', () => {
  const existing = [node('p1', 'Existing premise', 'fact', 'Existing premise description')];
  const incomplete = [
    node('r1', 'Inference process', 'reasoning', 'Inference process description', ['p1']),
    node('c1', 'Derived conclusion', 'theorem', 'Derived conclusion description', ['r1']),
  ];
  assert.match(validateNodeBatch(existing, incomplete), /Invalid logic symbol/);
  assert.match(
    validateNodeBatch(existing, [node('c2', 'Direct conclusion', 'theorem', 'Direct description', ['p1'])]),
    /Derived conclusion must depend on one reasoning node/,
  );
});

test('hidden historical nodes still reserve title and description', () => {
  const existing = [
    node('old', 'Reserved title', 'definition', 'Reserved description', [], { hidden: true, status: 'suspended' }),
  ];
  assert.match(
    validateNodeBatch(existing, [node('new-title', 'Reserved title', 'definition', 'Fresh description')]),
    /Duplicate node title/,
  );
  assert.match(
    validateNodeBatch(existing, [node('new-description', 'Fresh title', 'fact', 'Reserved description')]),
    /Duplicate node description/,
  );
});

test('server accepts atomic merge persistence and checks successor references', () => {
  const existing = [
    node('a', 'Definition A', 'definition', 'Definition wording A'),
    node('b', 'Definition B', 'definition', 'Definition wording B'),
  ];
  const merged = node('merged', 'Canonical definition', 'definition', 'Canonical definition wording', [], {
    aliases: ['Definition A', 'Definition B'],
    semanticKey: 'definition:canonical',
  });
  const incoming = [
    { ...existing[0], hidden: true, status: 'suspended', supersededBy: 'merged', version: 2 },
    { ...existing[1], hidden: true, status: 'suspended', supersededBy: 'merged', version: 2 },
    merged,
  ];
  assert.equal(validateNodeBatch(existing, incoming), null);
  assert.match(
    validateNodeBatch(existing, [{ ...incoming[0], supersededBy: 'missing' }]),
    /Missing successor/,
  );
});

test('server rejects edits that create duplicates or cycles', () => {
  const existing = [
    node('a', 'Node A', 'fact', 'Description A'),
    node('b', 'Node B', 'fact', 'Description B'),
  ];
  assert.match(
    validateNodeBatch(existing, [{ ...existing[1], title: 'Node A', version: 2 }]),
    /Duplicate node title/,
  );
  const cyclic = [
    { ...existing[0], premises: ['b'], version: 2 },
    { ...existing[1], premises: ['a'], version: 2 },
  ];
  assert.match(validateNodeBatch(existing, cyclic), /Dependency cycle/);
});
