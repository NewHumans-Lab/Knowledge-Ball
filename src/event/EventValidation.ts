import type { DomainEvent } from './Event';
import type { GraphState } from '../state/GraphState';
import {
  validateKnowledgeEdit,
  type ProtocolNode,
} from '../protocol/KnowledgeEditingProtocol';

const editKindByType = {
  KnowledgeAdded: 'add',
  KnowledgeNegated: 'negate',
  KnowledgeDecomposed: 'decompose',
  KnowledgeMerged: 'merge',
  KnowledgeStatusChanged: 'status',
  KnowledgeNodeEdited: 'update',
} as const;

export function validateDomainEventEnvelope(event: DomainEvent): string[] {
  const errors: string[] = [];
  if (!event || typeof event !== 'object') return ['事件必须是对象'];
  if (!event.id?.trim()) errors.push('事件必须有 ID');
  if (event.schemaVersion !== 1) errors.push(`不支持的事件版本: ${event.schemaVersion}`);
  if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) errors.push('事件时间戳无效');
  if (!event.payload || typeof event.payload !== 'object') errors.push('事件载荷无效');

  if (event.type in editKindByType) {
    const expected = editKindByType[event.type as keyof typeof editKindByType];
    const edit = (event.payload as { edit?: { kind?: string } }).edit;
    if (!edit || edit.kind !== expected) {
      errors.push(`${event.type} 必须携带 ${expected} 编辑载荷`);
    }
  }
  return errors;
}

function protocolNodes(state: GraphState): ProtocolNode[] {
  return Object.values(state.nodesById).map(node => ({
    id: node.id,
    title: node.title,
    type: node.type,
    reasoning: node.reasoning,
    premises: [...node.premises],
    status: node.status,
    hidden: node.hidden,
    aliases: node.aliases ? [...node.aliases] : undefined,
    supersededBy: node.supersededBy,
    logicRuleId: node.logicRuleId,
    negatedBy: node.negatedBy ? [...node.negatedBy] : undefined,
    semanticKey: node.semanticKey,
  }));
}

export function validateDomainEventAgainstState(event: DomainEvent, state: GraphState): string[] {
  const errors = validateDomainEventEnvelope(event);
  if (errors.length) return errors;
  switch (event.type) {
    case 'KnowledgeAdded':
    case 'KnowledgeNegated':
    case 'KnowledgeDecomposed':
    case 'KnowledgeMerged':
      return validateKnowledgeEdit(protocolNodes(state), event.payload.edit);
    case 'KnowledgeStatusChanged': {
      const target = state.nodesById[event.payload.edit.nodeId];
      if (!target) return [`事件目标不存在: ${event.payload.edit.nodeId}`];
      if (target.status === 'falsified') return ['已证伪节点不能通过普通状态命令恢复'];
      if (event.payload.edit.status === 'suspended' && !event.payload.edit.causeNodeId) return ['悬置必须记录原因节点'];
      if (event.payload.edit.causeNodeId && !state.nodesById[event.payload.edit.causeNodeId]) return [`原因节点不存在: ${event.payload.edit.causeNodeId}`];
      return [];
    }
    case 'KnowledgeNodeEdited':
      return state.nodesById[event.payload.edit.nodeId] ? [] : [`事件目标不存在: ${event.payload.edit.nodeId}`];
    case 'NodeCreated':
      if (event.payload.source !== 'import') return ['NodeCreated 仅用于导入旧记录；新的增加必须提交 KnowledgeAdded'];
      if (state.nodesById[event.payload.nodeId]) return [`节点 ID 已存在: ${event.payload.nodeId}`];
      return [];
    case 'NodeEdited':
    case 'NodeSuspended':
    case 'NodeDisputed':
    case 'NodeMasterySet':
      return state.nodesById[event.payload.nodeId] ? [] : [`事件目标不存在: ${event.payload.nodeId}`];
    case 'NodeFalsified':
      return ['NodeFalsified 仅用于读取旧事件；新的否定必须提交带反例的 KnowledgeNegated'];
    case 'NodeResolved': {
      const target = state.nodesById[event.payload.nodeId];
      if (!target) return [`事件目标不存在: ${event.payload.nodeId}`];
      if (target.status === 'falsified') {
        return ['已证伪节点不能直接恢复；必须先否定记录在 negatedBy 中的相反知识节点'];
      }
      return [];
    }
  }
}

export class DomainEventValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('；'));
    this.name = 'DomainEventValidationError';
  }
}
