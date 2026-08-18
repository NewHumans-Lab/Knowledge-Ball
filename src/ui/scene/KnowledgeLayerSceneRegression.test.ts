import { initialNodePosition, layerForNode } from './KnowledgeScene';
import { LAYER_BANDS } from '../config/KnowledgeUiConfig';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const middleFact = {
  id: 'declared-inner-now-middle',
  type: 'fact' as const,
  status: 'verified' as const,
  effectiveLayer: 'middle' as const,
};
assert(layerForNode(middleFact) === 'middle', 'scene must consume effectiveLayer instead of re-inferring fact as inner');
const middlePos = initialNodePosition(middleFact);
assert(
  middlePos.length() >= LAYER_BANDS.middle.rMin && middlePos.length() <= LAYER_BANDS.middle.rMax,
  'a first-layer node promoted by protocol must actually be placed in the middle shell',
);

const explicitOuter = {
  id: 'uncertain-relation',
  type: 'theorem' as const,
  status: 'verified' as const,
  effectiveLayer: 'outer' as const,
};
assert(layerForNode(explicitOuter) === 'outer', 'declared uncertainty must outrank legacy theorem type inference');
const outerPos = initialNodePosition(explicitOuter);
assert(
  outerPos.length() >= LAYER_BANDS.outer.rMin && outerPos.length() <= LAYER_BANDS.outer.rMax,
  'effective outer knowledge must be initialized in the outer shell',
);

const legacyLogic = { id: 'legacy-logic', type: 'logic-symbol' as const, status: 'verified' as const };
assert(layerForNode(legacyLogic) === 'middle', 'legacy logic/inference rules must map to the second layer');

console.log('Knowledge layer scene regression checks passed.');
