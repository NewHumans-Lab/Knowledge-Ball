import type { NodeType, NodeStatus, Mastery } from '../event/Event';

export interface GraphNode {
  id: string;
  title: string;
  type: NodeType;
  status: NodeStatus;
  mastery: Mastery;
  reasoning: string;
  premises: string[];
}
