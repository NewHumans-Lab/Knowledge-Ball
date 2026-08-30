export const STABLE_LABEL_MIN = 12;
export const STABLE_LABEL_MAX = 18;
export const STABLE_LABEL_CENTER_CAP = 6;
export const STABLE_LABEL_WHITELIST = new Set(['n1', 'n2', 'n16']);

export type StableShellLabelCandidate = Readonly<{
  id: string;
  x: number;
  y: number;
  shellRadius: number;
}>;

function onScreen(candidate: StableShellLabelCandidate, width: number, height: number): boolean {
  return candidate.x >= 0 && candidate.x <= width && candidate.y >= 0 && candidate.y <= height;
}

function inCenter(candidate: StableShellLabelCandidate, width: number, height: number): boolean {
  return Math.abs(candidate.x - width * 0.5) <= width * 0.27
    && Math.abs(candidate.y - height * 0.5) <= height * 0.20;
}

function farEnough(
  candidate: StableShellLabelCandidate,
  selected: readonly StableShellLabelCandidate[],
  gap: number,
): boolean {
  const gapSq = gap * gap;
  return selected.every(other => {
    const dx = candidate.x - other.x;
    const dy = candidate.y - other.y;
    return dx * dx + dy * dy >= gapSq;
  });
}

function addByShellAndSpacing(
  ordered: readonly StableShellLabelCandidate[],
  selected: StableShellLabelCandidate[],
  selectedIds: Set<string>,
  limit: number,
  width: number,
  height: number,
  centerGap: number,
  outerGap: number,
  centerCap = STABLE_LABEL_CENTER_CAP,
): void {
  let centerCount = selected.filter(candidate => inCenter(candidate, width, height)).length;
  for (const candidate of ordered) {
    if (selected.length >= limit || selectedIds.has(candidate.id)) continue;
    const central = inCenter(candidate, width, height);
    if (central && centerCount >= centerCap) continue;
    const gap = central ? centerGap : outerGap;
    if (!farEnough(candidate, selected, gap)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    if (central) centerCount += 1;
  }
}

function choose(
  candidates: readonly StableShellLabelCandidate[],
  retained: readonly StableShellLabelCandidate[],
  target: number,
  width: number,
  height: number,
): Set<string> {
  const ordered = [...candidates].sort((left, right) => right.shellRadius - left.shellRadius || left.id.localeCompare(right.id));
  const selected = [...retained];
  const selectedIds = new Set(selected.map(candidate => candidate.id));
  const shortSide = Math.max(1, Math.min(width, height));
  const centerGap = Math.max(36, shortSide * 0.11);
  const outerGap = Math.max(64, shortSide * 0.18);

  addByShellAndSpacing(ordered, selected, selectedIds, target, width, height, centerGap, outerGap);
  if (selected.length < target) addByShellAndSpacing(ordered, selected, selectedIds, target, width, height, centerGap * 0.8, outerGap * 0.8);
  if (selected.length < target) addByShellAndSpacing(ordered, selected, selectedIds, target, width, height, centerGap * 0.6, outerGap * 0.6);
  if (selected.length < target) addByShellAndSpacing(ordered, selected, selectedIds, target, width, height, 0, 0, target);

  return new Set(selected.slice(0, target).map(candidate => candidate.id));
}

/**
 * Large-mobile label hysteresis:
 * - only on-screen candidates participate;
 * - the core triad whitelist always survives once those labels become eligible;
 * - ordinary labels keep shell radius as the ranking priority (outer first);
 * - the centre normally holds at most six ordinary labels with a tighter spacing;
 * - 12..18 is the stable band: do not reshuffle ordinary retained labels while possible;
 * - the whitelist consumes part of the same 18-label cap; it never increases the cap.
 */
export function selectStableShellLabels(
  candidates: readonly StableShellLabelCandidate[],
  previous: ReadonlySet<string>,
  width: number,
  height: number,
): Set<string> {
  const eligible = candidates.filter(candidate => onScreen(candidate, width, height));
  const byId = new Map(eligible.map(candidate => [candidate.id, candidate] as const));
  const whitelisted = eligible.filter(candidate => STABLE_LABEL_WHITELIST.has(candidate.id));
  const whitelistedIds = new Set(whitelisted.map(candidate => candidate.id));
  const retainedOrdinary = [...previous]
    .filter(id => !whitelistedIds.has(id))
    .map(id => byId.get(id))
    .filter((candidate): candidate is StableShellLabelCandidate => Boolean(candidate));
  const retained = [...whitelisted, ...retainedOrdinary].slice(0, STABLE_LABEL_MAX);

  if (eligible.length <= STABLE_LABEL_MAX) return new Set(eligible.map(candidate => candidate.id));

  if (retained.length >= STABLE_LABEL_MIN && retained.length <= STABLE_LABEL_MAX) {
    return new Set(retained.map(candidate => candidate.id));
  }

  const target = previous.size === 0
    ? STABLE_LABEL_MAX
    : Math.min(STABLE_LABEL_MIN, eligible.length);
  return choose(eligible, retained, target, width, height);
}
