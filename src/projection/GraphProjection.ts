import type { DomainEvent } from '../event/Event';
import type { GraphState } from '../state/GraphState';
import { emptyGraphState, nodeList } from '../state/GraphState';
import type { Projection } from './Projection';
import { cascadeReachable } from '../graph/Graph';
import {
  applyKnowledgeEdit,
  type KnowledgeEdit,
  type ProtocolNode,
} from '../protocol/KnowledgeEditingProtocol';

let cascadeDepthLimit = Infinity;
export function setCascadeDepthLimit(n: number | null) { cascadeDepthLimit = n ?? Infinity; }

export class GraphProjection implements Projection<GraphState> {
  state: GraphState = emptyGraphState();

  reset(seed: GraphState): void { this.state = seed; }

  hydrate(snapshotState: GraphState | null, eventsSinceSnapshot: DomainEvent[]): void {
    this.state = snapshotState ? structuredClone(snapshotState) : emptyGraphState();
    eventsSinceSnapshot.forEach(event => this.apply(event));
  }

  private applyKnowledgeEdit(edit: KnowledgeEdit): void {
    const masteryById = new Map(nodeList(this.state).map(node => [node.id, node.mastery]));
    const protocolNodes: ProtocolNode[] = nodeList(this.state).map(node => ({
      id: node.id,
      title: node.title,
      type: node.type,
      status: node.status,
      reasoning: node.reasoning,
      premises: [...node.premises],
      hidden: node.hidden,
      aliases: node.aliases ? [...node.aliases] : undefined,
      supersededBy: node.supersededBy,
      logicRuleId: node.logicRuleId,
      negatedBy: node.negatedBy ? [...node.negatedBy] : undefined,
      semanticKey: node.semanticKey,
    }));
    const result = applyKnowledgeEdit(protocolNodes, edit);
    if (result.errors.length) {
      throw new Error(`Invalid ${edit.kind} event: ${result.errors.join('；')}`);
    }

    this.state.nodesById = Object.fromEntries(result.nodes.map(node => [
      node.id,
      {
        ...node,
        mastery: masteryById.get(node.id) ?? 'none',
        premises: [...node.premises],
      },
    ]));
  }

  apply(event: DomainEvent): void {
    if (event.schemaVersion !== 1) console.warn(`[GraphProjection] unhandled schemaVersion ${event.schemaVersion} on ${event.type}`);
    switch (event.type) {
      case 'NodeCreated': {
        const p = event.payload;
        this.state.nodesById[p.nodeId] = {
          id: p.nodeId,
          title: p.title,
          type: p.nodeType,
          status: p.initialStatus ?? 'pending',
          mastery: 'none',
          reasoning: p.reasoning,
          premises: [...p.premises],
          hidden: p.hidden ?? false,
          aliases: p.aliases ? [...p.aliases] : undefined,
          supersededBy: p.supersededBy,
          logicRuleId: p.logicRuleId,
          negatedBy: p.negatedBy ? [...p.negatedBy] : undefined,
          semanticKey: p.semanticKey,
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
        if (p.premises !== undefined) n.premises = [...p.premises];
        break;
      }
      case 'NodeFalsified': {
        const n = this.state.nodesById[event.payload.nodeId];
        if (n) {
          n.status = 'falsified';
          n.hidden = true;
        }
        break;
      }
      case 'NodeSuspended': { const n = this.state.nodesById[event.payload.nodeId]; if (n && n.status !== 'falsified') n.status = 'suspended'; break; }
      case 'NodeResolved': { const n = this.state.nodesById[event.payload.nodeId]; if (n && n.status !== 'falsified') n.status = 'verified'; break; }
      case 'NodeDisputed': { const n = this.state.nodesById[event.payload.nodeId]; if (n) n.status = 'disputed'; break; }
      case 'KnowledgeStatusChanged': { const n = this.state.nodesById[event.payload.edit.nodeId]; if (n && n.status !== 'falsified') n.status = event.payload.edit.status; break; }
      case 'KnowledgeNodeEdited': { const n = this.state.nodesById[event.payload.edit.nodeId]; if(n){const p=event.payload.edit;if(p.title!==undefined)n.title=p.title;if(p.nodeType!==undefined)n.type=p.nodeType;if(p.reasoning!==undefined)n.reasoning=p.reasoning;if(p.premises!==undefined)n.premises=[...p.premises];}break; }
      case 'NodeMasterySet': { const n = this.state.nodesById[event.payload.nodeId]; if (n) n.mastery = event.payload.mastery; break; }
      case 'KnowledgeAdded':
      case 'KnowledgeNegated':
      case 'KnowledgeDecomposed':
      case 'KnowledgeMerged': {
        this.applyKnowledgeEdit(event.payload.edit);
        break;
      }
    }
  }

  reachableForCascade(fromNodeId: string): { ids: string[]; truncated: boolean } {
    return cascadeReachable(fromNodeId, nodeList(this.state), cascadeDepthLimit);
  }
}
