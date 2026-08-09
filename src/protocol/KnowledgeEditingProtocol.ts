import type { NodeStatus, NodeType } from '../event/Event';

/** A reasoning process is a first-class node between premise conclusions and a conclusion. */
export interface ProtocolNode {
  id: string;
  title: string;
  type: NodeType;
  reasoning: string;
  premises: string[];
  status: NodeStatus;
  aliases?: string[];
  supersededBy?: string;
}

export interface ReasoningChain {
  premiseIds: string[];
  reasoningId: string;
  conclusionId: string;
}

export interface NewProtocolNode {
  id: string;
  title: string;
  type: NodeType;
  reasoning: string;
}

export interface NegateEdit {
  kind: 'negate';
  target: 'premise' | 'reasoning' | 'conclusion';
  targetId: string;
  /** Required evidence when negating a premise or conclusion. */
  counterexampleIds?: string[];
  /** Required replacement when the inference itself is wrong. */
  correctedReasoning?: NewProtocolNode;
}

export interface DecomposeEdit {
  kind: 'decompose';
  chain: ReasoningChain;
  /** Two or more smaller inference processes replacing the original process. */
  reasoningSteps: NewProtocolNode[];
  /** Exactly one new conclusion between each adjacent pair of reasoning steps. */
  intermediateConclusions: NewProtocolNode[];
}

export interface MergeEdit {
  kind: 'merge';
  chains: ReasoningChain[];
  /** Callers use the same key to assert that differently named conclusions are equivalent. */
  semanticKey: string;
  mergedReasoning: NewProtocolNode;
  mergedConclusion: NewProtocolNode;
}

export interface AddEdit {
  kind: 'add';
  requiredPremiseIds: string[];
  reasoning: NewProtocolNode;
  conclusion: NewProtocolNode;
}

export type KnowledgeEdit = NegateEdit | DecomposeEdit | MergeEdit | AddEdit;

export interface KnowledgeEditResult {
  nodes: ProtocolNode[];
  errors: string[];
}

const unique = (values: string[]) => [...new Set(values)];
const sameSet = (left: string[], right: string[]) =>
  left.length === right.length && unique(left).sort().join('\0') === unique(right).sort().join('\0');
const canonicalText = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

function nodeFromDraft(draft: NewProtocolNode, premises: string[]): ProtocolNode {
  return {
    ...draft,
    title: draft.title.trim(),
    reasoning: draft.reasoning.trim(),
    premises: unique(premises),
    status: 'pending',
  };
}

function indexNodes(nodes: ProtocolNode[]): Map<string, ProtocolNode> {
  return new Map(nodes.map(node => [node.id, node]));
}

function validateDraft(draft: NewProtocolNode, existingIds: Set<string>, expectedType?: NodeType): string[] {
  const errors: string[] = [];
  if (!draft.id.trim()) errors.push('新节点必须有 ID');
  if (existingIds.has(draft.id)) errors.push(`节点 ID 已存在: ${draft.id}`);
  if (!draft.title.trim()) errors.push(`节点 ${draft.id || '(unknown)'} 必须有标题`);
  if (!draft.reasoning.trim()) errors.push(`节点 ${draft.id || '(unknown)'} 必须有描述`);
  if (expectedType && draft.type !== expectedType) errors.push(`节点 ${draft.id || '(unknown)'} 必须是 ${expectedType} 类型`);
  return errors;
}

export function validateReasoningChain(nodes: ProtocolNode[], chain: ReasoningChain): string[] {
  const byId = indexNodes(nodes);
  const reasoning = byId.get(chain.reasoningId);
  const conclusion = byId.get(chain.conclusionId);
  const errors: string[] = [];

  if (chain.premiseIds.length === 0) errors.push('推理链至少需要一个前提');
  for (const id of chain.premiseIds) if (!byId.has(id)) errors.push(`前提不存在: ${id}`);
  if (!reasoning) errors.push(`推理过程不存在: ${chain.reasoningId}`);
  else {
    if (reasoning.type !== 'reasoning') errors.push(`推理过程节点必须是 reasoning 类型: ${reasoning.id}`);
    if (!sameSet(reasoning.premises, chain.premiseIds)) errors.push('推理过程的前提与推理链声明不一致');
  }
  if (!conclusion) errors.push(`结论不存在: ${chain.conclusionId}`);
  else if (!conclusion.premises.includes(chain.reasoningId)) errors.push('结论必须直接依赖推理过程节点');
  return errors;
}

export function validateKnowledgeEdit(nodes: ProtocolNode[], edit: KnowledgeEdit): string[] {
  const byId = indexNodes(nodes);
  const existingIds = new Set(byId.keys());
  const errors: string[] = [];

  if (edit.kind === 'negate') {
    const target = byId.get(edit.targetId);
    if (!target) errors.push(`否定目标不存在: ${edit.targetId}`);
    if (edit.target === 'reasoning') {
      if (target && target.type !== 'reasoning') errors.push('否定推理过程时，目标必须是 reasoning 节点');
      if (!edit.correctedReasoning) errors.push('否定错误推理过程时必须给出正确的推理过程');
      else errors.push(...validateDraft(edit.correctedReasoning, existingIds, 'reasoning'));
    } else {
      if (!edit.counterexampleIds?.length) errors.push('直接否定前提或结论时必须列举至少一个反例');
      for (const id of edit.counterexampleIds ?? []) if (!byId.has(id)) errors.push(`反例节点不存在: ${id}`);
    }
  }

  if (edit.kind === 'decompose') {
    errors.push(...validateReasoningChain(nodes, edit.chain));
    if (edit.reasoningSteps.length < 2) errors.push('分解必须包含至少两个推理过程');
    if (edit.intermediateConclusions.length !== edit.reasoningSteps.length - 1) {
      errors.push('相邻推理过程之间必须且只能添加一个中间知识节点');
    }
    const drafts = [...edit.reasoningSteps, ...edit.intermediateConclusions];
    const draftIds = new Set<string>();
    for (const draft of drafts) {
      errors.push(...validateDraft(draft, existingIds, edit.reasoningSteps.includes(draft) ? 'reasoning' : undefined));
      if (draftIds.has(draft.id)) errors.push(`分解中的新节点 ID 重复: ${draft.id}`);
      draftIds.add(draft.id);
    }
    if (edit.intermediateConclusions.some(node => node.type === 'reasoning')) errors.push('分解产生的中间结论不能是 reasoning 类型');
  }

  if (edit.kind === 'merge') {
    if (edit.chains.length < 2) errors.push('合并至少需要两条推理链');
    for (const chain of edit.chains) errors.push(...validateReasoningChain(nodes, chain));
    const first = edit.chains[0];
    const firstReasoning = first ? byId.get(first.reasoningId) : undefined;
    for (const chain of edit.chains.slice(1)) {
      if (!first || !sameSet(first.premiseIds, chain.premiseIds)) errors.push('合并要求所有推理链具有相同前提');
      const reasoning = byId.get(chain.reasoningId);
      if (firstReasoning && reasoning && canonicalText(firstReasoning.reasoning) !== canonicalText(reasoning.reasoning)) {
        errors.push('合并要求推理过程相同；必须先合并推理过程，再合并结论');
      }
    }
    if (!edit.semanticKey.trim()) errors.push('合并结论必须提供语义等价标识');
    errors.push(...validateDraft(edit.mergedReasoning, existingIds, 'reasoning'));
    errors.push(...validateDraft(edit.mergedConclusion, existingIds));
    if (edit.mergedConclusion.type === 'reasoning') errors.push('合并后的结论不能是 reasoning 类型');
    if (edit.mergedConclusion.id === edit.mergedReasoning.id) errors.push('合并推理过程和结论必须使用不同 ID');
  }

  if (edit.kind === 'add') {
    if (edit.requiredPremiseIds.length === 0) errors.push('增加推理链必须标记所需前提');
    for (const id of edit.requiredPremiseIds) if (!byId.has(id)) errors.push(`所需前提不存在: ${id}`);
    if (unique(edit.requiredPremiseIds).length !== edit.requiredPremiseIds.length) errors.push('所需前提不能重复');
    errors.push(...validateDraft(edit.reasoning, existingIds, 'reasoning'));
    errors.push(...validateDraft(edit.conclusion, existingIds));
    if (edit.conclusion.type === 'reasoning') errors.push('新增结论不能是 reasoning 类型');
    if (edit.reasoning.id === edit.conclusion.id) errors.push('推理过程和结论必须使用不同 ID');
  }

  return unique(errors);
}

/**
 * Applies a validated edit without deleting history. Replaced nodes remain in the graph and
 * point to their successor through `supersededBy`, so editing is auditable.
 */
export function applyKnowledgeEdit(nodes: ProtocolNode[], edit: KnowledgeEdit): KnowledgeEditResult {
  const errors = validateKnowledgeEdit(nodes, edit);
  if (errors.length) return { nodes, errors };

  const next = structuredClone(nodes);
  const byId = indexNodes(next);
  const append = (node: ProtocolNode) => { next.push(node); byId.set(node.id, node); };

  if (edit.kind === 'add') {
    append(nodeFromDraft(edit.reasoning, edit.requiredPremiseIds));
    append(nodeFromDraft(edit.conclusion, [edit.reasoning.id]));
  }

  if (edit.kind === 'negate') {
    const target = byId.get(edit.targetId)!;
    target.status = 'falsified';
    if (edit.target === 'reasoning') {
      const corrected = nodeFromDraft(edit.correctedReasoning!, target.premises);
      append(corrected);
      target.supersededBy = corrected.id;
      for (const node of next) node.premises = node.premises.map(id => id === target.id ? corrected.id : id);
    }
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
    const finalReasoning = edit.reasoningSteps[edit.reasoningSteps.length - 1];
    conclusion.premises = conclusion.premises.map(id => id === original.id ? finalReasoning.id : id);
    original.supersededBy = edit.reasoningSteps[0].id;
    original.status = 'suspended';
  }

  if (edit.kind === 'merge') {
    const premises = edit.chains[0].premiseIds;
    append(nodeFromDraft(edit.mergedReasoning, premises));
    const sourceConclusions = edit.chains.map(chain => byId.get(chain.conclusionId)!);
    const aliases = unique(sourceConclusions.flatMap(node => [node.title, ...(node.aliases ?? [])]));
    append({ ...nodeFromDraft(edit.mergedConclusion, [edit.mergedReasoning.id]), aliases });
    for (const chain of edit.chains) {
      const reasoning = byId.get(chain.reasoningId)!;
      const conclusion = byId.get(chain.conclusionId)!;
      reasoning.supersededBy = edit.mergedReasoning.id;
      conclusion.supersededBy = edit.mergedConclusion.id;
      reasoning.status = 'suspended';
      conclusion.status = 'suspended';
    }
  }

  return { nodes: next, errors: [] };
}
