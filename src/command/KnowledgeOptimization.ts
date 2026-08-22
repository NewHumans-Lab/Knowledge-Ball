import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type DomainEvent, type KnowledgeAddedEvent } from '../event/Event';
import type { EventCommitter } from '../event/EventCommitter';
import type { EventStore } from '../event/EventStore';
import type { UserKnowledgeLayer } from '../domain/KnowledgeLayerPolicy';
import { isOptimizationCandidate } from '../domain/KnowledgeOptimization';
import { lineageRoleFor, topicIdFor } from '../domain/KnowledgeLineage';
import { canonicalKnowledgeText } from '../protocol/KnowledgeEditingProtocol';
import type { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';

export interface KnowledgeOptimizationInput {
  targetId: string;
  candidateId: string;
  title: string;
  reasoning: string;
  declaredLayer: UserKnowledgeLayer;
}

export class KnowledgeOptimizationValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('；'));
    this.name = 'KnowledgeOptimizationValidationError';
  }
}

/**
 * Validate the product-level optimization invariant without mutating the target.
 * The only editable semantic fields are title, declared layer, and content.
 * Node type, premises, and logic-rule identity are inherited from the current ball.
 */
export function validateKnowledgeOptimization(
  state: GraphState,
  input: KnowledgeOptimizationInput,
): string[] {
  const errors: string[] = [];
  const nodes = Object.values(state.nodesById);
  const target = state.nodesById[input.targetId];
  const candidateId = input.candidateId.trim();
  const title = canonicalKnowledgeText(input.title);
  const reasoning = canonicalKnowledgeText(input.reasoning);

  if (!target) return [`优化目标不存在: ${input.targetId}`];
  if (target.status !== 'verified' || target.hidden || target.supersededBy) {
    errors.push('只能优化当前已验证且可见的有效知识');
  }
  if (lineageRoleFor(target) !== 'current') errors.push('只能优化当前版本，不能直接编辑历史、对立或候选版本');

  if (!candidateId || candidateId !== input.candidateId) errors.push('优化候选必须有不含首尾空白的新节点 ID');
  else if (state.nodesById[candidateId]) errors.push(`优化候选节点 ID 已存在: ${candidateId}`);

  if (!title) errors.push('优化候选必须有名字');
  if (!reasoning) errors.push('优化候选必须有内容');

  const targetTitle = canonicalKnowledgeText(target.title);
  if (title && title !== targetTitle) {
    const duplicate = nodes.find(node => canonicalKnowledgeText(node.title) === title);
    if (duplicate) errors.push(`优化后的新名字已被其他知识节点使用: ${input.title.trim()}`);
  }

  const topicId = topicIdFor(target);
  if (nodes.some(node => topicIdFor(node) === topicId && node.status === 'pending' && isOptimizationCandidate(node))) {
    errors.push('同一知识主题已有一个优化候选正在验证；线性版本链在当前协议下必须串行推进');
  }

  return errors;
}

export async function executeKnowledgeOptimization(
  store: EventStore<GraphState>,
  projection: GraphProjection,
  input: KnowledgeOptimizationInput,
  committer?: EventCommitter,
): Promise<KnowledgeAddedEvent> {
  const errors = validateKnowledgeOptimization(projection.state, input);
  if (errors.length) throw new KnowledgeOptimizationValidationError(errors);

  const target = projection.state.nodesById[input.targetId]!;
  const topicId = topicIdFor(target);
  const timestamp = Date.now();
  const edit = {
    kind: 'add' as const,
    mode: 'atomic' as const,
    node: {
      id: input.candidateId,
      title: input.title.trim(),
      type: target.type,
      reasoning: input.reasoning.trim(),
      logicRuleId: target.logicRuleId,
    },
  };
  const payload: KnowledgeAddedEvent['payload'] = {
    edit,
    declaredLayers: { [input.candidateId]: input.declaredLayer },
    optimization: { targetId: target.id, topicId },
  };
  const id = await fingerprint('KnowledgeAdded', payload, timestamp);
  const event: KnowledgeAddedEvent = {
    id,
    type: 'KnowledgeAdded',
    scope: 'public',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp,
    payload,
  };

  const accepted = committer ? await committer(event as DomainEvent) : store.appendValidated(event);
  if (!accepted) throw new Error(`Duplicate optimization event: ${id}`);
  return event;
}
