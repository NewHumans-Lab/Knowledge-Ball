from pathlib import Path
import re

# 1) Protocol: keep the public pure API, but expose a validated in-place mutation
# core so projections do not need a full graph clone/rebuild round trip.
p = Path('src/protocol/KnowledgeEditingProtocol.ts')
s = p.read_text()
marker = '/**\n * Apply exactly one validated edit. No source node is deleted: replaced or negated\n * nodes remain queryable, default-hidden, and still block duplicate submissions.\n */\nexport function applyKnowledgeEdit(nodes: ProtocolNode[], edit: KnowledgeEdit): KnowledgeEditResult {'
start = s.find(marker)
if start < 0:
    raise SystemExit('KnowledgeEditingProtocol applyKnowledgeEdit marker missing')
replacement = r'''/**
 * Mutate one already-validated protocol graph in place. Existing node objects keep
 * their identity; newly-created nodes are appended to the supplied array. This is
 * the single mutation implementation shared by the pure protocol API and live
 * projections.
 */
function mutateKnowledgeEditInPlace(nodes: ProtocolNode[], edit: KnowledgeEdit): void {
  const byId = indexNodes(nodes);
  const append = (node: ProtocolNode) => {
    nodes.push(node);
    byId.set(node.id, node);
  };

  if (edit.kind === 'add') {
    if (edit.mode === 'atomic') {
      append(nodeFromDraft(edit.node, []));
    } else if (edit.mode === 'theory') {
      append(nodeFromDraft(edit.reasoning, edit.requiredPremiseIds));
      append(nodeFromDraft(edit.conclusion, [edit.reasoning.id]));
    } else {
      append(nodeFromDraft(edit.reasoning, edit.requiredPremiseIds));
      for (const conclusionId of edit.conclusionIds) {
        const conclusion = byId.get(conclusionId)!;
        conclusion.premises = unique([...conclusion.premises, edit.reasoning.id]);
      }
    }
  }

  if (edit.kind === 'negate') {
    const target = byId.get(edit.targetId)!;
    target.status = 'falsified';
    target.hidden = true;
    target.negatedBy = unique([...(target.negatedBy ?? []), ...edit.counterexampleIds]);

    if (edit.target === 'reasoning') {
      const corrected = nodeFromDraft(edit.correctedReasoning!, target.premises);
      append(corrected);
      target.supersededBy = corrected.id;
      for (const node of nodes) {
        if (node.hidden || node.supersededBy) continue;
        node.premises = node.premises.map(id => id === target.id ? corrected.id : id);
      }
    } else {
      suspendDownstream(nodes, target.id);
    }
    restoreClaimsWhoseOppositionWasNegated(nodes, target.id);
  }

  if (edit.kind === 'decompose') {
    const original = byId.get(edit.chain.reasoningId)!;
    const conclusion = byId.get(edit.chain.conclusionId)!;
    let premises = edit.chain.premiseIds;

    edit.reasoningSteps.forEach((step, index) => {
      append(nodeFromDraft(step, premises));
      const intermediate = edit.intermediateConclusions[index];
      if (intermediate) {
        append(nodeFromDraft(intermediate, [step.id]));
        premises = [intermediate.id];
      }
    });

    const finalReasoning = edit.reasoningSteps[edit.reasoningSteps.length - 1]!;
    conclusion.premises = conclusion.premises.map(id => id === original.id ? finalReasoning.id : id);
    original.supersededBy = edit.reasoningSteps[0].id;
    original.status = 'suspended';
    original.hidden = true;
  }

  if (edit.kind === 'merge' && edit.mode === 'definition') {
    const sources = edit.sourceNodeIds.map(id => byId.get(id)!);
    const aliases = unique(sources.flatMap(node => [node.title, ...(node.aliases ?? [])]));
    const merged = nodeFromDraft(edit.mergedDefinition, []);
    merged.aliases = aliases;
    merged.semanticKey = edit.semanticKey.trim();
    append(merged);

    for (const source of sources) {
      source.supersededBy = merged.id;
      source.status = 'suspended';
      source.hidden = true;
    }
    for (const node of nodes) {
      if (node.hidden || node.supersededBy) continue;
      node.premises = node.premises.map(id => edit.sourceNodeIds.includes(id) ? merged.id : id);
    }
  }

  if (edit.kind === 'merge' && edit.mode === 'theory') {
    const mergedReasoning = nodeFromDraft(edit.mergedReasoning, edit.chains[0].premiseIds);
    mergedReasoning.semanticKey = edit.reasoningSemanticKey.trim();
    append(mergedReasoning);
    const sourceConclusions = edit.chains.map(chain => byId.get(chain.conclusionId)!);
    const aliases = unique(sourceConclusions.flatMap(node => [node.title, ...(node.aliases ?? [])]));
    const mergedConclusion = nodeFromDraft(edit.mergedConclusion, [edit.mergedReasoning.id]);
    mergedConclusion.aliases = aliases;
    mergedConclusion.semanticKey = edit.semanticKey.trim();
    append(mergedConclusion);

    for (const chain of edit.chains) {
      const reasoning = byId.get(chain.reasoningId)!;
      const conclusion = byId.get(chain.conclusionId)!;
      reasoning.supersededBy = edit.mergedReasoning.id;
      conclusion.supersededBy = edit.mergedConclusion.id;
      reasoning.status = 'suspended';
      conclusion.status = 'suspended';
      reasoning.hidden = true;
      conclusion.hidden = true;
    }
    const sourceConclusionIds = new Set(edit.chains.map(chain => chain.conclusionId));
    for (const node of nodes) {
      if (node.hidden || node.supersededBy) continue;
      node.premises = node.premises.map(id => sourceConclusionIds.has(id) ? mergedConclusion.id : id);
    }
  }
}

/**
 * Projection-oriented protocol API. Validation is identical to applyKnowledgeEdit,
 * but successful edits preserve the identity of all existing node objects.
 */
export function applyKnowledgeEditInPlace(nodes: ProtocolNode[], edit: KnowledgeEdit): KnowledgeEditResult {
  const errors = validateKnowledgeEdit(nodes, edit);
  if (errors.length) return { nodes, errors };
  mutateKnowledgeEditInPlace(nodes, edit);
  return { nodes, errors: [] };
}

/**
 * Pure protocol API retained for command validation, tests, and callers that need
 * an immutable result. It shares the same mutation core after cloning once.
 */
export function applyKnowledgeEdit(nodes: ProtocolNode[], edit: KnowledgeEdit): KnowledgeEditResult {
  const errors = validateKnowledgeEdit(nodes, edit);
  if (errors.length) return { nodes, errors };
  const next = structuredClone(nodes);
  mutateKnowledgeEditInPlace(next, edit);
  return { nodes: next, errors: [] };
}
'''
s = s[:start] + replacement
p.write_text(s)

# 2) Projection: pass real GraphNode references into the in-place protocol API and
# only materialize newly appended nodes into nodesById.
p = Path('src/projection/GraphProjection.ts')
s = p.read_text()
s = s.replace('  applyKnowledgeEdit,\n', '  applyKnowledgeEditInPlace,\n', 1)
old = '''    const masteryById = new Map(nodeList(this.state).map(node => [node.id, node.mastery]));
    const declaredLayerById = new Map(nodeList(this.state).map(node => [node.id, node.declaredLayer]));
    const lineageById = new Map(nodeList(this.state).map(node => [node.id, node.lineage ? structuredClone(node.lineage) : undefined]));
    const protocolNodes: ProtocolNode[] = nodeList(this.state).map(node => ({
      id: node.id,
      title: node.title,
      type: node.type,
      status: node.status,
      reasoning: node.reasoning,
      premises: [...node.premises],
      hidden: node.hidden,
      aliases: node.aliases ? [...node.aliases] : undefined,
      supersededBy: node.supersededBy,
      logicRuleId: node.logicRuleId,
      negatedBy: node.negatedBy ? [...node.negatedBy] : undefined,
      semanticKey: node.semanticKey,
      lineage: node.lineage ? structuredClone(node.lineage) : undefined,
    }));
    const result = applyKnowledgeEdit(protocolNodes, edit);
    if (result.errors.length) throw new Error(`Invalid ${edit.kind} event: ${result.errors.join('；')}`);

    this.state.nodesById = Object.fromEntries(result.nodes.map(node => [
      node.id,
      {
        ...node,
        mastery: masteryById.get(node.id) ?? 'none',
        declaredLayer: declaredLayerById.get(node.id),
        lineage: lineageById.get(node.id) ?? node.lineage,
        premises: [...node.premises],
      },
    ]));
'''
new = '''    // GraphNode structurally contains ProtocolNode plus personal/presentation
    // fields. Mutating these references preserves mastery, declared layer, lineage,
    // and object identity for every existing node instead of rebuilding the graph.
    const protocolNodes: ProtocolNode[] = nodeList(this.state);
    const existingNodeCount = protocolNodes.length;
    const result = applyKnowledgeEditInPlace(protocolNodes, edit);
    if (result.errors.length) throw new Error(`Invalid ${edit.kind} event: ${result.errors.join('；')}`);

    // The protocol array is only an index view over nodesById, so append the small
    // delta of newly-created nodes to the authoritative record after mutation.
    for (const node of result.nodes.slice(existingNodeCount)) {
      this.state.nodesById[node.id] = {
        ...node,
        mastery: 'none',
        premises: [...node.premises],
      };
    }
'''
if s.count(old) != 1:
    raise SystemExit('GraphProjection full-round-trip block mismatch')
s = s.replace(old, new, 1)
p.write_text(s)

# 3) Regression: prove record/object identity survives a non-add edit and the
# visible graph result remains the same.
p = Path('src/protocol/KnowledgeEditEventRegression.test.ts')
s = p.read_text()
anchor = "  const beforeDecompose = runtime.store.size();\n"
insert = '''  const nodesByIdBeforeDecompose = runtime.projection.state.nodesById;
  const untouchedPremiseBeforeDecompose = runtime.projection.state.nodesById.p1;
  const editedReasoningBeforeDecompose = runtime.projection.state.nodesById.r1;
  const conclusionBeforeDecompose = runtime.projection.state.nodesById.c1;
'''
if s.count(anchor) != 1:
    raise SystemExit('KnowledgeEditEventRegression decompose anchor mismatch')
s = s.replace(anchor, insert + anchor, 1)
anchor2 = "  assert.equal(runtime.projection.state.nodesById.r1.hidden, true);\n"
insert2 = '''  assert.equal(runtime.projection.state.nodesById, nodesByIdBeforeDecompose, 'projection edits must preserve the authoritative nodesById record');
  assert.equal(runtime.projection.state.nodesById.p1, untouchedPremiseBeforeDecompose, 'unaffected nodes must keep object identity');
  assert.equal(runtime.projection.state.nodesById.r1, editedReasoningBeforeDecompose, 'edited existing nodes must be mutated in place');
  assert.equal(runtime.projection.state.nodesById.c1, conclusionBeforeDecompose, 'rewired existing conclusions must keep object identity');
'''
if s.count(anchor2) != 1:
    raise SystemExit('KnowledgeEditEventRegression assertion anchor mismatch')
s = s.replace(anchor2, insert2 + anchor2, 1)
p.write_text(s)

# 4) Architecture guard.
Path('scripts/verify-projection-edit-delta.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projection = await readFile('src/projection/GraphProjection.ts', 'utf8');
const protocol = await readFile('src/protocol/KnowledgeEditingProtocol.ts', 'utf8');

assert.match(protocol, /export function applyKnowledgeEditInPlace\(/,
  'protocol must expose one validated in-place mutation path for live projection');
assert.match(protocol, /mutateKnowledgeEditInPlace\(next, edit\)/,
  'pure protocol edit must reuse the exact same mutation core after cloning');
assert.match(projection, /applyKnowledgeEditInPlace\(protocolNodes, edit\)/,
  'GraphProjection must use the in-place protocol path');
assert.match(projection, /const existingNodeCount = protocolNodes\.length/,
  'projection must track only the newly appended node delta');
assert.match(projection, /result\.nodes\.slice\(existingNodeCount\)/,
  'projection must materialize only new nodes after the edit');
assert.doesNotMatch(projection, /this\.state\.nodesById\s*=\s*Object\.fromEntries/,
  'non-add edits must never rebuild the authoritative nodesById record');
assert.doesNotMatch(projection, /const masteryById = new Map/,
  'projection must not copy personal state just to survive a graph rebuild');
assert.doesNotMatch(projection, /const lineageById = new Map/,
  'projection must not clone lineage metadata just to survive a graph rebuild');

console.log('Projection knowledge-edit delta architecture checks passed');
''')

# 5) Wire guard into the existing architecture test suite.
p = Path('package.json')
s = p.read_text()
old = 'node scripts/verify-personal-account-state.mjs && node scripts/verify-visibility-runtime-architecture.mjs"'
new = 'node scripts/verify-personal-account-state.mjs && node scripts/verify-visibility-runtime-architecture.mjs && node scripts/verify-projection-edit-delta.mjs"'
if s.count(old) != 1:
    raise SystemExit('package architecture script anchor mismatch')
p.write_text(s.replace(old, new, 1))
