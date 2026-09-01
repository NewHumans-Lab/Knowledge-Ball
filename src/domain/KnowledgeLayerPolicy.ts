import type { NodeType } from './KnowledgeModel';
import {
  knowledgeLayerHelp,
  knowledgeLayerLabel,
  systemUiText,
} from '../i18n/SystemUiText';

export const USER_KNOWLEDGE_LAYERS = ['inner', 'middle', 'outer'] as const;
export type UserKnowledgeLayer = typeof USER_KNOWLEDGE_LAYERS[number];
export type KnowledgeLayer = UserKnowledgeLayer | 'core';

export const SYSTEM_CORE_NODE_IDS = ['n1', 'n2', 'n16'] as const;

/**
 * Legacy presentation compatibility only. Localized copy is owned by i18n;
 * these getters keep older imperative consumers compiling while they migrate.
 */
export const KNOWLEDGE_LAYER_LABEL: Record<KnowledgeLayer, string> = Object.defineProperties({}, {
  core: { enumerable: true, get: () => systemUiText('layer.label.core') },
  inner: { enumerable: true, get: () => knowledgeLayerLabel('inner') },
  middle: { enumerable: true, get: () => knowledgeLayerLabel('middle') },
  outer: { enumerable: true, get: () => knowledgeLayerLabel('outer') },
}) as Record<KnowledgeLayer, string>;

/** @deprecated Presentation copy belongs to i18n; migrate UI consumers to knowledgeLayerHelp(). */
export const KNOWLEDGE_LAYER_HELP: Record<UserKnowledgeLayer, string> = Object.defineProperties({}, {
  inner: { enumerable: true, get: () => knowledgeLayerHelp('inner') },
  middle: { enumerable: true, get: () => knowledgeLayerHelp('middle') },
  outer: { enumerable: true, get: () => knowledgeLayerHelp('outer') },
}) as Record<UserKnowledgeLayer, string>;

/**
 * Canonical semantic layer contract.
 *
 * Layer 1 is descriptive rather than inferential: definitions, directly stated
 * facts/observations, and static semantic relations between knowledge items.
 * Layer 2 contains rigorous reasoning or content that explicitly claims to be
 * rigorous: formal inference, proof, theorem and deduction-rule structures.
 * Layer 3 contains disputed knowledge and statements that are explicitly framed
 * as probabilistic/uncertain at authoring time, including forecasts, hypotheses,
 * opinions, and value claims.
 *
 * Localized user-facing labels and explanations belong to the i18n presentation
 * layer, not this domain-policy module.
 *
 * `NodeType` remains a separate protocol/structural field. It must never be used
 * as the authoritative owner of these three semantic layers for new clean data.
 */
export type LayerNodeStatus = 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';

export interface LayerPolicyNode {
  id: string;
  type: NodeType;
  status: LayerNodeStatus;
  premises: readonly string[];
  hidden?: boolean;
  declaredLayer?: UserKnowledgeLayer;
}

export function isSystemCoreNodeId(id: string): boolean {
  return (SYSTEM_CORE_NODE_IDS as readonly string[]).includes(id);
}

/**
 * Historical events predate explicit layer declarations. This mapping is only a
 * compatibility fallback; every new user submission must carry declaredLayer.
 * Historical content may be replaced later and therefore does not define the
 * canonical three-layer contract.
 */
export function inferLegacyDeclaredLayer(node: Pick<LayerPolicyNode, 'type'>): UserKnowledgeLayer {
  if (node.type === 'definition' || node.type === 'fact') return 'inner';
  if (['hypothesis', 'prediction', 'opinion', 'value'].includes(node.type)) return 'outer';
  return 'middle';
}

export function declaredLayerForNode(node: Pick<LayerPolicyNode, 'id' | 'type' | 'declaredLayer'>): KnowledgeLayer {
  if (isSystemCoreNodeId(node.id)) return 'core';
  return node.declaredLayer ?? inferLegacyDeclaredLayer(node);
}

/**
 * Canonical display/placement rule.
 *
 * Classification and review state are deliberately separate dimensions:
 * - pending does not mean probabilistic, so a pending first/second-layer node
 *   stays in its declared layer while its pending pulse communicates review state;
 * - suspended is an availability/dependency state and also keeps its declaration;
 * - disputed knowledge is shown in layer 3 because the product definition of the
 *   third layer explicitly includes currently disputed knowledge;
 * - premises never silently rewrite a user's declared semantic class. The create
 *   UI prevents layer-1 nodes from carrying inferential premises in the first place.
 */
export function effectiveLayerForNode(
  node: LayerPolicyNode,
  _nodesById: Readonly<Record<string, LayerPolicyNode>>,
): KnowledgeLayer {
  if (isSystemCoreNodeId(node.id)) return 'core';
  if (node.status === 'disputed') return 'outer';
  return declaredLayerForNode(node);
}

export function isUserKnowledgeLayer(value: string): value is UserKnowledgeLayer {
  return (USER_KNOWLEDGE_LAYERS as readonly string[]).includes(value);
}
