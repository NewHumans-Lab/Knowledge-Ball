import type { NodeStatus, NodeType } from '../event/Event';
import { lineageRoleFor, type KnowledgeLineageMeta } from '../domain/KnowledgeLineage';

/**
 * Canonical protocol representation used by command validation and deterministic
 * event replay. Hidden and superseded nodes stay here so history also participates
 * in uniqueness checks.
 */
export interface ProtocolNode {
  id: string;
  title: string;
  type: NodeType;
  reasoning: string;
  premises: string[];
  status: NodeStatus;
  hidden?: boolean;
  aliases?: string[];
  supersededBy?: string;
  logicRuleId?: string;
  negatedBy?: string[];
  semanticKey?: string;
  lineage?: KnowledgeLineageMeta;
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
  /** Description for a knowledge conclusion; inference text for a reasoning node. */
  reasoning: string;
  /** Every new reasoning process may classify itself with an existing logic-symbol node. */
  logicRuleId?: string;
}

export interface NegateEdit {
  kind: 'negate';
  target: 'premise' | 'reasoning' | 'conclusion';
  targetId: string;
  /** A negation is evidence-bearing: at least one active counterexample is always required. */
  counterexampleIds: string[];
  /** A rejected inference additionally needs its complete replacement inference. */
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

export interface DefinitionMergeEdit {
  kind: 'merge';
  mode: 'definition';
  sourceNodeIds: string[];
  semanticKey: string;
  mergedDefinition: NewProtocolNode;
}

export interface TheoryMergeEdit {
  kind: 'merge';
  mode: 'theory';
  chains: ReasoningChain[];
  /** Explicit identity for the inference process; validated before conclusion identity. */
  reasoningSemanticKey: string;
  semanticKey: string;
  /** Created before the merged conclusion in the same atomic event. */
  mergedReasoning: NewProtocolNode;
  mergedConclusion: NewProtocolNode;
}

export type MergeEdit = DefinitionMergeEdit | TheoryMergeEdit;

export interface AddAtomicEdit {
  kind: 'add';
  mode: 'atomic';
  node: NewProtocolNode;
}

/** Legacy complete-chain add retained for replay compatibility. */
export interface AddTheoryEdit {
  kind: 'add';
  mode: 'theory';
  requiredPremiseIds: string[];
  reasoning: NewProtocolNode;
  conclusion: NewProtocolNode;
}

/**
 * Create one real reasoning-process ball between existing Knowledge balls.
 * `conclusionIds` remains an array for event/replay compatibility, but every new
 * reasoning-link must contain exactly one concrete immutable conclusion ID.
 */
export interface AddReasoningLinkEdit {
  kind: 'add';
  mode: 'reasoning-link';
  requiredPremiseIds: string[];
  reasoning: NewProtocolNode;
  conclusionIds: string[];
}

export type AddEdit = AddAtomicEdit | AddTheoryEdit | AddReasoningLinkEdit;
export type KnowledgeEdit = NegateEdit | DecomposeEdit | MergeEdit | AddEdit;

export interface KnowledgeEditResult {
  nodes: ProtocolNode[];
  errors: string[];
}

const ATOMIC_TYPES = new Set<NodeType>(['axiom', 'definition', 'fact', 'logic-symbol']);
const unique = (values: string[]) => [...new Set(values)];

export function canonicalKnowledgeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

const sameSet = (left: string[], right: string[]) => {
  const a = unique(left);
  const b = unique(right);
  return a.length === left.length &&
    b.length === right.length &&
    a.length === b.length &&
    a.sort().join('\0') === b.sort().join('\0');
};

function indexNodes(nodes: ProtocolNode[]): Map<string, ProtocolNode> {
  return new Map(nodes.map(node => [node.id, node]));
}

function active(node: ProtocolNode | undefined): boolean {
  return Boolean(node && !node.hidden && !node.supersededBy && node.status !== 'falsified' && node.status !== 'suspended');
}

function validOrdinaryPremise(node: ProtocolNode | undefined): boolean {
  return active(node) && node!.type !== 'reasoning' && node!.type !== 'logic-symbol';
}

function validReasoningLinkPremise(node: ProtocolNode | undefined): boolean {
  return Boolean(
    node &&
    node.type !== 'reasoning' &&
    node.status !== 'pending' &&
    node.status !== 'falsified' &&
    node.status !== 'suspended' &&
    !node.hidden &&
    !node.supersededBy &&
    lineageRoleFor(node) === 'current'
  );
}

function nodeFromDraft(draft: NewProtocolNode, premises: string[]): ProtocolNode {
  return {
    id: draft.id,
    title: draft.title.trim(),
    type: draft.type,
    reasoning: draft.reasoning.trim(),
    premises: unique(premises),
    status: 'pending',
    hidden: false,
    logicRuleId: draft.logicRuleId,
  };
}

function validateDraftBatch(nodes: ProtocolNode[], drafts: NewProtocolNode[]): string[] {
  const errors: string[] = [];
  const byId = indexNodes(nodes);
  const usedIds = new Set(byId.keys());
  const usedTitles = new Map<string, string>();

  for (const node of nodes) {
    const title = canonicalKnowledgeText(node.title);
    if (title && !usedTitles.has(title)) usedTitles.set(title, node.id);
  }

  for (const draft of drafts) {
    const id = draft.id.trim();
    const title = canonicalKnowledgeText(draft.title);
    const description = canonicalKnowledgeText(draft.reasoning);

    if (!id || id !== draft.id) errors.push('新节点必须有不含首尾空白的 ID');
    else if (usedIds.has(id)) errors.push(`节点 ID 已存在或在本次操作中重复: ${id}`);
    else usedIds.add(id);

    if (!title) errors.push(`节点 ${id || '(unknown)'} 必须有标题`);
    else if (usedTitles.has(title)) {
      errors.push(`节点标题与现有或本次操作中的节点重复: ${draft.title.trim()}`);
    } else {
      usedTitles.set(title, id);
    }

    if (!description) errors.push(`节点 ${id || '(unknown)'} 必须有描述或推理过程`);
    // Similar descriptions are advisory duplicate candidates, never a hard submission gate.

    if (draft.type === 'reasoning') {
      const rule = draft.logicRuleId ? byId.get(draft.logicRuleId) : undefined;
      if (draft.logicRuleId && !rule) errors.push(`逻辑符号节点不存在: ${draft.logicRuleId}`);
      else if (draft.logicRuleId && rule?.type !== 'logic-symbol') errors.push(`节点不是逻辑符号: ${draft.logicRuleId}`);
      else if (draft.logicRuleId && !active(rule)) errors.push(`逻辑符号节点当前不可用: ${draft.logicRuleId}`);
    } else if (draft.logicRuleId) {
      errors.push(`只有 reasoning 节点可以指定逻辑符号: ${id || '(unknown)'}`);
    }
  }

  return errors;
}

function validateCounterexamples(nodes: ProtocolNode[], edit: NegateEdit): string[] {
  const errors: string[] = [];
  const byId = indexNodes(nodes);
  if (edit.counterexampleIds.length === 0) errors.push('否定必须列举至少一个反例知识节点');
  if (unique(edit.counterexampleIds).length !== edit.counterexampleIds.length) errors.push('反例知识节点不能重复');

  for (const id of edit.counterexampleIds) {
    const counterexample = byId.get(id);
    if (!counterexample) errors.push(`反例节点不存在: ${id}`);
    else if (id === edit.targetId) errors.push('知识节点不能作为自身的反例');
    else if (!active(counterexample)) errors.push(`反例节点当前不可用: ${id}`);
    else if (counterexample.type === 'reasoning' || counterexample.type === 'logic-symbol') errors.push(`反例必须是普通知识结论: ${id}`);
  }
  return errors;
}

function downstreamIndex(nodes: readonly ProtocolNode[]): ReadonlyMap<string, readonly string[]> {
  const downstream = new Map<string, string[]>();
  for (const node of nodes) {
    for (const premiseId of node.premises) {
      const list = downstream.get(premiseId) ?? [];
      list.push(node.id);
      downstream.set(premiseId, list);
    }
  }
  return downstream;
}

function reachesDownstream(downstream: ReadonlyMap<string, readonly string[]>, fromId: string, targetId: string): boolean {
  if (fromId === targetId) return true;
  const seen = new Set<string>([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const nextId of downstream.get(current) ?? []) {
      if (nextId === targetId) return true;
      if (seen.has(nextId)) continue;
      seen.add(nextId);
      queue.push(nextId);
    }
  }
  return false;
}

function validateReasoningLink(nodes: ProtocolNode[], edit: AddReasoningLinkEdit): string[] {
  const errors: string[] = [];
  const byId = indexNodes(nodes);
  if (edit.requiredPremiseIds.length === 0) errors.push('新增推理至少需要选择一个已有前提');
  if (unique(edit.requiredPremiseIds).length !== edit.requiredPremiseIds.length) errors.push('新增推理的前提不能重复');
  if (edit.conclusionIds.length !== 1) errors.push('新增推理必须且只能选择一个已有结论');

  for (const id of edit.requiredPremiseIds) {
    const premise = byId.get(id);
    if (!premise) errors.push(`前提不存在: ${id}`);
    else if (!validReasoningLinkPremise(premise)) {
      errors.push(`前提必须是当前且已通过验证的非推理节点: ${id}`);
    }
  }

  for (const id of edit.conclusionIds) {
    const conclusion = byId.get(id);
    if (!conclusion) errors.push(`结论不存在: ${id}`);
    else if (conclusion.type === 'reasoning') errors.push(`结论不能是推理节点: ${id}`);
  }

  const overlap = edit.requiredPremiseIds.find(id => edit.conclusionIds.includes(id));
  if (overlap) errors.push(`同一节点不能同时作为前提和结论: ${overlap}`);
  if (edit.reasoning.type !== 'reasoning') errors.push('新增推理必须创建 reasoning 类型白球');
  errors.push(...validateDraftBatch(nodes, [edit.reasoning]));

  const downstream = downstreamIndex(nodes);
  for (const conclusionId of edit.conclusionIds) {
    for (const premiseId of edit.requiredPremiseIds) {
      if (reachesDownstream(downstream, conclusionId, premiseId)) {
        errors.push(`新增推理会形成依赖环: ${premiseId} → ${conclusionId}`);
      }
    }
  }
  return errors;
}

export function validateReasoningChain(nodes: ProtocolNode[], chain: ReasoningChain): string[] {
  const byId = indexNodes(nodes);
  const reasoning = byId.get(chain.reasoningId);
  const conclusion = byId.get(chain.conclusionId);
  const errors: string[] = [];

  if (chain.premiseIds.length === 0) errors.push('推理链至少需要一个前提');
  if (unique(chain.premiseIds).length !== chain.premiseIds.length) errors.push('推理链前提不能重复');
  for (const id of chain.premiseIds) {
    const premise = byId.get(id);
    if (!premise) errors.push(`前提不存在: ${id}`);
    else if (!active(premise)) errors.push(`前提当前不可用: ${id}`);
    else if (!validOrdinaryPremise(premise)) errors.push(`普通知识结论前提不能是 reasoning 或 logic-symbol: ${id}`);
  }

  if (!reasoning) errors.push(`推理过程不存在: ${chain.reasoningId}`);
  else {
    if (!active(reasoning)) errors.push(`推理过程当前不可用: ${reasoning.id}`);
    if (reasoning.type !== 'reasoning') errors.push(`推理过程节点必须是 reasoning 类型: ${reasoning.id}`);
    if (!sameSet(reasoning.premises, chain.premiseIds)) errors.push('推理过程的前提与推理链声明不一致');
    const logicRule = reasoning.logicRuleId ? byId.get(reasoning.logicRuleId) : undefined;
    if (reasoning.logicRuleId && (!logicRule || logicRule.type !== 'logic-symbol')) errors.push(`推理过程引用的逻辑符号无效: ${reasoning.logicRuleId}`);
    else if (reasoning.logicRuleId && !active(logicRule)) errors.push(`推理过程引用的逻辑符号当前不可用: ${reasoning.logicRuleId}`);
  }

  if (!conclusion) errors.push(`结论不存在: ${chain.conclusionId}`);
  else {
    if (!active(conclusion)) errors.push(`结论当前不可用: ${conclusion.id}`);
    if (conclusion.type === 'reasoning') errors.push('推理链结论不能是 reasoning 类型');
    if (!conclusion.premises.includes(chain.reasoningId)) {
      errors.push('结论必须直接依赖该推理过程节点');
    }
    if (conclusion.premises.some(id => byId.get(id)?.type !== 'reasoning')) {
      errors.push('结论的直接逻辑父节点必须全部是 reasoning 节点');
    }
  }
  return errors;
}

export function validateKnowledgeEdit(nodes: ProtocolNode[], edit: KnowledgeEdit): string[] {
  const byId = indexNodes(nodes);
  const errors: string[] = [];

  if (edit.kind === 'add') {
    if (edit.mode === 'atomic') {
      if (!ATOMIC_TYPES.has(edit.node.type)) {
        errors.push('公理、定义、事实和逻辑符号可以独立增加；其他结论必须提交完整推理链');
      }
      errors.push(...validateDraftBatch(nodes, [edit.node]));
    } else if (edit.mode === 'theory') {
      if (edit.requiredPremiseIds.length === 0) errors.push('增加理论必须标记至少一个已有知识前提');
      if (unique(edit.requiredPremiseIds).length !== edit.requiredPremiseIds.length) errors.push('所需前提不能重复');
      for (const id of edit.requiredPremiseIds) {
        const premise = byId.get(id);
        if (!premise) errors.push(`所需前提不存在: ${id}`);
        else if (!active(premise)) errors.push(`所需前提当前不可用: ${id}`);
        else if (!validOrdinaryPremise(premise)) errors.push(`所需的普通知识结论前提不能是 reasoning 或 logic-symbol: ${id}`);
        else if (premise.type === 'reasoning' || premise.type === 'logic-symbol') errors.push(`所需前提必须是普通知识结论: ${id}`);
      }
      if (edit.reasoning.type !== 'reasoning') errors.push('新增推理过程必须是 reasoning 类型');
      if (ATOMIC_TYPES.has(edit.conclusion.type) || edit.conclusion.type === 'reasoning') {
        errors.push('理论结论必须是定理、假说、预测、观点或价值判断');
      }
      errors.push(...validateDraftBatch(nodes, [edit.reasoning, edit.conclusion]));
    } else {
      errors.push(...validateReasoningLink(nodes, edit));
    }
  }

  if (edit.kind === 'negate') {
    const target = byId.get(edit.targetId);
    if (!target) errors.push(`否定目标不存在: ${edit.targetId}`);
    else if (!active(target)) errors.push(`否定目标当前不可用: ${edit.targetId}`);

    errors.push(...validateCounterexamples(nodes, edit));
    if (edit.target === 'reasoning') {
      if (target && target.type !== 'reasoning') errors.push('否定推理过程时，目标必须是 reasoning 节点');
      if (!edit.correctedReasoning) errors.push('否定错误推理过程时必须给出完整的正确推理过程');
      else {
        if (edit.correctedReasoning.type !== 'reasoning') errors.push('正确推理过程必须是 reasoning 类型');
        errors.push(...validateDraftBatch(nodes, [edit.correctedReasoning]));
      }
    } else {
      if (target?.type === 'reasoning') errors.push('reasoning 节点必须按推理过程方式否定');
      if (edit.correctedReasoning) errors.push('否定知识结论时不能附带替换推理过程');
    }
  }

  if (edit.kind === 'decompose') {
    errors.push(...validateReasoningChain(nodes, edit.chain));
    if (edit.reasoningSteps.length < 2) errors.push('分解必须包含至少两个推理过程');
    if (edit.intermediateConclusions.length !== edit.reasoningSteps.length - 1) {
      errors.push('相邻推理过程之间必须且只能添加一个中间知识结论');
    }
    if (edit.reasoningSteps.some(step => step.type !== 'reasoning')) {
      errors.push('分解中的每个推理步骤都必须是 reasoning 类型');
    }
    if (edit.intermediateConclusions.some(node => node.type === 'reasoning' || ATOMIC_TYPES.has(node.type))) {
      errors.push('分解产生的中间结论必须是定理、假说、预测、观点或价值判断');
    }
    errors.push(...validateDraftBatch(nodes, [...edit.reasoningSteps, ...edit.intermediateConclusions]));
  }

  if (edit.kind === 'merge' && edit.mode === 'definition') {
    if (edit.sourceNodeIds.length < 2) errors.push('定义合并至少需要两个来源定义');
    if (unique(edit.sourceNodeIds).length !== edit.sourceNodeIds.length) errors.push('定义合并来源不能重复');
    const sources = edit.sourceNodeIds.map(id => byId.get(id));
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const id = edit.sourceNodeIds[i];
      if (!source) errors.push(`来源定义不存在: ${id}`);
      else if (!active(source)) errors.push(`来源定义当前不可用: ${id}`);
      else if (source.type !== 'definition') errors.push(`来源节点不是定义: ${id}`);
    }
    const descriptions = new Set(sources.filter(Boolean).map(node => canonicalKnowledgeText(node!.reasoning)));
    if (sources.length >= 2 && descriptions.size < 2) {
      errors.push('定义合并需要同一定义的至少两种不同语言描述，不能提交完全重复文本');
    }
    if (!edit.semanticKey.trim()) errors.push('定义合并必须提供语义等价标识');
    if (edit.mergedDefinition.type !== 'definition') errors.push('合并结果必须是 definition 类型');
    errors.push(...validateDraftBatch(nodes, [edit.mergedDefinition]));
  }

  if (edit.kind === 'merge' && edit.mode === 'theory') {
    if (edit.chains.length < 2) errors.push('理论合并至少需要两条推理链');
    const conclusionIds = edit.chains.map(chain => chain.conclusionId);
    const reasoningIds = edit.chains.map(chain => chain.reasoningId);
    if (unique(conclusionIds).length !== conclusionIds.length) errors.push('理论合并的来源结论不能重复');
    if (unique(reasoningIds).length !== reasoningIds.length) errors.push('理论合并必须先选择彼此独立的推理过程');

    for (const chain of edit.chains) errors.push(...validateReasoningChain(nodes, chain));
    const first = edit.chains[0];
    const firstReasoning = first ? byId.get(first.reasoningId) : undefined;
    const firstConclusion = first ? byId.get(first.conclusionId) : undefined;
    for (const chain of edit.chains.slice(1)) {
      const reasoning = byId.get(chain.reasoningId);
      const conclusion = byId.get(chain.conclusionId);
      if (!first || !sameSet(first.premiseIds, chain.premiseIds)) {
        errors.push('理论合并要求所有推理链具有相同前提');
      }
      if (firstReasoning && reasoning && firstReasoning.logicRuleId !== reasoning.logicRuleId) {
        errors.push('理论合并要求推理过程使用同一逻辑符号');
      }
      if (firstConclusion && conclusion && firstConclusion.type !== conclusion.type) {
        errors.push('理论合并要求来源结论具有相同知识类型');
      }
    }

    if (!edit.reasoningSemanticKey.trim()) errors.push('理论合并必须先提供推理过程语义等价标识');
    if (!edit.semanticKey.trim()) errors.push('理论合并必须提供语义等价标识');
    if (edit.mergedReasoning.type !== 'reasoning') errors.push('合并推理过程必须是 reasoning 类型');
    if (edit.mergedConclusion.type === 'reasoning' || ATOMIC_TYPES.has(edit.mergedConclusion.type)) {
      errors.push('合并后的理论结论类型无效');
    }
    if (firstConclusion && edit.mergedConclusion.type !== firstConclusion.type) {
      errors.push('合并后的理论结论必须保持来源结论类型');
    }
    errors.push(...validateDraftBatch(nodes, [edit.mergedReasoning, edit.mergedConclusion]));
  }

  return unique(errors);
}

function suspendDownstream(nodes: ProtocolNode[], fromId: string): void {
  const visited = new Set<string>([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const node of nodes) {
      if (visited.has(node.id) || (!node.premises.includes(current) && node.logicRuleId !== current)) continue;
      visited.add(node.id);
      queue.push(node.id);
      if (node.status !== 'falsified') node.status = 'suspended';
    }
  }
}

function restoreClaimsWhoseOppositionWasNegated(nodes: ProtocolNode[], negatedId: string): void {
  const byId = indexNodes(nodes);
  for (const node of nodes) {
    if (node.status !== 'falsified' || !node.negatedBy?.includes(negatedId)) continue;
    const allOppositionNegated = node.negatedBy.every(id => byId.get(id)?.status === 'falsified');
    if (allOppositionNegated) {
      const replacement = node.supersededBy ? byId.get(node.supersededBy) : undefined;
      if (replacement) {
        for (const dependent of nodes) {
          if (dependent.hidden || dependent.supersededBy) continue;
          dependent.premises = dependent.premises.map(id => id === replacement.id ? node.id : id);
        }
        replacement.status = 'suspended';
        replacement.hidden = true;
        replacement.supersededBy = node.id;
        node.supersededBy = undefined;
      }
      node.status = 'pending';
      node.hidden = false;
    }
  }
}

/**
 * Mutate one already-validated protocol graph in place. Existing node objects keep
 * their identity; newly-created nodes are appended to the supplied array. This is
 * the single mutation implementation shared by the pure protocol API and live
 * projections.
 */
function mutateKnowledgeEditInPlace(nodes: ProtocolNode[], edit: KnowledgeEdit): void {
  const byId = indexNodes(nodes);
  const append = (node: ProtocolNode) => {
    nodes.push(node);
    byId.set(node.id, node);
  };

  if (edit.kind === 'add') {
    if (edit.mode === 'atomic') {
      append(nodeFromDraft(edit.node, []));
    } else if (edit.mode === 'theory') {
      append(nodeFromDraft(edit.reasoning, edit.requiredPremiseIds));
      append(nodeFromDraft(edit.conclusion, [edit.reasoning.id]));
    } else {
      append(nodeFromDraft(edit.reasoning, edit.requiredPremiseIds));
      for (const conclusionId of edit.conclusionIds) {
        const conclusion = byId.get(conclusionId)!;
        conclusion.premises = unique([...conclusion.premises, edit.reasoning.id]);
      }
    }
  }

  if (edit.kind === 'negate') {
    const target = byId.get(edit.targetId)!;
    target.status = 'falsified';
    target.hidden = true;
    target.negatedBy = unique([...(target.negatedBy ?? []), ...edit.counterexampleIds]);

    if (edit.target === 'reasoning') {
      const corrected = nodeFromDraft(edit.correctedReasoning!, target.premises);
      append(corrected);
      target.supersededBy = corrected.id;
      for (const node of nodes) {
        if (node.hidden || node.supersededBy) continue;
        node.premises = node.premises.map(id => id === target.id ? corrected.id : id);
      }
    } else {
      suspendDownstream(nodes, target.id);
    }
    restoreClaimsWhoseOppositionWasNegated(nodes, target.id);
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

    const finalReasoning = edit.reasoningSteps[edit.reasoningSteps.length - 1]!;
    conclusion.premises = conclusion.premises.map(id => id === original.id ? finalReasoning.id : id);
    original.supersededBy = edit.reasoningSteps[0].id;
    original.status = 'suspended';
    original.hidden = true;
  }

  if (edit.kind === 'merge' && edit.mode === 'definition') {
    const sources = edit.sourceNodeIds.map(id => byId.get(id)!);
    const aliases = unique(sources.flatMap(node => [node.title, ...(node.aliases ?? [])]));
    const merged = nodeFromDraft(edit.mergedDefinition, []);
    merged.aliases = aliases;
    merged.semanticKey = edit.semanticKey.trim();
    append(merged);

    for (const source of sources) {
      source.supersededBy = merged.id;
      source.status = 'suspended';
      source.hidden = true;
    }
    for (const node of nodes) {
      if (node.hidden || node.supersededBy) continue;
      node.premises = node.premises.map(id => edit.sourceNodeIds.includes(id) ? merged.id : id);
    }
  }

  if (edit.kind === 'merge' && edit.mode === 'theory') {
    const mergedReasoning = nodeFromDraft(edit.mergedReasoning, edit.chains[0].premiseIds);
    mergedReasoning.semanticKey = edit.reasoningSemanticKey.trim();
    append(mergedReasoning);
    const sourceConclusions = edit.chains.map(chain => byId.get(chain.conclusionId)!);
    const aliases = unique(sourceConclusions.flatMap(node => [node.title, ...(node.aliases ?? [])]));
    const mergedConclusion = nodeFromDraft(edit.mergedConclusion, [edit.mergedReasoning.id]);
    mergedConclusion.aliases = aliases;
    mergedConclusion.semanticKey = edit.semanticKey.trim();
    append(mergedConclusion);

    for (const chain of edit.chains) {
      const reasoning = byId.get(chain.reasoningId)!;
      const conclusion = byId.get(chain.conclusionId)!;
      reasoning.supersededBy = edit.mergedReasoning.id;
      conclusion.supersededBy = edit.mergedConclusion.id;
      reasoning.status = 'suspended';
      conclusion.status = 'suspended';
      reasoning.hidden = true;
      conclusion.hidden = true;
    }
    const sourceConclusionIds = new Set(edit.chains.map(chain => chain.conclusionId));
    for (const node of nodes) {
      if (node.hidden || node.supersededBy) continue;
      node.premises = node.premises.map(id => sourceConclusionIds.has(id) ? mergedConclusion.id : id);
    }
  }
}

/**
 * Projection-oriented protocol API. Validation is identical to applyKnowledgeEdit,
 * but successful edits preserve the identity of all existing node objects.
 */
export function applyKnowledgeEditInPlace(nodes: ProtocolNode[], edit: KnowledgeEdit): KnowledgeEditResult {
  const errors = validateKnowledgeEdit(nodes, edit);
  if (errors.length) return { nodes, errors };
  mutateKnowledgeEditInPlace(nodes, edit);
  return { nodes, errors: [] };
}

/**
 * Pure protocol API retained for command validation, tests, and callers that need
 * an immutable result. It shares the same mutation core after cloning once.
 */
export function applyKnowledgeEdit(nodes: ProtocolNode[], edit: KnowledgeEdit): KnowledgeEditResult {
  const errors = validateKnowledgeEdit(nodes, edit);
  if (errors.length) return { nodes, errors };
  const next = structuredClone(nodes);
  mutateKnowledgeEditInPlace(next, edit);
  return { nodes: next, errors: [] };
}
