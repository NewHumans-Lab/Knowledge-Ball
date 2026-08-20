import {
  KNOWLEDGE_LAYER_HELP,
  declaredLayerForNode,
  effectiveLayerForNode,
  inferLegacyDeclaredLayer,
  isSystemCoreNodeId,
  type LayerPolicyNode,
} from './KnowledgeLayerPolicy';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function node(
  id: string,
  declaredLayer: LayerPolicyNode['declaredLayer'],
  status: LayerPolicyNode['status'] = 'verified',
  premises: string[] = [],
  type: LayerPolicyNode['type'] = 'fact',
): LayerPolicyNode {
  return { id, declaredLayer, status, premises, type };
}

const base = node('base', 'inner');
const historicalInnerWithPremise = node('historical-inner-with-premise', 'inner', 'verified', ['base']);
const pendingInner = node('pending-inner', 'inner', 'pending');
const suspendedInner = node('suspended-inner', 'inner', 'suspended');
const disputedInner = node('disputed-inner', 'inner', 'disputed');
const uncertain = node('uncertain', 'outer', 'verified', ['base'], 'prediction');
const rigorous = node('rigorous', 'middle', 'verified', ['base'], 'theorem');
const graph: Record<string, LayerPolicyNode> = {
  base,
  'historical-inner-with-premise': historicalInnerWithPremise,
  'pending-inner': pendingInner,
  'suspended-inner': suspendedInner,
  'disputed-inner': disputedInner,
  uncertain,
  rigorous,
};

assert(effectiveLayerForNode(base, graph) === 'inner', 'declared first-layer knowledge must remain in the semantic/base layer');
assert(
  effectiveLayerForNode(historicalInnerWithPremise, graph) === 'inner',
  'premises must not silently rewrite an explicit semantic classification; new UI prevents this invalid combination',
);
assert(effectiveLayerForNode(pendingInner, graph) === 'inner', 'pending is a review state, not an uncertainty classification');
assert(effectiveLayerForNode(suspendedInner, graph) === 'inner', 'suspended is an availability state, not an uncertainty classification');
assert(effectiveLayerForNode(disputedInner, graph) === 'outer', 'currently disputed knowledge belongs to the third display layer');
assert(effectiveLayerForNode(uncertain, graph) === 'outer', 'explicit probabilistic/uncertain knowledge must remain in the third layer');
assert(effectiveLayerForNode(rigorous, graph) === 'middle', 'rigorous or claimed-rigorous reasoning belongs to the second layer');

assert(isSystemCoreNodeId('n1') && isSystemCoreNodeId('n2') && isSystemCoreNodeId('n16'), 'core triad must remain system-owned');
assert(declaredLayerForNode(node('n1', 'outer')) === 'core', 'user declarations must not move system core nodes');
assert(inferLegacyDeclaredLayer(node('legacy-definition', undefined, 'verified', [], 'definition')) === 'inner', 'legacy definitions remain first-layer compatible');
assert(inferLegacyDeclaredLayer(node('legacy-relation', undefined, 'verified', [], 'logic-symbol')) === 'middle', 'legacy logic/inference rules retain the historical middle fallback');
assert(inferLegacyDeclaredLayer(node('legacy-opinion', undefined, 'verified', [], 'opinion')) === 'outer', 'legacy uncertain types remain outer');

assert(KNOWLEDGE_LAYER_HELP.inner.includes('静态语义关系'), 'first-layer contract must explicitly include static semantic relations');
assert(KNOWLEDGE_LAYER_HELP.middle.includes('严谨推理'), 'second-layer contract must explicitly represent rigorous reasoning');
assert(KNOWLEDGE_LAYER_HELP.outer.includes('概率'), 'third-layer contract must explicitly represent probabilistic/uncertain claims');

console.log('Knowledge layer policy regression checks passed.');
