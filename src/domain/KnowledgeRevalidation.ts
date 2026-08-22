import type { GraphNode } from '../graph/Node';
import manifest from './truth-protocol/v1/original-design-policy.manifest.json';
import {
  challengePolicy,
  ordinaryVotesRequired,
  timeoutVerdict,
  type EscalationPolicy,
} from './truth-protocol/v1/original-design-policy';
import {
  currentNodeForTopic,
  lineageRoleFor,
  topicIdFor,
  validateKnowledgeLineage,
} from './KnowledgeLineage';

export type RevalidationVerdict = 'PENDING' | 'CORRECT' | 'INCORRECT';

export interface RevalidationRoundPolicy extends EscalationPolicy {
  stage: number;
  requiredVotes: number;
  localHopLimit?: number;
}

export interface PreviousChallengeResult {
  stage: number;
  verdict: Exclude<RevalidationVerdict, 'PENDING'>;
}

export interface RevalidationEligibilityInput {
  accuracyPercent: number;
  localDistance?: number;
}

function assertFrozenManifest(): void {
  const initial = challengePolicy(0);
  if (initial.stake !== BigInt(manifest.challengeInitialStake) || initial.scope !== 'GLOBAL') {
    throw new Error('ORIGINAL_DESIGN_V1 challenge manifest/interpreter mismatch');
  }
  if (!Number.isSafeInteger(manifest.localHopLimit) || manifest.localHopLimit < 1) {
    throw new Error('ORIGINAL_DESIGN_V1 localHopLimit is invalid');
  }
}

/**
 * Adapter only: every stake/scope/accuracy stage comes from the frozen V1
 * interpreter. This module deliberately does not copy the challenge ladder.
 */
export function revalidationRoundPolicy(stage: number, eligibleUserSnapshot: number): RevalidationRoundPolicy {
  assertFrozenManifest();
  const policy = challengePolicy(stage);
  return {
    ...policy,
    stage,
    requiredVotes: ordinaryVotesRequired(eligibleUserSnapshot),
    localHopLimit: policy.scope === 'LOCAL_10' ? manifest.localHopLimit : undefined,
  };
}

/** An unchanged result advances one stage; any successful flip resets the ladder. */
export function nextRevalidationStage(previous?: PreviousChallengeResult): number {
  if (!previous) return 0;
  if (!Number.isSafeInteger(previous.stage) || previous.stage < 0) throw new RangeError('previous stage must be non-negative');
  return previous.verdict === 'CORRECT' ? 0 : previous.stage + 1;
}

/**
 * Accuracy and locality are eligibility gates, never alternate stake formulas.
 * A LOCAL_10 round requires authoritative graph distance <= the frozen hop limit.
 */
export function canParticipateInRevalidation(
  policy: RevalidationRoundPolicy,
  input: RevalidationEligibilityInput,
): boolean {
  if (!Number.isFinite(input.accuracyPercent) || input.accuracyPercent < 0 || input.accuracyPercent > 100) return false;
  if (policy.accuracyGate !== undefined && input.accuracyPercent < policy.accuracyGate) return false;
  if (policy.scope === 'LOCAL_10') {
    return Number.isSafeInteger(input.localDistance)
      && input.localDistance! >= 0
      && input.localDistance! <= (policy.localHopLimit ?? manifest.localHopLimit);
  }
  return true;
}

/**
 * V1 timeout semantics: the initiator is the AGREE position and participates
 * only in timeout majority, not the ordinary threshold count. A true tie stays
 * PENDING; 0:0 ordinary ballots therefore becomes 1:0 through the initiator.
 */
export function revalidationTimeoutVerdict(
  agreeOrdinary: number,
  disagreeOrdinary: number,
): { verdict: RevalidationVerdict; tied: boolean } {
  const result = timeoutVerdict('PENDING', 'AGREE', agreeOrdinary, disagreeOrdinary);
  return { verdict: result.verdict, tied: result.tied };
}

function assertLineage(nodes: readonly GraphNode[]): void {
  const errors = validateKnowledgeLineage(nodes);
  if (errors.length) throw new Error(`Invalid knowledge lineage after revalidation: ${errors.join('; ')}`);
}

export function beginKnowledgeRevalidation(nodes: GraphNode[], nodeId: string): 'history' | 'opposition' {
  const node = nodes.find(item => item.id === nodeId);
  if (!node) throw new Error(`Revalidation node not found: ${nodeId}`);
  const role = lineageRoleFor(node);
  if (role !== 'history' && role !== 'opposition') throw new Error('Only stable history/opposition nodes may be revalidated');
  if (node.status !== 'verified') throw new Error('Only stable verified lineage nodes may start revalidation');
  node.status = 'disputed';
  return role;
}

function reactivateHistoryNode(nodes: GraphNode[], selected: GraphNode): string {
  const topicId = topicIdFor(selected);
  const current = currentNodeForTopic(nodes, topicId);
  if (!current) throw new Error(`Revalidation topic has no current node: ${topicId}`);

  const otherHistory = nodes
    .filter(node => node.id !== selected.id && topicIdFor(node) === topicId && lineageRoleFor(node) === 'history')
    .sort((left, right) => (left.lineage?.rank ?? 0) - (right.lineage?.rank ?? 0));

  const currentMeta = current.lineage ?? { topicId, proposal: 'new' as const, role: 'current' as const, rank: 0 };
  current.lineage = { ...currentMeta, topicId, role: 'history', rank: 1 };
  current.hidden = true;
  otherHistory.forEach((node, index) => {
    if (!node.lineage) throw new Error(`Historical lineage metadata missing: ${node.id}`);
    node.lineage = { ...node.lineage, role: 'history', rank: index + 2 };
    node.hidden = true;
  });

  if (!selected.lineage) throw new Error(`Selected history metadata missing: ${selected.id}`);
  selected.lineage = { ...selected.lineage, role: 'current', rank: 0 };
  selected.status = 'verified';
  selected.hidden = false;
  return current.id;
}

function reactivateOppositionNode(nodes: GraphNode[], selected: GraphNode): string {
  const topicId = topicIdFor(selected);
  const current = currentNodeForTopic(nodes, topicId);
  if (!current) throw new Error(`Revalidation topic has no current node: ${topicId}`);

  const oldHistory = nodes
    .filter(node => topicIdFor(node) === topicId && lineageRoleFor(node) === 'history')
    .sort((left, right) => (left.lineage?.rank ?? 0) - (right.lineage?.rank ?? 0));
  const otherOpposition = nodes
    .filter(node => node.id !== selected.id && topicIdFor(node) === topicId && lineageRoleFor(node) === 'opposition')
    .sort((left, right) => (left.lineage?.rank ?? 0) - (right.lineage?.rank ?? 0));

  otherOpposition.forEach((node, index) => {
    if (!node.lineage) throw new Error(`Opposition lineage metadata missing: ${node.id}`);
    node.lineage = { ...node.lineage, role: 'history', rank: index + 1 };
    node.hidden = true;
  });

  const currentMeta = current.lineage ?? { topicId, proposal: 'new' as const, role: 'current' as const, rank: 0 };
  current.lineage = { ...currentMeta, topicId, role: 'opposition', rank: 1 };
  current.hidden = true;
  oldHistory.forEach((node, index) => {
    if (!node.lineage) throw new Error(`Historical lineage metadata missing: ${node.id}`);
    node.lineage = { ...node.lineage, role: 'opposition', rank: index + 2 };
    node.hidden = true;
  });

  if (!selected.lineage) throw new Error(`Selected opposition metadata missing: ${selected.id}`);
  selected.lineage = { ...selected.lineage, role: 'current', rank: 0 };
  selected.status = 'verified';
  selected.hidden = false;
  return current.id;
}

export function finalizeKnowledgeRevalidation(
  nodes: GraphNode[],
  nodeId: string,
  verdict: Exclude<RevalidationVerdict, 'PENDING'>,
): string | null {
  const selected = nodes.find(node => node.id === nodeId);
  if (!selected) throw new Error(`Revalidation node not found: ${nodeId}`);
  if (selected.status !== 'disputed') throw new Error('Only an active revalidation may finalize');
  const role = lineageRoleFor(selected);
  if (role !== 'history' && role !== 'opposition') throw new Error('Revalidation target must retain its original lineage role until final verdict');

  if (verdict === 'INCORRECT') {
    selected.status = 'verified';
    assertLineage(nodes);
    return null;
  }

  const previousCurrentId = role === 'history'
    ? reactivateHistoryNode(nodes, selected)
    : reactivateOppositionNode(nodes, selected);
  assertLineage(nodes);
  return previousCurrentId;
}
