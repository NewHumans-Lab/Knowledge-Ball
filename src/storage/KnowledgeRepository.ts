import type { KnowledgeNodeRecord, KnowledgeNodeDraft } from './KnowledgeNode';

export interface KnowledgeRepository {
  saveNode(node: KnowledgeNodeRecord): Promise<void>;
  saveNodes(nodes: KnowledgeNodeRecord[]): Promise<void>;
  saveDraft(draft: KnowledgeNodeDraft): Promise<void>;
  listNodes(domain?: string): Promise<KnowledgeNodeRecord[]>;
  getNode(id: string): Promise<KnowledgeNodeRecord | null>;
  deleteNode(id: string): Promise<void>;
}
