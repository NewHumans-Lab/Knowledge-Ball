import type { Mastery, PersonalKnowledgeState } from '../domain/KnowledgeModel';

export type PersonalKnowledgeEvent = {
  id: string; type: 'PersonalMasterySet'; schemaVersion: 1; timestamp: number;
  payload: { nodeId: string; mastery: Mastery; updatedAt: string; version: number };
};

export interface PersonalState { byNodeId: Record<string, PersonalKnowledgeState>; }
export const PERSONAL_EVENT_STORAGE_KEY = 'knowledge-ball.personal-events.v1';
export const emptyPersonalState = (): PersonalState => ({ byNodeId: {} });

export function evolvePersonal(state: PersonalState, event: PersonalKnowledgeEvent): PersonalState {
  return { byNodeId: { ...state.byNodeId, [event.payload.nodeId]: { nodeId: event.payload.nodeId, mastery: event.payload.mastery,
    updatedAt: event.payload.updatedAt, version: event.payload.version } } };
}
