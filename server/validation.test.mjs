import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNodeBatch } from './validation.mjs';

function node(id, title, type, reasoning, premises = [], extra = {}) {
  return { id, title, type, reasoning, premises, status: 'pending', tags: [], domain: 'general', version: 1,
    createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z', ...extra };
}
const code = result => result?.code;

test('server accepts only a complete reasoning chain as one batch', () => {
  const existing = [node('logic', 'Implication symbol', 'logic-symbol', 'Classifies implication'), node('p1', 'Existing premise', 'fact', 'Existing premise description')];
  const reasoning = node('r1', 'Inference process', 'reasoning', 'Inference process description', ['p1'], { logicRuleId: 'logic' });
  const conclusion = node('c1', 'Derived conclusion', 'theorem', 'Derived conclusion description', ['r1']);
  assert.equal(validateNodeBatch(existing, [reasoning, conclusion]), null);
  assert.equal(code(validateNodeBatch(existing, [reasoning])), 'INCOMPLETE_THEORY_CHAIN');
  assert.equal(code(validateNodeBatch([...existing, reasoning], [conclusion])), 'INCOMPLETE_THEORY_CHAIN');
});

test('server returns stable errors for invalid theory structure', () => {
  const existing = [node('p1', 'Existing premise', 'fact', 'Existing premise description')];
  const incomplete = [node('r1', 'Inference process', 'reasoning', 'Inference process description', ['p1']), node('c1', 'Derived conclusion', 'theorem', 'Derived conclusion description', ['r1'])];
  assert.equal(code(validateNodeBatch(existing, incomplete)), 'LOGIC_RULE_REQUIRED');
  assert.equal(code(validateNodeBatch(existing, [node('c2', 'Direct conclusion', 'theorem', 'Direct description', ['p1'])])), 'INCOMPLETE_THEORY_CHAIN');
});

test('hidden historical nodes still reserve title and description', () => {
  const existing = [node('old', 'Reserved title', 'definition', 'Reserved description', [], { lifecycle: 'superseded' })];
  assert.equal(code(validateNodeBatch(existing, [node('new-title', 'Reserved title', 'definition', 'Fresh description')])), 'DUPLICATE_TITLE');
  assert.equal(code(validateNodeBatch(existing, [node('new-description', 'Fresh title', 'fact', 'Reserved description')])), 'DUPLICATE_CONTENT');
});

test('same-batch updates participate in uniqueness', () => {
  const existing = [node('a', 'A', 'fact', 'A text'), node('b', 'B', 'fact', 'B text')];
  assert.equal(code(validateNodeBatch(existing, [{ ...existing[0], title: 'Same', version: 2 }, { ...existing[1], title: 'Same', version: 2 }])), 'DUPLICATE_TITLE');
  assert.equal(code(validateNodeBatch(existing, [{ ...existing[0], reasoning: 'Same text', version: 2 }, { ...existing[1], reasoning: 'Same text', version: 2 }])), 'DUPLICATE_CONTENT');
});

test('cycle detection includes premises and logic rule', () => {
  const seed = [node('logic', 'Rule', 'logic-symbol', 'Rule text'), node('p', 'P', 'fact', 'P text')];
  const reasoning = node('r', 'R', 'reasoning', 'R text', ['p'], { logicRuleId: 'logic' });
  const conclusion = node('c', 'C', 'theorem', 'C text', ['r']);
  assert.equal(code(validateNodeBatch([...seed, reasoning, conclusion], [{ ...seed[0], premises: ['r'], version: 2 }])), 'DEPENDENCY_CYCLE');
});

test('public payload rejects personal mastery', () => {
  assert.equal(code(validateNodeBatch([], [node('a', 'A', 'fact', 'A text', [], { mastery: 'mastered' })])), 'PERSONAL_STATE_IN_PUBLIC_PAYLOAD');
});

test('public persistence rejects personal mastery state', () => {
  assert.equal(
    code(validateNodeBatch([], [node('public', 'Public node', 'fact', 'Public description', [], { mastery: 'mastered' })])),
    'PERSONAL_STATE_IN_PUBLIC_PAYLOAD',
  );
});

test('batch updates cannot converge two records onto the same normalized value', () => {
  const existing = [
    node('a', 'Node A', 'fact', 'Description A'),
    node('b', 'Node B', 'fact', 'Description B'),
  ];
  assert.equal(
    code(validateNodeBatch(existing, [
      { ...existing[0], title: 'Shared title', version: 2 },
      { ...existing[1], title: '  SHARED   TITLE  ', version: 2 },
    ])),
    'DUPLICATE_TITLE',
  );
  assert.equal(
    code(validateNodeBatch(existing, [
      { ...existing[0], reasoning: 'Shared description', version: 2 },
      { ...existing[1], reasoning: 'Ｓｈａｒｅｄ description', version: 2 },
    ])),
    'DUPLICATE_CONTENT',
  );
});
