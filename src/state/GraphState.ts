import type { GraphNode } from '../graph/Node';

export interface GraphState {
  nodesById: Record<string, GraphNode>;
}

export function emptyGraphState(): GraphState {
  return { nodesById: {} };
}

export function nodeList(state: GraphState): GraphNode[] {
  return Object.values(state.nodesById);
}
