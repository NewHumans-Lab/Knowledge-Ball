export type NodeType =
  | 'axiom' | 'definition' | 'fact' | 'theorem'
  | 'hypothesis' | 'prediction' | 'opinion' | 'value';

export type NodeStatus = 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';
export type Mastery = 'none' | 'touched' | 'mastered';

interface EventEnvelope<TType extends string, TPayload> {
  id: string;
  type: TType;
  schemaVersion: number;
  timestamp: number;
  seq?: number;
  payload: TPayload;
}

export type NodeCreatedEvent = EventEnvelope<'NodeCreated', {
  nodeId: string; title: string; nodeType: NodeType; reasoning: string; premises: string[];
}>;
export type NodeEditedEvent = EventEnvelope<'NodeEdited', {
  nodeId: string; title?: string; nodeType?: NodeType; reasoning?: string; premises?: string[];
}>;
export type NodeFalsifiedEvent = EventEnvelope<'NodeFalsified', { nodeId: string }>;
export type NodeSuspendedEvent = EventEnvelope<'NodeSuspended', { nodeId: string; causeNodeId: string }>;
export type NodeDisputedEvent = EventEnvelope<'NodeDisputed', { nodeId: string }>;
export type NodeResolvedEvent = EventEnvelope<'NodeResolved', { nodeId: string }>;
export type NodeMasterySetEvent = EventEnvelope<'NodeMasterySet', { nodeId: string; mastery: Mastery }>;

export type DomainEvent =
  | NodeCreatedEvent | NodeEditedEvent | NodeFalsifiedEvent | NodeSuspendedEvent
  | NodeResolvedEvent | NodeMasterySetEvent | NodeDisputedEvent;

export const CURRENT_SCHEMA_VERSION = 1;
