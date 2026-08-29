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
 * LAYOUT_UNIT is the project's 5R centre-spacing rule; actual shell chords can
 * be slightly larger because positions must remain on canonical ISG cells.
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

type RelocationHome = Readonly<{
  shellID: string;
  radius: number;
  origin: THREE.Vector3;
}>;

type SpatialSnapshot = Readonly<{
  address?: Readonly<{ shellID: string; cellID: number }>;
  pos?: THREE.Vector3;
  homePos?: THREE.Vector3;
  vel?: THREE.Vector3;
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
  const chord = to.clone().sub(from);
  return chord
    .addScaledVector(radial, -chord.dot(radial))
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
    if (obstacle.type === 'reasoning' || ignoredIds.has(obstacle.id) || !obstacle.pos) continue;
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

function findCoordinateLines(
  family: Family,
  grid: IcosahedralGrid,
  obstacles: readonly LayoutNode[],
  usedCells: ReadonlySet<number>,
  ignoredIds: ReadonlySet<string>,
): LineCandidate[] {
  const anchorCell = family.anchor.address!.cellID;
  const neighbors = neighborMap(grid);
  const anchorNeighbors = neighbors.get(anchorCell) ?? [];
  const candidates: LineCandidate[] = [];

  const historyStarts = family.historySide.length ? anchorNeighbors : [-1];
  const oppositionStarts = family.oppositionSide.length ? anchorNeighbors : [-1];

  for (const historyStart of historyStarts) {
    if (historyStart >= 0 && !cellIsFree(grid, historyStart, obstacles, ignoredIds, usedCells)) continue;
    for (const oppositionStart of oppositionStarts) {
      if (historyStart >= 0 && oppositionStart === historyStart) continue;
      if (oppositionStart >= 0 && !cellIsFree(grid, oppositionStart, obstacles, ignoredIds, usedCells)) continue;

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
          usedCells,
        );
      if (!historyCells) continue;

      const historyUsed = new Set<number>([...usedCells, ...historyCells]);
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
      candidates.push({
        historyCells,
        oppositionCells,
        score: oppositeScore
          + pathBendScore(grid, anchorCell, historyCells)
          + pathBendScore(grid, anchorCell, oppositionCells),
        tie: `${historyCells.join('.')}:${oppositionCells.join('.')}`,
      });
    }
  }

  return candidates.sort((left, right) => left.score - right.score || left.tie.localeCompare(right.tie));
}

function familyIds(family: Family): ReadonlySet<string> {
  return new Set([
    family.anchor.id,
    ...family.historySide.map(node => node.id),
    ...family.oppositionSide.map(node => node.id),
  ]);
}

function usedCellsOnShell(
  nodes: readonly LayoutNode[],
  shellID: string,
  ignoredIds: ReadonlySet<string>,
): ReadonlySet<number> {
  return new Set(nodes
    .filter(node => node.type !== 'reasoning' && node.address?.shellID === shellID && !ignoredIds.has(node.id))
    .map(node => node.address!.cellID));
}

function isRelocatableOrdinary(node: LayoutNode, protectedAnchorIds: ReadonlySet<string>): boolean {
  return node.type !== 'reasoning'
    && lineageRoleFor(node) !== 'rejected'
    && !isOrdinaryLineageSatellite(node)
    && !protectedAnchorIds.has(node.id)
    && !!node.address
    && !!node.pos;
}

function candidateCells(candidate: LineCandidate): readonly number[] {
  return [...candidate.historyCells, ...candidate.oppositionCells];
}

function linePositions(candidate: LineCandidate, grid: IcosahedralGrid): THREE.Vector3[] {
  return candidateCells(candidate).map(cellID => grid.vertices[cellID]!.clone());
}

function positionConflictsWithLine(position: THREE.Vector3, reservedLinePositions: readonly THREE.Vector3[]): boolean {
  return reservedLinePositions.some(reserved => position.distanceTo(reserved) < ORDINARY_LINEAGE_SPACING - EPSILON);
}

function blockersForCandidate(
  candidate: LineCandidate,
  grid: IcosahedralGrid,
  nodes: readonly LayoutNode[],
  relocatableIds: ReadonlySet<string>,
): LayoutNode[] {
  const positions = linePositions(candidate, grid);
  return nodes
    .filter(node => relocatableIds.has(node.id) && !!node.pos)
    .filter(node => positionConflictsWithLine(node.pos!, positions))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function snapshotNodes(nodes: readonly LayoutNode[]): Map<string, SpatialSnapshot> {
  return new Map(nodes.map(node => [node.id, {
    address: node.address ? { ...node.address } : undefined,
    pos: node.pos?.clone(),
    homePos: node.homePos?.clone(),
    vel: node.vel?.clone(),
  }]));
}

function restoreNodes(nodes: readonly LayoutNode[], snapshot: ReadonlyMap<string, SpatialSnapshot>): void {
  for (const node of nodes) {
    const saved = snapshot.get(node.id);
    if (!saved) continue;
    if (saved.address) node.address = { ...saved.address };
    else delete node.address;
    if (saved.pos) node.pos = saved.pos.clone();
    else delete node.pos;
    if (saved.homePos) node.homePos = saved.homePos.clone();
    else delete node.homePos;
    if (saved.vel) {
      node.vel ??= new THREE.Vector3();
      node.vel.copy(saved.vel);
    } else {
      delete node.vel;
    }
  }
}

function clearSpatial(node: LayoutNode): void {
  delete node.address;
  delete node.pos;
  delete node.homePos;
}

function collisionState(
  subjectId: string,
  position: THREE.Vector3,
  nodes: readonly LayoutNode[],
  relocatableIds: ReadonlySet<string>,
): Readonly<{ hard: boolean; softIds: readonly string[] }> {
  const softIds: string[] = [];
  for (const node of nodes) {
    if (node.id === subjectId || node.type === 'reasoning' || !node.pos) continue;
    if (position.distanceTo(node.pos) >= ORDINARY_LINEAGE_SPACING - EPSILON) continue;
    if (relocatableIds.has(node.id)) softIds.push(node.id);
    else return { hard: true, softIds: [] };
  }
  softIds.sort((left, right) => left.localeCompare(right));
  return { hard: false, softIds };
}

function positionIsFreeNow(
  subjectId: string,
  position: THREE.Vector3,
  nodes: readonly LayoutNode[],
  reservedLinePositions: readonly THREE.Vector3[],
): boolean {
  if (positionConflictsWithLine(position, reservedLinePositions)) return false;
  for (const node of nodes) {
    if (node.id === subjectId || node.type === 'reasoning' || !node.pos) continue;
    if (position.distanceTo(node.pos) < ORDINARY_LINEAGE_SPACING - EPSILON) return false;
  }
  return true;
}

function assignRelocatedNode(node: LayoutNode, shellID: string, cellID: number, position: THREE.Vector3): void {
  node.address = { shellID, cellID };
  node.pos = position.clone();
  node.homePos = position.clone();
  node.vel ??= new THREE.Vector3();
  node.vel.set(0, 0, 0);
}

/**
 * Cascading local reflow, analogous to displacement in an occupancy table.
 * A blocker keeps its semantic shell. It first tries the nearest canonical cell;
 * if that cell is occupied only by another relocatable ordinary node, that node
 * is recursively displaced first. Hard lineage anchors/satellites never move.
 */
function cascadeRelocate(
  nodeId: string,
  nodes: readonly LayoutNode[],
  relocatableNodes: readonly LayoutNode[],
  relocatableById: ReadonlyMap<string, LayoutNode>,
  relocationHomes: ReadonlyMap<string, RelocationHome>,
  relocatableIds: ReadonlySet<string>,
  reservedLinePositions: readonly THREE.Vector3[],
  visiting: ReadonlySet<string>,
): boolean {
  if (visiting.has(nodeId)) return false;
  const node = relocatableById.get(nodeId);
  const home = relocationHomes.get(nodeId);
  if (!node || !home) return false;

  const entrySnapshot = snapshotNodes(relocatableNodes);
  const nextVisiting = new Set(visiting);
  nextVisiting.add(nodeId);
  const grid = generateIcosahedralGrid(home.radius, undefined, home.shellID);
  const orderedCells = grid.vertices
    .map((position, cellID) => ({ cellID, distance: position.distanceToSquared(home.origin) }))
    .sort((left, right) => left.distance - right.distance || left.cellID - right.cellID);

  for (const cell of orderedCells) {
    restoreNodes(relocatableNodes, entrySnapshot);
    clearSpatial(node);
    const position = grid.vertices[cell.cellID]!;
    if (positionConflictsWithLine(position, reservedLinePositions)) continue;

    const collision = collisionState(nodeId, position, nodes, relocatableIds);
    if (collision.hard) continue;

    let displaced = true;
    for (const softId of collision.softIds) {
      if (nextVisiting.has(softId) || !cascadeRelocate(
        softId,
        nodes,
        relocatableNodes,
        relocatableById,
        relocationHomes,
        relocatableIds,
        reservedLinePositions,
        nextVisiting,
      )) {
        displaced = false;
        break;
      }
    }
    if (!displaced || !positionIsFreeNow(nodeId, position, nodes, reservedLinePositions)) continue;

    assignRelocatedNode(node, home.shellID, cell.cellID, position);
    return true;
  }

  restoreNodes(relocatableNodes, entrySnapshot);
  return false;
}

function tryCandidateWithLocalReflow(
  candidate: LineCandidate,
  grid: IcosahedralGrid,
  nodes: readonly LayoutNode[],
  relocatableNodes: readonly LayoutNode[],
  relocatableIds: ReadonlySet<string>,
): boolean {
  const blockers = blockersForCandidate(candidate, grid, nodes, relocatableIds);
  if (!blockers.length) return true;

  const reservedLinePositions = linePositions(candidate, grid);
  const initialSnapshot = snapshotNodes(relocatableNodes);
  const relocatableById = new Map(relocatableNodes.map(node => [node.id, node]));
  const relocationHomes = new Map(relocatableNodes
    .filter(node => node.address && node.pos)
    .map(node => [node.id, {
      shellID: node.address!.shellID,
      radius: node.pos!.length(),
      origin: node.pos!.clone(),
    }] as const));

  for (const initialBlocker of blockers) {
    // A preceding cascade may already have moved this blocker off the reserved
    // line, so only displace it again when it still conflicts.
    if (!initialBlocker.pos || !positionConflictsWithLine(initialBlocker.pos, reservedLinePositions)) continue;
    if (!cascadeRelocate(
      initialBlocker.id,
      nodes,
      relocatableNodes,
      relocatableById,
      relocationHomes,
      relocatableIds,
      reservedLinePositions,
      new Set(),
    )) {
      restoreNodes(relocatableNodes, initialSnapshot);
      return false;
    }
  }
  return true;
}

function chooseCoordinateLineWithLocalReflow(
  family: Family,
  grid: IcosahedralGrid,
  nodes: readonly LayoutNode[],
  protectedAnchorIds: ReadonlySet<string>,
): LineCandidate {
  const ownIds = familyIds(family);
  const strictUsed = usedCellsOnShell(nodes, family.anchor.address!.shellID, ownIds);
  const strict = findCoordinateLines(family, grid, nodes, strictUsed, ownIds)[0];
  if (strict) return strict;

  // Lineage is the stronger invariant. Existing ordinary main-layout positions
  // become soft occupancy, while other lineage anchors and already placed
  // lineage satellites stay hard. Candidate lines are tried in order of the
  // fewest immediate blockers first, then straightness/opposition quality.
  const relocatableNodes = nodes
    .filter(node => isRelocatableOrdinary(node, protectedAnchorIds))
    .sort((left, right) => left.id.localeCompare(right.id));
  const relocatableIds = new Set(relocatableNodes.map(node => node.id));
  const softIgnored = new Set([...ownIds, ...relocatableIds]);
  const hardUsed = usedCellsOnShell(nodes, family.anchor.address!.shellID, softIgnored);
  const structural = findCoordinateLines(family, grid, nodes, hardUsed, softIgnored)
    .map(candidate => ({
      candidate,
      blockerCount: blockersForCandidate(candidate, grid, nodes, relocatableIds).length,
    }))
    .sort((left, right) => left.blockerCount - right.blockerCount
      || left.candidate.score - right.candidate.score
      || left.candidate.tie.localeCompare(right.candidate.tie));

  if (!structural.length) {
    throw new Error(`Ordinary lineage has no legal 5R shell coordinate line after local re-layout: ${family.topicId}`);
  }

  const baseline = snapshotNodes(relocatableNodes);
  for (const option of structural) {
    restoreNodes(relocatableNodes, baseline);
    if (tryCandidateWithLocalReflow(option.candidate, grid, nodes, relocatableNodes, relocatableIds)) {
      return option.candidate;
    }
  }
  restoreNodes(relocatableNodes, baseline);
  throw new Error(`Ordinary lineage local cascading re-layout exhausted all 5R shell lines: ${family.topicId}`);
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
 * line is recalculated against current occupancy. If ordinary main-layout nodes
 * block every direct candidate, lineage wins and a cascading local reflow moves
 * only ordinary blockers (and ordinary blockers of those blockers) to their
 * nearest legal canonical cells on their existing shells. Reasoning is outside
 * this ordinary-lineage rule.
 */
export function applyOrdinaryLineagePlacement(nodes: LayoutNode[]): void {
  const families = collectFamilies(nodes);
  const protectedAnchorIds = new Set(families.map(family => family.anchor.id));

  // Satellites are rebuilt from authoritative Current anchors on every run. No
  // stale address is allowed to reserve a future slot or bias a new local line.
  const satellites = nodes.filter(isOrdinaryLineageSatellite);
  for (const node of satellites) {
    delete node.address;
    delete node.pos;
    delete node.homePos;
    node.vel?.set(0, 0, 0);
  }

  for (const family of families) {
    const shellID = family.anchor.address!.shellID;
    const radius = family.anchor.pos!.length();
    const grid = generateIcosahedralGrid(radius, undefined, shellID);
    const candidate = chooseCoordinateLineWithLocalReflow(family, grid, nodes, protectedAnchorIds);
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
    }
  }
}

export function isCoordinateLineStep(grid: IcosahedralGrid, leftCellID: number, rightCellID: number): boolean {
  return grid.edges.has(edgeKey(leftCellID, rightCellID));
}
