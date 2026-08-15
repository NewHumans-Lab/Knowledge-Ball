import { EventStore } from '../event/EventStore';
import { validateDomainEventAgainstState } from '../event/EventValidation';
import { GraphProjection, setCascadeDepthLimit } from '../projection/GraphProjection';
import { nodeList } from '../state/GraphState';

import { createNode as cmdCreateNode } from '../command/CreateNode';
import { editNode as cmdEditNode } from '../command/EditNode';
import { resolveNode as cmdResolveNode } from '../command/ResolveNode';
import { setMastery as cmdSetMastery } from '../command/SetMastery';
import { disputeNode as cmdDisputeNode } from '../command/DisputeNode';
import { suspendNode as cmdSuspendNode } from '../command/SuspendNode';
import { executeKnowledgeEdit } from '../command/KnowledgeEdit';
import {
  canonicalKnowledgeText,
  type AddEdit,
  type DecomposeEdit,
  type MergeEdit,
  type NegateEdit,
} from '../protocol/KnowledgeEditingProtocol';
import type { PublicKnowledgeEvent } from '../event/Event';
import { SyncEngine } from '../sync/SyncEngine';
import { createProductionSyncAdapter } from '../sync/SupabaseSyncAdapter';

import {
  TWIN_META,
  type KnowledgeMastery,
  type KnowledgeNodeType,
} from './config/KnowledgeUiConfig';

import {
  createKnowledgeScene,
  type KnowledgeSceneNode,
  type KnowledgeSceneRuntime,
} from './scene/KnowledgeScene';

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
import { setupMobileShell } from '../mobile/MobileShell';
import { isDemoSeedEvent, seedDemoKnowledge } from '../demo/seedDemoKnowledge';
import { isCanonicalPublicKnowledgeEvent } from '../event/Event';
import { bootstrapRemoteFirst } from '../bootstrap/RemoteFirstBootstrap';

const projection = new GraphProjection();
const store = new EventStore(
  () => structuredClone(projection.state),
  undefined,
  event => validateDomainEventAgainstState(event, projection.state),
);
let renderNodes: KnowledgeSceneNode[] = [];
let scene: KnowledgeSceneRuntime;
let panel: PanelController;
let interaction: InteractionController;
let currentPanelId: string | null = null;
let syncEngine: SyncEngine<typeof projection.state> | null = null;
let backgroundSyncTimer:number|null=null;
function scheduleBackgroundSync():void {
  if(backgroundSyncTimer!==null)return;
  backgroundSyncTimer=window.setTimeout(()=>{backgroundSyncTimer=null;void syncEngine?.sync().catch(error=>console.warn('[Knowledge-Ball] background sync deferred:',error));},0);
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

  const prevById: Record<string, KnowledgeSceneNode> = {};
  renderNodes.forEach(n => {
    prevById[n.id] = n;
  });

  renderNodes = domainNodes.filter(dn => !dn.hidden).map(dn => {
    const prev = prevById[dn.id];
    const meta = (TWIN_META as Record<string, { twinGroup: string; sharedTitle: string }>)[dn.id] ?? {};

    return {
      id: dn.id,
      title: dn.title,
      type: dn.type as KnowledgeNodeType,
      status: dn.status,
      mastery: dn.mastery,
      reasoning: dn.reasoning,
      premises: dn.premises,
      logicRuleId: dn.logicRuleId,
      aliases: dn.aliases,
      semanticKey: dn.semanticKey,
      ...meta,
      pos: prev?.pos,
      vel: prev?.vel,
      homePos: prev?.homePos,
      layer: prev?.layer,
    };
  });
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

function openNode(id: string): void {
  const node = getNodeById(id);
  if (!node) return;
  currentPanelId = id;
  panel.openNodePanel(id);
  scene.markDirty();
}

async function createKnowledgeNode(payload: CreateNodePayload): Promise<void> {
  const conclusionId = generateNodeId();
  const atomic = ['axiom', 'definition', 'fact', 'logic-symbol'].includes(payload.type);
  const edit: AddEdit = atomic
    ? {
        kind: 'add',
        mode: 'atomic',
        node: {
          id: conclusionId,
          title: payload.title,
          type: payload.type,
          reasoning: payload.description,
        },
      }
    : {
        kind: 'add',
        mode: 'theory',
        requiredPremiseIds: payload.premises,
        reasoning: {
          id: generateNodeId(),
          title: `推理：${payload.title} · ${conclusionId.slice(-6)}`,
          type: 'reasoning',
          reasoning: payload.reasoning ?? '',
          logicRuleId: payload.logicRuleId,
        },
        conclusion: {
          id: conclusionId,
          title: payload.title,
          type: payload.type,
          reasoning: payload.description,
        },
      };
  await applyKnowledgeEdit(edit);
  currentPanelId = conclusionId;
  panel.openNodePanel(conclusionId);
  scene.markDirty();
}

async function applyKnowledgeEdit(edit: AddEdit | NegateEdit | DecomposeEdit | MergeEdit): Promise<void> {
  await executeKnowledgeEdit(store, projection, edit);
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
  await cmdEditNode(store, {
    nodeId: id,
    title: payload.title,
    nodeType: payload.type,
    reasoning: payload.reasoning,
  });
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
  await cmdResolveNode(store, { nodeId: id });
}

async function disputeKnowledgeNode(id: string): Promise<void> {
  await cmdDisputeNode(store, { nodeId: id });
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
  getNodes: () => renderNodes,
  callbacks: {
    onNodeTap: openNode,
    onBackgroundTap: () => {
      currentPanelId = null;
      panel.closeNodePanel();
    },
    onBackgroundDoubleTap: () => {
      panel.openCreateModal(currentPanelId);
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
  fCanonical: must<HTMLInputElement>('fCanonical'),
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
  onPickNode: openNode,
  onOpenCreateNode: () => panel.openCreateModal(currentPanelId),
  onOpenSettings: () => panel.openSettingsOverlay(),
});

store.subscribe((event) => {
  projection.apply(event);
  syncNodesFromProjection();
  scene.markDirty();

  if (currentPanelId) panel.openNodePanel(currentPanelId);
  // Never begin network/rebase work inside the submit click stack. The modal
  // closes immediately after the local append; one deferred sync handles any
  // events appended in the same task.
  if (syncEngine && event.scope === 'public') scheduleBackgroundSync();
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

function validateRemoteEvent(event: PublicKnowledgeEvent, rebaseBase?: readonly import('../event/Event').DomainEvent[]): string | null {
  let state = projection.state;
  if (rebaseBase) {
    const rebasedProjection = new GraphProjection();
    for (const baseEvent of rebaseBase) rebasedProjection.apply(baseEvent);
    state = rebasedProjection.state;
  }
  const errors = validateDomainEventAgainstState(event, state);
  return errors[0] ?? null;
}

const productionSyncAdapter = createProductionSyncAdapter();
function initializeSyncEngine(): void {
  syncEngine = new SyncEngine(store, productionSyncAdapter, undefined, validateRemoteEvent,
    event => isCanonicalPublicKnowledgeEvent(event) && !(productionSyncAdapter && isDemoSeedEvent(event)));
  syncEngine.subscribe((status, failures) => {
    document.documentElement.dataset.syncStatus = status;
    const settingsButton = opt<HTMLButtonElement>('btnSettings');
    if (settingsButton) settingsButton.title = status === 'unavailable' ? '同步未配置 · 当前为本地模式' : `同步状态：${status}`;
    if (status === 'unavailable') panel.showToast('未配置远程同步，当前为本地模式');
    if (status === 'conflict' && failures.length) panel.showToast(`同步冲突：${failures.length} 个本地事件需要处理`);
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

window.addEventListener('online', () => {
  void syncEngine?.sync().catch(error => console.warn('[Knowledge-Ball] reconnect sync deferred:', error));
});

window.addEventListener('resize', () => {
  scene.resize();
});

void setupMobileShell();

(window as unknown as { __debug?: unknown }).__debug = {
  store,
  projection,
  get renderNodes() {
    return renderNodes;
  },
  interaction,
  panel,
  scene,
  get syncEngine() { return syncEngine; },
};
