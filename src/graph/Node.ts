export type NodeStatus = 'Draft' | 'Verified' | 'Suspended';
export type NodeType = 'Axiom' | 'Hypothesis' | 'Theorem' | 'Fact';

export interface KnowledgeNode {
  id: string;
  title: string;
  type: NodeType;
  layer: string;
  status: NodeStatus;
  suspendedReason?: string;
  createdAt: number;
  updatedAt: number;
}