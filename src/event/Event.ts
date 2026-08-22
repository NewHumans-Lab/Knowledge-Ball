import type { Mastery, NodeType } from '../domain/KnowledgeModel';
import type { UserKnowledgeLayer } from '../domain/KnowledgeLayerPolicy';
export type { Mastery, NodeType } from '../domain/KnowledgeModel';

export type NodeStatus = 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';
export type KnowledgeVerdictPolicyVersion = 'ORIGINAL_DESIGN_V1' | 'ORIGINAL_DESIGN_V2';

interface EventEnvelope<TType extends string, TPayload, TScope extends 'public' | 'personal' = 'public'> {
  id: string;
  type: TType;
  scope?: TScope; // optional only for persisted v0 migration; every new event sets it
  schemaVersion: number;
  timestamp: number;
  seq?: number;
  payload: TPayload;
}

export type NodeCreatedEvent = EventEnvelope<'NodeCreated', {
  nodeId: string; title: string; nodeType: NodeType; reasoning: string; premises: string[];
  initialStatus?: NodeStatus; source?: 'import'; declaredLayer?: UserKnowledgeLayer;
  hidden?: boolean; aliases?: string[]; supersededBy?: string; logicRuleId?: string;
  negatedBy?: string[]; semanticKey?: string;
}>;
export type NodeEditedEvent = EventEnvelope<'NodeEdited', {
  nodeId: string; title?: string; nodeType?: NodeType; reasoning?: string; premises?: string[];
}>;
export type NodeFalsifiedEvent = EventEnvelope<'NodeFalsified', { nodeId: string }>;
export type NodeSuspendedEvent = EventEnvelope<'NodeSuspended', { nodeId: string; causeNodeId: string }>;
export type NodeDisputedEvent = EventEnvelope<'NodeDisputed', { nodeId: string }>;
export type NodeResolvedEvent = EventEnvelope<'NodeResolved', { nodeId: string }>;
export type NodeMasterySetEvent = EventEnvelope<'NodeMasterySet', { nodeId: string; mastery: Mastery }, 'personal'>;

import type {
  AddEdit,
  DecomposeEdit,
  MergeEdit,
  NegateEdit,
} from '../protocol/KnowledgeEditingProtocol';

export interface KnowledgeOptimizationMetadata {
  /** Current knowledge ball that this immutable candidate was created to improve. */
  targetId: string;
  /** Stable topic identity copied from the target at submission time. */
  topicId: string;
}

export interface KnowledgeOppositionMetadata {
  /** Current knowledge ball challenged by this immutable opposing viewpoint. */
  targetId: string;
  /** Stable topic identity shared by both viewpoint chains. */
  topicId: string;
}

export type KnowledgeAddedEvent = EventEnvelope<'KnowledgeAdded', {
  edit: AddEdit;
  /** Explicit layer declarations for nodes created by this event. Missing entries are legacy-compatible. */
  declaredLayers?: Record<string, UserKnowledgeLayer>;
  /** Optimization candidate lineage intent; mutually exclusive with opposition. */
  optimization?: KnowledgeOptimizationMetadata;
  /** Opposition candidate lineage intent; mutually exclusive with optimization. */
  opposition?: KnowledgeOppositionMetadata;
}>;
export type KnowledgeNegatedEvent = EventEnvelope<'KnowledgeNegated', { edit: NegateEdit }>;
export type KnowledgeDecomposedEvent = EventEnvelope<'KnowledgeDecomposed', { edit: DecomposeEdit }>;
export type KnowledgeMergedEvent = EventEnvelope<'KnowledgeMerged', { edit: MergeEdit }>;
export type KnowledgeStatusChangedEvent = EventEnvelope<'KnowledgeStatusChanged', {
  edit: { kind: 'status'; nodeId: string; status: 'verified' | 'suspended' | 'disputed'; causeNodeId?: string };
}>;
export type KnowledgeNodeEditedEvent = EventEnvelope<'KnowledgeNodeEdited', {
  edit: { kind: 'update'; nodeId: string; title?: string; nodeType?: NodeType; reasoning?: string; premises?: string[] };
}>;
export type KnowledgeVerdictFinalizedEvent = EventEnvelope<'KnowledgeVerdictFinalized', {
  roundId: string;
  nodeId: string;
  verdict: 'CORRECT' | 'INCORRECT';
  closeReason: 'THRESHOLD' | 'TIMEOUT';
  agreeCount: number;
  disagreeCount: number;
  requiredVotes: number;
  policyVersion: KnowledgeVerdictPolicyVersion;
}>;

export type PublicKnowledgeEvent = NodeCreatedEvent | NodeEditedEvent | NodeFalsifiedEvent | NodeSuspendedEvent | NodeResolvedEvent | NodeDisputedEvent | KnowledgeAddedEvent | KnowledgeNegatedEvent | KnowledgeDecomposedEvent | KnowledgeMergedEvent | KnowledgeStatusChangedEvent | KnowledgeNodeEditedEvent | KnowledgeVerdictFinalizedEvent;
export type PersonalKnowledgeEvent = NodeMasterySetEvent;

export type DomainEvent =
  | NodeCreatedEvent | NodeEditedEvent | NodeFalsifiedEvent | NodeSuspendedEvent
  | NodeResolvedEvent | NodeMasterySetEvent | NodeDisputedEvent
  | KnowledgeAddedEvent | KnowledgeNegatedEvent | KnowledgeDecomposedEvent | KnowledgeMergedEvent
  | KnowledgeStatusChangedEvent | KnowledgeNodeEditedEvent | KnowledgeVerdictFinalizedEvent;

export const CURRENT_SCHEMA_VERSION = 1;

export function isPublicKnowledgeEvent(event: DomainEvent): event is PublicKnowledgeEvent {
  return event.type !== 'NodeMasterySet' && (event.scope === undefined || event.scope === 'public');
}

// This guard is intentionally the client-writable canonical command family.
// Server-authored KnowledgeVerdictFinalized is public and sync-readable, but it
// must never be queued or pushed back through append_public_knowledge_events.
export function isCanonicalPublicKnowledgeEvent(event: DomainEvent): event is KnowledgeAddedEvent | KnowledgeNegatedEvent | KnowledgeDecomposedEvent | KnowledgeMergedEvent | KnowledgeStatusChangedEvent | KnowledgeNodeEditedEvent {
  return event.scope === 'public' && ['KnowledgeAdded','KnowledgeNegated','KnowledgeDecomposed','KnowledgeMerged','KnowledgeStatusChanged','KnowledgeNodeEdited'].includes(event.type);
}
export function migrateEventScope(event: DomainEvent): DomainEvent {
  return event.scope ? event : { ...event, scope: event.type === 'NodeMasterySet' ? 'personal' : 'public' } as DomainEvent;
}
