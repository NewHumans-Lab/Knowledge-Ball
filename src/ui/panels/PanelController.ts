import {
  KNOWLEDGE_LAYER_HELP,
  KNOWLEDGE_LAYER_LABEL,
  isUserKnowledgeLayer,
  type KnowledgeLayer,
  type UserKnowledgeLayer,
} from '../../domain/KnowledgeLayerPolicy';
import {
  MASTERY_LABEL,
  STATUS_COLOR_HEX,
  STATUS_LABEL,
  TYPE_COLOR_HEX,
  TYPE_LABEL,
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

export interface DecomposeNodePayload {
  conclusionId: string;
  reasoningSteps: Array<{ title: string; reasoning: string; logicRuleId: string }>;
  intermediateConclusions: Array<{ title: string; type: KnowledgeNodeType; description: string }>;
}

export interface MergeDefinitionPayload {
  sourceNodeIds: string[];
  semanticKey: string;
  mergedDefinition: { title: string; description: string };
}

export interface MergeTheoryPayload {
  sourceConclusionIds: string[];
  reasoningSemanticKey: string;
  semanticKey: string;
  mergedReasoning: { title: string; reasoning: string; logicRuleId: string };
  mergedConclusion: { title: string; type: KnowledgeNodeType; description: string };
}

export interface PanelControllerCallbacks {
  getNodes: () => PanelNodeSummary[];
  getNodeById: (id: string) => PanelNodeSummary | null;

  onCreateNode: (payload: CreateNodePayload) => Promise<void> | void;
  onOptimizeNode: (id: string, payload: LineageCandidatePayload) => Promise<void> | void;
  onOpposeNode: (id: string, payload: LineageCandidatePayload) => Promise<void> | void;
  onDecomposeNode: (id: string, payload: DecomposeNodePayload) => Promise<void> | void;
  onMergeDefinitions: (payload: MergeDefinitionPayload) => Promise<void> | void;
  onMergeTheories: (payload: MergeTheoryPayload) => Promise<void> | void;
  onResolveNode: (id: string) => Promise<void> | void;
  onDisputeNode: (id: string) => Promise<void> | void;
  onSetMastery: (id: string, mastery: KnowledgeMastery) => Promise<void> | void;
  onSelectRelatedNode?: (id: string) => void;
  onOverlayVisibilityChange?: (visible: boolean) => void;

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
  depthLimit?: HTMLInputElement;

  toast?: HTMLElement;
}

type LineageCandidateKind = 'optimization' | 'opposition';

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

function safeText(input: string | undefined | null): string {
  return (input ?? '').trim();
}

export class PanelController {
  private readonly getNodes: () => PanelNodeSummary[];
  private readonly getNodeById: (id: string) => PanelNodeSummary | null;

  private readonly onCreateNode: (payload: CreateNodePayload) => Promise<void> | void;
  private readonly onOptimizeNode: (id: string, payload: LineageCandidatePayload) => Promise<void> | void;
  private readonly onOpposeNode: (id: string, payload: LineageCandidatePayload) => Promise<void> | void;
  private readonly onDecomposeNode: (id: string, payload: DecomposeNodePayload) => Promise<void> | void;
  private readonly onMergeDefinitions: (payload: MergeDefinitionPayload) => Promise<void> | void;
  private readonly onMergeTheories: (payload: MergeTheoryPayload) => Promise<void> | void;
  private readonly onResolveNode: (id: string) => Promise<void> | void;
  private readonly onDisputeNode: (id: string) => Promise<void> | void;
  private readonly onSetMastery: (id: string, mastery: KnowledgeMastery) => Promise<void> | void;
  private readonly onSelectRelatedNode?: (id: string) => void;
  private readonly onOverlayVisibilityChange?: (visible: boolean) => void;
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
  private readonly depthLimit?: HTMLInputElement;

  private readonly toast?: HTMLElement;

  private selectedId: string | null = null;
  private prefillPremise: string | null = null;
  private toastTimer: number | null = null;

  constructor(options: PanelControllerCallbacks & PanelControllerElements) {
    this.getNodes = options.getNodes;
    this.getNodeById = options.getNodeById;

    this.onCreateNode = options.onCreateNode;
    this.onOptimizeNode = options.onOptimizeNode;
    this.onOpposeNode = options.onOpposeNode;
    this.onDecomposeNode = options.onDecomposeNode;
    this.onMergeDefinitions = options.onMergeDefinitions;
    this.onMergeTheories = options.onMergeTheories;
    this.onResolveNode = options.onResolveNode;
    this.onDisputeNode = options.onDisputeNode;
    this.onSetMastery = options.onSetMastery;
    this.onSelectRelatedNode = options.onSelectRelatedNode;
    this.onOverlayVisibilityChange = options.onOverlayVisibilityChange;
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
    this.depthLimit = options.depthLimit;

    this.toast = options.toast;

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

  openNodePanel(id: string): void {
    performance.mark?.('knowledge-panel-open-start');
    const nodes = this.getNodes();
    const byId = new Map(nodes.map(node => [node.id, node]));
    const node = byId.get(id);
    if (!node) return;

    this.selectedId = id;
    this.onOverlayVisibilityChange?.(true);
    this.panel.classList.add('open');
    this.panelTitle.textContent = node.title;

    const typeColor = TYPE_COLOR_HEX[node.type] ?? '#ffffff';
    const statusColor = STATUS_COLOR_HEX[node.status] ?? '#ffffff';
    const effectiveLayerLabel = node.effectiveLayer ? KNOWLEDGE_LAYER_LABEL[node.effectiveLayer] : '层级未计算';
    const declaredLayerLabel = node.declaredLayer ? KNOWLEDGE_LAYER_LABEL[node.declaredLayer] : '历史兼容';
    const layerAdjusted = Boolean(node.declaredLayer && node.effectiveLayer && node.declaredLayer !== node.effectiveLayer);

    const premisesHtml = node.premises.map(pid => {
      const p = byId.get(pid);
      if (!p) return '';
      return `<div class="chip" data-jump="${escapeHtml(pid)}">${escapeHtml(shortText(p.title, 20))}</div>`;
    }).join('') || '<div class="chip empty">无已记录前置知识</div>';

    const depsHtml = nodes
      .filter(n => n.premises.includes(id) || n.logicRuleId === id)
      .map(n => `<div class="chip" data-jump="${escapeHtml(n.id)}">${escapeHtml(shortText(n.title, 20))}</div>`)
      .join('') || '<div class="chip empty">暂无下游依赖节点</div>';

    const twinNodes = node.twinGroup
      ? nodes.filter(n => n.twinGroup === node.twinGroup && n.id !== node.id)
      : [];

    const twinHtml = twinNodes.length
      ? `
        <div class="field">
          <label>孪生证明</label>
          <div class="chip-list">
            ${twinNodes.map(t => `<div class="chip" data-jump="${escapeHtml(t.id)}">${escapeHtml(shortText(t.title, 18))}</div>`).join('')}
          </div>
        </div>
      `
      : '';

    const logicRule = node.logicRuleId ? byId.get(node.logicRuleId) ?? null : null;
    const logicRuleHtml = node.type === 'reasoning'
      ? `
        <div class="field">
          <label>逻辑符号 / 推理分类</label>
          <div class="chip-list">
            ${logicRule
              ? `<div class="chip" data-jump="${escapeHtml(logicRule.id)}">${escapeHtml(logicRule.title)}</div>`
              : '<div class="chip empty">未指定正式规则</div>'}
          </div>
        </div>
      `
      : '';

    const layerAdjustmentHtml = layerAdjusted
      ? `<div class="difference-card"><b>当前显示层级调整</b><br>提交时：${escapeHtml(declaredLayerLabel)}<br>当前：${escapeHtml(effectiveLayerLabel)}<br>${node.status === 'disputed' && node.effectiveLayer === 'outer' ? '原因：该知识当前处于争议状态，因此显示在第三层；原始声明分类仍被保留。' : '当前状态触发了显示层级规则；原始声明分类不会被静默改写。'}</div>`
      : '';

    this.panelBody.innerHTML = `
      <div class="badge-row">
        <div class="badge">${escapeHtml(effectiveLayerLabel)}</div>
        <div class="badge" style="color:${statusColor};border-color:${statusColor}66;">${STATUS_LABEL[node.status]}</div>
        <div class="badge" style="color:${typeColor};border-color:${typeColor}66;">${TYPE_LABEL[node.type]} · 内部细分类</div>
      </div>

      ${layerAdjustmentHtml}

      <div class="field">
        <label>掌握程度</label>
        <div class="mastery-display" id="masteryDisplay">${MASTERY_LABEL[node.mastery]}</div>
        <div class="mastery-private">PRIVATE STATE · 仅你可见，不影响公共知识有效性</div>
        <div class="mastery-demo-controls">
          <div class="chip ${node.mastery === 'none' ? 'active' : ''}" data-mastery="none">未接触</div>
          <div class="chip ${node.mastery === 'touched' ? 'active' : ''}" data-mastery="touched">接触过</div>
          <div class="chip ${node.mastery === 'mastered' ? 'active' : ''}" data-mastery="mastered">完全掌握</div>
        </div>
      </div>

      <div class="field-reasoning-band" aria-label="当前推理链">
        <div class="reasoning-stage">PREMISES<b>${node.premises.length || '—'}</b></div><span class="reasoning-arrow">→</span>
        <div class="reasoning-stage">REASONING<b>${node.type === 'reasoning' ? '当前节点' : (logicRule ? '已连接' : '—')}</b></div><span class="reasoning-arrow">→</span>
        <div class="reasoning-stage">CONCLUSION<b>${node.type === 'reasoning' ? depsHtml === '' ? '—' : '下游' : '当前节点'}</b></div>
      </div>

      <div class="field">
        <label>${node.type === 'reasoning' ? '推理过程' : '知识描述'}</label>
        <div class="val">${escapeHtml(node.reasoning || '（未填写）')}</div>
      </div>

      ${logicRuleHtml}

      <div class="field">
        <label>前置知识点</label>
        <div class="chip-list">${premisesHtml}</div>
      </div>

      <div class="field">
        <label>下游依赖节点</label>
        <div class="chip-list">${depsHtml}</div>
      </div>

      ${twinHtml}
    `;

    this.panelActions.innerHTML = `
      <div class="action-grid">
        <button class="btn ghost" id="btnEditNode">Optimize · 优化</button>
        <button class="btn ghost" id="btnDeriveNode">Add · 新增</button>
      </div>
      <div class="action-grid">
        ${node.type === 'reasoning' ? '<button class="btn ghost" id="btnDecompose">Decompose · 分解</button>' : ''}
        ${this.canMerge(node, nodes, byId) ? '<button class="btn ghost" id="btnMerge">Merge · 合并</button>' : ''}
      </div>
      ${node.status !== 'falsified' && node.status !== 'suspended' ? `<button class="btn danger" id="btnNegate">Oppose · 提出对立观点</button>` : ''}
      ${node.status === 'suspended' ? `<button class="btn confirm" id="btnResolve">✓ 标记重新验证通过</button>` : ''}
      ${node.status === 'disputed' ? `<button class="btn confirm" id="btnDispute">✓ 标记争议中</button>` : ''}
      <div class="note-small">公共知识由服务器确认后进入共享事件流；浏览器只渲染当前内存投影。</div>
    `;

    this.bindPanelRuntimeEvents(id);
    performance.mark?.('knowledge-panel-open-end');
    performance.measure?.('knowledge-panel-open', 'knowledge-panel-open-start', 'knowledge-panel-open-end');
    if (performance.getEntriesByName?.('knowledge-node-tap-start').length) {
      performance.measure?.('knowledge-tap-to-panel', 'knowledge-node-tap-start', 'knowledge-panel-open-end');
    }
  }

  closeNodePanel(): void {
    this.panel.classList.remove('open');
    this.onOverlayVisibilityChange?.(false);
    this.selectedId = null;
  }

  openCreateModal(prefillPremiseId: string | null = null): void {
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
    if (this.onOpenSettings) this.onOpenSettings();
  }

  closeSettingsOverlay = (): void => {
    this.settingsOverlay?.classList.remove('show');
    if (this.onCloseSettings) this.onCloseSettings();
  };

  showToast(message: string): void {
    if (!this.toast) return;
    this.toast.textContent = message;
    this.toast.classList.add('show');
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
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
    depthLimit?: number | null;
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
    if (typeof values.labelColor === 'string' && this.setLabelColor) {
      this.setLabelColor.value = values.labelColor;
    }
    if (typeof values.labelFont === 'string' && this.setLabelFont) {
      this.setLabelFont.value = values.labelFont;
    }
    if (values.depthLimit !== undefined && this.depthLimit) {
      this.depthLimit.value = values.depthLimit === null ? '' : String(values.depthLimit);
    }
  }

  private bind(): void {
    this.panelClose.addEventListener('click', () => this.closeNodePanel());
    this.modalClose.addEventListener('click', () => this.closeCreateModal());
    this.modalCancel.addEventListener('click', () => this.closeCreateModal());

    this.modalOverlay.addEventListener('click', e => {
      if (e.target === this.modalOverlay) this.closeCreateModal();
    });

    if (this.accountClose) {
      this.accountClose.addEventListener('click', this.closeAccountOverlay);
    }
    if (this.accountOverlay) {
      this.accountOverlay.addEventListener('click', e => {
        if (e.target === this.accountOverlay) this.closeAccountOverlay();
      });
    }

    if (this.settingsClose) {
      this.settingsClose.addEventListener('click', this.closeSettingsOverlay);
    }
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

  private bindPanelRuntimeEvents(id: string): void {
    const optimizeBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnEditNode');
    const deriveBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnDeriveNode');
    const opposeBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnNegate');
    const decomposeBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnDecompose');
    const mergeBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnMerge');
    const resolveBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnResolve');
    const disputeBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnDispute');

    optimizeBtn?.addEventListener('click', () => this.openLineageCandidateForm(id, 'optimization'));
    deriveBtn?.addEventListener('click', () => this.openCreateModal(id));
    opposeBtn?.addEventListener('click', () => this.openLineageCandidateForm(id, 'opposition'));
    decomposeBtn?.addEventListener('click', () => this.openDecomposeForm(id));
    mergeBtn?.addEventListener('click', () => this.openMergeForm(id));
    resolveBtn?.addEventListener('click', async () => {
      await this.onResolveNode(id);
      this.showToast('节点已重新验证通过');
    });
    disputeBtn?.addEventListener('click', async () => {
      await this.onDisputeNode(id);
      this.showToast('节点已标记为争议中');
    });

    this.panelBody.querySelectorAll<HTMLElement>('[data-jump]').forEach(el => {
      el.addEventListener('click', () => {
        const jumpId = el.dataset.jump;
        if (!jumpId) return;
        this.onSelectRelatedNode?.(jumpId);
      });
    });

    this.panelBody.querySelectorAll<HTMLElement>('[data-mastery]').forEach(el => {
      el.addEventListener('click', async () => {
        const mastery = el.dataset.mastery as KnowledgeMastery | undefined;
        if (!mastery) return;
        await this.onSetMastery(id, mastery);
        const node = this.getNodeById(id);
        if (node) this.openNodePanel(id);
      });
    });
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

    this.panelActions.querySelector<HTMLButtonElement>('#cancelLineageCandidate')?.addEventListener('click', () => this.openNodePanel(id));
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

  private isDerivedType(type: KnowledgeNodeType): boolean {
    return !['axiom', 'definition', 'fact', 'logic-symbol', 'reasoning'].includes(type);
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

  private logicRuleOptions(selectedId?: string): string {
    const rules = this.getNodes().filter(node => node.type === 'logic-symbol' && node.status !== 'falsified');
    return [
      '<option value="">请选择逻辑符号</option>',
      ...rules.map(rule => `<option value="${escapeHtml(rule.id)}" ${rule.id === selectedId ? 'selected' : ''}>${escapeHtml(rule.title)}</option>`),
    ].join('');
  }

  private reasoningParent(node: PanelNodeSummary, byId?: ReadonlyMap<string, PanelNodeSummary>): PanelNodeSummary | null {
    const parents = node.premises
      .map(id => byId?.get(id) ?? this.getNodeById(id))
      .filter((candidate): candidate is PanelNodeSummary => candidate?.type === 'reasoning');
    return parents.length === 1 ? parents[0] : null;
  }

  private samePremises(left: PanelNodeSummary, right: PanelNodeSummary): boolean {
    return [...new Set(left.premises)].sort().join('\0') === [...new Set(right.premises)].sort().join('\0');
  }

  private canMerge(node: PanelNodeSummary, nodes = this.getNodes(), byId = new Map(nodes.map(item => [item.id, item]))): boolean {
    if (node.type === 'definition') {
      return nodes.some(candidate => candidate.id !== node.id && candidate.type === 'definition');
    }
    if (!this.isDerivedType(node.type)) return false;
    const reasoning = this.reasoningParent(node, byId);
    if (!reasoning) return false;
    return nodes.some(candidate => {
      if (candidate.id === node.id || candidate.type !== node.type) return false;
      const otherReasoning = this.reasoningParent(candidate);
      return Boolean(
        otherReasoning &&
        otherReasoning.id !== reasoning.id &&
        otherReasoning.logicRuleId === reasoning.logicRuleId &&
        this.samePremises(otherReasoning, reasoning)
      );
    });
  }

  private showOperationError(error: unknown): void {
    console.error('[Knowledge-Ball] knowledge edit failed:', error);
    this.showToast(error instanceof Error ? `操作失败：${error.message}` : '操作失败');
  }

  private openDecomposeForm(id: string): void {
    const reasoning = this.getNodeById(id);
    if (!reasoning || reasoning.type !== 'reasoning') return;
    const conclusions = this.getNodes().filter(node => node.type !== 'reasoning' && node.premises.includes(id));
    this.panelTitle.textContent = `分解：${reasoning.title}`;
    this.panelBody.innerHTML = `
      <div class="field-reasoning-band"><div class="reasoning-stage">前提<b>已连接</b></div><span class="reasoning-arrow">→</span><div class="reasoning-stage">中间推理<b>未完成</b></div><span class="reasoning-arrow">→</span><div class="reasoning-stage">结论<b>等待连接</b></div></div>
      <div class="operation-progress" aria-label="分解进度"><span style="width:33%"></span></div>
      <div class="field">
        <label>原结论</label>
        <select id="decomposeConclusion">
          ${conclusions.map(node => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.title)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>步骤一标题</label><input type="text" id="stepOneTitle"></div>
      <div class="field"><label>步骤一推理过程</label><textarea id="stepOneReasoning"></textarea></div>
      <div class="field"><label>步骤一逻辑符号</label><select id="stepOneLogic">${this.logicRuleOptions(reasoning.logicRuleId)}</select></div>
      <div class="field"><label>中间结论标题</label><input type="text" id="middleTitle"></div>
      <div class="field"><label>中间结论描述</label><textarea id="middleDescription"></textarea></div>
      <div class="field"><label>步骤二标题</label><input type="text" id="stepTwoTitle"></div>
      <div class="field"><label>步骤二推理过程</label><textarea id="stepTwoReasoning"></textarea></div>
      <div class="field"><label>步骤二逻辑符号</label><select id="stepTwoLogic">${this.logicRuleOptions(reasoning.logicRuleId)}</select></div>
      <p class="note-small" style="text-align:left;">只有完整形成“原前提 → 步骤一 → 中间结论 → 步骤二 → 原结论”后，系统才写入一个原子分解事件。内部细分类由系统沿用原结论结构，不要求用户选择。</p>
    `;
    this.panelActions.innerHTML = `
      <button class="btn primary" id="submitDecompose">检查完整链并分解</button>
      <button class="btn ghost" id="cancelOperation">取消</button>
    `;
    this.panelActions.querySelector<HTMLButtonElement>('#cancelOperation')?.addEventListener('click', () => this.openNodePanel(id));
    this.panelActions.querySelector<HTMLButtonElement>('#submitDecompose')?.addEventListener('click', async () => {
      const value = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector: string) =>
        safeText(this.panelBody.querySelector<T>(selector)?.value);
      const conclusionId = value<HTMLSelectElement>('#decomposeConclusion');
      const conclusionType = this.getNodeById(conclusionId)?.type;
      if (!conclusionType || !this.isDerivedType(conclusionType)) {
        this.showToast('原结论的内部结构无法用于分解，请先检查该知识链。');
        return;
      }
      const payload: DecomposeNodePayload = {
        conclusionId,
        reasoningSteps: [
          { title: value<HTMLInputElement>('#stepOneTitle'), reasoning: value<HTMLTextAreaElement>('#stepOneReasoning'), logicRuleId: value<HTMLSelectElement>('#stepOneLogic') },
          { title: value<HTMLInputElement>('#stepTwoTitle'), reasoning: value<HTMLTextAreaElement>('#stepTwoReasoning'), logicRuleId: value<HTMLSelectElement>('#stepTwoLogic') },
        ],
        intermediateConclusions: [{
          title: value<HTMLInputElement>('#middleTitle'),
          type: conclusionType,
          description: value<HTMLTextAreaElement>('#middleDescription'),
        }],
      };
      const complete = payload.conclusionId &&
        payload.reasoningSteps.every(step => step.title && step.reasoning && step.logicRuleId) &&
        payload.intermediateConclusions.every(item => item.title && item.description);
      if (!complete) {
        this.showToast('分解链不完整：两个推理步骤、中间结论和逻辑符号都必须填写。');
        return;
      }
      try {
        await this.onDecomposeNode(id, payload);
        this.showToast('完整分解事件已提交；旧推理保留并默认隐藏');
        this.closeNodePanel();
      } catch (error) {
        this.showOperationError(error);
      }
    });
  }

  private openMergeForm(id: string): void {
    const node = this.getNodeById(id);
    if (!node) return;
    if (node.type === 'definition') {
      this.openDefinitionMergeForm(node);
      return;
    }
    this.openTheoryMergeForm(node);
  }

  private openDefinitionMergeForm(node: PanelNodeSummary): void {
    const candidates = this.getNodes().filter(candidate => candidate.id !== node.id && candidate.type === 'definition');
    this.panelTitle.textContent = `合并定义：${node.title}`;
    this.panelBody.innerHTML = `
      <div class="difference-card"><b>DIFFERENCE REVIEW</b><br>选择待合并定义，逐项比较原始表述、语义标识与统一定义；差异确认前不会重连关系。</div>
      <div class="field"><label>同一定义的其他语言描述</label><div class="premise-list">
        ${candidates.map(candidate => `<label class="premise-item"><input type="checkbox" data-merge-source value="${escapeHtml(candidate.id)}"> ${escapeHtml(candidate.title)}</label>`).join('')}
      </div></div>
      <div class="field"><label>语义等价标识</label><input type="text" id="mergeSemanticKey" placeholder="例如 definition:prime-number"></div>
      <div class="field"><label>统一定义标题</label><input type="text" id="mergeDefinitionTitle"></div>
      <div class="field"><label>统一定义描述</label><textarea id="mergeDefinitionDescription"></textarea></div>
      <p class="note-small" style="text-align:left;">来源定义必须文字不同但语义相同；原定义保留为别名并默认隐藏。</p>
    `;
    this.panelActions.innerHTML = `<button class="btn primary" id="submitMerge">检查并合并定义</button><button class="btn ghost" id="cancelOperation">取消</button>`;
    this.panelActions.querySelector<HTMLButtonElement>('#cancelOperation')?.addEventListener('click', () => this.openNodePanel(node.id));
    this.panelActions.querySelector<HTMLButtonElement>('#submitMerge')?.addEventListener('click', async () => {
      const selected = Array.from(this.panelBody.querySelectorAll<HTMLInputElement>('[data-merge-source]:checked')).map(input => input.value);
      const payload: MergeDefinitionPayload = {
        sourceNodeIds: [node.id, ...selected],
        semanticKey: safeText(this.panelBody.querySelector<HTMLInputElement>('#mergeSemanticKey')?.value),
        mergedDefinition: {
          title: safeText(this.panelBody.querySelector<HTMLInputElement>('#mergeDefinitionTitle')?.value),
          description: safeText(this.panelBody.querySelector<HTMLTextAreaElement>('#mergeDefinitionDescription')?.value),
        },
      };
      if (selected.length === 0 || !payload.semanticKey || !payload.mergedDefinition.title || !payload.mergedDefinition.description) {
        this.showToast('请选择另一个定义，并填写语义标识与新的统一描述。');
        return;
      }
      try {
        await this.onMergeDefinitions(payload);
        this.showToast('定义合并事件已提交；来源定义保留并默认隐藏');
        this.closeNodePanel();
      } catch (error) {
        this.showOperationError(error);
      }
    });
  }

  private openTheoryMergeForm(node: PanelNodeSummary): void {
    const reasoning = this.reasoningParent(node);
    if (!reasoning) return;
    const candidates = this.getNodes().filter(candidate => {
      if (candidate.id === node.id || candidate.type !== node.type) return false;
      const other = this.reasoningParent(candidate);
      return Boolean(other && other.id !== reasoning.id &&
        other.logicRuleId === reasoning.logicRuleId &&
        this.samePremises(other, reasoning));
    });
    this.panelTitle.textContent = `合并理论：${node.title}`;
    this.panelBody.innerHTML = `
      <div class="difference-card"><b>REASONING CHAIN DIFF</b><br>仅共同前提和逻辑规则一致的链可进入比较。请核对推理文本与结论差异。</div>
      <div class="field"><label>具有相同前提、推理过程和逻辑符号的结论</label><div class="premise-list">
        ${candidates.map(candidate => `<label class="premise-item"><input type="checkbox" data-merge-source value="${escapeHtml(candidate.id)}"> ${escapeHtml(candidate.title)}</label>`).join('')}
      </div></div>
      <div class="field"><label>推理过程语义等价标识（先检查）</label><input type="text" id="mergeReasoningSemanticKey"></div>
      <div class="field"><label>结论语义等价标识</label><input type="text" id="mergeSemanticKey"></div>
      <div class="field"><label>统一推理标题</label><input type="text" id="mergeReasoningTitle"></div>
      <div class="field"><label>统一推理过程</label><textarea id="mergeReasoningText"></textarea></div>
      <div class="field"><label>统一推理逻辑符号</label><select id="mergeLogicRule">${this.logicRuleOptions(reasoning.logicRuleId)}</select></div>
      <div class="field"><label>统一结论标题</label><input type="text" id="mergeConclusionTitle"></div>
      <div class="field"><label>统一结论描述</label><textarea id="mergeConclusionDescription"></textarea></div>
      <p class="note-small" style="text-align:left;">系统先检查并建立统一推理过程，再建立依赖它的统一结论；内部细分类沿用来源结构，不要求用户填写。</p>
    `;
    this.panelActions.innerHTML = `<button class="btn primary" id="submitMerge">检查推理后合并结论</button><button class="btn ghost" id="cancelOperation">取消</button>`;
    this.panelActions.querySelector<HTMLButtonElement>('#cancelOperation')?.addEventListener('click', () => this.openNodePanel(node.id));
    this.panelActions.querySelector<HTMLButtonElement>('#submitMerge')?.addEventListener('click', async () => {
      const selected = Array.from(this.panelBody.querySelectorAll<HTMLInputElement>('[data-merge-source]:checked')).map(input => input.value);
      const payload: MergeTheoryPayload = {
        sourceConclusionIds: [node.id, ...selected],
        reasoningSemanticKey: safeText(this.panelBody.querySelector<HTMLInputElement>('#mergeReasoningSemanticKey')?.value),
        semanticKey: safeText(this.panelBody.querySelector<HTMLInputElement>('#mergeSemanticKey')?.value),
        mergedReasoning: {
          title: safeText(this.panelBody.querySelector<HTMLInputElement>('#mergeReasoningTitle')?.value),
          reasoning: safeText(this.panelBody.querySelector<HTMLTextAreaElement>('#mergeReasoningText')?.value),
          logicRuleId: safeText(this.panelBody.querySelector<HTMLSelectElement>('#mergeLogicRule')?.value),
        },
        mergedConclusion: {
          title: safeText(this.panelBody.querySelector<HTMLInputElement>('#mergeConclusionTitle')?.value),
          type: node.type,
          description: safeText(this.panelBody.querySelector<HTMLTextAreaElement>('#mergeConclusionDescription')?.value),
        },
      };
      const complete = selected.length > 0 && payload.reasoningSemanticKey && payload.semanticKey &&
        payload.mergedReasoning.title && payload.mergedReasoning.reasoning && payload.mergedReasoning.logicRuleId &&
        payload.mergedConclusion.title && payload.mergedConclusion.description;
      if (!complete) {
        this.showToast('请选择另一条同推理链，并完整填写统一推理和统一结论。');
        return;
      }
      try {
        await this.onMergeTheories(payload);
        this.showToast('理论合并事件已提交；来源链保留并默认隐藏');
        this.closeNodePanel();
      } catch (error) {
        this.showOperationError(error);
      }
    });
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
        if (Number.isFinite(v) && this.setNodeRadiusVal) {
          this.setNodeRadiusVal.textContent = `${v.toFixed(1)}mm`;
        }
      });
    }

    if (this.setLabelSize) {
      this.setLabelSize.addEventListener('input', () => {
        const v = Number.parseFloat(this.setLabelSize!.value);
        if (Number.isFinite(v) && this.setLabelSizeVal) {
          this.setLabelSizeVal.textContent = `${v}px`;
        }
      });
    }

    if (this.setLabelBrightness) {
      this.setLabelBrightness.addEventListener('input', () => {
        const v = Number.parseFloat(this.setLabelBrightness!.value);
        if (Number.isFinite(v) && this.setLabelBrightnessVal) {
          this.setLabelBrightnessVal.textContent = `${v}%`;
        }
      });
    }

    if (this.onOpenSettings && this.settingsOverlay) {
      this.settingsOverlay.addEventListener('transitionend', () => {
        // placeholder for future sync
      });
    }
  }
}
