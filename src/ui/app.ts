import { Capacitor } from '@capacitor/core';
import { EventStore } from '../event/EventStore';
import { validateDomainEventAgainstState } from '../event/EventValidation';
import { GraphProjection } from '../projection/GraphProjection';
import { nodeList } from '../state/GraphState';
import type { GraphNode } from '../graph/Node';
import {
  lineageRoleFor,
} from '../domain/KnowledgeLineage';
import { createKnowledgeRelationIndex } from '../domain/KnowledgeRelations';
import { createKnowledgeGraphIndex, effectivePremiseIds } from '../domain/KnowledgeGraphIndex';
import {
  declaredLayerForNode,
  effectiveLayerForNode,
  type UserKnowledgeLayer,
} from '../domain/KnowledgeLayerPolicy';

import { executeKnowledgeOptimization } from '../command/KnowledgeOptimization';
import { executeKnowledgeOpposition } from '../command/KnowledgeOpposition';
import { resolveNode as cmdResolveNode } from '../command/ResolveNode';
import { setMastery as cmdSetMastery } from '../command/SetMastery';
import { disputeNode as cmdDisputeNode } from '../command/DisputeNode';
import { executeKnowledgeEdit } from '../command/KnowledgeEdit';
import {
  type AddEdit,
  type DecomposeEdit,
} from '../protocol/KnowledgeEditingProtocol';
import type { DomainEvent, PublicKnowledgeEvent } from '../event/Event';
import { FilteredKnowledgePersistence } from '../persistence/KnowledgePersistence';
import { SyncEngine } from '../sync/SyncEngine';
import { createdNodeIdsFromEvent, createProductionSyncAdapter } from '../sync/SupabaseSyncAdapter';
import {
  createProductionAuthClient,
  type PersonalKnowledgeStateSnapshot,
  type PersonalMastery,
} from '../auth/AuthClient';

import { type KnowledgeNodeType } from './config/KnowledgeUiConfig';
import { nodeBelongsInLineageScene } from './KnowledgeLineageView';
import { installAccountUi } from './AccountUi';
import './ExitControls.css';
import { ProjectionRenderScheduler } from './ProjectionRenderScheduler';
import { KnowledgeSurfaceState } from './KnowledgeSurfaceState';

import {
  createKnowledgeScene,
  type KnowledgeSceneNode,
  type KnowledgeSceneRuntime,
} from './scene/KnowledgeScene';
import { applyUniformLayerLayout } from './scene/UniformLayerLayout';

import {
  InteractionController,
  type InteractionNodeSummary,
} from './interaction/InteractionController';

import {
  PanelController,
  type CreateNodePayload,
  type DecomposeNodePayload,
  type LineageCandidatePayload,
  type PanelNodeSummary,
} from './panels/PanelController';
import {
  KnowledgeCreateController,
  type CreateReasoningKnowledgePayload,
  type CreateStandaloneKnowledgePayload,
  type KnowledgeCreateNode,
} from './panels/KnowledgeCreateController';
import {
  NodeDetailController,
  type NodeDetailAction,
  type NodeDetailNode,
} from './panels/NodeDetailController';
import { setupMobileShell } from '../mobile/MobileShell';
import { seedDemoKnowledge } from '../demo/seedDemoKnowledge';
import { bootstrapRemoteFirst } from '../bootstrap/RemoteFirstBootstrap';
import { getLocale, initializeLocale, setLocale, subscribeLocale } from '../i18n/Locale';

initializeLocale();

const projection = new GraphProjection();
const personalEventPersistence = new FilteredKnowledgePersistence<DomainEvent>({
  storageKey: 'knowledge-ball.personal-events.v1',
  legacyStorageKey: 'knowledge-ball.events.v1',
  retain: event => event.type === 'NodeMasterySet',
});
const store = new EventStore(
  () => structuredClone(projection.state),
  personalEventPersistence,
  event => validateDomainEventAgainstState(event, projection.state),
);
const productionSyncAdapter = createProductionSyncAdapter();
const nodeViewAuthClient = createProductionAuthClient();
let layoutNodes: KnowledgeSceneNode[] = [];
let renderNodes: KnowledgeSceneNode[] = [];
let knowledgeRelationIndex = createKnowledgeRelationIndex([]);
let scene: KnowledgeSceneRuntime;
let panel: PanelController;
let knowledgeCreate: KnowledgeCreateController;
let nodeDetail: NodeDetailController | null = null;
let interaction: InteractionController;
const knowledgeSurfaceState = new KnowledgeSurfaceState();
let syncEngine: SyncEngine<typeof projection.state> | null = null;
let markingViewedNodeId: string | null = null;
let currentViewerUserId: string | null = null;
const locallyCreatedByMeNodeIds = new Set<string>();

function nodeCreatedByCurrentUser(nodeId: string): boolean {
  if (locallyCreatedByMeNodeIds.has(nodeId)) return true;
  if (!currentViewerUserId) return false;
  return productionSyncAdapter?.nodeMetadata(nodeId)?.actorId === currentViewerUserId;
}

function syncCreatedByMeFlags(): void {
  for (const node of layoutNodes) node.createdByMe = nodeCreatedByCurrentUser(node.id);
  scene?.markDirty();
}

function updateCurrentViewerUserId(userId: string): void {
  if (currentViewerUserId && currentViewerUserId !== userId) locallyCreatedByMeNodeIds.clear();
  currentViewerUserId = userId;
  syncCreatedByMeFlags();
}

async function commitPublicEvent(event: DomainEvent): Promise<boolean> {
  if (!syncEngine) throw new Error('公共知识远程通道尚未初始化');
  const accepted = await syncEngine.commit(event);
  if (accepted) {
    for (const nodeId of createdNodeIdsFromEvent(event)) locallyCreatedByMeNodeIds.add(nodeId);
    syncCreatedByMeFlags();
  }
  return accepted;
}

function getSceneNodes(): KnowledgeSceneNode[] {
  return renderNodes;
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element: #${id}`);
  return el as T;
}

function opt<T extends HTMLElement>(id: string): T | undefined {
  return document.getElementById(id) as T | null ?? undefined;
}

function qOpt<T extends Element>(selector: string): T | undefined {
  return document.querySelector(selector) as T | null ?? undefined;
}

function generateNodeId(): string {
  return `n-${crypto.randomUUID()}`;
}

function syncNodesFromProjection(): void {
  const domainNodes = nodeList(projection.state);
  const graphIndex = createKnowledgeGraphIndex(domainNodes);
  knowledgeRelationIndex = createKnowledgeRelationIndex(domainNodes, graphIndex);

  // All formal lineage balls stay in scene data. Current/Personal/All owns their
  // visibility; rejected audit-only candidates and legacy hidden records do not.
  layoutNodes = domainNodes.map(dn => {
    const rendered = renderNodeFromDomain(dn);
    rendered.premises = effectivePremiseIds(dn, graphIndex);
    return rendered;
  });
  applyUniformLayerLayout(layoutNodes);
  renderNodes = layoutNodes.filter(node => nodeBelongsInLineageScene(node));
}

function syncPersonalMasteryFromProjection(nodeId: string): void {
  const mastery = projection.state.nodesById[nodeId]?.mastery;
  if (!mastery) return;
  for (const node of layoutNodes) {
    if (node.id === nodeId) {
      node.mastery = mastery;
      break;
    }
  }
  for (const node of renderNodes) {
    if (node.id === nodeId) {
      node.mastery = mastery;
      break;
    }
  }
}

function syncAllPersonalMasteryFromProjection(): void {
  for (const node of layoutNodes) {
    const mastery = projection.state.nodesById[node.id]?.mastery;
    if (mastery) node.mastery = mastery;
  }
  for (const node of renderNodes) {
    const mastery = projection.state.nodesById[node.id]?.mastery;
    if (mastery) node.mastery = mastery;
  }
}

function renderNodeFromDomain(dn: GraphNode): KnowledgeSceneNode {
  const declaredLayer = declaredLayerForNode(dn);
  const effectiveLayer = effectiveLayerForNode(dn, projection.state.nodesById);
  return {
      id: dn.id,
      title: dn.title,
      type: dn.type as KnowledgeNodeType,
      status: dn.status,
      mastery: dn.mastery,
      createdByMe: nodeCreatedByCurrentUser(dn.id),
      reasoning: dn.reasoning,
      premises: [...dn.premises],
      declaredLayer,
      effectiveLayer,
      logicRuleId: dn.logicRuleId,
      aliases: dn.aliases,
      semanticKey: dn.semanticKey,
      hidden: dn.hidden,
      lineage: dn.lineage,
  };
}

function getNodeById(id: string): KnowledgeSceneNode | null {
  return renderNodes.find(n => n.id === id) ?? null;
}

function panelNodeSummary(n: KnowledgeSceneNode): PanelNodeSummary {
  return {
    id: n.id,
    title: n.title,
    type: n.type,
    status: n.status,
    mastery: n.mastery,
    reasoning: n.reasoning,
    premises: n.premises,
    declaredLayer: n.declaredLayer,
    effectiveLayer: n.effectiveLayer,
    logicRuleId: n.logicRuleId,
    aliases: n.aliases,
    semanticKey: n.semanticKey,
  };
}

function getPanelNodeById(id: string): PanelNodeSummary | null {
  const n = getNodeById(id);
  if (!n || lineageRoleFor(n) !== 'current') return null;
  return panelNodeSummary(n);
}

function getPanelNodes(): PanelNodeSummary[] {
  return renderNodes
    .filter(n => lineageRoleFor(n) === 'current')
    .map(panelNodeSummary);
}

function getKnowledgeCreateNodes(): KnowledgeCreateNode[] {
  return nodeList(projection.state).map(node => ({
    id: node.id,
    title: node.title,
    type: node.type as KnowledgeNodeType,
    status: node.status,
    lineage: node.lineage,
  }));
}

function getInteractionNodes(): InteractionNodeSummary[] {
  return renderNodes.map(n => ({
    id: n.id,
    title: n.title,
    type: n.type,
    status: n.status,
    mastery: n.mastery,
    reasoning: n.reasoning,
  }));
}

function getNodeDetailById(id: string): NodeDetailNode | null {
  const node = getNodeById(id);
  return node ? {
    id: node.id,
    title: node.title,
    type: node.type,
    status: node.status,
    reasoning: node.reasoning,
    lineage: node.lineage,
  } : null;
}

function getNodeDetailActions(id: string): NodeDetailAction[] {
  const node = getNodeById(id);
  if (!node || lineageRoleFor(node) !== 'current') return [];
  const actions: NodeDetailAction[] = ['edit', 'derive', 'derive-reasoning'];
  if (node.type === 'reasoning') actions.push('decompose');
  if (node.status !== 'falsified' && node.status !== 'suspended') actions.push('negate');
  if (node.status === 'suspended') actions.push('resolve');
  if (node.status === 'disputed') actions.push('dispute');
  return actions;
}

function launchPanelAction(id: string, action: NodeDetailAction): void {
  if (action === 'derive') {
    knowledgeCreate.openStandalone();
    return;
  }
  if (action === 'derive-reasoning') {
    knowledgeCreate.openReasoning(id);
    return;
  }
  nodeDetail?.close();
  if (!panel.openNodeAction(id, action)) {
    panel.showToast('当前知识节点不支持这个编辑操作');
  }
}

async function markNodeViewed(id: string): Promise<void> {
  const node = projection.state.nodesById[id];
  if (!node || node.mastery !== 'none' || markingViewedNodeId === id) return;
  markingViewedNodeId = id;
  try {
    if (nodeViewAuthClient) {
      const state = await nodeViewAuthClient.markKnowledgeTouched(id);
      const current = projection.state.nodesById[id];
      if (current?.mastery === 'none') await cmdSetMastery(store, { nodeId: id, mastery: state.mastery });
      return;
    }
    await cmdSetMastery(store, { nodeId: id, mastery: 'touched' });
  } catch (error) {
    console.warn('[Knowledge-Ball] viewed-node mastery update deferred:', error);
  } finally {
    if (markingViewedNodeId === id) markingViewedNodeId = null;
  }
}

function latestLocalPersonalStates(): Array<{ nodeId: string; mastery: PersonalMastery }> {
  const latest = new Map<string, PersonalMastery>();
  for (const event of store.allEvents()) {
    if (event.type !== 'NodeMasterySet') continue;
    latest.set(event.payload.nodeId, event.payload.mastery);
  }
  return [...latest].map(([nodeId, mastery]) => ({ nodeId, mastery }));
}

function applyPersonalKnowledgeSnapshot(states: PersonalKnowledgeStateSnapshot[]): void {
  const masteryById = Object.fromEntries(states.map(state => [state.nodeId, state.mastery])) as Record<string, PersonalMastery>;
  projection.replacePersonalMastery(masteryById);
  syncAllPersonalMasteryFromProjection();
  scene.markDirty();
  refreshCurrentKnowledgeSurface();
}

function openNode(id: string): void {
  const node = getNodeById(id);
  if (!node) return;
  if (nodeDetail) {
    panel.closeNodePanel();
    knowledgeSurfaceState.open('detail', id);
    nodeDetail.open(id);
    if (performance.getEntriesByName('knowledge-node-tap-start', 'mark').length) {
      performance.mark?.('knowledge-node-detail-open');
      performance.measure?.('knowledge-node-detail-latency', 'knowledge-node-tap-start', 'knowledge-node-detail-open');
      performance.clearMarks?.('knowledge-node-tap-start');
      performance.clearMarks?.('knowledge-node-detail-open');
    }
  } else {
    panel.openNodePanel(id);
  }
  scene.markDirty();
}

function updateSceneOverlayState(visible: boolean): void {
  scene.setOverlayVisible(visible);
}

function closeKnowledgeSurface(): void {
  const { surface } = knowledgeSurfaceState.snapshot();
  if (surface === 'detail') nodeDetail?.close();
  else if (surface === 'panel') panel.closeNodePanel();
  knowledgeSurfaceState.clear();
}

function internalAtomicTypeForLayer(layer: UserKnowledgeLayer): KnowledgeNodeType {
  return layer === 'middle' ? 'axiom' : 'fact';
}

function internalConclusionTypeForLayer(layer: Exclude<UserKnowledgeLayer, 'inner'>): KnowledgeNodeType {
  return layer === 'middle' ? 'theorem' : 'hypothesis';
}

async function createKnowledgeNode(payload: CreateNodePayload): Promise<void> {
  if (payload.layer === 'inner' && payload.premises.length > 0) {
    throw new Error('第一层是非推导性的语义 / 基础事实层，不能直接带推理前提');
  }
  const conclusionId = generateNodeId();
  const hasPremises = payload.premises.length > 0;
  let edit: AddEdit;
  let declaredLayers: Record<string, UserKnowledgeLayer>;

  if (!hasPremises) {
    edit = {
      kind: 'add',
      mode: 'atomic',
      node: {
        id: conclusionId,
        title: payload.title,
        type: internalAtomicTypeForLayer(payload.layer),
        reasoning: payload.description,
      },
    };
    declaredLayers = { [conclusionId]: payload.layer };
  } else {
    if (payload.layer === 'inner') throw new Error('第一层不能建立派生链');
    const reasoningId = generateNodeId();
    edit = {
      kind: 'add',
      mode: 'theory',
      requiredPremiseIds: payload.premises,
      reasoning: {
        id: reasoningId,
        title: `推理：${payload.title} · ${conclusionId.slice(-6)}`,
        type: 'reasoning',
        reasoning: payload.reasoning ?? '',
        logicRuleId: payload.logicRuleId,
      },
      conclusion: {
        id: conclusionId,
        title: payload.title,
        type: internalConclusionTypeForLayer(payload.layer),
        reasoning: payload.description,
      },
    };
    declaredLayers = {
      [reasoningId]: payload.layer,
      [conclusionId]: payload.layer,
    };
  }
  await applyKnowledgeEdit(edit, declaredLayers);
  closeKnowledgeSurface();
}

async function createStandaloneKnowledge(payload: CreateStandaloneKnowledgePayload): Promise<void> {
  const nodeId = generateNodeId();
  const edit: AddEdit = {
    kind: 'add',
    mode: 'atomic',
    node: {
      id: nodeId,
      title: payload.title,
      type: internalAtomicTypeForLayer(payload.layer),
      reasoning: payload.description,
    },
  };
  await applyKnowledgeEdit(edit, { [nodeId]: payload.layer });
  closeKnowledgeSurface();
}

async function createReasoningKnowledge(payload: CreateReasoningKnowledgePayload): Promise<void> {
  const reasoningId = generateNodeId();
  const edit: AddEdit = {
    kind: 'add',
    mode: 'reasoning-link',
    requiredPremiseIds: payload.premiseIds,
    reasoning: {
      id: reasoningId,
      title: payload.title,
      type: 'reasoning',
      reasoning: payload.reasoning,
    },
    conclusionIds: payload.conclusionIds,
  };
  // Reasoning is structurally a white ball; its semantic layer is the rigorous
  // reasoning layer. The type, not the layer palette, owns its white appearance.
  await applyKnowledgeEdit(edit, { [reasoningId]: 'middle' });
  closeKnowledgeSurface();
}

async function applyKnowledgeEdit(
  edit: AddEdit | DecomposeEdit,
  declaredLayers?: Readonly<Record<string, UserKnowledgeLayer>>,
): Promise<void> {
  await executeKnowledgeEdit(store, projection, edit, commitPublicEvent, declaredLayers);
}

async function optimizeKnowledgeNode(id: string, payload: LineageCandidatePayload): Promise<void> {
  await executeKnowledgeOptimization(store, projection, {
    targetId: id,
    candidateId: generateNodeId(),
    title: payload.title,
    reasoning: payload.description,
    declaredLayer: payload.layer,
  }, commitPublicEvent);
}

async function opposeKnowledgeNode(id: string, payload: LineageCandidatePayload): Promise<void> {
  await executeKnowledgeOpposition(store, projection, {
    targetId: id,
    candidateId: generateNodeId(),
    title: payload.title,
    reasoning: payload.description,
    declaredLayer: payload.layer,
  }, commitPublicEvent);
}

async function decomposeKnowledgeNode(id: string, payload: DecomposeNodePayload): Promise<void> {
  const reasoning = projection.state.nodesById[id];
  if (!reasoning || reasoning.type !== 'reasoning') throw new Error('分解目标必须是推理过程');
  const edit: DecomposeEdit = {
    kind: 'decompose',
    chain: {
      premiseIds: [...reasoning.premises],
      reasoningId: id,
      conclusionId: payload.conclusionId,
    },
    reasoningSteps: payload.reasoningSteps.map(step => ({
      id: generateNodeId(),
      title: step.title,
      type: 'reasoning',
      reasoning: step.reasoning,
      logicRuleId: step.logicRuleId,
    })),
    intermediateConclusions: payload.intermediateConclusions.map(item => ({
      id: generateNodeId(),
      title: item.title,
      type: item.type,
      reasoning: item.description,
    })),
  };
  await applyKnowledgeEdit(edit);
}

async function resolveKnowledgeNode(id: string): Promise<void> {
  await cmdResolveNode(store, { nodeId: id }, commitPublicEvent);
}

async function disputeKnowledgeNode(id: string): Promise<void> {
  await cmdDisputeNode(store, { nodeId: id }, commitPublicEvent);
}

async function setKnowledgeMastery(id: string, mastery: 'none' | 'touched' | 'mastered'): Promise<void> {
  await cmdSetMastery(store, { nodeId: id, mastery });
}

async function seedDemoData(): Promise<void> {
  await seedDemoKnowledge(store, projection);
}
const host = must<HTMLElement>('canvasHost');
const labelsLayer = must<HTMLElement>('labelsLayer');

let openSettingsOverlay: (() => void) | undefined;
let closeSettingsOverlay: (() => void) | undefined;

scene = createKnowledgeScene({
  host,
  labelsLayer,
  getNodes: getSceneNodes,
  callbacks: {
    onNodeTap: openNode,
    onBackgroundTap: () => {
      closeKnowledgeSurface();
    },
    onBackgroundDoubleTap: () => {
      const premiseId = knowledgeSurfaceState.nodeId;
      closeKnowledgeSurface();
      if (premiseId) knowledgeCreate.openReasoning(premiseId);
      else knowledgeCreate.openStandalone();
    },
  },
});

panel = new PanelController({
  getNodes: getPanelNodes,
  getNodeById: getPanelNodeById,

  onCreateNode: Capacitor.isNativePlatform() ? createKnowledgeNode : undefined,
  onOptimizeNode: optimizeKnowledgeNode,
  onOpposeNode: opposeKnowledgeNode,
  onDecomposeNode: decomposeKnowledgeNode,
  onResolveNode: resolveKnowledgeNode,
  onDisputeNode: disputeKnowledgeNode,
  onSetMastery: setKnowledgeMastery,
  onSelectRelatedNode: openNode,
  onOverlayVisibilityChange: updateSceneOverlayState,
  onNodePanelChange: id => id ? knowledgeSurfaceState.open('panel', id) : knowledgeSurfaceState.close('panel'),

  panel: must<HTMLElement>('panel'),
  panelTitle: must<HTMLElement>('panelTitle'),
  panelBody: must<HTMLElement>('panelBody'),
  panelActions: must<HTMLElement>('panelActions'),
  panelClose: must<HTMLElement>('panelClose'),

  modalOverlay: must<HTMLElement>('modalOverlay'),
  modalTitle: must<HTMLElement>('modalTitle'),
  modalHint: must<HTMLElement>('modalHint'),
  modalClose: must<HTMLElement>('modalClose'),
  modalCancel: must<HTMLElement>('modalCancel'),
  modalSubmit: must<HTMLButtonElement>('modalSubmit'),

  fTitle: must<HTMLInputElement>('fTitle'),
  fType: must<HTMLSelectElement>('fType'),
  fDescription: must<HTMLTextAreaElement>('fDescription'),
  fReasoning: must<HTMLTextAreaElement>('fReasoning'),
  fReasoningField: must<HTMLElement>('fReasoningField'),
  fPremises: must<HTMLElement>('fPremises'),
  fPremisesField: must<HTMLElement>('fPremisesField'),
  fLogicRule: must<HTMLSelectElement>('fLogicRule'),
  fLogicRuleField: must<HTMLElement>('fLogicRuleField'),

  accountOverlay: Capacitor.isNativePlatform() ? opt<HTMLElement>('accountOverlay') : undefined,
  accountClose: Capacitor.isNativePlatform() ? opt<HTMLElement>('accountClose') : undefined,
  statRep: Capacitor.isNativePlatform() ? opt<HTMLElement>('statRep') : undefined,
  statLit: Capacitor.isNativePlatform() ? opt<HTMLElement>('statLit') : undefined,
  statContrib: Capacitor.isNativePlatform() ? opt<HTMLElement>('statContrib') : undefined,

  settingsOverlay: opt<HTMLElement>('settingsOverlay'),
  settingsClose: opt<HTMLElement>('settingsClose'),
  setNodeRadius: opt<HTMLInputElement>('setNodeRadius'),
  setNodeRadiusVal: opt<HTMLElement>('setNodeRadiusVal'),
  setLabelSize: opt<HTMLInputElement>('setLabelSize'),
  setLabelSizeVal: opt<HTMLElement>('setLabelSizeVal'),
  setLabelColor: opt<HTMLInputElement>('setLabelColor'),
  setLabelFont: opt<HTMLSelectElement>('setLabelFont'),
  setLabelBrightness: opt<HTMLInputElement>('setLabelBrightness'),
  setLabelBrightnessVal: opt<HTMLElement>('setLabelBrightnessVal'),

  toast: opt<HTMLElement>('toast'),
});

knowledgeCreate = new KnowledgeCreateController({
  getNodes: getKnowledgeCreateNodes,
  onCreateStandalone: createStandaloneKnowledge,
  onCreateReasoning: createReasoningKnowledge,
  onOverlayVisibilityChange: updateSceneOverlayState,
  onToast: message => panel.showToast(message),
});

if (!Capacitor.isNativePlatform()) {
  nodeDetail = new NodeDetailController({
    getNodeById: getNodeDetailById,
    getMetadata: id => {
      const metadata = productionSyncAdapter?.nodeMetadata(id);
      return metadata ? { contributor: metadata.contributor, createdAt: metadata.createdAt, actorId: metadata.actorId } : null;
    },
    getRelations: id => knowledgeRelationIndex.relationsFor(id),
    getScreenPosition: id => scene.screenPositionForNode(id),
    getActions: getNodeDetailActions,
    onAction: launchPanelAction,
    onSelectRelatedNode: openNode,
    onDetailNodeChange: id => scene.setDetailNode(id),
    onViewed: id => { void markNodeViewed(id); },
    onClose: () => { knowledgeSurfaceState.close('detail'); },
  });
}

openSettingsOverlay = () => panel.openSettingsOverlay();
closeSettingsOverlay = () => panel.closeSettingsOverlay();

interaction = new InteractionController({
  scene,
  getNodes: getInteractionNodes,
  searchInput: must<HTMLInputElement>('aiInput'),
  searchResults: must<HTMLElement>('aiResults'),
  personalButton: opt<HTMLButtonElement>('btnPersonal'),
  settingsButton: opt<HTMLButtonElement>('btnSettings'),
  nodeRadiusInput: opt<HTMLInputElement>('setNodeRadius'),
  labelBrightnessInput: opt<HTMLInputElement>('setLabelBrightness'),
  onPickNode: openNode,
  onOpenCreateNode: () => knowledgeSurfaceState.nodeId ? knowledgeCreate.openReasoning(knowledgeSurfaceState.nodeId) : knowledgeCreate.openStandalone(),
  onOpenSettings: () => panel.openSettingsOverlay(),
});

function refreshCurrentKnowledgeSurface(): void {
  const { nodeId, surface } = knowledgeSurfaceState.snapshot();
  if (!nodeId) return;
  if (surface === 'panel') panel.openNodePanel(nodeId);
  else if (surface === 'detail') nodeDetail?.refresh(nodeId);
}

function flushProjectionRender(): void {
  performance.mark?.('knowledge-render-flush-start');
  syncNodesFromProjection();
  scene.markDirty();
  refreshCurrentKnowledgeSurface();
  performance.mark?.('knowledge-render-flush-end');
  performance.measure?.('knowledge-render-flush', 'knowledge-render-flush-start', 'knowledge-render-flush-end');
}

const projectionRenderScheduler = new ProjectionRenderScheduler(flushProjectionRender);

store.subscribe((event) => {
  performance.mark?.('knowledge-subscriber-start');
  projection.apply(event);
  if (event.type === 'NodeMasterySet') {
    // Personal mastery changes visibility/style only. They never change graph
    // topology, lineage, layer membership, or spatial constraints.
    syncPersonalMasteryFromProjection(event.payload.nodeId);
    scene.markDirty();
    if (knowledgeSurfaceState.nodeId === event.payload.nodeId) refreshCurrentKnowledgeSurface();
  } else {
    // Public/domain truth still advances event-by-event. A synchronous replay
    // burst gets one derived full-graph render/layout at the microtask boundary.
    projectionRenderScheduler.request();
  }
  performance.mark?.('knowledge-subscriber-end');
  performance.measure?.('knowledge-subscriber', 'knowledge-subscriber-start', 'knowledge-subscriber-end');
});

syncNodesFromProjection();

const accountUi = !Capacitor.isNativePlatform()
  ? installAccountUi({
      avatarButton: qOpt<HTMLElement>('.avatar-btn') ?? null,
      accountOverlay: opt<HTMLElement>('accountOverlay') ?? null,
      accountClose: opt<HTMLElement>('accountClose') ?? null,
      toast: opt<HTMLElement>('toast') ?? null,
      getLocalPersonalStates: latestLocalPersonalStates,
      applyPersonalSnapshot: applyPersonalKnowledgeSnapshot,
      onIdentityResolved: updateCurrentViewerUserId,
    })
  : null;

panel.setSettingsValues({
  nodeRadius: 7.2,
  labelSize: 11.5,
  labelBrightness: 1,
  labelColor: '#C7DBDD',
  labelFont: `'Noto Sans SC','Inter',sans-serif`,
});

const localeSelect = opt<HTMLSelectElement>('setLocale');
if (localeSelect) {
  localeSelect.value = getLocale();
  localeSelect.addEventListener('change', () => setLocale(localeSelect.value === 'en' ? 'en' : 'zh-CN'));
}
const downloadsOverlay = opt<HTMLElement>('downloadsOverlay');
opt<HTMLButtonElement>('openDownloads')?.addEventListener('click', () => {
  opt<HTMLElement>('settingsOverlay')?.classList.remove('show');
  downloadsOverlay?.classList.add('show');
});
const closeDownloads = () => {
  downloadsOverlay?.classList.remove('show');
  opt<HTMLElement>('settingsOverlay')?.classList.add('show');
};
opt<HTMLButtonElement>('downloadsClose')?.addEventListener('click', closeDownloads);
downloadsOverlay?.addEventListener('click', event => { if (event.target === downloadsOverlay) closeDownloads(); });
subscribeLocale(() => {
  if (localeSelect) localeSelect.value = getLocale();
  const { nodeId, surface } = knowledgeSurfaceState.snapshot();
  if (nodeId && surface === 'panel') panel.openNodePanel(nodeId);
  else if (nodeId && surface === 'detail') nodeDetail?.refresh(nodeId);
});


const legend = qOpt<HTMLElement>('.legend');
if (legend) {
  legend.innerHTML = `
    <h4>Knowledge Layers</h4>
    <div class="legend-row"><div class="legend-dot" style="background:var(--node-inner)"></div><span>第一层 · 语义与基础事实</span></div>
    <div class="legend-row"><div class="legend-dot" style="background:var(--node-middle)"></div><span>第二层 · 严谨推理</span></div>
    <div class="legend-row"><div class="legend-dot" style="background:var(--node-outer)"></div><span>第三层 · 概率与争议</span></div>
    <div class="legend-div"></div>
    <div class="layer-note">第一层包括静态语义关系；第二层只表达推理结构；第三层表达争议或提交时明确声明的不确定 / 概率知识。</div>
  `;
}

if (Capacitor.isNativePlatform()) {
  const accountButton = qOpt<HTMLButtonElement>('.avatar-btn');
  accountButton?.addEventListener('click', () => panel.openAccountOverlay());
}

const createButton = qOpt<HTMLButtonElement>('.ai-add');
createButton?.addEventListener('click', () => knowledgeSurfaceState.nodeId ? knowledgeCreate.openReasoning(knowledgeSurfaceState.nodeId) : knowledgeCreate.openStandalone());

const sendButton = qOpt<HTMLButtonElement>('.ai-send');
const searchInput = must<HTMLInputElement>('aiInput');
sendButton?.addEventListener('click', () => {
  searchInput.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
  );
});

interaction.setVisibilityMode('current');

function validateProposedPublicEvent(event: PublicKnowledgeEvent): string | null {
  const errors = validateDomainEventAgainstState(event, projection.state);
  return errors[0] ?? null;
}

function initializeSyncEngine(): void {
  syncEngine = new SyncEngine(store, productionSyncAdapter, validateProposedPublicEvent);
  syncEngine.subscribe((status) => {
    document.documentElement.dataset.syncStatus = status;
    const settingsButton = opt<HTMLButtonElement>('btnSettings');
    if (settingsButton) settingsButton.title = status === 'unavailable'
      ? '远程数据库未配置 · 公共知识只读，本地公共数据不被承认'
      : `同步状态：${status}`;
    if (status === 'unavailable') panel.showToast('远程数据库未配置；公共知识只认云端，当前页面不能提交公共修改');
    if (status === 'conflict') panel.showToast('服务器数据已变化，请重试刚才的公共操作');
  });
}

initializeSyncEngine();

void bootstrapRemoteFirst({
  hosted: productionSyncAdapter !== null,
  hydrateRemote: () => syncEngine?.sync() ?? Promise.resolve(),
  hasKnowledge: () => nodeList(projection.state).length > 0,
  seedDemo: seedDemoData,
})
  .then(() => {
    // Materialize any pending coalesced replay before scene start without
    // rebuilding the same authoritative graph a second time.
    projectionRenderScheduler.flushNow();
    scene.start();
  })
  .catch(error => {
    console.error('[Knowledge-Ball] remote-first bootstrap failed:', error);
    scene.start();
  });

window.addEventListener('resize', () => {
  scene.resize();
});

void setupMobileShell();

(window as unknown as { __debug?: unknown }).__debug = {
  store,
  projection,
  get layoutNodes() {
    return layoutNodes;
  },
  get renderNodes() {
    return renderNodes;
  },
  interaction,
  panel,
  knowledgeCreate,
  nodeDetail,
  accountUi,
  scene,
  projectionRenderScheduler,
  knowledgeSurfaceState,
  createKnowledgeNode,
  createStandaloneKnowledge,
  createReasoningKnowledge,
  get syncEngine() { return syncEngine; },
};
