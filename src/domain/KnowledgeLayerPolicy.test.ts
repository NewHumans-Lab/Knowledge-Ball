import {
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
const derivedInner = node('derived-inner', 'inner', 'verified', ['base']);
const pendingInner = node('pending-inner', 'inner', 'pending', []);
const uncertain = node('uncertain', 'outer', 'verified', ['base'], 'prediction');
const middle = node('relation', 'middle', 'verified', [], 'theorem');
const graph: Record<string, LayerPolicyNode> = {
  base,
  'derived-inner': derivedInner,
  'pending-inner': pendingInner,
  uncertain,
  relation: middle,
};

assert(effectiveLayerForNode(base, graph) === 'inner', 'verified first-layer starting knowledge must remain inner');
assert(effectiveLayerForNode(derivedInner, graph) === 'middle', 'first-layer knowledge with a verified premise must automatically demote to middle');
assert(effectiveLayerForNode(pendingInner, graph) === 'outer', 'pending knowledge must display in the outer layer until confirmed');
assert(effectiveLayerForNode(uncertain, graph) === 'outer', 'declared uncertain knowledge must remain outer even with verified premises');
assert(effectiveLayerForNode(middle, graph) === 'middle', 'semantic relations and rigorous reasoning stay middle');

base.status = 'disputed';
assert(effectiveLayerForNode(derivedInner, graph) === 'inner', 'an unverified/disputed premise must not force first-layer demotion');
base.status = 'verified';
base.hidden = true;
assert(effectiveLayerForNode(derivedInner, graph) === 'inner', 'a hidden premise must not force first-layer demotion');
base.hidden = false;

assert(isSystemCoreNodeId('n1') && isSystemCoreNodeId('n2') && isSystemCoreNodeId('n16'), 'core triad must remain system-owned');
assert(declaredLayerForNode(node('n1', 'outer')) === 'core', 'user declarations must not move system core nodes');
assert(inferLegacyDeclaredLayer(node('legacy-definition', undefined, 'verified', [], 'definition')) === 'inner', 'legacy definitions remain first-layer compatible');
assert(inferLegacyDeclaredLayer(node('legacy-relation', undefined, 'verified', [], 'logic-symbol')) === 'middle', 'legacy logic/inference rules map to middle');
assert(inferLegacyDeclaredLayer(node('legacy-opinion', undefined, 'verified', [], 'opinion')) === 'outer', 'legacy uncertain types remain outer');

console.log('Knowledge layer policy regression checks passed.');
