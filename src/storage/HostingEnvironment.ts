export function supportsSharedKnowledgeApi(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized !== 'rushow111.github.io' && !normalized.endsWith('.github.io');
}
