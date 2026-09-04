import {
  KNOWLEDGE_LAYER_HELP,
  isUserKnowledgeLayer,
  type KnowledgeLayer,
  type UserKnowledgeLayer,
} from '../../domain/KnowledgeLayerPolicy';
import {
  type KnowledgeMastery,
  type KnowledgeNodeStatus,
  type KnowledgeNodeType,
} from '../config/KnowledgeUiConfig';

export interface PanelNodeSummary {
  id: string;
  title: string;
  type: KnowledgeNodeType;
  status: KnowledgeNodeStatus;
  mastery: KnowledgeMastery;
  reasoning: string;
  premises: string[];
  declaredLayer?: KnowledgeLayer;
  effectiveLayer?: KnowledgeLayer;
  twinGroup?: string;
  sharedTitle?: string;
  domain?: string;
  logicRuleId?: string;
  aliases?: string[];
  semanticKey?: string;
}

export interface CreateNodePayload {
  title: string;
  layer: UserKnowledgeLayer;
  description: string;
  reasoning?: string;
  premises: string[];
  logicRuleId?: string;
  tags?: string[];
  domain?: string;
  author?: string;
}

export interface LineageCandidatePayload {
  title: string;
  layer: UserKnowledgeLayer;
  description: string;
}

export interface PanelControllerCallbacks {
  getNodes: () => PanelNodeSummary[];
  getNodeById: (id: string) => PanelNodeSummary | null;

  onCreateNode?: (payload: CreateNodePayload) => Promise<void> | void;
  onOptimizeNode: (id: string, payload: LineageCandidatePayload) => Promise<void> | void;
  onOpposeNode: (id: string, payload: LineageCandidatePayload) => Promise<void> | void;
  onResolveNode: (id: string) => Promise<void> | void;
  onDisputeNode: (id: string) => Promise<void> | void;
  onSetMastery: (id: string, mastery: KnowledgeMastery) => Promise<void> | void;
  onSelectRelatedNode?: (id: string) => void;
  onOverlayVisibilityChange?: (visible: boolean) => void;
  onNodePanelChange?: (id: string | null) => void;

  onOpenSettings?: () => void;
  onCloseSettings?: () => void;
}

export interface PanelControllerElements {
  panel: HTMLElement;
  panelTitle: HTMLElement;
  panelBody: HTMLElement;
  panelActions: HTMLElement;
  panelClose: HTMLElement;

  modalOverlay: HTMLElement;
  modalTitle: HTMLElement;
  modalHint: HTMLElement;
  modalClose: HTMLElement;
  modalCancel: HTMLElement;
  modalSubmit: HTMLButtonElement;

  fTitle: HTMLInputElement;
  fType: HTMLSelectElement;
  fDescription: HTMLTextAreaElement;
  fReasoning: HTMLTextAreaElement;
  fReasoningField: HTMLElement;
  fPremises: HTMLElement;
  fPremisesField: HTMLElement;
  fLogicRule: HTMLSelectElement;
  fLogicRuleField: HTMLElement;

  accountOverlay?: HTMLElement;
  accountClose?: HTMLElement;
  statRep?: HTMLElement;
  statLit?: HTMLElement;
  statContrib?: HTMLElement;

  settingsOverlay?: HTMLElement;
  settingsClose?: HTMLElement;
  setNodeRadius?: HTMLInputElement;
  setNodeRadiusVal?: HTMLElement;
  setLabelSize?: HTMLInputElement;
  setLabelSizeVal?: HTMLElement;
  setLabelColor?: HTMLInputElement;
  setLabelFont?: HTMLSelectElement;
  setLabelBrightness?: HTMLInputElement;
  setLabelBrightnessVal?: HTMLElement;

  toast?: HTMLElement;
}

export type PanelNodeAction = 'edit' | 'negate' | 'resolve' | 'dispute';

type LineageCandidateKind = 'optimization' | 'opposition';
type PanelView = 'idle' | 'action';

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function shortText(input: string, max = 20): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}…`;
}

/**
 * Owns action forms, native compatibility create UI, settings/account overlays,
 * and toast feedback. Node detail rendering belongs exclusively to
 * NodeDetailController. Keeping one detail owner prevents stale legacy DOM from
 * resurfacing when an action exits.
 */
export class PanelController {
  private readonly getNodes: () => PanelNodeSummary[];
  private readonly getNodeById: (id: string) => PanelNodeSummary | null;

  private readonly onCreateNode?: (payload: CreateNodePayload) => Promise<void> | void;
  private readonly onOptimizeNode: (id: string, payload: LineageCandidatePayload) => Promise<void> | void;
  private readonly onOpposeNode: (id: string, payload: LineageCandidatePayload) => Promise<void> | void;
  private readonly onResolveNode: (id: string) => Promise<void> | void;
  private readonly onDisputeNode: (id: string) => Promise<void> | void;
  private readonly onSelectRelatedNode?: (id: string) => void;
  private readonly onOverlayVisibilityChange?: (visible: boolean) => void;
  private readonly onNodePanelChange?: (id: string | null) => void;
  private readonly onOpenSettings?: () => void;
  private readonly onCloseSettings?: () => void;

  private readonly panel: HTMLElement;
  private readonly panelTitle: HTMLElement;
  private readonly panelBody: HTMLElement;
  private readonly panelActions: HTMLElement;
  private readonly panelClose: HTMLElement;

  private readonly modalOverlay: HTMLElement;
  private readonly modalTitle: HTMLElement;
  private readonly modalHint: HTMLElement;
  private readonly modalClose: HTMLElement;
  private readonly modalCancel: HTMLElement;
  private readonly modalSubmit: HTMLButtonElement;

  private readonly fTitle: HTMLInputElement;
  private readonly fType: HTMLSelectElement;
  private readonly fDescription: HTMLTextAreaElement;
  private readonly fReasoning: HTMLTextAreaElement;
  private readonly fReasoningField: HTMLElement;
  private readonly fPremises: HTMLElement;
  private readonly fPremisesField: HTMLElement;
  private readonly fLogicRule: HTMLSelectElement;
  private readonly fLogicRuleField: HTMLElement;

  private readonly accountOverlay?: HTMLElement;
  private readonly accountClose?: HTMLElement;
  private readonly statRep?: HTMLElement;
  private readonly statLit?: HTMLElement;
  private readonly statContrib?: HTMLElement;

  private readonly settingsOverlay?: HTMLElement;
  private readonly settingsClose?: HTMLElement;
  private readonly setNodeRadius?: HTMLInputElement;
  private readonly setNodeRadiusVal?: HTMLElement;
  private readonly setLabelSize?: HTMLInputElement;
  private readonly setLabelSizeVal?: HTMLElement;
  private readonly setLabelColor?: HTMLInputElement;
  private readonly setLabelFont?: HTMLSelectElement;
  private readonly setLabelBrightness?: HTMLInputElement;
  private readonly setLabelBrightnessVal?: HTMLElement;

  private readonly toast?: HTMLElement;

  private selectedId: string | null = null;
  private prefillPremise: string | null = null;
  private toastTimer: number | null = null;
  private panelView: PanelView = 'idle';
  private routingDetail = false;

  constructor(options: PanelControllerCallbacks & PanelControllerElements) {
    this.getNodes = options.getNodes;
    this.getNodeById = options.getNodeById;

    this.onCreateNode = options.onCreateNode;
    this.onOptimizeNode = options.onOptimizeNode;
    this.onOpposeNode = options.onOpposeNode;
    this.onResolveNode = options.onResolveNode;
    this.onDisputeNode = options.onDisputeNode;
    this.onSelectRelatedNode = options.onSelectRelatedNode;
    this.onOverlayVisibilityChange = options.onOverlayVisibilityChange;
    this.onNodePanelChange = options.onNodePanelChange;
    this.onOpenSettings = options.onOpenSettings;
    this.onCloseSettings = options.onCloseSettings;

    this.panel = options.panel;
    this.panelTitle = options.panelTitle;
    this.panelBody = options.panelBody;
    this.panelActions = options.panelActions;
    this.panelClose = options.panelClose;

    this.modalOverlay = options.modalOverlay;
    this.modalTitle = options.modalTitle;
    this.modalHint = options.modalHint;
    this.modalClose = options.modalClose;
    this.modalCancel = options.modalCancel;
    this.modalSubmit = options.modalSubmit;

    this.fTitle = options.fTitle;
    this.fType = options.fType;
    this.fDescription = options.fDescription;
    this.fReasoning = options.fReasoning;
    this.fReasoningField = options.fReasoningField;
    this.fPremises = options.fPremises;
    this.fPremisesField = options.fPremisesField;
    this.fLogicRule = options.fLogicRule;
    this.fLogicRuleField = options.fLogicRuleField;

    this.accountOverlay = options.accountOverlay;
    this.accountClose = options.accountClose;
    this.statRep = options.statRep;
    this.statLit = options.statLit;
    this.statContrib = options.statContrib;

    this.settingsOverlay = options.settingsOverlay;
    this.settingsClose = options.settingsClose;
    this.setNodeRadius = options.setNodeRadius;
    this.setNodeRadiusVal = options.setNodeRadiusVal;
    this.setLabelSize = options.setLabelSize;
    this.setLabelSizeVal = options.setLabelSizeVal;
    this.setLabelColor = options.setLabelColor;
    this.setLabelFont = options.setLabelFont;
    this.setLabelBrightness = options.setLabelBrightness;
    this.setLabelBrightnessVal = options.setLabelBrightnessVal;

    this.toast = options.toast;

    this.configureExitControl(this.panelClose, '返回节点详情');
    this.configureExitControl(this.modalClose, '返回上一层');
    this.configureExitControl(this.accountClose, '返回知识球');
    this.configureExitControl(this.settingsClose, '返回知识球');
    this.configureLayerSubmission();
    this.bind();
  }

  private configureLayerSubmission(): void {
    this.fType.innerHTML = `
      <option value="inner">第一层 · 语义与基础事实</option>
      <option value="middle">第二层 · 严谨推理</option>
      <option value="outer">第三层 · 概率与争议</option>
    `;
    const field = this.fType.closest('.form-field');
    const label = field?.querySelector('label');
    if (label) label.textContent = '知识层级';
    let layerHelp = field?.querySelector<HTMLElement>('[data-layer-help]');
    if (!layerHelp && field) {
      layerHelp = document.createElement('div');
      layerHelp.className = 'form-hint';
      layerHelp.dataset.layerHelp = 'true';
      field.appendChild(layerHelp);
    }
    if (layerHelp) {
      layerHelp.innerHTML = `第一层：${KNOWLEDGE_LAYER_HELP.inner}<br><br>第二层：${KNOWLEDGE_LAYER_HELP.middle}<br><br>第三层：${KNOWLEDGE_LAYER_HELP.outer}`;
    }
    const logicLabel = this.fLogicRuleField.querySelector('label');
    if (logicLabel) logicLabel.textContent = '逻辑 / 推理规则（可选）';
    const logicHint = this.fLogicRuleField.querySelector<HTMLElement>('.form-hint');
    if (logicHint) logicHint.textContent = '若该推理使用已有正式规则，可在这里标记；不作为提交门槛。';
  }

  destroy(): void {
    this.panelClose.onclick = null;
    this.modalClose.onclick = null;
    this.modalCancel.onclick = null;
    this.modalSubmit.onclick = null;
    this.accountClose?.removeEventListener('click', this.closeAccountOverlay);
    this.settingsClose?.removeEventListener('click', this.closeSettingsOverlay);
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  }

  /**
   * Compatibility router for callers that still ask PanelController to show a
   * detail. It never renders detail markup; the single authoritative detail
   * surface is NodeDetailController via onSelectRelatedNode/openNode.
   */
  openNodePanel(id: string): void {
    if (!this.getNodeById(id)) return;
    if (this.panelView === 'action' && this.selectedId === id && this.panel.classList.contains('open')) return;
    if (this.routingDetail || !this.onSelectRelatedNode) return;
    this.routingDetail = true;
    try {
      this.onSelectRelatedNode(id);
    } finally {
      this.routingDetail = false;
    }
  }

  closeNodePanel(): void {
    const wasOpen = this.selectedId !== null || this.panel.classList.contains('open');
    this.panel.classList.remove('open');
    this.panelTitle.textContent = '';
    this.panelBody.innerHTML = '';
    this.panelActions.innerHTML = '';
    this.onOverlayVisibilityChange?.(false);
    this.selectedId = null;
    this.panelView = 'idle';
    this.updatePanelExitLabel();
    if (wasOpen) this.onNodePanelChange?.(null);
  }

  openNodeAction(id: string, action: PanelNodeAction): boolean {
    const node = this.getNodeById(id);
    if (!node || !this.supportsNodeAction(node, action)) return false;

    if (action === 'resolve' || action === 'dispute') {
      void this.executeImmediateNodeAction(id, action);
      return true;
    }

    this.enterPanelAction(id);
    this.executeNodeAction(id, action);
    return true;
  }

  openCreateModal(prefillPremiseId: string | null = null): void {
    // Native compatibility surface only. Web production uses the split
    // KnowledgeCreateController flows.
    if (!this.onCreateNode) return;
    this.prefillPremise = prefillPremiseId;
    this.modalTitle.textContent = prefillPremiseId ? '基于现有知识提交新节点' : '提交新知识节点';
    this.modalHint.style.display = 'block';
    if (prefillPremiseId) {
      const src = this.getNodeById(prefillPremiseId);
      this.modalHint.textContent = src ? `已预选「${src.title}」作为推理前提；因此默认进入第二层。` : '已预选一个推理前提；因此默认进入第二层。';
    } else {
      this.modalHint.textContent = '选择统一三层分类：第一层是语义/基础事实，第二层是严谨推理，第三层是概率/不确定/争议知识。';
    }
    this.fTitle.value = '';
    this.fType.value = prefillPremiseId ? 'middle' : 'inner';
    this.fDescription.value = '';
    this.fReasoning.value = '';
    this.modalSubmit.disabled = false;
    this.renderPremiseList();
    this.renderLogicRuleList();
    this.updateCreateMode();
    this.onOverlayVisibilityChange?.(true);
    this.modalOverlay.classList.add('show');
  }

  closeCreateModal(): void {
    this.modalOverlay.classList.remove('show');
    this.onOverlayVisibilityChange?.(this.panel.classList.contains('open'));
  }

  openAccountOverlay(): void {
    if (!this.accountOverlay) return;
    if (this.statRep) this.statRep.textContent = '—';
    if (this.statLit) this.statLit.textContent = String(this.getNodes().filter(n => n.mastery !== 'none').length);
    if (this.statContrib) this.statContrib.textContent = String(this.getNodes().filter(n => n.status === 'pending').length);
    this.accountOverlay.classList.add('show');
  }

  closeAccountOverlay = (): void => {
    this.accountOverlay?.classList.remove('show');
  };

  openSettingsOverlay(): void {
    if (!this.settingsOverlay) return;
    this.settingsOverlay.classList.add('show');
    this.onOpenSettings?.();
  }

  closeSettingsOverlay = (): void => {
    this.settingsOverlay?.classList.remove('show');
    this.onCloseSettings?.();
  };

  showToast(message: string): void {
    if (!this.toast) return;
    this.toast.textContent = message;
    this.toast.classList.add('show');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast?.classList.remove('show');
      this.toastTimer = null;
    }, 4400);
  }

  setSettingsValues(values: {
    nodeRadius?: number;
    labelSize?: number;
    labelBrightness?: number;
    labelColor?: string;
    labelFont?: string;
  }): void {
    if (typeof values.nodeRadius === 'number' && this.setNodeRadius) {
      this.setNodeRadius.value = String(values.nodeRadius);
      if (this.setNodeRadiusVal) this.setNodeRadiusVal.textContent = `${values.nodeRadius.toFixed(1)}mm`;
    }
    if (typeof values.labelSize === 'number' && this.setLabelSize) {
      this.setLabelSize.value = String(values.labelSize);
      if (this.setLabelSizeVal) this.setLabelSizeVal.textContent = `${values.labelSize}px`;
    }
    if (typeof values.labelBrightness === 'number' && this.setLabelBrightness) {
      const pct = Math.round(values.labelBrightness * 100);
      this.setLabelBrightness.value = String(pct);
      if (this.setLabelBrightnessVal) this.setLabelBrightnessVal.textContent = `${pct}%`;
    }
    if (typeof values.labelColor === 'string' && this.setLabelColor) this.setLabelColor.value = values.labelColor;
    if (typeof values.labelFont === 'string' && this.setLabelFont) this.setLabelFont.value = values.labelFont;
  }

  private configureExitControl(control: HTMLElement | undefined, label: string): void {
    if (!control) return;
    if (control instanceof HTMLButtonElement) control.type = 'button';
    control.setAttribute('aria-label', label);
    control.setAttribute('title', label);
  }

  private updatePanelExitLabel(): void {
    this.configureExitControl(this.panelClose, this.panelView === 'action' ? '返回节点详情' : '返回知识球');
  }

  private enterPanelAction(id: string): void {
    this.selectedId = id;
    this.panelView = 'action';
    this.updatePanelExitLabel();
    this.onOverlayVisibilityChange?.(true);
    this.panel.classList.add('open');
    this.onNodePanelChange?.(id);
  }

  private returnToNodeDetail(id: string | null = this.selectedId): void {
    const targetId = id;
    this.closeNodePanel();
    if (targetId) this.onSelectRelatedNode?.(targetId);
  }

  private handlePanelExit(): void {
    if (this.panelView === 'action') {
      this.returnToNodeDetail();
      return;
    }
    this.closeNodePanel();
  }

  private bind(): void {
    this.panelClose.addEventListener('click', () => this.handlePanelExit());
    this.modalClose.addEventListener('click', () => this.closeCreateModal());
    this.modalCancel.addEventListener('click', () => this.closeCreateModal());

    this.modalOverlay.addEventListener('click', e => {
      if (e.target === this.modalOverlay) this.closeCreateModal();
    });

    if (this.accountClose) this.accountClose.addEventListener('click', this.closeAccountOverlay);
    if (this.accountOverlay) {
      this.accountOverlay.addEventListener('click', e => {
        if (e.target === this.accountOverlay) this.closeAccountOverlay();
      });
    }

    if (this.settingsClose) this.settingsClose.addEventListener('click', this.closeSettingsOverlay);
    if (this.settingsOverlay) {
      this.settingsOverlay.addEventListener('click', e => {
        if (e.target === this.settingsOverlay) this.closeSettingsOverlay();
      });
    }

    this.fType.addEventListener('change', () => this.updateCreateMode());

    this.modalSubmit.addEventListener('click', async () => {
      const title = this.fTitle.value.trim();
      const description = this.fDescription.value.trim();
      const reasoning = this.fReasoning.value.trim();
      const layerValue = this.fType.value;
      if (!isUserKnowledgeLayer(layerValue)) {
        this.showToast('请选择三个知识层级之一。');
        return;
      }
      const layer = layerValue;
      const premises = Array.from(this.fPremises.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
        .map(el => el.value);
      const logicRuleId = this.fLogicRule.value;

      if (!title) {
        this.showToast('请填写节点标题。');
        return;
      }
      if (!description) {
        this.showToast('请填写知识描述。');
        return;
      }
      if (layer === 'inner' && premises.length > 0) {
        this.showToast('第一层是非推导性的语义 / 基础事实层，不能带推理前提。请改选第二层。');
        return;
      }
      if (premises.length > 0 && !reasoning) {
        this.showToast('选择前提后必须填写它们如何推出当前知识。');
        return;
      }

      if (!this.onCreateNode) return;
      this.modalSubmit.disabled = true;
      try {
        await this.onCreateNode({
          title,
          layer,
          description,
          reasoning: reasoning || undefined,
          premises: layer === 'inner' ? [] : premises,
          logicRuleId: logicRuleId || undefined,
        });
        this.closeCreateModal();
        this.showToast(`节点已提交：${title}`);
      } catch (error) {
        console.error('[Knowledge-Ball] node submission failed:', error);
        this.showToast(error instanceof Error ? `提交失败：${error.message}` : '提交失败');
        this.modalSubmit.disabled = false;
      }
    });

    this.bindPremiseChecks();
    this.bindSettingsControls();
  }

  private supportsNodeAction(node: PanelNodeSummary, action: PanelNodeAction): boolean {
    switch (action) {
      case 'edit': return true;
      case 'negate': return node.status !== 'falsified' && node.status !== 'suspended';
      case 'resolve': return node.status === 'suspended';
      case 'dispute': return node.status === 'disputed';
    }
  }

  private executeNodeAction(id: string, action: Extract<PanelNodeAction, 'edit' | 'negate'>): void {
    if (action === 'edit') this.openLineageCandidateForm(id, 'optimization');
    else this.openLineageCandidateForm(id, 'opposition');
  }

  private async executeImmediateNodeAction(id: string, action: Extract<PanelNodeAction, 'resolve' | 'dispute'>): Promise<void> {
    try {
      if (action === 'resolve') {
        await this.onResolveNode(id);
        this.showToast('节点已重新验证通过');
      } else {
        await this.onDisputeNode(id);
        this.showToast('节点已标记为争议中');
      }
      this.onSelectRelatedNode?.(id);
    } catch (error) {
      this.showOperationError(error);
      this.onSelectRelatedNode?.(id);
    }
  }

  private openLineageCandidateForm(id: string, kind: LineageCandidateKind): void {
    const node = this.getNodeById(id);
    if (!node) return;
    const optimization = kind === 'optimization';
    const reasoningOptimization = optimization && node.type === 'reasoning';
    const candidateLayer = node.declaredLayer ?? node.effectiveLayer ?? 'outer';
    const defaultLayer = isUserKnowledgeLayer(candidateLayer) ? candidateLayer : 'outer';

    this.panelTitle.textContent = optimization
      ? `编辑节点 · 优化：${node.title}`
      : `编辑节点 · 对立观点：${node.title}`;
    this.panelBody.innerHTML = `
      <div class="difference-card"><b>${optimization ? 'IMMUTABLE OPTIMIZATION' : 'IMMUTABLE OPPOSITION'}</b><br>${optimization
        ? '提交会生成新的灰色闪烁候选球；最终判定前当前球保持不变。'
        : '提交会生成新的红色闪烁候选球；最终判定前当前球不会被证伪、隐藏或换边。'}</div>
      <div class="field"><label>名称</label><input type="text" id="lineageCandidateTitle" value="${optimization ? escapeHtml(node.title) : ''}" placeholder="${optimization ? '可保留当前名称，也可改为新的唯一名称' : '请输入新的唯一名称'}"></div>
      ${reasoningOptimization ? '' : `<div class="field"><label>知识层级</label><select id="lineageCandidateLayer">
        <option value="inner" ${defaultLayer === 'inner' ? 'selected' : ''}>第一层 · 语义与基础事实</option>
        <option value="middle" ${defaultLayer === 'middle' ? 'selected' : ''}>第二层 · 严谨推理</option>
        <option value="outer" ${defaultLayer === 'outer' ? 'selected' : ''}>第三层 · 概率与争议</option>
      </select></div>`}
      <div class="field"><label>${reasoningOptimization ? '推理过程' : '内容'}</label><textarea id="lineageCandidateDescription" placeholder="${reasoningOptimization ? '填写优化后的推理过程' : '填写新的完整内容'}">${optimization ? escapeHtml(node.reasoning || '') : ''}</textarea></div>
      <p class="note-small" style="text-align:left;">${reasoningOptimization
        ? '推理节点优化只允许修改名称和推理过程。前提、结论、节点类型、逻辑规则和知识层级全部继承当前推理节点。'
        : '节点类型、前提关系和逻辑规则身份全部沿用当前球。这里仅允许修改名称、层级和内容。'}</p>
    `;
    this.panelActions.innerHTML = `
      <button class="btn ${optimization ? 'primary' : 'danger'}" id="submitLineageCandidate">${optimization ? '提交优化候选' : '提交对立候选'}</button>
      <button class="btn ghost" id="cancelLineageCandidate">取消</button>
    `;

    this.panelActions.querySelector<HTMLButtonElement>('#cancelLineageCandidate')?.addEventListener('click', () => this.returnToNodeDetail(id));
    this.panelActions.querySelector<HTMLButtonElement>('#submitLineageCandidate')?.addEventListener('click', async () => {
      const title = this.panelBody.querySelector<HTMLInputElement>('#lineageCandidateTitle')?.value.trim() ?? '';
      const layerValue = reasoningOptimization
        ? defaultLayer
        : this.panelBody.querySelector<HTMLSelectElement>('#lineageCandidateLayer')?.value ?? '';
      const description = this.panelBody.querySelector<HTMLTextAreaElement>('#lineageCandidateDescription')?.value.trim() ?? '';
      if (!title || !description || !isUserKnowledgeLayer(layerValue)) {
        this.showToast(reasoningOptimization ? '请完整填写名称和推理过程。' : '请完整填写名称、知识层级和内容。');
        return;
      }
      const payload: LineageCandidatePayload = { title, layer: layerValue, description };
      try {
        if (optimization) await this.onOptimizeNode(id, payload);
        else await this.onOpposeNode(id, payload);
        this.showToast(optimization ? '优化候选已提交，等待验证' : '对立候选已提交，等待验证');
        this.closeNodePanel();
      } catch (error) {
        this.showOperationError(error);
      }
    });
  }

  private updateCreateMode(): void {
    const layer = isUserKnowledgeLayer(this.fType.value) ? this.fType.value : 'inner';
    const allowsPremises = layer !== 'inner';
    this.fReasoningField.hidden = !allowsPremises;
    this.fPremisesField.hidden = !allowsPremises;
    this.fLogicRuleField.hidden = !allowsPremises;
    if (!allowsPremises) {
      this.fPremises.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked').forEach(input => {
        input.checked = false;
      });
    }
  }

  private renderLogicRuleList(): void {
    const rules = this.getNodes().filter(node => node.type === 'logic-symbol' && node.status !== 'falsified');
    this.fLogicRule.innerHTML = [
      '<option value="">不指定正式规则</option>',
      ...rules.map(rule => `<option value="${escapeHtml(rule.id)}">${escapeHtml(rule.title)}</option>`),
    ].join('');
  }

  private showOperationError(error: unknown): void {
    console.error('[Knowledge-Ball] knowledge edit failed:', error);
    this.showToast(error instanceof Error ? `操作失败：${error.message}` : '操作失败');
  }

  private renderPremiseList(): void {
    const nodes = this.getNodes().filter(node => node.type !== 'reasoning' && node.type !== 'logic-symbol' && node.status !== 'falsified');
    this.fPremises.innerHTML = nodes.map(n => {
      const checked = this.prefillPremise === n.id ? 'checked' : '';
      return `
        <label class="premise-item">
          <input type="checkbox" value="${escapeHtml(n.id)}" ${checked}>
          ${escapeHtml(shortText(n.title, 32))}
        </label>
      `;
    }).join('');
  }

  private bindPremiseChecks(): void {
    this.fPremises.addEventListener('change', () => {
      if (this.fType.value === 'inner' && this.fPremises.querySelector('input:checked')) {
        this.fType.value = 'middle';
        this.updateCreateMode();
        this.showToast('选择推理前提后已切换到第二层；第一层只表达非推导性的语义 / 基础事实。');
      }
    });
  }

  private bindSettingsControls(): void {
    if (this.setNodeRadius) {
      this.setNodeRadius.addEventListener('input', () => {
        const v = Number.parseFloat(this.setNodeRadius!.value);
        if (Number.isFinite(v) && this.setNodeRadiusVal) this.setNodeRadiusVal.textContent = `${v.toFixed(1)}mm`;
      });
    }

    if (this.setLabelSize) {
      this.setLabelSize.addEventListener('input', () => {
        const v = Number.parseFloat(this.setLabelSize!.value);
        if (Number.isFinite(v) && this.setLabelSizeVal) this.setLabelSizeVal.textContent = `${v}px`;
      });
    }

    if (this.setLabelBrightness) {
      this.setLabelBrightness.addEventListener('input', () => {
        const v = Number.parseFloat(this.setLabelBrightness!.value);
        if (Number.isFinite(v) && this.setLabelBrightnessVal) this.setLabelBrightnessVal.textContent = `${v}%`;
      });
    }

    if (this.onOpenSettings && this.settingsOverlay) {
      this.settingsOverlay.addEventListener('transitionend', () => {
        // reserved for future settings synchronization
      });
    }
  }
}
