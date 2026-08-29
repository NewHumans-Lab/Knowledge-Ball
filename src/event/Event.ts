import type { Mastery, NodeType } from '../domain/KnowledgeModel';
import type { UserKnowledgeLayer } from '../domain/KnowledgeLayerPolicy';
export type { Mastery, NodeType } from '../domain/KnowledgeModel';

export type NodeStatus = 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';
export type KnowledgeVerdictPolicyVersion = 'ORIGINAL_DESIGN_V1' | 'ORIGINAL_DESIGN_V2' | 'KNOWLEDGE_LINEAGE_V3_CASCADE';
export type KnowledgeRevalidationScope = 'GLOBAL' | 'LOCAL_10';

interface EventEnvelope<TType extends string, TPayload, TScope extends 'public' | 'personal' = 'public'> {
  id: string;
  type: TType;
  scope?: TScope;
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

import type { AddEdit, DecomposeEdit, NegateEdit } from '../protocol/KnowledgeEditingProtocol';

export interface KnowledgeOptimizationMetadata {
  targetId: string;
  topicId: string;
}

export interface KnowledgeOppositionMetadata {
  targetId: string;
  topicId: string;
}

export type KnowledgeAddedEvent = EventEnvelope<'KnowledgeAdded', {
  edit: AddEdit;
  declaredLayers?: Record<string, UserKnowledgeLayer>;
  optimization?: KnowledgeOptimizationMetadata;
  opposition?: KnowledgeOppositionMetadata;
}>;
export type KnowledgeNegatedEvent = EventEnvelope<'KnowledgeNegated', { edit: NegateEdit }>;
export type KnowledgeDecomposedEvent = EventEnvelope<'KnowledgeDecomposed', { edit: DecomposeEdit }>;
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

/** Server-authored only. Starting a challenge never changes lineage role/color. */
export type KnowledgeRevalidationStartedEvent = EventEnvelope<'KnowledgeRevalidationStarted', {
  roundId: string;
  nodeId: string;
  topicId: string;
  roleAtStart: 'history' | 'opposition';
  stage: number;
  stake: string;
  scope: KnowledgeRevalidationScope;
  accuracyGate?: number;
  localHopLimit?: number;
  requiredVotes: number;
  deadline: string;
  policyVersion: 'ORIGINAL_DESIGN_V1';
}>;

/** CORRECT means the challenged old ball becomes current; INCORRECT means current remains unchanged. */
export type KnowledgeRevalidationFinalizedEvent = EventEnvelope<'KnowledgeRevalidationFinalized', {
  roundId: string;
  nodeId: string;
  topicId: string;
  verdict: 'CORRECT' | 'INCORRECT';
  closeReason: 'THRESHOLD' | 'TIMEOUT';
  agreeCount: number;
  disagreeCount: number;
  requiredVotes: number;
  stage: number;
  policyVersion: 'ORIGINAL_DESIGN_V1';
}>;

export type PublicKnowledgeEvent =
  | NodeCreatedEvent | NodeEditedEvent | NodeFalsifiedEvent | NodeSuspendedEvent | NodeResolvedEvent | NodeDisputedEvent
  | KnowledgeAddedEvent | KnowledgeNegatedEvent | KnowledgeDecomposedEvent
  | KnowledgeStatusChangedEvent | KnowledgeNodeEditedEvent | KnowledgeVerdictFinalizedEvent
  | KnowledgeRevalidationStartedEvent | KnowledgeRevalidationFinalizedEvent;
export type PersonalKnowledgeEvent = NodeMasterySetEvent;

export type DomainEvent = PublicKnowledgeEvent | PersonalKnowledgeEvent;

export const CURRENT_SCHEMA_VERSION = 1;

export function isPublicKnowledgeEvent(event: DomainEvent): event is PublicKnowledgeEvent {
  return event.type !== 'NodeMasterySet' && (event.scope === undefined || event.scope === 'public');
}

// Only client-writable command families belong here. Verdict/revalidation lifecycle
// events are server-authored and sync-readable but can never be pushed by clients.
export function isCanonicalPublicKnowledgeEvent(event: DomainEvent): event is KnowledgeAddedEvent | KnowledgeNegatedEvent | KnowledgeDecomposedEvent | KnowledgeStatusChangedEvent | KnowledgeNodeEditedEvent {
  return event.scope === 'public' && ['KnowledgeAdded','KnowledgeNegated','KnowledgeDecomposed','KnowledgeStatusChanged','KnowledgeNodeEdited'].includes(event.type);
}
export function migrateEventScope(event: DomainEvent): DomainEvent {
  return event.scope ? event : { ...event, scope: event.type === 'NodeMasterySet' ? 'personal' : 'public' } as DomainEvent;
}
