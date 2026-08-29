import * as THREE from 'three';

export const CHAIN_ISOLATION_LONG_PRESS_MS = 2500;
export const CHAIN_ISOLATION_MOVE_TOLERANCE_PX = 10;
export const CHAIN_ISOLATION_ENTER_MS = 900;
export const CHAIN_ISOLATION_EXIT_MS = 900;
export const CHAIN_ISOLATION_ABSORB_FRACTION = 0.4;
export const CHAIN_ISOLATION_CORE_SCALE = 0.08;

export type ChainIsolationNode = Readonly<{
  id: string;
  type?: string;
  address?: Readonly<{ shellID: string; cellID: number }>;
  pos?: THREE.Vector3;
  homePos?: THREE.Vector3;
}>;

export type ChainIsolationEdge = Readonly<{
  fromId: string;
  toId: string;
}>;

const SHELL_RADIUS_EPSILON = 1e-3;

function finitePosition(node: ChainIsolationNode): THREE.Vector3 | null {
  const position = node.homePos ?? node.pos;
  return position && [position.x, position.y, position.z].every(Number.isFinite) ? position : null;
}

function isKnowledgeNode(node: ChainIsolationNode): boolean {
  return node.type !== 'reasoning' && node.type !== 'logic-symbol';
}

export function connectedChainIds(
  seedId: string,
  nodes: readonly ChainIsolationNode[],
  edges: readonly ChainIsolationEdge[],
  eligibleIds?: ReadonlySet<string>,
): ReadonlySet<string> {
  const nodeIds = new Set(nodes.map(node => node.id));
  if (!nodeIds.has(seedId) || (eligibleIds && !eligibleIds.has(seedId))) return new Set();

  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!nodeIds.has(a) || !nodeIds.has(b)) return;
    if (eligibleIds && (!eligibleIds.has(a) || !eligibleIds.has(b))) return;
    let from = adjacency.get(a);
    if (!from) adjacency.set(a, from = new Set());
    from.add(b);
  };
  for (const edge of edges) {
    link(edge.fromId, edge.toId);
    link(edge.toId, edge.fromId);
  }

  const visited = new Set<string>();
  const queue = [seedId];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of adjacency.get(id) ?? []) if (!visited.has(next)) queue.push(next);
  }
  return visited;
}

export function middleShellChainCenter(
  nodes: readonly ChainIsolationNode[],
  chainIds: ReadonlySet<string>,
): THREE.Vector3 {
  const candidates = nodes
    .filter(node => chainIds.has(node.id) && isKnowledgeNode(node))
    .map(node => ({ node, position: finitePosition(node) }))
    .filter((entry): entry is { node: ChainIsolationNode; position: THREE.Vector3 } => entry.position !== null);

  const fallback = () => {
    const positions = nodes
      .filter(node => chainIds.has(node.id))
      .map(finitePosition)
      .filter((position): position is THREE.Vector3 => position !== null);
    if (!positions.length) return new THREE.Vector3();
    return positions.reduce((sum, position) => sum.add(position), new THREE.Vector3()).multiplyScalar(1 / positions.length);
  };
  if (!candidates.length) return fallback();

  const canonicalShells = new Map<string, THREE.Vector3[]>();
  for (const entry of candidates) {
    const shellID = entry.node.address?.shellID;
    if (!shellID) continue;
    const positions = canonicalShells.get(shellID) ?? [];
    positions.push(entry.position);
    canonicalShells.set(shellID, positions);
  }

  const shells: Array<{ radius: number; positions: THREE.Vector3[] }> = canonicalShells.size
    ? [...canonicalShells.values()].map(positions => ({
      radius: positions.reduce((sum, position) => sum + position.length(), 0) / positions.length,
      positions,
    }))
    : [];

  if (!shells.length) {
    const sorted = [...candidates].sort((a, b) => a.position.length() - b.position.length() || a.node.id.localeCompare(b.node.id));
    for (const entry of sorted) {
      const radius = entry.position.length();
      const shell = shells.find(value => Math.abs(value.radius - radius) <= SHELL_RADIUS_EPSILON);
      if (shell) shell.positions.push(entry.position);
      else shells.push({ radius, positions: [entry.position] });
    }
  }
  shells.sort((a, b) => a.radius - b.radius);

  const radialMidpoint = (shells[0]!.radius + shells[shells.length - 1]!.radius) / 2;
  const middleShell = shells.reduce((best, shell) => {
    const delta = Math.abs(shell.radius - radialMidpoint);
    const bestDelta = Math.abs(best.radius - radialMidpoint);
    return delta < bestDelta - SHELL_RADIUS_EPSILON
      || (Math.abs(delta - bestDelta) <= SHELL_RADIUS_EPSILON && shell.radius < best.radius)
      ? shell
      : best;
  }, shells[0]!);

  return middleShell.positions
    .reduce((sum, position) => sum.add(position), new THREE.Vector3())
    .multiplyScalar(1 / middleShell.positions.length);
}

export function chainIsolationRenderPosition(
  authoritative: THREE.Vector3,
  anchorCenter: THREE.Vector3,
  inChain: boolean,
  entering: boolean,
  progress: number,
): THREE.Vector3 {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const absorbEnd = CHAIN_ISOLATION_ABSORB_FRACTION;
  if (entering) {
    if (!inChain) return authoritative.clone().lerp(new THREE.Vector3(), Math.min(1, p / absorbEnd));
    if (p <= absorbEnd) return authoritative.clone().lerp(new THREE.Vector3(), p / absorbEnd);
    const grow = (p - absorbEnd) / (1 - absorbEnd);
    return authoritative.clone().sub(anchorCenter).multiplyScalar(grow);
  }

  if (inChain) {
    if (p <= absorbEnd) {
      const shrink = p / absorbEnd;
      return authoritative.clone().sub(anchorCenter).multiplyScalar(1 - shrink);
    }
    const restore = (p - absorbEnd) / (1 - absorbEnd);
    return authoritative.clone().multiplyScalar(restore);
  }
  const restore = p <= absorbEnd ? 0 : (p - absorbEnd) / (1 - absorbEnd);
  return authoritative.clone().multiplyScalar(restore);
}

export function chainIsolationNodeScale(inChain: boolean, entering: boolean, progress: number): number {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const absorbEnd = CHAIN_ISOLATION_ABSORB_FRACTION;
  if (entering) {
    if (!inChain) return Math.max(0, 1 - p / absorbEnd);
    if (p <= absorbEnd) return Math.max(0.08, 1 - 0.92 * p / absorbEnd);
    return 0.08 + 0.92 * (p - absorbEnd) / (1 - absorbEnd);
  }
  if (inChain) {
    if (p <= absorbEnd) return Math.max(0.08, 1 - 0.92 * p / absorbEnd);
    return 0.08 + 0.92 * (p - absorbEnd) / (1 - absorbEnd);
  }
  return p <= absorbEnd ? 0 : (p - absorbEnd) / (1 - absorbEnd);
}
