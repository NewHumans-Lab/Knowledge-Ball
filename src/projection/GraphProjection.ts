import type { DomainEvent, Mastery } from '../event/Event';
import type { UserKnowledgeLayer } from '../domain/KnowledgeLayerPolicy';
import {
  isOptimizationCandidate,
  optimizationCandidateLineage,
  resolveOptimizationCandidate,
} from '../domain/KnowledgeOptimization';
import {
  isOppositionCandidate,
  oppositionCandidateLineage,
  resolveOppositionCandidate,
} from '../domain/KnowledgeOpposition';
import {
  beginKnowledgeRevalidation,
  finalizeKnowledgeRevalidation,
} from '../domain/KnowledgeRevalidation';
import type { GraphState } from '../state/GraphState';
import { emptyGraphState, nodeList } from '../state/GraphState';
import type { Projection } from './Projection';
import { cascadeReachable } from '../graph/Graph';
import {
  applyKnowledgeEdit,
  type KnowledgeEdit,
  type NewProtocolNode,
  type ProtocolNode,
} from '../protocol/KnowledgeEditingProtocol';

let cascadeDepthLimit = Infinity;
export function setCascadeDepthLimit(n: number | null) { cascadeDepthLimit = n ?? Infinity; }

export class GraphProjection implements Projection<GraphState> {
  state: GraphState = emptyGraphState();
  private readonly pendingMasteryByNodeId = new Map<string, Mastery>();

  reset(seed: GraphState): void {
    this.pendingMasteryByNodeId.clear();
    this.state = seed;
  }

  hydrate(snapshotState: GraphState | null, eventsSinceSnapshot: DomainEvent[]): void {
    this.pendingMasteryByNodeId.clear();
    this.state = snapshotState ? structuredClone(snapshotState) : emptyGraphState();
    eventsSinceSnapshot.forEach(event => this.apply(event));
  }

  replacePersonalMastery(states: Readonly<Record<string, Mastery>>): void {
    this.pendingMasteryByNodeId.clear();
    for (const node of Object.values(this.state.nodesById)) node.mastery = 'none';
    for (const [nodeId, mastery] of Object.entries(states)) {
      const node = this.state.nodesById[nodeId];
      if (node) node.mastery = mastery;
      else this.pendingMasteryByNodeId.set(nodeId, mastery);
    }
  }

  private takePendingMastery(nodeId: string): Mastery {
    const mastery = this.pendingMasteryByNodeId.get(nodeId) ?? 'none';
    this.pendingMasteryByNodeId.delete(nodeId);
    return mastery;
  }

  private applyOptimizationAdd(event: Extract<DomainEvent, { type: 'KnowledgeAdded' }>): void {
    const optimization = event.payload.optimization;
    if (!optimization || event.payload.edit.mode !== 'atomic') return;
    const target = this.state.nodesById[optimization.targetId];
    if (!target) throw new Error(`Optimization target missing during projection: ${optimization.targetId}`);
    const draft = event.payload.edit.node;
    this.state.nodesById[draft.id] = {
      id: draft.id,
      title: draft.title.trim(),
      type: target.type,
      status: 'pending',
      mastery: this.takePendingMastery(draft.id),
      reasoning: draft.reasoning.trim(),
      premises: [...target.premises],
      declaredLayer: event.payload.declaredLayers?.[draft.id],
      hidden: false,
      aliases: target.aliases ? [...target.aliases] : undefined,
      logicRuleId: target.logicRuleId,
      semanticKey: target.semanticKey,
      lineage: optimizationCandidateLineage(target),
    };
  }

  private applyOppositionAdd(event: Extract<DomainEvent, { type: 'KnowledgeAdded' }>): void {
    const opposition = event.payload.opposition;
    if (!opposition || event.payload.edit.mode !== 'atomic') return;
    const target = this.state.nodesById[opposition.targetId];
    if (!target) throw new Error(`Opposition target missing during projection: ${opposition.targetId}`);
    const draft = event.payload.edit.node;
    this.state.nodesById[draft.id] = {
      id: draft.id,
      title: draft.title.trim(),
      type: target.type,
      status: 'pending',
      mastery: this.takePendingMastery(draft.id),
      reasoning: draft.reasoning.trim(),
      premises: [...target.premises],
      declaredLayer: event.payload.declaredLayers?.[draft.id],
      hidden: false,
      logicRuleId: target.logicRuleId,
      lineage: oppositionCandidateLineage(target),
    };
  }

  private applyKnowledgeEdit(
    edit: KnowledgeEdit,
    declaredLayers?: Readonly<Record<string, UserKnowledgeLayer>>,
  ): void {
    if (edit.kind === 'add') {
      const append = (draft: NewProtocolNode, premises: string[]) => {
        this.state.nodesById[draft.id] = {
          id: draft.id,
          title: draft.title.trim(),
          type: draft.type,
          status: 'pending',
          mastery: this.takePendingMastery(draft.id),
          reasoning: draft.reasoning.trim(),
          premises: [...new Set(premises)],
          declaredLayer: declaredLayers?.[draft.id],
          hidden: false,
          logicRuleId: draft.logicRuleId,
        };
      };
      if (edit.mode === 'atomic') append(edit.node, []);
      else {
        append(edit.reasoning, edit.requiredPremiseIds);
        append(edit.conclusion, [edit.reasoning.id]);
      }
      return;
    }
    const masteryById = new Map(nodeList(this.state).map(node => [node.id, node.mastery]));
    const declaredLayerById = new Map(nodeList(this.state).map(node => [node.id, node.declaredLayer]));
    const lineageById = new Map(nodeList(this.state).map(node => [node.id, node.lineage ? structuredClone(node.lineage) : undefined]));
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
    if (result.errors.length) throw new Error(`Invalid ${edit.kind} event: ${result.errors.join('；')}`);

    this.state.nodesById = Object.fromEntries(result.nodes.map(node => [
      node.id,
      {
        ...node,
        mastery: masteryById.get(node.id) ?? 'none',
        declaredLayer: declaredLayerById.get(node.id),
        lineage: lineageById.get(node.id),
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
          mastery: this.takePendingMastery(p.nodeId),
          reasoning: p.reasoning,
          premises: [...p.premises],
          declaredLayer: p.declaredLayer,
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
        if (n) { n.status = 'falsified'; n.hidden = true; }
        break;
      }
      case 'NodeSuspended': { const n = this.state.nodesById[event.payload.nodeId]; if (n && n.status !== 'falsified') n.status = 'suspended'; break; }
      case 'NodeResolved': { const n = this.state.nodesById[event.payload.nodeId]; if (n && n.status !== 'falsified') n.status = 'verified'; break; }
      case 'NodeDisputed': { const n = this.state.nodesById[event.payload.nodeId]; if (n) n.status = 'disputed'; break; }
      case 'KnowledgeStatusChanged': { const n = this.state.nodesById[event.payload.edit.nodeId]; if (n && n.status !== 'falsified') n.status = event.payload.edit.status; break; }
      case 'KnowledgeVerdictFinalized': {
        const n = this.state.nodesById[event.payload.nodeId];
        if (!n) break;
        if (isOptimizationCandidate(n)) {
          resolveOptimizationCandidate(Object.values(this.state.nodesById), n.id, event.payload.verdict);
          break;
        }
        if (isOppositionCandidate(n)) {
          resolveOppositionCandidate(Object.values(this.state.nodesById), n.id, event.payload.verdict);
          break;
        }
        if (event.payload.verdict === 'CORRECT') { n.status = 'verified'; n.hidden = false; }
        else { n.status = 'falsified'; n.hidden = true; }
        break;
      }
      case 'KnowledgeRevalidationStarted': {
        beginKnowledgeRevalidation(Object.values(this.state.nodesById), event.payload.nodeId);
        break;
      }
      case 'KnowledgeRevalidationFinalized': {
        finalizeKnowledgeRevalidation(Object.values(this.state.nodesById), event.payload.nodeId, event.payload.verdict);
        break;
      }
      case 'KnowledgeCascadeRevalidationStarted': {
        const n = this.state.nodesById[event.payload.nodeId];
        if (n && n.status !== 'falsified' && n.status !== 'suspended') n.status = 'disputed';
        break;
      }
      case 'KnowledgeNodeEdited': {
        const n = this.state.nodesById[event.payload.edit.nodeId];
        if (n) {
          const p = event.payload.edit;
          if (p.title !== undefined) n.title = p.title;
          if (p.nodeType !== undefined) n.type = p.nodeType;
          if (p.reasoning !== undefined) n.reasoning = p.reasoning;
          if (p.premises !== undefined) n.premises = [...p.premises];
        }
        break;
      }
      case 'NodeMasterySet': {
        const n = this.state.nodesById[event.payload.nodeId];
        if (n) n.mastery = event.payload.mastery;
        else this.pendingMasteryByNodeId.set(event.payload.nodeId, event.payload.mastery);
        break;
      }
      case 'KnowledgeAdded': {
        if (event.payload.optimization) this.applyOptimizationAdd(event);
        else if (event.payload.opposition) this.applyOppositionAdd(event);
        else this.applyKnowledgeEdit(event.payload.edit, event.payload.declaredLayers);
        break;
      }
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
