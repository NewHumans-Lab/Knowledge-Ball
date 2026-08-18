import type { NodeType } from './KnowledgeModel';

export const USER_KNOWLEDGE_LAYERS = ['inner', 'middle', 'outer'] as const;
export type UserKnowledgeLayer = typeof USER_KNOWLEDGE_LAYERS[number];
export type KnowledgeLayer = UserKnowledgeLayer | 'core';

export const SYSTEM_CORE_NODE_IDS = ['n1', 'n2', 'n16'] as const;

export const KNOWLEDGE_LAYER_LABEL: Record<KnowledgeLayer, string> = {
  core: '核心 · 系统基础',
  inner: '第一层 · 基础起点',
  middle: '第二层 · 关系与严谨推理',
  outer: '第三层 · 不确定与争议',
};

export const KNOWLEDGE_LAYER_HELP: Record<UserKnowledgeLayer, string> = {
  inner: '不依赖其他已验证知识的定义、直接观察、可靠事实或知识链起点。若以后新增前提并验证成功，系统会自动转入第二层。',
  middle: '知识之间的语义关系，或由明确前提和规则推出的内容，包括公理体系、定理、证明、严谨推理和演绎规则。',
  outer: '假设、概率、预测、观点、价值判断、争议内容，或当前尚未确认的知识。',
};

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
 * compatibility fallback; every new user submission should carry declaredLayer.
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

export function hasVerifiedPremise(
  node: Pick<LayerPolicyNode, 'premises'>,
  nodesById: Readonly<Record<string, LayerPolicyNode>>,
): boolean {
  return node.premises.some(id => {
    const premise = nodesById[id];
    return Boolean(premise && !premise.hidden && premise.status === 'verified');
  });
}

/**
 * Canonical display/placement rule.
 *
 * Priority:
 * 1. System core is fixed.
 * 2. Pending/disputed/suspended knowledge is displayed in the outer layer.
 * 3. Declared outer knowledge remains outer even if it has premises.
 * 4. A declared first-layer node automatically becomes second-layer once any
 *    attached premise is itself verified.
 * 5. Otherwise the user's declared layer is retained.
 */
export function effectiveLayerForNode(
  node: LayerPolicyNode,
  nodesById: Readonly<Record<string, LayerPolicyNode>>,
): KnowledgeLayer {
  if (isSystemCoreNodeId(node.id)) return 'core';
  if (node.status === 'pending' || node.status === 'disputed' || node.status === 'suspended') return 'outer';

  const declared = declaredLayerForNode(node);
  if (declared === 'outer') return 'outer';
  if (declared === 'inner' && hasVerifiedPremise(node, nodesById)) return 'middle';
  return declared;
}

export function isUserKnowledgeLayer(value: string): value is UserKnowledgeLayer {
  return (USER_KNOWLEDGE_LAYERS as readonly string[]).includes(value);
}
