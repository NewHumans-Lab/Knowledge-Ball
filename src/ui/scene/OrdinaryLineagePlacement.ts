import * as THREE from 'three';
import { lineageRoleFor, topicIdFor } from '../../domain/KnowledgeLineage';
import {
  generateIcosahedralGrid,
  LAYOUT_UNIT,
  type IcosahedralGrid,
  type LayoutNode,
} from './Deterministic5RLayout';

/**
 * Ordinary Knowledge lineage uses the project-wide 5R centre-spacing unit.
 * Canonical shell chords may be slightly longer because every position must be
 * a real ISG cell, but they may never be shorter than this unit.
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

type AnchorHome = Readonly<{
  shellID: string;
  radius: number;
  position: THREE.Vector3;
  cellID: number;
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

  // Search harder / longer lineage families first, but recursive backtracking can
  // still revise an earlier family when a later one cannot fit.
  return families.sort((left, right) =>
    (right.historySide.length + right.oppositionSide.length)
      - (left.historySide.length + left.oppositionSide.length)
    || left.topicId.localeCompare(right.topicId));
}

function familyMembers(family: Family): LayoutNode[] {
  return [family.anchor, ...family.historySide, ...family.oppositionSide];
}

function familyIds(family: Family): ReadonlySet<string> {
  return new Set(familyMembers(family).map(node => node.id));
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
  return chord.addScaledVector(radial, -chord.dot(radial)).normalize();
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
  usedCells: ReadonlySet<number>,
): readonly number[] | null {
  if (length === 0) return [];
  const path = [firstCell];
  const locallyUsed = new Set<number>([anchorCell, ...usedCells, firstCell]);
  let previous = anchorCell;
  let current = firstCell;

  while (path.length < length) {
    const currentPosition = grid.vertices[current]!;
    const incoming = tangentDirection(currentPosition, grid.vertices[previous]!).multiplyScalar(-1);
    const options = (neighbors.get(current) ?? [])
      .filter(cellID => cellID !== previous)
      .filter(cellID => cellIsFree(grid, cellID, obstacles, ignoredIds, locallyUsed))
      .map(cellID => ({
        cellID,
        straightness: incoming.dot(tangentDirection(currentPosition, grid.vertices[cellID]!)),
      }))
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
        : continueLine(grid, neighbors, anchorCell, historyStart, family.historySide.length, obstacles, ignoredIds, usedCells);
      if (!historyCells) continue;
      const historyUsed = new Set<number>([...usedCells, ...historyCells]);
      const oppositionCells = oppositionStart < 0
        ? []
        : continueLine(grid, neighbors, anchorCell, oppositionStart, family.oppositionSide.length, obstacles, ignoredIds, historyUsed);
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

function usedCellsOnShell(nodes: readonly LayoutNode[], shellID: string, ignoredIds: ReadonlySet<string>): ReadonlySet<number> {
  return new Set(nodes
    .filter(node => node.type !== 'reasoning' && node.address?.shellID === shellID && !ignoredIds.has(node.id))
    .map(node => node.address!.cellID));
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
    } else delete node.vel;
  }
}

function clearSpatial(node: LayoutNode): void {
  delete node.address;
  delete node.pos;
  delete node.homePos;
}

function clearFamily(family: Family): void {
  for (const node of familyMembers(family)) clearSpatial(node);
}

function clearFamilySatellites(family: Family): void {
  for (const node of [...family.historySide, ...family.oppositionSide]) clearSpatial(node);
}

function assignCanonical(node: LayoutNode, shellID: string, cellID: number, position: THREE.Vector3): void {
  node.address = { shellID, cellID };
  node.pos = position.clone();
  node.homePos = position.clone();
  node.vel ??= new THREE.Vector3();
  node.vel.set(0, 0, 0);
}

function assignFamilyLine(family: Family, grid: IcosahedralGrid, shellID: string, candidate: LineCandidate): void {
  clearFamilySatellites(family);
  family.historySide.forEach((node, index) => {
    const cellID = candidate.historyCells[index]!;
    assignCanonical(node, shellID, cellID, grid.vertices[cellID]!);
  });
  family.oppositionSide.forEach((node, index) => {
    const cellID = candidate.oppositionCells[index]!;
    assignCanonical(node, shellID, cellID, grid.vertices[cellID]!);
  });
}

function allFamilyPositions(families: readonly Family[]): THREE.Vector3[] {
  return families.flatMap(family => familyMembers(family).flatMap(node => node.pos ? [node.pos.clone()] : []));
}

function conflictsWithReserved(position: THREE.Vector3, reservedPositions: readonly THREE.Vector3[]): boolean {
  return reservedPositions.some(reserved => position.distanceTo(reserved) < ORDINARY_LINEAGE_SPACING - EPSILON);
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
  reservedPositions: readonly THREE.Vector3[],
): boolean {
  if (conflictsWithReserved(position, reservedPositions)) return false;
  for (const node of nodes) {
    if (node.id === subjectId || node.type === 'reasoning' || !node.pos) continue;
    if (position.distanceTo(node.pos) < ORDINARY_LINEAGE_SPACING - EPSILON) return false;
  }
  return true;
}

/**
 * Soft ordinary blockers first search their original shell. If the shell has no
 * legal capacity after lineage claims its authoritative cells, the search grows
 * radially outward in exact 5R increments, mirroring the main layout's expansion
 * rule. The authoritative shellID is rebuilt from the destination radius.
 *
 * A candidate occupied only by another soft ordinary node can recursively displace
 * that node. With finite hard occupancy, the outward loop eventually reaches a
 * shell outside the occupied radial envelope; there is deliberately no fixed
 * expansion-count ceiling.
 */
function cascadeRelocate(
  nodeId: string,
  nodes: readonly LayoutNode[],
  relocatableNodes: readonly LayoutNode[],
  relocatableById: ReadonlyMap<string, LayoutNode>,
  relocationHomes: ReadonlyMap<string, RelocationHome>,
  relocatableIds: ReadonlySet<string>,
  reservedPositions: readonly THREE.Vector3[],
  visiting: ReadonlySet<string>,
): boolean {
  if (visiting.has(nodeId)) return false;
  const node = relocatableById.get(nodeId);
  const home = relocationHomes.get(nodeId);
  if (!node || !home) return false;

  const entrySnapshot = snapshotNodes(relocatableNodes);
  const nextVisiting = new Set(visiting);
  nextVisiting.add(nodeId);
  const homeRay = home.origin.clone().normalize();

  for (let expansion = 0;; expansion++) {
    const radius = home.radius + expansion * LAYOUT_UNIT;
    if (!Number.isFinite(radius)) break;
    const shellID = expansion === 0 ? home.shellID : `shell:${radius.toFixed(6)}`;
    const grid = generateIcosahedralGrid(radius, undefined, shellID);
    const target = homeRay.clone().multiplyScalar(radius);
    const orderedCells = grid.vertices
      .map((position, cellID) => ({ cellID, distance: position.distanceToSquared(target) }))
      .sort((left, right) => left.distance - right.distance || left.cellID - right.cellID);

    for (const cell of orderedCells) {
      restoreNodes(relocatableNodes, entrySnapshot);
      clearSpatial(node);
      const position = grid.vertices[cell.cellID]!;
      if (conflictsWithReserved(position, reservedPositions)) continue;
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
          reservedPositions,
          nextVisiting,
        )) {
          displaced = false;
          break;
        }
      }
      if (!displaced || !positionIsFreeNow(nodeId, position, nodes, reservedPositions)) continue;
      assignCanonical(node, shellID, cell.cellID, position);
      return true;
    }
  }

  restoreNodes(relocatableNodes, entrySnapshot);
  return false;
}

function tryReflowSoftOrdinary(
  nodes: readonly LayoutNode[],
  softOrdinary: readonly LayoutNode[],
  reservedPositions: readonly THREE.Vector3[],
): boolean {
  const blockers = softOrdinary
    .filter(node => node.pos && conflictsWithReserved(node.pos, reservedPositions))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!blockers.length) return true;

  const initialSnapshot = snapshotNodes(softOrdinary);
  const relocatableById = new Map(softOrdinary.map(node => [node.id, node]));
  const relocatableIds = new Set(softOrdinary.map(node => node.id));
  const relocationHomes = new Map(softOrdinary
    .filter(node => node.address && node.pos)
    .map(node => [node.id, {
      shellID: node.address!.shellID,
      radius: node.pos!.length(),
      origin: node.pos!.clone(),
    }] as const));

  for (const blocker of blockers) {
    if (!blocker.pos || !conflictsWithReserved(blocker.pos, reservedPositions)) continue;
    if (!cascadeRelocate(
      blocker.id,
      nodes,
      softOrdinary,
      relocatableById,
      relocationHomes,
      relocatableIds,
      reservedPositions,
      new Set(),
    )) {
      restoreNodes(softOrdinary, initialSnapshot);
      return false;
    }
  }
  return true;
}

function solveLineageFamilies(
  index: number,
  families: readonly Family[],
  nodes: readonly LayoutNode[],
  anchorHomes: ReadonlyMap<string, AnchorHome>,
  softOrdinary: readonly LayoutNode[],
  softIds: ReadonlySet<string>,
  softBaseline: ReadonlyMap<string, SpatialSnapshot>,
): boolean {
  if (index >= families.length) {
    restoreNodes(softOrdinary, softBaseline);
    return tryReflowSoftOrdinary(nodes, softOrdinary, allFamilyPositions(families));
  }

  const family = families[index]!;
  const home = anchorHomes.get(family.anchor.id);
  if (!home) return false;
  const grid = generateIcosahedralGrid(home.radius, undefined, home.shellID);
  const ownIds = familyIds(family);
  const ignoredIds = new Set([...softIds, ...ownIds]);
  const anchorCandidates = grid.vertices
    .map((position, cellID) => ({
      cellID,
      distance: position.distanceToSquared(home.position),
      original: cellID === home.cellID ? 0 : 1,
    }))
    .sort((left, right) => left.original - right.original || left.distance - right.distance || left.cellID - right.cellID);

  for (const anchorCandidate of anchorCandidates) {
    clearFamily(family);
    const usedBeforeAnchor = usedCellsOnShell(nodes, home.shellID, ignoredIds);
    if (!cellIsFree(grid, anchorCandidate.cellID, nodes, ignoredIds, usedBeforeAnchor)) continue;
    assignCanonical(family.anchor, home.shellID, anchorCandidate.cellID, grid.vertices[anchorCandidate.cellID]!);

    const usedForLine = usedCellsOnShell(nodes, home.shellID, ignoredIds);
    const lineCandidates = findCoordinateLines(family, grid, nodes, usedForLine, ignoredIds);
    for (const lineCandidate of lineCandidates) {
      assignFamilyLine(family, grid, home.shellID, lineCandidate);
      if (solveLineageFamilies(index + 1, families, nodes, anchorHomes, softOrdinary, softIds, softBaseline)) return true;
      clearFamilySatellites(family);
    }
  }
  clearFamily(family);
  return false;
}

/**
 * Ordinary lineage is solved as one joint high-priority occupancy problem rather
 * than greedily freezing one family at a time. Each family first tries its main-
 * layout Current cell, then nearby canonical cells on the same semantic shell;
 * recursion backtracks earlier families when a later lineage cannot fit.
 *
 * History/Opposition/pending members always consume real shellID/cellID positions
 * along adjacent ISG edges at the nominal 5R spacing. No future cells are held.
 * Only after every lineage is legal are conflicting ordinary non-lineage nodes
 * locally repacked. Same-shell capacity is preferred; exhaustion expands the
 * affected ordinary node outward by 5R increments with a matching new shellID.
 * Reasoning is never occupancy and is projected later from final ordinary geometry.
 */
export function applyOrdinaryLineagePlacement(nodes: LayoutNode[]): void {
  const families = collectFamilies(nodes);
  if (!families.length) return;

  const familyNodeIds = new Set(families.flatMap(family => familyMembers(family).map(node => node.id)));
  const familyNodes = families.flatMap(family => familyMembers(family));
  const familySnapshot = snapshotNodes(familyNodes);
  const anchorHomes = new Map(families.map(family => [family.anchor.id, {
    shellID: family.anchor.address!.shellID,
    radius: family.anchor.pos!.length(),
    position: family.anchor.pos!.clone(),
    cellID: family.anchor.address!.cellID,
  }] as const));

  const softOrdinary = nodes
    .filter(node => node.type !== 'reasoning'
      && lineageRoleFor(node) !== 'rejected'
      && !familyNodeIds.has(node.id)
      && !!node.address
      && !!node.pos)
    .sort((left, right) => left.id.localeCompare(right.id));
  const softIds = new Set(softOrdinary.map(node => node.id));
  const softBaseline = snapshotNodes(softOrdinary);

  // All lineage families enter one joint solve. Their old satellite positions and
  // even their Current anchors are candidates, not immutable reservations.
  for (const family of families) clearFamily(family);

  if (!solveLineageFamilies(0, families, nodes, anchorHomes, softOrdinary, softIds, softBaseline)) {
    restoreNodes(familyNodes, familySnapshot);
    restoreNodes(softOrdinary, softBaseline);
    throw new Error('Ordinary lineage joint 5R shell-coordinate solve has no legal arrangement');
  }
}

export function isCoordinateLineStep(grid: IcosahedralGrid, leftCellID: number, rightCellID: number): boolean {
  return grid.edges.has(edgeKey(leftCellID, rightCellID));
}
