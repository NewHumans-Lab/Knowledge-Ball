import { Capacitor } from '@capacitor/core';
import { EventStore } from '../event/EventStore';
import { validateDomainEventAgainstState } from '../event/EventValidation';
import { GraphProjection, setCascadeDepthLimit } from '../projection/GraphProjection';
import { nodeList } from '../state/GraphState';
import type { GraphNode } from '../graph/Node';
import {
  declaredLayerForNode,
  effectiveLayerForNode,
  type UserKnowledgeLayer,
} from '../domain/KnowledgeLayerPolicy';

import { editNode as cmdEditNode } from '../command/EditNode';
import { resolveNode as cmdResolveNode } from '../command/ResolveNode';
import { setMastery as cmdSetMastery } from '../command/SetMastery';
import { disputeNode as cmdDisputeNode } from '../command/DisputeNode';
import { executeKnowledgeEdit } from '../command/KnowledgeEdit';
import {
  canonicalKnowledgeText,
  type AddEdit,
  type DecomposeEdit,
  type MergeEdit,
  type NegateEdit,
} from '../protocol/KnowledgeEditingProtocol';
import type { DomainEvent, PublicKnowledgeEvent } from '../event/Event';
import { FilteredKnowledgePersistence } from '../persistence/KnowledgePersistence';
import { SyncEngine } from '../sync/SyncEngine';
import { createProductionSyncAdapter } from '../sync/SupabaseSyncAdapter';
import { createProductionAuthClient } from '../auth/AuthClient';

import {
  TWIN_META,
  type KnowledgeNodeType,
} from './config/KnowledgeUiConfig';

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
  type EditNodePayload,
  type MergeDefinitionPayload,
  type MergeTheoryPayload,
  type NegateNodePayload,
  type PanelNodeSummary,
} from './panels/PanelController';
import {
  NodeDetailController,
  type NodeDetailAction,
  type NodeDetailNode,
} from './panels/NodeDetailController';
import { setupMobileShell } from '../mobile/MobileShell';
import { seedDemoKnowledge } from '../demo/seedDemoKnowledge';
import { bootstrapRemoteFirst } from '../bootstrap/RemoteFirstBootstrap';

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
let scene: KnowledgeSceneRuntime;
let panel: PanelController;
let nodeDetail: NodeDetailController | null = null;
let interaction: InteractionController;
let currentPanelId: string | null = null;
let syncEngine: SyncEngine<typeof projection.state> | null = null;
let markingViewedNodeId: string | null = null;

async function commitPublicEvent(event: DomainEvent): Promise<boolean> {
  if (!syncEngine) throw new Error('公共知识远程通道尚未初始化');
  return syncEngine.commit(event);
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
  const hiddenIds = new Set(domainNodes.filter(dn => dn.hidden).map(dn => dn.id));

  // Every projected node receives a real slot before render visibility is applied.
  // Hidden/falsified/superseded history therefore continues to occupy space.
  layoutNodes = domainNodes.map(dn => renderNodeFromDomain(dn));
  applyUniformLayerLayout(layoutNodes);
  renderNodes = layoutNodes.filter(node => !hiddenIds.has(node.id));
}

function renderNodeFromDomain(dn: GraphNode): KnowledgeSceneNode {
  const meta = (TWIN_META as Record<string, { twinGroup: string; sharedTitle: string }>)[dn.id] ?? {};
  const declaredLayer = declaredLayerForNode(dn);
  const effectiveLayer = effectiveLayerForNode(dn, projection.state.nodesById);
  return {
      id: dn.id,
      title: dn.title,
      type: dn.type as KnowledgeNodeType,
      status: dn.status,
      mastery: dn.mastery,
      reasoning: dn.reasoning,
      premises: dn.premises,
      declaredLayer,
      effectiveLayer,
      logicRuleId: dn.logicRuleId,
      aliases: dn.aliases,
      semanticKey: dn.semanticKey,
      ...meta,
  };
}

function getNodeById(id: string): KnowledgeSceneNode | null {
  return renderNodes.find(n => n.id === id) ?? null;
}

function getPanelNodeById(id: string): PanelNodeSummary | null {
  const n = getNodeById(id);
  if (!n) return null;

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
    twinGroup: n.twinGroup,
    sharedTitle: n.sharedTitle,
    logicRuleId: n.logicRuleId,
    aliases: n.aliases,
    semanticKey: n.semanticKey,
  };
}

function getPanelNodes(): PanelNodeSummary[] {
  return renderNodes.map(n => ({
    id: n.id,
    title: n.title,
    type: n.type,
    status: n.status,
    mastery: n.mastery,
    reasoning: n.reasoning,
    premises: n.premises,
    declaredLayer: n.declaredLayer,
    effectiveLayer: n.effectiveLayer,
    twinGroup: n.twinGroup,
    sharedTitle: n.sharedTitle,
    logicRuleId: n.logicRuleId,
    aliases: n.aliases,
    semanticKey: n.semanticKey,
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
  } : null;
}

function reasoningParentForDetail(node: KnowledgeSceneNode): KnowledgeSceneNode | null {
  const parents = node.premises
    .map(id => getNodeById(id))
    .filter((candidate): candidate is KnowledgeSceneNode => candidate?.type === 'reasoning');
  return parents.length === 1 ? parents[0] : null;
}

function canMergeFromDetail(node: KnowledgeSceneNode): boolean {
  if (node.type === 'definition') return renderNodes.some(candidate => candidate.id !== node.id && candidate.type === 'definition');
  if (['axiom', 'definition', 'fact', 'logic-symbol', 'reasoning'].includes(node.type)) return false;
  const reasoning = reasoningParentForDetail(node);
  if (!reasoning) return false;
  const premiseKey = [...new Set(reasoning.premises)].sort().join('\0');
  return renderNodes.some(candidate => {
    if (candidate.id === node.id || candidate.type !== node.type) return false;
    const otherReasoning = reasoningParentForDetail(candidate);
    if (!otherReasoning || otherReasoning.id === reasoning.id || otherReasoning.logicRuleId !== reasoning.logicRuleId) return false;
    return [...new Set(otherReasoning.premises)].sort().join('\0') === premiseKey;
  });
}

function getNodeDetailActions(id: string): NodeDetailAction[] {
  const node = getNodeById(id);
  if (!node) return [];
  const actions: NodeDetailAction[] = ['edit', 'derive'];
  if (node.type === 'reasoning') actions.push('decompose');
  if (canMergeFromDetail(node)) actions.push('merge');
  if (node.status !== 'falsified' && node.status !== 'suspended') actions.push('negate');
  if (node.status === 'suspended') actions.push('resolve');
  if (node.status === 'disputed') actions.push('dispute');
  return actions;
}

function launchLegacyPanelAction(id: string, action: NodeDetailAction): void {
  currentPanelId = id;
  if (action === 'derive') {
    panel.openCreateModal(id);
    return;
  }
  panel.openNodePanel(id);
  const buttonId: Partial<Record<NodeDetailAction, string>> = {
    edit: 'btnEditNode',
    negate: 'btnNegate',
    decompose: 'btnDecompose',
    merge: 'btnMerge',
    resolve: 'btnResolve',
    dispute: 'btnDispute',
  };
  const targetId = buttonId[action];
  const button = targetId ? document.getElementById(targetId) as HTMLButtonElement | null : null;
  if (!button) {
    panel.closeNodePanel();
    panel.showToast('当前知识节点不支持这个编辑操作');
    return;
  }
  button.click();
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

function openNode(id: string): void {
  const node = getNodeById(id);
  if (!node) return;
  currentPanelId = id;
  if (nodeDetail) {
    panel.closeNodePanel();
    nodeDetail.open(id);
    void markNodeViewed(id);
  } else {
    panel.openNodePanel(id);
  }
  scene.markDirty();
}

function updateSceneOverlayState(visible: boolean): void {
  scene.setOverlayVisible(visible);
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
  currentPanelId = null;
  await applyKnowledgeEdit(edit, declaredLayers);
}

async function applyKnowledgeEdit(
  edit: AddEdit | NegateEdit | DecomposeEdit | MergeEdit,
  declaredLayers?: Readonly<Record<string, UserKnowledgeLayer>>,
): Promise<void> {
  await executeKnowledgeEdit(store, projection, edit, commitPublicEvent, declaredLayers);
}

async function editKnowledgeNode(id: string, payload: EditNodePayload): Promise<void> {
  const current = projection.state.nodesById[id];
  if (!current) throw new Error('编辑目标不存在');
  if (payload.type !== current.type) throw new Error('结构类型不能直接更改；请通过增加、分解或合并建立新结构');
  const title = canonicalKnowledgeText(payload.title);
  const description = canonicalKnowledgeText(payload.reasoning);
  const duplicateTitle = nodeList(projection.state).find(node => node.id !== id && canonicalKnowledgeText(node.title) === title);
  const duplicateDescription = nodeList(projection.state).find(node => node.id !== id && canonicalKnowledgeText(node.reasoning) === description);
  if (duplicateTitle) throw new Error(`节点标题已被“${duplicateTitle.title}”占用，包括隐藏历史节点`);
  if (duplicateDescription) throw new Error(`节点描述已被“${duplicateDescription.title}”占用，包括隐藏历史节点`);
  const premises = payload.premises ? [...new Set(payload.premises)] : [...current.premises];
  if (premises.includes(id)) throw new Error('知识节点不能把自己作为前提');
  for (const premiseId of premises) {
    if (!projection.state.nodesById[premiseId]) throw new Error(`前提不存在: ${premiseId}`);
  }
  await cmdEditNode(store, {
    nodeId: id,
    title: payload.title,
    nodeType: payload.type,
    reasoning: payload.reasoning,
    premises,
  }, commitPublicEvent);
}

async function negateKnowledgeNode(id: string, payload: NegateNodePayload): Promise<void> {
  const target = projection.state.nodesById[id];
  if (!target) throw new Error('否定目标不存在');
  const edit: NegateEdit = {
    kind: 'negate',
    target: target.type === 'reasoning' ? 'reasoning' : 'conclusion',
    targetId: id,
    counterexampleIds: payload.counterexampleIds,
    correctedReasoning: payload.correctedReasoning
      ? {
          id: generateNodeId(),
          title: payload.correctedReasoning.title,
          type: 'reasoning',
          reasoning: payload.correctedReasoning.reasoning,
          logicRuleId: payload.correctedReasoning.logicRuleId,
        }
      : undefined,
  };
  await applyKnowledgeEdit(edit);
  currentPanelId = null;
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
  currentPanelId = null;
}

async function mergeDefinitions(payload: MergeDefinitionPayload): Promise<void> {
  const edit: MergeEdit = {
    kind: 'merge',
    mode: 'definition',
    sourceNodeIds: payload.sourceNodeIds,
    semanticKey: payload.semanticKey,
    mergedDefinition: {
      id: generateNodeId(),
      title: payload.mergedDefinition.title,
      type: 'definition',
      reasoning: payload.mergedDefinition.description,
    },
  };
  await applyKnowledgeEdit(edit);
  currentPanelId = null;
}

async function mergeTheories(payload: MergeTheoryPayload): Promise<void> {
  const chains = payload.sourceConclusionIds.map(conclusionId => {
    const conclusion = projection.state.nodesById[conclusionId];
    const reasoningParents = conclusion?.premises
      .map(id => projection.state.nodesById[id])
      .filter(node => node?.type === 'reasoning') ?? [];
    if (!conclusion || reasoningParents.length !== 1) throw new Error(`结论缺少唯一推理过程: ${conclusionId}`);
    const reasoning = reasoningParents[0]!;
    return {
      premiseIds: [...reasoning.premises],
      reasoningId: reasoning.id,
      conclusionId,
    };
  });
  const edit: MergeEdit = {
    kind: 'merge',
    mode: 'theory',
    chains,
    reasoningSemanticKey: payload.reasoningSemanticKey,
    semanticKey: payload.semanticKey,
    mergedReasoning: {
      id: generateNodeId(),
      title: payload.mergedReasoning.title,
      type: 'reasoning',
      reasoning: payload.mergedReasoning.reasoning,
      logicRuleId: payload.mergedReasoning.logicRuleId,
    },
    mergedConclusion: {
      id: generateNodeId(),
      title: payload.mergedConclusion.title,
      type: payload.mergedConclusion.type,
      reasoning: payload.mergedConclusion.description,
    },
  };
  await applyKnowledgeEdit(edit);
  currentPanelId = null;
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
      currentPanelId = null;
      nodeDetail?.close();
      panel.closeNodePanel();
    },
    onBackgroundDoubleTap: () => {
      const premiseId = currentPanelId;
      nodeDetail?.close();
      currentPanelId = premiseId;
      panel.openCreateModal(premiseId);
    },
  },
});

panel = new PanelController({
  getNodes: getPanelNodes,
  getNodeById: getPanelNodeById,

  onCreateNode: createKnowledgeNode,
  onEditNode: editKnowledgeNode,
  onNegateNode: negateKnowledgeNode,
  onDecomposeNode: decomposeKnowledgeNode,
  onMergeDefinitions: mergeDefinitions,
  onMergeTheories: mergeTheories,
  onResolveNode: resolveKnowledgeNode,
  onDisputeNode: disputeKnowledgeNode,
  onSetMastery: setKnowledgeMastery,
  onSelectRelatedNode: openNode,
  onOverlayVisibilityChange: updateSceneOverlayState,

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

  accountOverlay: opt<HTMLElement>('accountOverlay'),
  accountClose: opt<HTMLElement>('accountClose'),
  statRep: opt<HTMLElement>('statRep'),
  statLit: opt<HTMLElement>('statLit'),
  statContrib: opt<HTMLElement>('statContrib'),

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
  depthLimit: opt<HTMLInputElement>('depthLimit'),

  toast: opt<HTMLElement>('toast'),
});

if (!Capacitor.isNativePlatform()) {
  nodeDetail = new NodeDetailController({
    getNodeById: getNodeDetailById,
    getMetadata: id => {
      const metadata = productionSyncAdapter?.nodeMetadata(id);
      return metadata ? { contributor: metadata.contributor, createdAt: metadata.createdAt } : null;
    },
    getScreenPosition: id => scene.screenPositionForNode(id),
    getActions: getNodeDetailActions,
    onAction: launchLegacyPanelAction,
    onDetailNodeChange: id => scene.setDetailNode(id),
    onClose: () => { currentPanelId = null; },
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
  hideUntouchedButton: opt<HTMLButtonElement>('btnPersonal'),
  onPickNode: id => scene.focusNode(id),
  onOpenCreateNode: () => panel.openCreateModal(currentPanelId),
  onOpenSettings: () => panel.openSettingsOverlay(),
});

store.subscribe((event) => {
  performance.mark?.('knowledge-subscriber-start');
  projection.apply(event);
  // Layer occupancy is global: every event can alter layer membership or visibility,
  // so rebuild the complete slot assignment from the authoritative projection.
  syncNodesFromProjection();
  scene.markDirty();

  if (currentPanelId) {
    const legacyPanelOpen = must<HTMLElement>('panel').classList.contains('open');
    if (legacyPanelOpen) panel.openNodePanel(currentPanelId);
    else if (nodeDetail?.isOpenFor(currentPanelId)) nodeDetail.refresh(currentPanelId);
  }
  performance.mark?.('knowledge-subscriber-end');
  performance.measure?.('knowledge-subscriber', 'knowledge-subscriber-start', 'knowledge-subscriber-end');
});

syncNodesFromProjection();

panel.setSettingsValues({
  nodeRadius: 7.2,
  labelSize: 11.5,
  labelBrightness: 1,
  labelColor: '#C7DBDD',
  labelFont: `'Noto Sans SC','Inter',sans-serif`,
  depthLimit: null,
});

const depthLimitInput = opt<HTMLInputElement>('depthLimit');
if (depthLimitInput) {
  const applyDepthLimit = () => {
    const raw = depthLimitInput.value.trim();
    if (!raw) {
      setCascadeDepthLimit(null);
      scene.setCascadeDepthLimit(null);
      return;
    }
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      setCascadeDepthLimit(value);
      scene.setCascadeDepthLimit(value);
    } else {
      setCascadeDepthLimit(null);
      scene.setCascadeDepthLimit(null);
    }
  };

   depthLimitInput.addEventListener('input', applyDepthLimit);
  applyDepthLimit();
}

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

const accountButton = qOpt<HTMLButtonElement>('.avatar-btn');
accountButton?.addEventListener('click', () => panel.openAccountOverlay());

const createButton = qOpt<HTMLButtonElement>('.ai-add');
createButton?.addEventListener('click', () => panel.openCreateModal(currentPanelId));

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

interaction.setHideUntouched(false);

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
    syncNodesFromProjection();
    scene.markDirty();
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
  nodeDetail,
  scene,
  createKnowledgeNode,
  get syncEngine() { return syncEngine; },
};
