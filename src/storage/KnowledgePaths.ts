import type { KnowledgeDomain, KnowledgeNodeRecord } from './KnowledgeNode';

const DOMAIN_FOLDER: Record<KnowledgeDomain, string> = {
  logic: 'logic',
  mathematics: 'mathematics',
  physics: 'physics',
  biology: 'biology',
  chemistry: 'chemistry',
  'computer-science': 'computer-science',
  economics: 'economics',
  history: 'history',
  philosophy: 'philosophy',
  general: 'general',
};

export function getNodeFolder(domain: KnowledgeDomain): string {
  return DOMAIN_FOLDER[domain] ?? 'general';
}

export function getNodePath(node: KnowledgeNodeRecord): string {
  return `knowledge/nodes/${getNodeFolder(node.domain)}/${node.id}.json`;
}

export function getIndexPath(scope: 'nodes' | 'tags' | 'authors' = 'nodes'): string {
  return `knowledge/index/${scope}.json`;
}