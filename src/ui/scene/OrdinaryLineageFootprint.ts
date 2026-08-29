import * as THREE from 'three';
import { lineageRoleFor, topicIdFor } from '../../domain/KnowledgeLineage';
import {
  type LayoutDiagnostics,
  type LayoutFootprintPlanner,
  type LayoutFootprintPlacement,
  type LayoutNode,
} from './Deterministic5RLayout';
import { applyOrdinaryLineagePlacement, isOrdinaryLineageSatellite } from './OrdinaryLineagePlacement';

type FootprintFamily = Readonly<{
  anchor: LayoutNode;
  satellites: readonly LayoutNode[];
}>;

function cloneWithoutSpatial(node: LayoutNode): LayoutNode {
  const clone: LayoutNode = {
    ...node,
    premises: node.premises ? [...node.premises] : undefined,
    lineage: node.lineage ? { ...node.lineage } : undefined,
  };
  delete clone.address;
  delete clone.pos;
  delete clone.homePos;
  delete clone.vel;
  return clone;
}

function collectFootprintFamilies(nodes: readonly LayoutNode[]): FootprintFamily[] {
  const byTopic = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    if (node.type === 'reasoning' || lineageRoleFor(node) === 'rejected' || !node.lineage) continue;
    const topicId = topicIdFor(node);
    const members = byTopic.get(topicId) ?? [];
    members.push(node);
    byTopic.set(topicId, members);
  }

  const families: FootprintFamily[] = [];
  for (const members of byTopic.values()) {
    const anchor = members.find(node => lineageRoleFor(node) === 'current');
    if (!anchor) continue;
    const satellites = members.filter(isOrdinaryLineageSatellite);
    if (!satellites.length) continue;
    families.push({ anchor, satellites });
  }
  return families.sort((left, right) => left.anchor.id.localeCompare(right.anchor.id));
}

function hardObstacle(id: string, position: THREE.Vector3): LayoutNode {
  return {
    id,
    type: 'logic-symbol',
    premises: [],
    pos: position.clone(),
    homePos: position.clone(),
  };
}

/**
 * Reuses the existing ordinary-lineage solver unchanged, but runs it on clones
 * before a main-chain candidate is accepted. Existing main/global placements are
 * represented as hard obstacles without authoritative addresses, so the local
 * solve may not move them. If the original candidate anchor itself has to move,
 * the candidate is rejected and the unchanged main solver tries another cell.
 */
export function createOrdinaryLineageFootprintPlanner(nodes: readonly LayoutNode[]): LayoutFootprintPlanner {
  const families = collectFootprintFamilies(nodes);
  const familyByAnchor = new Map(families.map(family => [family.anchor.id, family] as const));

  return ({ anchor, grid, cellID, occupied, placed }) => {
    const family = familyByAnchor.get(anchor.id);
    if (!family) return [];
    const anchorPosition = grid.vertices[cellID];
    if (!anchorPosition) return null;

    const ownIds = new Set([family.anchor.id, ...family.satellites.map(node => node.id)]);
    const clonedAnchor = cloneWithoutSpatial(family.anchor);
    clonedAnchor.address = { shellID: grid.shellID, cellID };
    clonedAnchor.pos = anchorPosition.clone();
    clonedAnchor.homePos = anchorPosition.clone();
    clonedAnchor.vel = new THREE.Vector3();

    const clonedSatellites = family.satellites.map(cloneWithoutSpatial);
    const obstacles: LayoutNode[] = [];
    let obstacleIndex = 0;
    for (const position of occupied.values()) {
      obstacles.push(hardObstacle(`__lineage-occupied-${obstacleIndex++}`, position));
    }
    for (const placement of placed.values()) {
      if (ownIds.has(placement.id)) continue;
      obstacles.push(hardObstacle(`__lineage-placed-${obstacleIndex++}`, placement.position));
    }

    const temporary = [clonedAnchor, ...clonedSatellites, ...obstacles];
    try {
      applyOrdinaryLineagePlacement(temporary);
    } catch {
      return null;
    }

    if (clonedAnchor.address?.shellID !== grid.shellID || clonedAnchor.address.cellID !== cellID) return null;

    const result: LayoutFootprintPlacement[] = [];
    for (const satellite of clonedSatellites) {
      if (!satellite.address || !satellite.pos) return null;
      result.push({
        id: satellite.id,
        address: { ...satellite.address },
        position: satellite.pos.clone(),
      });
    }
    return result;
  };
}

export function ordinaryLineageFootprintSignature(nodes: readonly LayoutNode[]): string {
  return collectFootprintFamilies(nodes)
    .flatMap(family => [family.anchor, ...family.satellites])
    .map(node => `${node.id}:${topicIdFor(node)}:${lineageRoleFor(node)}:${node.lineage?.rank ?? ''}`)
    .sort()
    .join('|');
}

/** Materialize the footprint addresses already selected inside the main solve. */
export function commitOrdinaryLineageFootprints(nodes: readonly LayoutNode[], diagnostics: LayoutDiagnostics | null): void {
  if (!diagnostics) throw new Error('Ordinary lineage footprint commit requires layout diagnostics');
  const plannedIds = new Set(collectFootprintFamilies(nodes).flatMap(family => family.satellites.map(node => node.id)));
  for (const node of nodes) {
    if (!plannedIds.has(node.id)) continue;
    const address = diagnostics.addresses.get(node.id);
    const grid = address ? diagnostics.grids.get(address.shellID) : undefined;
    const position = address && grid ? grid.vertices[address.cellID] : undefined;
    if (!address || !position) throw new Error(`Missing pre-solved ordinary lineage footprint for ${node.id}`);
    node.address = { ...address };
    node.pos = position.clone();
    node.homePos = position.clone();
    node.vel ??= new THREE.Vector3();
    node.vel.set(0, 0, 0);
  }
}
