export type EdgeType = 'DependsOn' | 'Supports' | 'Contradicts';

export interface KnowledgeEdge {
  id: string;
  from: string; // nodeId
  to: string;   // nodeId
  type: EdgeType;
}