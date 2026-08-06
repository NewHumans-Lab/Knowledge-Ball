export type KnowledgeNodeType =
  | 'axiom'
  | 'definition'
  | 'fact'
  | 'theorem'
  | 'hypothesis'
  | 'prediction'
  | 'opinion'
  | 'value';

export type KnowledgeNodeStatus = 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';
export type KnowledgeMastery = 'none' | 'touched' | 'mastered';

export type KnowledgeDomain =
  | 'logic'
  | 'mathematics'
  | 'physics'
  | 'biology'
  | 'chemistry'
  | 'computer-science'
  | 'economics'
  | 'history'
  | 'philosophy'
  | 'general';

export interface KnowledgeNodeDraft {
  title: string;
  type: KnowledgeNodeType;
  reasoning: string;
  premises?: string[];
  tags?: string[];
  domain?: KnowledgeDomain;
  author?: string;
}

export interface KnowledgeNodeRecord {
  id: string;
  title: string;
  type: KnowledgeNodeType;
  status: KnowledgeNodeStatus;
  mastery: KnowledgeMastery;
  reasoning: string;
  premises: string[];
  tags: string[];
  domain: KnowledgeDomain;
  version: number;
  createdAt: string;
  updatedAt: string;
  author?: string;
}

export function normalizeKnowledgeNodeDraft(draft: KnowledgeNodeDraft): KnowledgeNodeDraft {
  return {
    ...draft,
    premises: Array.isArray(draft.premises) ? draft.premises : [],
    tags: Array.isArray(draft.tags) ? draft.tags : [],
    domain: draft.domain ?? 'general',
  };
}

export function buildKnowledgeNodeRecord(
  id: string,
  draft: KnowledgeNodeDraft,
  now = new Date()
): KnowledgeNodeRecord {
  const normalized = normalizeKnowledgeNodeDraft(draft);
  const iso = now.toISOString();

  return {
    id,
    title: normalized.title.trim(),
    type: normalized.type,
    status: 'pending',
    mastery: 'none',
    reasoning: normalized.reasoning.trim(),
    premises: normalized.premises ?? [],
    tags: normalized.tags ?? [],
    domain: normalized.domain ?? 'general',
    version: 1,
    createdAt: iso,
    updatedAt: iso,
    author: normalized.author,
  };
}

export function validateKnowledgeNodeRecord(node: KnowledgeNodeRecord): string[] {
  const errors: string[] = [];

  if (!node.id.trim()) errors.push('Missing id');
  if (!node.title.trim()) errors.push('Missing title');
  if (!node.reasoning.trim()) errors.push('Missing reasoning');

  if (!node.domain) errors.push('Missing domain');
  if (!['axiom', 'definition', 'fact', 'theorem', 'hypothesis', 'prediction', 'opinion', 'value'].includes(node.type)) {
    errors.push(`Invalid type: ${node.type}`);
  }

  if (!['pending', 'verified', 'suspended', 'disputed', 'falsified'].includes(node.status)) {
    errors.push(`Invalid status: ${node.status}`);
  }

  if (!['none', 'touched', 'mastered'].includes(node.mastery)) {
    errors.push(`Invalid mastery: ${node.mastery}`);
  }

  if (!Array.isArray(node.premises)) errors.push('premises must be an array');
  if (!Array.isArray(node.tags)) errors.push('tags must be an array');

  return errors;
}