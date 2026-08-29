export const MOBILE_LABEL_MIN = 12;
export const MOBILE_LABEL_MAX = 18;
export const MOBILE_DENSE_CENTER_LABELS = 6;

export interface ShellLabelCandidate {
  id: string;
  shellId: string;
  cameraDistance: number;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  frontFacing: boolean;
}

const distance = (a: ShellLabelCandidate, b: ShellLabelCandidate) => Math.hypot(a.x - b.x, a.y - b.y);
const centrality = (candidate: ShellLabelCandidate) => {
  const dx = (candidate.x - candidate.viewportWidth / 2) / Math.max(candidate.viewportWidth, 1);
  const dy = (candidate.y - candidate.viewportHeight / 2) / Math.max(candidate.viewportHeight, 1);
  return dx * dx + dy * dy;
};

/** Select labels from existing spherical shells without changing graph/layout state. */
export function selectShellLabels(candidates: readonly ShellLabelCandidate[], previous: ReadonlySet<string> = new Set(), maxLabels = MOBILE_LABEL_MAX): Set<string> {
  const eligible = candidates.filter(candidate => candidate.frontFacing
    && candidate.x >= 0 && candidate.x <= candidate.viewportWidth
    && candidate.y >= 0 && candidate.y <= candidate.viewportHeight);
  const shells = new Map<string, ShellLabelCandidate[]>();
  for (const candidate of eligible) {
    const shell = shells.get(candidate.shellId) ?? [];
    shell.push(candidate);
    shells.set(candidate.shellId, shell);
  }
  const orderedShells = [...shells.values()].sort((a, b) =>
    Math.min(...a.map(value => value.cameraDistance)) - Math.min(...b.map(value => value.cameraDistance)));
  const selected: ShellLabelCandidate[] = [];
  for (const shell of orderedShells) {
    // A small retained-choice bonus is view-space hysteresis: meaningful camera
    // movement can still replace a label, while sub-pixel ranking noise cannot.
    shell.sort((a, b) => (centrality(a) - (previous.has(a.id) ? .012 : 0))
      - (centrality(b) - (previous.has(b.id) ? .012 : 0)) || a.id.localeCompare(b.id));
    for (const candidate of shell) {
      if (selected.length >= maxLabels) break;
      const spacing = selected.length < MOBILE_DENSE_CENTER_LABELS ? 38 : 74;
      if (selected.every(other => distance(candidate, other) >= spacing)) selected.push(candidate);
    }
    if (selected.length >= maxLabels) break;
  }
  if (selected.length < MOBILE_LABEL_MIN) {
    for (const shell of orderedShells) for (const candidate of shell) {
      if (selected.length >= Math.min(MOBILE_LABEL_MIN, eligible.length)) break;
      if (!selected.some(value => value.id === candidate.id) && selected.every(other => distance(candidate, other) >= 28)) selected.push(candidate);
    }
  }
  return new Set(selected.map(candidate => candidate.id));
}
