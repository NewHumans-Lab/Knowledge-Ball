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
  twinGroup?: string;
  sharedTitle?: string;
  domain?: string;
  logicRuleId?: string;
  aliases?: string[];
  semanticKey?: string;
}

export interface CreateNodePayload {
  title: string;
  canonicalTitle?: string;
  type: KnowledgeNodeType;
  description: string;
  reasoning?: string;
  premises: string[];
  logicRuleId?: string;
  tags?: string[];
  domain?: string;
  author?: string;
}

export interface NegateNodePayload {
  counterexampleIds: string[];
  correctedReasoning?: {
    title: string;
    reasoning: string;
    logicRuleId: string;
  };
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

export interface EditNodePayload {
  title: string;
  type: KnowledgeNodeType;
  reasoning: string;
}

export interface PanelControllerCallbacks {
  getNodes: () => PanelNodeSummary[];
  getNodeById: (id: string) => PanelNodeSummary | null;

  onCreateNode: (payload: CreateNodePayload) => Promise<void> | void;
  onEditNode: (id: string, payload: EditNodePayload) => Promise<void> | void;
  onNegateNode: (id: string, payload: NegateNodePayload) => Promise<void> | void;
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
  fCanonical: HTMLInputElement;
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
  private readonly onEditNode: (id: string, payload: EditNodePayload) => Promise<void> | void;
  private readonly onNegateNode: (id: string, payload: NegateNodePayload) => Promise<void> | void;
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
  private readonly fCanonical: HTMLInputElement;
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
  private editMode = false;
  private prefillPremise: string | null = null;
  private toastTimer: number | null = null;

  constructor(options: PanelControllerCallbacks & PanelControllerElements) {
    this.getNodes = options.getNodes;
    this.getNodeById = options.getNodeById;

    this.onCreateNode = options.onCreateNode;
    this.onEditNode = options.onEditNode;
    this.onNegateNode = options.onNegateNode;
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
    this.fCanonical = options.fCanonical;
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

    this.bind();
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
    this.editMode = false;
    this.onOverlayVisibilityChange?.(true);
    this.panel.classList.add('open');
    this.panelTitle.textContent = node.title;

    const typeColor = TYPE_COLOR_HEX[node.type] ?? '#ffffff';
    const statusColor = STATUS_COLOR_HEX[node.status] ?? '#ffffff';

    const premisesHtml = node.premises.map(pid => {
      const p = byId.get(pid);
      if (!p) return '';
      return `<div class="chip" data-jump="${escapeHtml(pid)}">${escapeHtml(shortText(p.title, 20))}</div>`;
    }).join('') || '<div class="chip empty">无前置（公理层或独立节点）</div>';

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
              : '<div class="chip empty">旧数据：尚未分类</div>'}
          </div>
        </div>
      `
      : '';

    this.panelBody.innerHTML = `
      <div class="badge-row">
        <div class="badge" style="color:${typeColor};border-color:${typeColor}66;">${TYPE_LABEL[node.type]}</div>
        <div class="badge" style="color:${statusColor};border-color:${statusColor}66;">${STATUS_LABEL[node.status]}</div>
        <div class="badge" style="color:var(--brass);border-color:var(--brass-dim);">${safeText(node.domain) || 'general'}</div>
      </div>

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
        <button class="btn ghost" id="btnEditNode">Edit · 编辑</button>
        <button class="btn ghost" id="btnDeriveNode">Add · 新增</button>
      </div>
      <div class="action-grid">
        ${node.type === 'reasoning' ? '<button class="btn ghost" id="btnDecompose">Decompose · 分解</button>' : ''}
        ${this.canMerge(node, nodes, byId) ? '<button class="btn ghost" id="btnMerge">Merge · 合并</button>' : ''}
      </div>
      ${node.status !== 'falsified' && node.status !== 'suspended' ? `<button class="btn danger" id="btnNegate">Negate · 以 Counterexample 否定</button>` : ''}
      ${node.status === 'suspended' ? `<button class="btn confirm" id="btnResolve">✓ 标记重新验证通过</button>` : ''}
      ${node.status === 'disputed' ? `<button class="btn confirm" id="btnDispute">✓ 标记争议中</button>` : ''}
      <div class="note-small">节点会先保存在当前设备；共享服务可用时同步给其他用户。</div>
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
    this.editMode = false;
  }

  openCreateModal(prefillPremiseId: string | null = null): void {
    this.prefillPremise = prefillPremiseId;
    this.editMode = false;
    this.modalTitle.textContent = prefillPremiseId ? '推理新节点' : '提交新知识节点';
    this.modalHint.style.display = prefillPremiseId ? 'block' : 'none';
    if (prefillPremiseId) {
      const src = this.getNodeById(prefillPremiseId);
      this.modalHint.textContent = src ? `将默认以「${src.title}」作为前置知识点` : '将默认以所选节点作为前置知识点';
    }
    this.fTitle.value = '';
    this.fCanonical.value = '';
    this.fType.value = prefillPremiseId ? 'theorem' : 'fact';
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
      const canonicalTitle = this.fCanonical.value.trim();
      const description = this.fDescription.value.trim();
      const reasoning = this.fReasoning.value.trim();
      const type = this.fType.value as KnowledgeNodeType;
      const premises = Array.from(this.fPremises.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
        .map(el => el.value);
      const logicRuleId = this.fLogicRule.value;
      const derived = this.isDerivedType(type);

      if (!title) {
        this.showToast('请填写节点标题。');
        return;
      }
      const containsNonEnglish = /[^\x00-\x7F]/.test(title);
      if (containsNonEnglish && !canonicalTitle) {
        this.showToast('非英文 Original 必须填写 Canonical English 后才能提交。');
        this.fCanonical.focus();
        return;
      }
      if (canonicalTitle && /[^\x00-\x7F]/.test(canonicalTitle)) {
        this.showToast('Canonical English 必须使用英文字符。');
        this.fCanonical.focus();
        return;
      }
      if (!description) {
        this.showToast('请填写知识描述。');
        return;
      }
      if (derived && premises.length === 0) {
        this.showToast('理论必须选择至少一个已有知识前提。');
        return;
      }
      if (derived && !reasoning) {
        this.showToast('理论必须填写完整推理过程。');
        return;
      }
      if (derived && !logicRuleId) {
        this.showToast('理论必须选择一个已有逻辑符号；如列表为空，请先增加逻辑符号节点。');
        return;
      }

      this.modalSubmit.disabled = true;
      try {
        await this.onCreateNode({
          title,
          canonicalTitle: canonicalTitle || undefined,
          type,
          description,
          reasoning: derived ? reasoning : undefined,
          premises: derived ? premises : [],
          logicRuleId: derived ? logicRuleId : undefined,
        });
        this.closeCreateModal();
        this.showToast(`节点已保存：${title}`);
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
    const editBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnEditNode');
    const deriveBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnDeriveNode');
    const negateBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnNegate');
    const decomposeBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnDecompose');
    const mergeBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnMerge');
    const resolveBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnResolve');
    const disputeBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnDispute');

    editBtn?.addEventListener('click', () => {
      const node = this.getNodeById(id);
      if (!node) return;
      this.editMode = true;
      this.panelTitle.textContent = '编辑节点';
      this.panelBody.innerHTML = `
        <div class="field">
          <label>结论（标题）</label>
          <input type="text" id="editTitle" value="${escapeHtml(node.title)}">
        </div>
        <div class="field">
          <label>类型（结构类型不可直接变更）</label>
          <select id="editType" disabled>
            <option value="${escapeHtml(node.type)}" selected>${TYPE_LABEL[node.type]}</option>
          </select>
        </div>
        <div class="field">
          <label>${node.type === 'reasoning' ? '推理过程' : '知识描述'}</label>
          <textarea id="editReasoning">${escapeHtml(node.reasoning || '')}</textarea>
        </div>
      `;

      this.panelActions.innerHTML = `
        <button class="btn primary" id="saveEdit">保存修改</button>
        <button class="btn ghost" id="cancelEdit">取消</button>
      `;

      this.panelActions.querySelector<HTMLButtonElement>('#saveEdit')?.addEventListener('click', async () => {
        const title = (this.panelBody.querySelector<HTMLInputElement>('#editTitle')?.value ?? '').trim() || node.title;
        const type = (this.panelBody.querySelector<HTMLSelectElement>('#editType')?.value ?? node.type) as KnowledgeNodeType;
        const reasoning = (this.panelBody.querySelector<HTMLTextAreaElement>('#editReasoning')?.value ?? '').trim();
        try {
          await this.onEditNode(id, { title, type, reasoning });
          this.editMode = false;
          this.showToast('节点已更新');
          this.openNodePanel(id);
        } catch (error) {
          this.showOperationError(error);
        }
      });

      this.panelActions.querySelector<HTMLButtonElement>('#cancelEdit')?.addEventListener('click', () => {
        this.editMode = false;
        this.openNodePanel(id);
      });
    });

    deriveBtn?.addEventListener('click', () => this.openCreateModal(id));
    negateBtn?.addEventListener('click', () => this.openNegateForm(id));
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

  private isDerivedType(type: KnowledgeNodeType): boolean {
    return !['axiom', 'definition', 'fact', 'logic-symbol', 'reasoning'].includes(type);
  }

  private updateCreateMode(): void {
    const derived = this.isDerivedType(this.fType.value as KnowledgeNodeType);
    this.fReasoningField.hidden = !derived;
    this.fPremisesField.hidden = !derived;
    this.fLogicRuleField.hidden = !derived;
  }

  private renderLogicRuleList(): void {
    const rules = this.getNodes().filter(node => node.type === 'logic-symbol' && node.status !== 'falsified');
    this.fLogicRule.innerHTML = [
      '<option value="">请选择逻辑符号</option>',
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
      const otherReasoning = this.reasoningParent(candidate, byId);
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

  private openNegateForm(id: string): void {
    const node = this.getNodeById(id);
    if (!node) return;
    const candidates = this.getNodes().filter(candidate => candidate.id !== id && candidate.type !== 'reasoning');
    const correction = node.type === 'reasoning'
      ? `
        <div class="field">
          <label>正确推理过程标题</label>
          <input type="text" id="negateCorrectedTitle" placeholder="必须提供替换推理">
        </div>
        <div class="field">
          <label>正确推理过程</label>
          <textarea id="negateCorrectedReasoning" placeholder="完整写出修正后的推理步骤"></textarea>
        </div>
        <div class="field">
          <label>正确推理使用的逻辑符号</label>
          <select id="negateCorrectedLogic">${this.logicRuleOptions(node.logicRuleId)}</select>
        </div>
      `
      : '';

    this.panelTitle.textContent = `否定：${node.title}`;
    this.panelBody.innerHTML = `
      <div class="counterexample-callout"><b>COUNTEREXAMPLE → TARGET</b><br>反例将沿真实依赖关系抵达目标命题；目标与下游路径会减弱，而不会被爆炸式删除。</div>
      <div class="field">
        <label>反例知识节点（至少一个）</label>
        <div class="premise-list">
          ${candidates.map(candidate => `
            <label class="premise-item">
              <input type="checkbox" data-counterexample value="${escapeHtml(candidate.id)}">
              ${escapeHtml(shortText(candidate.title, 34))}
            </label>
          `).join('') || '<div class="chip empty">没有可用反例，请先增加反例知识节点</div>'}
        </div>
      </div>
      ${correction}
      <p class="note-small" style="text-align:left;">提交后目标不会删除，只会进入已证伪并默认隐藏；其反例以后被否定时，目标才会重新进入等待验证。</p>
    `;
    this.panelActions.innerHTML = `
      <button class="btn danger" id="submitNegate">验证反例并否定</button>
      <button class="btn ghost" id="cancelOperation">取消</button>
    `;

    this.panelActions.querySelector<HTMLButtonElement>('#cancelOperation')?.addEventListener('click', () => this.openNodePanel(id));
    this.panelActions.querySelector<HTMLButtonElement>('#submitNegate')?.addEventListener('click', async () => {
      const counterexampleIds = Array.from(this.panelBody.querySelectorAll<HTMLInputElement>('[data-counterexample]:checked'))
        .map(input => input.value);
      if (counterexampleIds.length === 0) {
        this.showToast('否定必须选择至少一个反例知识节点。');
        return;
      }
      const correctedReasoning = node.type === 'reasoning'
        ? {
            title: safeText(this.panelBody.querySelector<HTMLInputElement>('#negateCorrectedTitle')?.value),
            reasoning: safeText(this.panelBody.querySelector<HTMLTextAreaElement>('#negateCorrectedReasoning')?.value),
            logicRuleId: safeText(this.panelBody.querySelector<HTMLSelectElement>('#negateCorrectedLogic')?.value),
          }
        : undefined;
      if (correctedReasoning && (!correctedReasoning.title || !correctedReasoning.reasoning || !correctedReasoning.logicRuleId)) {
        this.showToast('否定错误推理时，必须完整填写正确推理及其逻辑符号。');
        return;
      }
      try {
        await this.onNegateNode(id, { counterexampleIds, correctedReasoning });
        this.showToast('否定事件已提交；原节点保留并默认隐藏');
        this.closeNodePanel();
      } catch (error) {
        this.showOperationError(error);
      }
    });
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
      <div class="field">
        <label>中间结论类型</label>
        <select id="middleType">
          <option value="theorem">定理</option><option value="hypothesis">假说</option>
          <option value="prediction">预测</option><option value="opinion">观点</option><option value="value">价值判断</option>
        </select>
      </div>
      <div class="field"><label>步骤二标题</label><input type="text" id="stepTwoTitle"></div>
      <div class="field"><label>步骤二推理过程</label><textarea id="stepTwoReasoning"></textarea></div>
      <div class="field"><label>步骤二逻辑符号</label><select id="stepTwoLogic">${this.logicRuleOptions(reasoning.logicRuleId)}</select></div>
      <p class="note-small" style="text-align:left;">只有完整形成“原前提 → 步骤一 → 中间结论 → 步骤二 → 原结论”后，系统才写入一个原子分解事件。</p>
    `;
    this.panelActions.innerHTML = `
      <button class="btn primary" id="submitDecompose">验证完整链并分解</button>
      <button class="btn ghost" id="cancelOperation">取消</button>
    `;
    this.panelActions.querySelector<HTMLButtonElement>('#cancelOperation')?.addEventListener('click', () => this.openNodePanel(id));
    this.panelActions.querySelector<HTMLButtonElement>('#submitDecompose')?.addEventListener('click', async () => {
      const value = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector: string) =>
        safeText(this.panelBody.querySelector<T>(selector)?.value);
      const payload: DecomposeNodePayload = {
        conclusionId: value<HTMLSelectElement>('#decomposeConclusion'),
        reasoningSteps: [
          { title: value<HTMLInputElement>('#stepOneTitle'), reasoning: value<HTMLTextAreaElement>('#stepOneReasoning'), logicRuleId: value<HTMLSelectElement>('#stepOneLogic') },
          { title: value<HTMLInputElement>('#stepTwoTitle'), reasoning: value<HTMLTextAreaElement>('#stepTwoReasoning'), logicRuleId: value<HTMLSelectElement>('#stepTwoLogic') },
        ],
        intermediateConclusions: [{
          title: value<HTMLInputElement>('#middleTitle'),
          type: value<HTMLSelectElement>('#middleType') as KnowledgeNodeType,
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
      <div class="difference-card"><b>DIFFERENCE REVIEW</b><br>选择待合并定义，逐项比较 Original 表述、语义标识与统一定义；差异确认前不会重连关系。</div>
      <div class="field"><label>同一定义的其他语言描述</label><div class="premise-list">
        ${candidates.map(candidate => `<label class="premise-item"><input type="checkbox" data-merge-source value="${escapeHtml(candidate.id)}"> ${escapeHtml(candidate.title)}</label>`).join('')}
      </div></div>
      <div class="field"><label>语义等价标识</label><input type="text" id="mergeSemanticKey" placeholder="例如 definition:prime-number"></div>
      <div class="field"><label>统一定义标题</label><input type="text" id="mergeDefinitionTitle"></div>
      <div class="field"><label>统一定义描述</label><textarea id="mergeDefinitionDescription"></textarea></div>
      <p class="note-small" style="text-align:left;">来源定义必须文字不同但语义相同；原定义保留为别名并默认隐藏。</p>
    `;
    this.panelActions.innerHTML = `<button class="btn primary" id="submitMerge">验证并合并定义</button><button class="btn ghost" id="cancelOperation">取消</button>`;
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
      <div class="field"><label>推理过程语义等价标识（先验证）</label><input type="text" id="mergeReasoningSemanticKey"></div>
      <div class="field"><label>结论语义等价标识</label><input type="text" id="mergeSemanticKey"></div>
      <div class="field"><label>统一推理标题</label><input type="text" id="mergeReasoningTitle"></div>
      <div class="field"><label>统一推理过程</label><textarea id="mergeReasoningText"></textarea></div>
      <div class="field"><label>统一推理逻辑符号</label><select id="mergeLogicRule">${this.logicRuleOptions(reasoning.logicRuleId)}</select></div>
      <div class="field"><label>统一结论标题</label><input type="text" id="mergeConclusionTitle"></div>
      <div class="field"><label>统一结论描述</label><textarea id="mergeConclusionDescription"></textarea></div>
      <div class="field"><label>统一结论类型（保持来源类型）</label><select id="mergeConclusionType" disabled>
        <option value="${escapeHtml(node.type)}">${TYPE_LABEL[node.type]}</option>
      </select></div>
      <p class="note-small" style="text-align:left;">系统先验证并建立统一推理过程，再建立依赖它的统一结论；两步作为一个事件同时提交。</p>
    `;
    this.panelActions.innerHTML = `<button class="btn primary" id="submitMerge">验证推理后合并结论</button><button class="btn ghost" id="cancelOperation">取消</button>`;
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
          type: (this.panelBody.querySelector<HTMLSelectElement>('#mergeConclusionType')?.value ?? node.type) as KnowledgeNodeType,
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
    const nodes = this.getNodes().filter(node => node.type !== 'reasoning' && node.type !== 'logic-symbol');
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
      // keep hook for future validation
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
