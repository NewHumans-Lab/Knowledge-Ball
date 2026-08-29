import * as THREE from 'three';
import { lineageRoleFor, topicIdFor } from '../../domain/KnowledgeLineage';
import {
  generateIcosahedralGrid,
  LAYOUT_UNIT,
  type IcosahedralGrid,
  type LayoutNode,
} from './Deterministic5RLayout';

/**
 * Ordinary Knowledge lineage advances by one authoritative ISG shell-grid step.
 * The layout unit is the project's 5R spacing unit.
 */
export const ORDINARY_LINEAGE_SPACING = LAYOUT_UNIT;

const EPSILON = 1e-7;

type Family = Readonly<{
  topicId: string;
  anchor: LayoutNode;
  historySide: readonly LayoutNode[];
  oppositionSide: readonly LayoutNode[];
}>;

type LineCandidate = Readonly<{
  historyCells: readonly number[];
  oppositionCells: readonly number[];
  score: number;
  tie: string;
}>;

export function isOrdinaryLineageSatellite(node: LayoutNode): boolean {
  if (node.type === 'reasoning') return false;
  const role = lineageRoleFor(node);
  return role === 'history'
    || role === 'opposition'
    || role === 'candidate-history'
    || role === 'candidate-opposition';
}

function rankThenId(left: LayoutNode, right: LayoutNode): number {
  return (left.lineage?.rank ?? Number.MAX_SAFE_INTEGER)
    - (right.lineage?.rank ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id);
}

function collectFamilies(nodes: readonly LayoutNode[]): Family[] {
  const byTopic = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    if (node.type === 'reasoning' || lineageRoleFor(node) === 'rejected') continue;
    const topicId = topicIdFor(node);
    const members = byTopic.get(topicId);
    if (members) members.push(node);
    else byTopic.set(topicId, [node]);
  }

  const families: Family[] = [];
  for (const [topicId, members] of byTopic) {
    const anchor = members.find(node => lineageRoleFor(node) === 'current');
    if (!anchor?.pos || !anchor.address || anchor.pos.lengthSq() <= EPSILON) continue;

    const pendingHistory = members
      .filter(node => lineageRoleFor(node) === 'candidate-history')
      .sort((left, right) => left.id.localeCompare(right.id));
    const stableHistory = members
      .filter(node => lineageRoleFor(node) === 'history')
      .sort(rankThenId);
    const pendingOpposition = members
      .filter(node => lineageRoleFor(node) === 'candidate-opposition')
      .sort((left, right) => left.id.localeCompare(right.id));
    const stableOpposition = members
      .filter(node => lineageRoleFor(node) === 'opposition')
      .sort(rankThenId);

    if (!pendingHistory.length && !stableHistory.length && !pendingOpposition.length && !stableOpposition.length) continue;
    families.push({
      topicId,
      anchor,
      historySide: [...pendingHistory, ...stableHistory],
      oppositionSide: [...pendingOpposition, ...stableOpposition],
    });
  }

  return families.sort((left, right) => left.topicId.localeCompare(right.topicId));
}

function edgeKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function neighborMap(grid: IcosahedralGrid): ReadonlyMap<number, readonly number[]> {
  const result = new Map<number, number[]>();
  const add = (left: number, right: number) => {
    const list = result.get(left) ?? [];
    list.push(right);
    result.set(left, list);
  };
  for (const edge of grid.edges) {
    const [left, right] = edge.split(':').map(Number);
    add(left!, right!);
    add(right!, left!);
  }
  for (const list of result.values()) list.sort((left, right) => left - right);
  return result;
}

function tangentDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const radial = from.clone().normalize();
  return to.clone()
    .sub(from)
    .addScaledVector(radial, -to.clone().sub(from).dot(radial))
    .normalize();
}

function cellIsFree(
  grid: IcosahedralGrid,
  cellID: number,
  obstacles: readonly LayoutNode[],
  ignoredIds: ReadonlySet<string>,
  usedCells: ReadonlySet<number>,
): boolean {
  if (usedCells.has(cellID)) return false;
  const position = grid.vertices[cellID];
  if (!position) return false;
  for (const obstacle of obstacles) {
    if (ignoredIds.has(obstacle.id) || !obstacle.pos) continue;
    if (position.distanceTo(obstacle.pos) < ORDINARY_LINEAGE_SPACING - EPSILON) return false;
  }
  return true;
}

function continueLine(
  grid: IcosahedralGrid,
  neighbors: ReadonlyMap<number, readonly number[]>,
  anchorCell: number,
  firstCell: number,
  length: number,
  obstacles: readonly LayoutNode[],
  ignoredIds: ReadonlySet<string>,
  globallyUsed: ReadonlySet<number>,
): readonly number[] | null {
  if (length === 0) return [];
  const path = [firstCell];
  const locallyUsed = new Set<number>([anchorCell, ...globallyUsed, firstCell]);
  let previous = anchorCell;
  let current = firstCell;

  while (path.length < length) {
    const currentPosition = grid.vertices[current]!;
    const incoming = tangentDirection(currentPosition, grid.vertices[previous]!).multiplyScalar(-1);
    const options = (neighbors.get(current) ?? [])
      .filter(cellID => cellID !== previous)
      .filter(cellID => cellIsFree(grid, cellID, obstacles, ignoredIds, locallyUsed))
      .map(cellID => {
        const outgoing = tangentDirection(currentPosition, grid.vertices[cellID]!);
        return { cellID, straightness: incoming.dot(outgoing) };
      })
      .sort((left, right) => right.straightness - left.straightness || left.cellID - right.cellID);
    const next = options[0]?.cellID;
    if (next === undefined) return null;
    path.push(next);
    locallyUsed.add(next);
    previous = current;
    current = next;
  }

  return path;
}

function pathBendScore(grid: IcosahedralGrid, anchorCell: number, path: readonly number[]): number {
  if (path.length <= 1) return 0;
  let previous = anchorCell;
  let current = path[0]!;
  let score = 0;
  for (let index = 1; index < path.length; index++) {
    const next = path[index]!;
    const currentPosition = grid.vertices[current]!;
    const incoming = tangentDirection(currentPosition, grid.vertices[previous]!).multiplyScalar(-1);
    const outgoing = tangentDirection(currentPosition, grid.vertices[next]!);
    score += 1 - incoming.dot(outgoing);
    previous = current;
    current = next;
  }
  return score;
}

function chooseCoordinateLine(
  family: Family,
  grid: IcosahedralGrid,
  obstacles: readonly LayoutNode[],
  globallyUsed: ReadonlySet<number>,
): LineCandidate {
  const anchorCell = family.anchor.address!.cellID;
  const neighbors = neighborMap(grid);
  const anchorNeighbors = neighbors.get(anchorCell) ?? [];
  const ignoredIds = new Set([
    family.anchor.id,
    ...family.historySide.map(node => node.id),
    ...family.oppositionSide.map(node => node.id),
  ]);
  const candidates: LineCandidate[] = [];

  const historyStarts = family.historySide.length ? anchorNeighbors : [-1];
  const oppositionStarts = family.oppositionSide.length ? anchorNeighbors : [-1];

  for (const historyStart of historyStarts) {
    if (historyStart >= 0 && !cellIsFree(grid, historyStart, obstacles, ignoredIds, globallyUsed)) continue;
    for (const oppositionStart of oppositionStarts) {
      if (historyStart >= 0 && oppositionStart === historyStart) continue;
      if (oppositionStart >= 0 && !cellIsFree(grid, oppositionStart, obstacles, ignoredIds, globallyUsed)) continue;

      const historyCells = historyStart < 0
        ? []
        : continueLine(
          grid,
          neighbors,
          anchorCell,
          historyStart,
          family.historySide.length,
          obstacles,
          ignoredIds,
          globallyUsed,
        );
      if (!historyCells) continue;

      const historyUsed = new Set<number>([...globallyUsed, ...historyCells]);
      const oppositionCells = oppositionStart < 0
        ? []
        : continueLine(
          grid,
          neighbors,
          anchorCell,
          oppositionStart,
          family.oppositionSide.length,
          obstacles,
          ignoredIds,
          historyUsed,
        );
      if (!oppositionCells) continue;

      let oppositeScore = 0;
      if (historyCells.length && oppositionCells.length) {
        const anchorPosition = grid.vertices[anchorCell]!;
        const historyDirection = tangentDirection(anchorPosition, grid.vertices[historyCells[0]!]!);
        const oppositionDirection = tangentDirection(anchorPosition, grid.vertices[oppositionCells[0]!]!);
        oppositeScore = 1 + historyDirection.dot(oppositionDirection);
      }
      const score = oppositeScore
        + pathBendScore(grid, anchorCell, historyCells)
        + pathBendScore(grid, anchorCell, oppositionCells);
      candidates.push({
        historyCells,
        oppositionCells,
        score,
        tie: `${historyCells.join('.')}:${oppositionCells.join('.')}`,
      });
    }
  }

  candidates.sort((left, right) => left.score - right.score || left.tie.localeCompare(right.tie));
  const best = candidates[0];
  if (!best) throw new Error(`Ordinary lineage has no collision-free 5R shell coordinate line: ${family.topicId}`);
  return best;
}

/**
 * Ordinary Knowledge lineage keeps Current as the global anchor, while every
 * existing History/Opposition member occupies an authoritative cell on the same
 * shell. Members advance one ISG coordinate-line edge at a time (the project's
 * nominal 5R layout unit). History and Opposition choose the most nearly opposite
 * directions through Current, and deeper members continue as straight as the
 * icosahedral shell grid permits.
 *
 * No future slots are reserved. When membership changes, this local coordinate
 * line is recalculated against the current occupied shell geometry. Reasoning is
 * intentionally outside this ordinary-lineage rule.
 */
export function applyOrdinaryLineagePlacement(nodes: LayoutNode[]): void {
  const satellites = nodes.filter(isOrdinaryLineageSatellite);
  for (const node of satellites) {
    delete node.address;
    delete node.pos;
    delete node.homePos;
    node.vel?.set(0, 0, 0);
  }

  const globallyUsedByShell = new Map<string, Set<number>>();
  for (const node of nodes) {
    if (!node.address || isOrdinaryLineageSatellite(node)) continue;
    const used = globallyUsedByShell.get(node.address.shellID) ?? new Set<number>();
    used.add(node.address.cellID);
    globallyUsedByShell.set(node.address.shellID, used);
  }

  const families = collectFamilies(nodes);
  for (const family of families) {
    const shellID = family.anchor.address!.shellID;
    const radius = family.anchor.pos!.length();
    const grid = generateIcosahedralGrid(radius, undefined, shellID);
    const globallyUsed = globallyUsedByShell.get(shellID) ?? new Set<number>();
    globallyUsed.add(family.anchor.address!.cellID);

    const candidate = chooseCoordinateLine(family, grid, nodes, globallyUsed);
    const assignments = [
      ...family.historySide.map((node, index) => [node, candidate.historyCells[index]!] as const),
      ...family.oppositionSide.map((node, index) => [node, candidate.oppositionCells[index]!] as const),
    ];

    for (const [node, cellID] of assignments) {
      const position = grid.vertices[cellID]!.clone();
      node.address = { shellID, cellID };
      node.pos = position.clone();
      node.homePos = position.clone();
      node.vel ??= new THREE.Vector3();
      node.vel.set(0, 0, 0);
      globallyUsed.add(cellID);
    }
    globallyUsedByShell.set(shellID, globallyUsed);
  }
}

export function isCoordinateLineStep(grid: IcosahedralGrid, leftCellID: number, rightCellID: number): boolean {
  return grid.edges.has(edgeKey(leftCellID, rightCellID));
}
