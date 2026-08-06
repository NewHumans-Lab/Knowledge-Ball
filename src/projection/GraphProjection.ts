import type { DomainEvent } from '../event/Event';
import type { GraphState } from '../state/GraphState';
import { emptyGraphState, nodeList } from '../state/GraphState';
import type { Projection } from './Projection';
import { cascadeReachable } from '../graph/Graph';

let cascadeDepthLimit = Infinity;
export function setCascadeDepthLimit(n: number | null) {
  cascadeDepthLimit = n ?? Infinity;
}

export class GraphProjection implements Projection<GraphState> {
  state: GraphState = emptyGraphState();

  reset(seed: GraphState): void {
    this.state = seed;
  }

  hydrate(snapshotState: GraphState | null, eventsSinceSnapshot: DomainEvent[]): void {
    this.state = snapshotState ? structuredClone(snapshotState) : emptyGraphState();
    eventsSinceSnapshot.forEach(e => this.apply(e));
  }

  apply(event: DomainEvent): void {
    if (event.schemaVersion !== 1) {
      console.warn(`[GraphProjection] unhandled schemaVersion ${event.schemaVersion} on ${event.type}`);
    }

    switch (event.type) {
      case 'NodeCreated': {
        const p = event.payload;
        this.state.nodesById[p.nodeId] = {
          id: p.nodeId,
          title: p.title,
          type: p.nodeType,
          status: 'pending',
          mastery: 'none',
          reasoning: p.reasoning,
          premises: p.premises,
        };
        break;
      }
      case 'NodeEdited': {
        const p = event.payload;
        const n = this.state.nodesById[p.nodeId];
        if (!n) break;
        if (p.title !== undefined) n.title = p.title;
        if (p.nodeType !== undefined) n.type = p.nodeType;
        if (p.reasoning !== undefined) n.reasoning = p.reasoning;
        break;
      }
      case 'NodeFalsified': {
        const p = event.payload;
        const n = this.state.nodesById[p.nodeId];
        if (n) n.status = 'falsified';
        break;
      }
      case 'NodeSuspended': {
        const p = event.payload;
        const n = this.state.nodesById[p.nodeId];
        if (n && n.status !== 'falsified') n.status = 'suspended';
        break;
      }
      case 'NodeResolved': {
        const p = event.payload;
        const n = this.state.nodesById[p.nodeId];
        if (n && n.status !== 'falsified') n.status = 'verified';
        break;
      }
      case 'NodeDisputed': {
        const p = event.payload;
        const n = this.state.nodesById[p.nodeId];
        if (n) n.status = 'disputed';
        break;
      }
      case 'NodeMasterySet': {
        const p = event.payload;
        const n = this.state.nodesById[p.nodeId];
        if (n) n.mastery = p.mastery;
        break;
      }
    }
  }

  reachableForCascade(fromNodeId: string): { ids: string[]; truncated: boolean } {
    return cascadeReachable(fromNodeId, nodeList(this.state), cascadeDepthLimit);
  }
}
