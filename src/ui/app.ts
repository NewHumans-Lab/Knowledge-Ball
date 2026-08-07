import { EventStore } from '../event/EventStore';
import { GraphProjection, setCascadeDepthLimit } from '../projection/GraphProjection';
import { nodeList } from '../state/GraphState';

import { createNode as cmdCreateNode } from '../command/CreateNode';
import { editNode as cmdEditNode } from '../command/EditNode';
import { falsifyNode as cmdFalsifyNode } from '../command/FalsifyNode';
import { resolveNode as cmdResolveNode } from '../command/ResolveNode';
import { setMastery as cmdSetMastery } from '../command/SetMastery';
import { disputeNode as cmdDisputeNode } from '../command/DisputeNode';
import { suspendNode as cmdSuspendNode } from '../command/SuspendNode';

import {
  TWIN_META,
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
  type EditNodePayload,
  type PanelNodeSummary,
} from './panels/PanelController';

const projection = new GraphProjection();
const store = new EventStore(() => structuredClone(projection.state));

let renderNodes: KnowledgeSceneNode[] = [];
let scene: KnowledgeSceneRuntime;
let panel: PanelController;
let interaction: InteractionController;
let currentPanelId: string | null = null;

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
  return `n${Math.random().toString(36).slice(2, 9)}`;
}

function syncNodesFromProjection(): void {
  const domainNodes = nodeList(projection.state);

  const prevById: Record<string, KnowledgeSceneNode> = {};
  renderNodes.forEach(n => {
    prevById[n.id] = n;
  });

  renderNodes = domainNodes.map(dn => {
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
  const nodeId = generateNodeId();
  await cmdCreateNode(store, {
    nodeId,
    title: payload.title,
    nodeType: payload.type,
    reasoning: payload.reasoning,
    premises: payload.premises,
  });
  currentPanelId = nodeId;
  panel.openNodePanel(nodeId);
  scene.markDirty();
}

async function editKnowledgeNode(id: string, payload: EditNodePayload): Promise<void> {
  await cmdEditNode(store, {
    nodeId: id,
    title: payload.title,
    nodeType: payload.type,
    reasoning: payload.reasoning,
  });
}

async function falsifyKnowledgeNode(id: string): Promise<void> {
  await cmdFalsifyNode(store, projection, { nodeId: id });
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

async function seedNode(
  nodeId: string,
  title: string,
  nodeType: KnowledgeNodeType,
  reasoning: string,
  premises: string[] = []
): Promise<void> {
  await cmdCreateNode(store, {
    nodeId,
    title,
    nodeType,
    reasoning,
    premises,
  });
}

async function seedDemoData(): Promise<void> {
  if (nodeList(projection.state).length > 0) return;

  await seedNode('n1', '同一律', 'axiom', '逻辑基础公理，长期稳定、无法继续向下证明，经准入规则纳入公理层。');
  await cmdSetMastery(store, { nodeId: 'n1', mastery: 'mastered' });
  await cmdResolveNode(store, { nodeId: 'n1' });

  await seedNode('n2', '排中律', 'axiom', '逻辑基础公理，与同一律、矛盾律共同构成经典逻辑地基。');
  await cmdSetMastery(store, { nodeId: 'n2', mastery: 'touched' });
  await cmdResolveNode(store, { nodeId: 'n2' });

  await seedNode('n16', '矛盾律', 'axiom', '同一命题不能同时为真又为假，经典逻辑的第三基础公理。');
  await cmdSetMastery(store, { nodeId: 'n16', mastery: 'mastered' });
  await cmdResolveNode(store, { nodeId: 'n16' });

  await seedNode('n3', '质数的定义', 'definition', '仅能被 1 和自身整除的大于 1 的自然数。基于同一律确立的稳定定义，长期无异议。', ['n1']);
  await cmdSetMastery(store, { nodeId: 'n3', mastery: 'mastered' });
  await cmdResolveNode(store, { nodeId: 'n3' });

  await seedNode('n4', '水的沸点', 'fact', '标准大气压下纯水沸点为 100°C，实验反复验证的经验事实。');
  await cmdSetMastery(store, { nodeId: 'n4', mastery: 'touched' });
  await cmdResolveNode(store, { nodeId: 'n4' });

  await seedNode('n5', '勾股定理', 'theorem', '直角三角形两直角边平方和等于斜边平方。欧几里得《几何原本》给出的经典演绎证明，基于同一律与排中律。', ['n1', 'n2']);
  await cmdSetMastery(store, { nodeId: 'n5', mastery: 'mastered' });
  await cmdResolveNode(store, { nodeId: 'n5' });

  await seedNode('n6', '反证法证明', 'theorem', '假设质数有限，构造新数导出矛盾，证明质数数量无穷。', ['n3']);
  await cmdSetMastery(store, { nodeId: 'n6', mastery: 'mastered' });
  await cmdResolveNode(store, { nodeId: 'n6' });

  await seedNode('n15', '欧拉乘积证法', 'theorem', '通过欧拉乘积公式 ∏(1-p⁻¹)⁻¹ 的发散性证明质数无穷，与反证法殊途同归，是同一结论的独立证明路径。', ['n3']);
  await cmdSetMastery(store, { nodeId: 'n15', mastery: 'touched' });
  await cmdResolveNode(store, { nodeId: 'n15' });

  await seedNode('n7', '黎曼猜想', 'hypothesis', '非平凡零点实部均为 1/2。尚无完整证明或证伪，悬置状态本身是准确的表达，而非系统缺陷。', ['n3']);
  await cmdSetMastery(store, { nodeId: 'n7', mastery: 'touched' });
  await cmdSuspendNode(store, { nodeId: 'n7' });

  await seedNode('n8', 'AGI 时间预测', 'prediction', '预测 2035 年可实现通用人工智能。不存在可验证的逻辑链条，悬置等待未来事件校验，校验结果计入提交者声誉。');
  await cmdSuspendNode(store, { nodeId: 'n8' });

  await seedNode('n9', '自由市场效率观点', 'opinion', '自由市场比计划经济更有效率。规范性/经验混合命题，无法逻辑裁定，采用加权投票+悬置并展示正反证据。');
  await cmdSetMastery(store, { nodeId: 'n9', mastery: 'touched' });
  await cmdDisputeNode(store, { nodeId: 'n9' });

  await seedNode('n10', '个体自由优先', 'value', '个体自由优先于集体效率。纯价值判断，协议不裁定对错，仅呈现论据双方。');
  await cmdDisputeNode(store, { nodeId: 'n10' });

  await seedNode('n11', 'LK-99 超导声称', 'fact', '论文声称 LK-99 材料在常压常温下具有超导性。2023 年论文声称发现常温常压超导现象，后经多个独立实验室复现失败、机制被重新解释，节点被标记为已证伪。');
  await cmdSetMastery(store, { nodeId: 'n11', mastery: 'touched' });

  await seedNode('n12', '无损耗输电推论', 'theorem', '若 LK-99 超导属实，可实现无损耗输电网络。完全依赖 n11 成立，前提证伪后本节点自动进入悬置。', ['n11']);
  await seedNode('n13', '数据中心节能推论', 'prediction', 'LK-99 应用可大幅降低数据中心能耗。依赖 n12 的工程可行性，属于二级下游推论。', ['n12']);
  await seedNode('n14', '电网投资推论', 'opinion', 'LK-99 产业化将重塑全球电网基建投资方向。依赖 n12，属于二级下游的产业判断。', ['n12']);

  await cmdFalsifyNode(store, projection, { nodeId: 'n11' });
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
    onSelectNode: openNode,
    onOpenPanel: openNode,
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
  onFalsifyNode: falsifyKnowledgeNode,
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
  fType: must<HTMLSelectElement>('fType'),
  fReasoning: must<HTMLTextAreaElement>('fReasoning'),
  fPremises: must<HTMLElement>('fPremises'),
  fLogicConfirm: must<HTMLInputElement>('fLogicConfirm'),

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

  if (currentPanelId) {
    panel.openNodePanel(currentPanelId);
  }
});

syncNodesFromProjection();

panel.setSettingsValues({
  nodeRadius: 9,
  labelSize: 11,
  labelBrightness: 1,
  labelColor: '#B8BFD4',
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

void seedDemoData()
  .then(() => {
    syncNodesFromProjection();
    scene.markDirty();
    scene.start();
  })
  .catch(err => {
    console.error('[Knowledge-Ball] seed failed:', err);
    scene.start();
  });

window.addEventListener('resize', () => {
  scene.resize();
});

(window as unknown as { __debug?: unknown }).__debug = {
  store,
  projection,
  get renderNodes() {
    return renderNodes;
  },
  interaction,
  panel,
  scene,
};