import type { Mastery, NodeType } from '../domain/KnowledgeModel';
export type { Mastery, NodeType } from '../domain/KnowledgeModel';

export type NodeStatus = 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';

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
  initialStatus?: NodeStatus; source?: 'import';
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

export type KnowledgeAddedEvent = EventEnvelope<'KnowledgeAdded', { edit: AddEdit }>;
export type KnowledgeNegatedEvent = EventEnvelope<'KnowledgeNegated', { edit: NegateEdit }>;
export type KnowledgeDecomposedEvent = EventEnvelope<'KnowledgeDecomposed', { edit: DecomposeEdit }>;
export type KnowledgeMergedEvent = EventEnvelope<'KnowledgeMerged', { edit: MergeEdit }>;
export type KnowledgeStatusChangedEvent = EventEnvelope<'KnowledgeStatusChanged', {
  edit: { kind: 'status'; nodeId: string; status: 'verified' | 'suspended' | 'disputed'; causeNodeId?: string };
}>;
export type KnowledgeNodeEditedEvent = EventEnvelope<'KnowledgeNodeEdited', {
  edit: { kind: 'update'; nodeId: string; title?: string; nodeType?: NodeType; reasoning?: string; premises?: string[] };
}>;

export type PublicKnowledgeEvent = NodeCreatedEvent | NodeEditedEvent | NodeFalsifiedEvent | NodeSuspendedEvent | NodeResolvedEvent | NodeDisputedEvent | KnowledgeAddedEvent | KnowledgeNegatedEvent | KnowledgeDecomposedEvent | KnowledgeMergedEvent | KnowledgeStatusChangedEvent | KnowledgeNodeEditedEvent;
export type PersonalKnowledgeEvent = NodeMasterySetEvent;

export type DomainEvent =
  | NodeCreatedEvent | NodeEditedEvent | NodeFalsifiedEvent | NodeSuspendedEvent
  | NodeResolvedEvent | NodeMasterySetEvent | NodeDisputedEvent
  | KnowledgeAddedEvent | KnowledgeNegatedEvent | KnowledgeDecomposedEvent | KnowledgeMergedEvent | KnowledgeStatusChangedEvent | KnowledgeNodeEditedEvent;

export const CURRENT_SCHEMA_VERSION = 1;

export function isPublicKnowledgeEvent(event: DomainEvent): event is PublicKnowledgeEvent {
  return event.type !== 'NodeMasterySet' && (event.scope === undefined || event.scope === 'public');
}
export function isCanonicalPublicKnowledgeEvent(event: DomainEvent): event is KnowledgeAddedEvent | KnowledgeNegatedEvent | KnowledgeDecomposedEvent | KnowledgeMergedEvent | KnowledgeStatusChangedEvent | KnowledgeNodeEditedEvent {
  return event.scope === 'public' && ['KnowledgeAdded','KnowledgeNegated','KnowledgeDecomposed','KnowledgeMerged','KnowledgeStatusChanged','KnowledgeNodeEdited'].includes(event.type);
}
export function migrateEventScope(event: DomainEvent): DomainEvent {
  return event.scope ? event : { ...event, scope: event.type === 'NodeMasterySet' ? 'personal' : 'public' } as DomainEvent;
}
