import type { DomainEvent } from './Event';
import type { GraphState } from '../state/GraphState';
import { lineageRoleFor, topicIdFor } from '../domain/KnowledgeLineage';
import { validateOptimizationProposal } from '../domain/KnowledgeOptimization';
import { validateOppositionProposal } from '../domain/KnowledgeOpposition';
import { validateKnowledgeEdit, type ProtocolNode } from '../protocol/KnowledgeEditingProtocol';

const editKindByType = {
  KnowledgeAdded: 'add', KnowledgeNegated: 'negate', KnowledgeDecomposed: 'decompose',
  KnowledgeMerged: 'merge', KnowledgeStatusChanged: 'status', KnowledgeNodeEdited: 'update',
} as const;

function safeCount(value: number, allowZero = true): boolean {
  return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1);
}

function validEnergyText(value: string): boolean {
  return /^\d+(?:\.\d{1,6})?$/.test(value) && Number(value) > 0;
}

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
    if (!edit || edit.kind !== expected) errors.push(`${event.type} 必须携带 ${expected} 编辑载荷`);
  }
  if (event.type === 'KnowledgeAdded') {
    const { optimization, opposition } = event.payload;
    if (optimization && opposition) errors.push('KnowledgeAdded 不能同时声明优化和否定候选');
    if (optimization) {
      if (!optimization.targetId?.trim() || !optimization.topicId?.trim()) errors.push('优化事件必须携带 targetId 和 topicId');
      if (event.payload.edit.mode !== 'atomic') errors.push('优化候选必须作为单一不可变知识球提交');
    }
    if (opposition) {
      if (!opposition.targetId?.trim() || !opposition.topicId?.trim()) errors.push('否定事件必须携带 targetId 和 topicId');
      if (event.payload.edit.mode !== 'atomic') errors.push('否定候选必须作为单一不可变知识球提交');
    }
  }
  if (event.type === 'KnowledgeVerdictFinalized') {
    const p = event.payload;
    if (!p.roundId?.trim() || !p.nodeId?.trim()) errors.push('投票结算事件缺少轮次或节点 ID');
    if (p.verdict !== 'CORRECT' && p.verdict !== 'INCORRECT') errors.push('投票结算事件 verdict 无效');
    if (p.closeReason !== 'THRESHOLD' && p.closeReason !== 'TIMEOUT') errors.push('投票结算事件 closeReason 无效');
    if (p.policyVersion !== 'ORIGINAL_DESIGN_V1' && p.policyVersion !== 'ORIGINAL_DESIGN_V2') errors.push('投票结算事件 policyVersion 无效');
    for (const [label, value, allowZero] of [
      ['赞成票', p.agreeCount, true],
      ['反对票', p.disagreeCount, true],
      ['门槛', p.requiredVotes, false],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) errors.push(`投票结算事件${label}无效`);
    }
  }
  if (event.type === 'KnowledgeRevalidationStarted') {
    const p = event.payload;
    if (!p.roundId?.trim() || !p.nodeId?.trim() || !p.topicId?.trim()) errors.push('重新验证启动事件缺少必要 ID');
    if (p.roleAtStart !== 'history' && p.roleAtStart !== 'opposition') errors.push('重新验证只能从灰链或红链发起');
    if (!Number.isSafeInteger(p.stage) || p.stage < 0) errors.push('重新验证 stage 无效');
    if (!validEnergyText(p.stake)) errors.push('重新验证 stake 无效');
    if (p.scope !== 'GLOBAL' && p.scope !== 'LOCAL_10') errors.push('重新验证 scope 无效');
    if (p.accuracyGate !== undefined && (!Number.isInteger(p.accuracyGate) || p.accuracyGate < 0 || p.accuracyGate > 100)) errors.push('重新验证 accuracyGate 无效');
    if (p.scope === 'LOCAL_10' && (!Number.isSafeInteger(p.localHopLimit) || p.localHopLimit! < 1)) errors.push('LOCAL_10 必须携带有效 hop limit');
    if (!safeCount(p.requiredVotes, false) || !p.deadline || Number.isNaN(Date.parse(p.deadline))) errors.push('重新验证门槛或截止时间无效');
    if (p.policyVersion !== 'ORIGINAL_DESIGN_V1') errors.push('第二次及后续重新验证必须使用冻结 ORIGINAL_DESIGN_V1');
  }
  if (event.type === 'KnowledgeRevalidationFinalized') {
    const p = event.payload;
    if (!p.roundId?.trim() || !p.nodeId?.trim() || !p.topicId?.trim()) errors.push('重新验证结算事件缺少必要 ID');
    if (p.verdict !== 'CORRECT' && p.verdict !== 'INCORRECT') errors.push('重新验证 verdict 无效');
    if (p.closeReason !== 'THRESHOLD' && p.closeReason !== 'TIMEOUT') errors.push('重新验证 closeReason 无效');
    if (!Number.isSafeInteger(p.stage) || p.stage < 0) errors.push('重新验证 stage 无效');
    if (!safeCount(p.agreeCount) || !safeCount(p.disagreeCount) || !safeCount(p.requiredVotes, false)) errors.push('重新验证票数无效');
    if (p.policyVersion !== 'ORIGINAL_DESIGN_V1') errors.push('重新验证结算必须使用冻结 ORIGINAL_DESIGN_V1');
  }
  if (event.type === 'KnowledgeCascadeRevalidationStarted') {
    const p = event.payload;
    if (!p.nodeId?.trim() || !p.sourceNodeId?.trim() || !p.replacementNodeId?.trim() || !p.triggerEventId?.trim()) {
      errors.push('级联重新验证事件缺少必要 ID');
    }
    if (p.nodeId === p.sourceNodeId || p.nodeId === p.replacementNodeId) errors.push('级联重新验证不能把变更源自身作为下游目标');
  }
  return errors;
}

function protocolNodes(state: GraphState): ProtocolNode[] {
  return Object.values(state.nodesById).map(node => ({
    id: node.id, title: node.title, type: node.type, reasoning: node.reasoning, premises: [...node.premises],
    status: node.status, hidden: node.hidden, aliases: node.aliases ? [...node.aliases] : undefined,
    supersededBy: node.supersededBy, logicRuleId: node.logicRuleId,
    negatedBy: node.negatedBy ? [...node.negatedBy] : undefined, semanticKey: node.semanticKey,
  }));
}

function validateOptimizationEvent(event: Extract<DomainEvent, { type: 'KnowledgeAdded' }>, state: GraphState): string[] {
  const optimization = event.payload.optimization;
  if (!optimization) return [];
  if (event.payload.edit.mode !== 'atomic') return ['优化候选必须作为单一不可变知识球提交'];
  const candidate = event.payload.edit.node;
  const errors = validateOptimizationProposal(Object.values(state.nodesById), {
    targetId: optimization.targetId, candidateId: candidate.id, title: candidate.title, reasoning: candidate.reasoning,
  });
  const target = state.nodesById[optimization.targetId];
  if (!target) return errors;
  if (optimization.topicId !== topicIdFor(target)) errors.push('优化事件 topicId 与当前目标所属主题不一致');
  if (candidate.type !== target.type) errors.push('优化只能修改名字、层级和内容，不能偷偷改变节点类型');
  if (candidate.logicRuleId !== target.logicRuleId) errors.push('优化不能偷偷改变原节点的逻辑规则身份');
  if (!event.payload.declaredLayers?.[candidate.id]) errors.push('优化候选必须显式声明第一/第二/第三层');
  return errors;
}

function validateOppositionEvent(event: Extract<DomainEvent, { type: 'KnowledgeAdded' }>, state: GraphState): string[] {
  const opposition = event.payload.opposition;
  if (!opposition) return [];
  if (event.payload.edit.mode !== 'atomic') return ['否定候选必须作为单一不可变知识球提交'];
  const candidate = event.payload.edit.node;
  const errors = validateOppositionProposal(Object.values(state.nodesById), {
    targetId: opposition.targetId, candidateId: candidate.id, title: candidate.title, reasoning: candidate.reasoning,
  });
  const target = state.nodesById[opposition.targetId];
  if (!target) return errors;
  if (opposition.topicId !== topicIdFor(target)) errors.push('否定事件 topicId 与当前目标所属主题不一致');
  if (candidate.type !== target.type) errors.push('否定表单只允许名字、层级和内容，不允许偷偷改变节点类型');
  if (candidate.logicRuleId !== target.logicRuleId) errors.push('否定表单不能偷偷改变原节点的逻辑规则身份');
  if (!event.payload.declaredLayers?.[candidate.id]) errors.push('否定候选必须显式声明第一/第二/第三层');
  return errors;
}

export function validateDomainEventAgainstState(event: DomainEvent, state: GraphState): string[] {
  const errors = validateDomainEventEnvelope(event);
  if (errors.length) return errors;
  switch (event.type) {
    case 'KnowledgeAdded':
      if (event.payload.optimization) return validateOptimizationEvent(event, state);
      if (event.payload.opposition) return validateOppositionEvent(event, state);
      return validateKnowledgeEdit(protocolNodes(state), event.payload.edit);
    case 'KnowledgeNegated': case 'KnowledgeDecomposed': case 'KnowledgeMerged':
      return validateKnowledgeEdit(protocolNodes(state), event.payload.edit);
    case 'KnowledgeStatusChanged': {
      const target = state.nodesById[event.payload.edit.nodeId];
      if (!target) return [`事件目标不存在: ${event.payload.edit.nodeId}`];
      if (target.status === 'falsified') return ['已证伪节点不能通过普通状态命令恢复'];
      if (event.payload.edit.status === 'suspended' && !event.payload.edit.causeNodeId) return ['悬置必须记录原因节点'];
      if (event.payload.edit.causeNodeId && !state.nodesById[event.payload.edit.causeNodeId]) return [`原因节点不存在: ${event.payload.edit.causeNodeId}`];
      return [];
    }
    case 'KnowledgeVerdictFinalized': {
      const target = state.nodesById[event.payload.nodeId];
      if (!target) return [`投票结算目标不存在: ${event.payload.nodeId}`];
      if (target.status !== 'pending') return [`只有待验证节点可以接收首轮投票结算: ${event.payload.nodeId}`];
      return [];
    }
    case 'KnowledgeRevalidationStarted': {
      const target = state.nodesById[event.payload.nodeId];
      if (!target) return [`重新验证目标不存在: ${event.payload.nodeId}`];
      if (topicIdFor(target) !== event.payload.topicId) return ['重新验证 topicId 与目标不一致'];
      if (lineageRoleFor(target) !== event.payload.roleAtStart) return ['重新验证启动时 lineage role 与目标不一致'];
      if (target.status !== 'verified') return ['只有稳定已验证的灰/红节点可以开始重新验证'];
      return [];
    }
    case 'KnowledgeRevalidationFinalized': {
      const target = state.nodesById[event.payload.nodeId];
      if (!target) return [`重新验证目标不存在: ${event.payload.nodeId}`];
      if (topicIdFor(target) !== event.payload.topicId) return ['重新验证结算 topicId 与目标不一致'];
      if (target.status !== 'disputed') return ['只有正在重新验证的节点可以结算'];
      return [];
    }
    case 'KnowledgeCascadeRevalidationStarted': {
      const target = state.nodesById[event.payload.nodeId];
      const source = state.nodesById[event.payload.sourceNodeId];
      const replacement = state.nodesById[event.payload.replacementNodeId];
      if (!target) return [`级联重新验证目标不存在: ${event.payload.nodeId}`];
      if (!source) return [`级联重新验证变更源不存在: ${event.payload.sourceNodeId}`];
      if (!replacement) return [`级联重新验证新版本不存在: ${event.payload.replacementNodeId}`];
      if (lineageRoleFor(target) !== 'current') return ['级联重新验证只能标记当前有效知识'];
      if (lineageRoleFor(replacement) !== 'current') return ['级联重新验证 replacement 必须是最终 current'];
      if (target.status === 'falsified' || target.status === 'suspended') return ['不可用节点不能进入级联重新验证'];
      return [];
    }
    case 'KnowledgeNodeEdited': return state.nodesById[event.payload.edit.nodeId] ? [] : [`事件目标不存在: ${event.payload.edit.nodeId}`];
    case 'NodeCreated':
      if (event.payload.source !== 'import') return ['NodeCreated 仅用于导入旧记录；新的增加必须提交 KnowledgeAdded'];
      if (state.nodesById[event.payload.nodeId]) return [`节点 ID 已存在: ${event.payload.nodeId}`];
      return [];
    case 'NodeEdited': case 'NodeSuspended': case 'NodeDisputed': case 'NodeMasterySet':
      return state.nodesById[event.payload.nodeId] ? [] : [`事件目标不存在: ${event.payload.nodeId}`];
    case 'NodeFalsified': return ['NodeFalsified 仅用于读取旧事件；新的否定必须提交带反例的 KnowledgeNegated'];
    case 'NodeResolved': {
      const target = state.nodesById[event.payload.nodeId];
      if (!target) return [`事件目标不存在: ${event.payload.nodeId}`];
      if (target.status === 'falsified') return ['已证伪节点不能直接恢复；必须先否定记录在 negatedBy 中的相反知识节点'];
      return [];
    }
  }
}

export class DomainEventValidationError extends Error {
  constructor(readonly errors: string[]) { super(errors.join('；')); this.name = 'DomainEventValidationError'; }
}
