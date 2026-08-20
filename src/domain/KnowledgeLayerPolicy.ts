import type { NodeType } from './KnowledgeModel';

export const USER_KNOWLEDGE_LAYERS = ['inner', 'middle', 'outer'] as const;
export type UserKnowledgeLayer = typeof USER_KNOWLEDGE_LAYERS[number];
export type KnowledgeLayer = UserKnowledgeLayer | 'core';

export const SYSTEM_CORE_NODE_IDS = ['n1', 'n2', 'n16'] as const;

export const KNOWLEDGE_LAYER_LABEL: Record<KnowledgeLayer, string> = {
  core: '核心 · 系统基础',
  inner: '第一层 · 语义与基础事实',
  middle: '第二层 · 严谨推理',
  outer: '第三层 · 概率与争议',
};

/**
 * Canonical user-facing layer contract.
 *
 * Layer 1 is descriptive rather than inferential: definitions, directly stated
 * facts/observations, and static semantic relations between knowledge items.
 * Layer 2 contains rigorous reasoning or content that explicitly claims to be
 * rigorous: formal inference, proof, theorem and deduction-rule structures.
 * Layer 3 contains disputed knowledge and statements that are explicitly framed
 * as probabilistic/uncertain at authoring time ("可能", "也许", probabilities,
 * forecasts, hypotheses, opinions and value claims).
 */
export const KNOWLEDGE_LAYER_HELP: Record<UserKnowledgeLayer, string> = {
  inner: '定义、直接事实或观察，以及知识点之间不依赖推导的静态语义关系。第一层描述“是什么 / 有什么关系”，不是推理链。',
  middle: '所有严谨推理，或明确声称严谨的推理结构，包括公理体系、证明、定理、演绎规则和形式化推导。',
  outer: '有争议的知识，或作者在提交时明确声明为概率性 / 不确定性的描述，例如“可能”“也许”“概率为 80%”以及假说、预测、观点和价值判断。',
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
