import type { UserKnowledgeLayer } from '../domain/KnowledgeLayerPolicy';

export type LineageIntentKind = 'optimization' | 'opposition';

const MARK = '\u241e';
const TITLE_PREFIX = `${MARK}KBL3:`;
const CONTENT_PREFIX = `${MARK}KBL3:content${MARK}`;

export interface LineageIntent {
  kind: LineageIntentKind;
  layer: UserKnowledgeLayer;
  title: string;
  description: string;
}

export function encodeLineageIntent(intent: LineageIntent): { title: string; reasoning: string } {
  return {
    title: `${TITLE_PREFIX}${intent.kind}:${intent.layer}${MARK}${intent.title}`,
    reasoning: `${CONTENT_PREFIX}${intent.description}`,
  };
}

export function decodeLineageIntent(title: string | undefined, reasoning: string | undefined): LineageIntent | null {
  if (!title?.startsWith(TITLE_PREFIX) || !reasoning?.startsWith(CONTENT_PREFIX)) return null;
  const match = title.match(/^\u241eKBL3:(optimization|opposition):(inner|middle|outer)\u241e([\s\S]+)$/);
  if (!match) return null;
  const description = reasoning.slice(CONTENT_PREFIX.length);
  const cleanTitle = match[3]?.trim() ?? '';
  if (!cleanTitle || !description.trim()) return null;
  return {
    kind: match[1] as LineageIntentKind,
    layer: match[2] as UserKnowledgeLayer,
    title: cleanTitle,
    description: description.trim(),
  };
}
