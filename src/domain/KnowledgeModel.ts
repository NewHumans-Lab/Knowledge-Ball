export const PROTOCOL_VERSION = 1 as const;
export const SERIALIZATION_SCHEMA_VERSION = 2 as const;

export const NODE_TYPES = ['axiom', 'definition', 'fact', 'logic-symbol', 'reasoning', 'theorem', 'hypothesis', 'prediction', 'opinion', 'value'] as const;
export type NodeType = typeof NODE_TYPES[number];
export type EpistemicStatus = 'pending' | 'verified' | 'disputed' | 'falsified';
export type Availability = 'active' | 'suspended';
export type Lifecycle = 'current' | 'superseded';
export type Mastery = 'none' | 'touched' | 'mastered';
export type RelationType = 'premise' | 'conclusion' | 'logic-rule' | 'counterexample' | 'supersedes';

export const PROTOCOL_ERROR_CODES = [
  'UNSUPPORTED_PROTOCOL_VERSION', 'COMMAND_EVENT_MISMATCH', 'NODE_NOT_FOUND', 'NODE_NOT_AVAILABLE',
  'DUPLICATE_NODE_ID', 'DUPLICATE_TITLE', 'DUPLICATE_CONTENT', 'REFERENCE_NOT_FOUND', 'SELF_REFERENCE',
  'DUPLICATE_RELATION', 'INVALID_RELATION_ENDPOINT', 'DEPENDENCY_CYCLE', 'LOGIC_RULE_REQUIRED',
  'INVALID_LOGIC_RULE', 'INCOMPLETE_THEORY_CHAIN', 'COUNTEREXAMPLE_REQUIRED', 'INVALID_COUNTEREXAMPLE',
  'CORRECTED_REASONING_REQUIRED', 'INVALID_DECOMPOSITION', 'MERGE_IDENTITY_REQUIRED',
  'INCOMPATIBLE_MERGE_SOURCES', 'ILLEGAL_STATUS_TRANSITION', 'PERSONAL_STATE_IN_PUBLIC_PAYLOAD',
  'REVISION_CONFLICT',
] as const;
export type ProtocolErrorCode = typeof PROTOCOL_ERROR_CODES[number];
export interface ProtocolError { code: ProtocolErrorCode; path?: string; entityId?: string; details?: Record<string, unknown>; }

export interface KnowledgeRelation { id: string; type: RelationType; from: string; to: string; }
export interface PublicKnowledgeNode {
  id: string; title: string; type: NodeType; description: string;
  epistemicStatus: EpistemicStatus; availability: Availability; lifecycle: Lifecycle;
  tags: string[]; version: number; createdAt: string; updatedAt: string;
  aliases?: string[]; semanticKey?: string;
}
export interface PersonalKnowledgeState { nodeId: string; mastery: Mastery; updatedAt: string; version: number; }
export interface KnowledgeDisplayNode extends PublicKnowledgeNode { mastery: Mastery; }

export function normalizeKnowledgeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function isDefaultVisible(node: Pick<PublicKnowledgeNode, 'epistemicStatus' | 'availability' | 'lifecycle'>): boolean {
  return node.epistemicStatus !== 'falsified' && node.lifecycle === 'current';
}

/** The UI's only public/personal composition boundary. */
export function selectKnowledgeDisplay(
  nodes: PublicKnowledgeNode[], personalByNodeId: Readonly<Record<string, PersonalKnowledgeState>>, includeHistory = false,
): KnowledgeDisplayNode[] {
  return nodes.filter(node => includeHistory || isDefaultVisible(node)).map(node => ({
    ...node,
    mastery: personalByNodeId[node.id]?.mastery ?? 'none',
  }));
}

export const STATUS_TRANSITIONS: Readonly<Record<EpistemicStatus, readonly EpistemicStatus[]>> = {
  pending: ['verified', 'disputed', 'falsified'],
  verified: ['disputed', 'falsified'],
  disputed: ['verified', 'falsified'],
  falsified: ['pending'], // automatic counterexample invalidation only
};

export function validateStatusTransition(from: EpistemicStatus, to: EpistemicStatus, automatic = false): ProtocolError[] {
  if (!STATUS_TRANSITIONS[from].includes(to) || (from === 'falsified' && to === 'pending' && !automatic)) {
    return [{ code: 'ILLEGAL_STATUS_TRANSITION', details: { from, to, automatic } }];
  }
  return [];
}
