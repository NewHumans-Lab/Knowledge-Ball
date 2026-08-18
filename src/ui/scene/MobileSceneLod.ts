export const MOBILE_ACTIVE_NODE_TARGET = 49;
export const MOBILE_ACTIVE_NODE_ENTER_RANK = 45;
export const MOBILE_ACTIVE_NODE_EXIT_RANK = 55;

export interface MobileSceneCandidate {
  id: string;
  score: number;
}

export function selectMobileActiveNodeIds(
  candidates: readonly MobileSceneCandidate[],
  previous: ReadonlySet<string>,
  forcedIds: ReadonlySet<string>,
): Set<string> {
  if (candidates.length <= MOBILE_ACTIVE_NODE_TARGET) {
    return new Set(candidates.map(candidate => candidate.id));
  }

  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const rankById = new Map(ranked.map((candidate, index) => [candidate.id, index] as const));
  const candidateIds = new Set(ranked.map(candidate => candidate.id));
  const next = new Set<string>();

  for (const id of forcedIds) {
    if (candidateIds.has(id)) next.add(id);
  }

  const preferred = ranked.filter((candidate, index) => {
    if (next.has(candidate.id)) return false;
    if (previous.has(candidate.id)) return index < MOBILE_ACTIVE_NODE_EXIT_RANK;
    return index < MOBILE_ACTIVE_NODE_ENTER_RANK;
  });

  for (const candidate of preferred) {
    if (next.size >= MOBILE_ACTIVE_NODE_TARGET) break;
    next.add(candidate.id);
  }

  for (const candidate of ranked) {
    if (next.size >= MOBILE_ACTIVE_NODE_TARGET) break;
    next.add(candidate.id);
  }

  if (next.size > MOBILE_ACTIVE_NODE_TARGET) {
    const removable = [...next]
      .filter(id => !forcedIds.has(id))
      .sort((a, b) => (rankById.get(b) ?? Infinity) - (rankById.get(a) ?? Infinity));
    while (next.size > MOBILE_ACTIVE_NODE_TARGET && removable.length > 0) {
      next.delete(removable.shift()!);
    }
  }

  return next;
}
