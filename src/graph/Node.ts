import type { NodeType, NodeStatus, Mastery } from '../event/Event';
import type { UserKnowledgeLayer } from '../domain/KnowledgeLayerPolicy';
import type { KnowledgeLineageMeta } from '../domain/KnowledgeLineage';

export interface GraphNode {
  id: string;
  title: string;
  type: NodeType;
  status: NodeStatus;
  mastery: Mastery;
  reasoning: string;
  premises: string[];
  /** User-declared semantic layer. Historical nodes may omit this and use compatibility inference. */
  declaredLayer?: UserKnowledgeLayer;
  hidden?: boolean;
  aliases?: string[];
  supersededBy?: string;
  logicRuleId?: string;
  negatedBy?: string[];
  semanticKey?: string;
  /** Immutable-ball lineage position. Legacy nodes omit it and behave as one-ball current topics. */
  lineage?: KnowledgeLineageMeta;
}
