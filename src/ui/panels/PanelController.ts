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
}

export interface CreateNodePayload {
  title: string;
  type: KnowledgeNodeType;
  reasoning: string;
  premises: string[];
  tags?: string[];
  domain?: string;
  author?: string;
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
  onFalsifyNode: (id: string) => Promise<void> | void;
  onResolveNode: (id: string) => Promise<void> | void;
  onDisputeNode: (id: string) => Promise<void> | void;
  onSetMastery: (id: string, mastery: KnowledgeMastery) => Promise<void> | void;
  onSelectRelatedNode?: (id: string) => void;

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
  fReasoning: HTMLTextAreaElement;
  fPremises: HTMLElement;
  fLogicConfirm: HTMLInputElement;

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
  private readonly onFalsifyNode: (id: string) => Promise<void> | void;
  private readonly onResolveNode: (id: string) => Promise<void> | void;
  private readonly onDisputeNode: (id: string) => Promise<void> | void;
  private readonly onSetMastery: (id: string, mastery: KnowledgeMastery) => Promise<void> | void;
  private readonly onSelectRelatedNode?: (id: string) => void;
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
  private readonly fReasoning: HTMLTextAreaElement;
  private readonly fPremises: HTMLElement;
  private readonly fLogicConfirm: HTMLInputElement;

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
    this.onFalsifyNode = options.onFalsifyNode;
    this.onResolveNode = options.onResolveNode;
    this.onDisputeNode = options.onDisputeNode;
    this.onSetMastery = options.onSetMastery;
    this.onSelectRelatedNode = options.onSelectRelatedNode;
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
    this.fReasoning = options.fReasoning;
    this.fPremises = options.fPremises;
    this.fLogicConfirm = options.fLogicConfirm;

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
    const node = this.getNodeById(id);
    if (!node) return;

    this.selectedId = id;
    this.editMode = false;
    this.panel.classList.add('open');
    this.panelTitle.textContent = node.title;

    const typeColor = TYPE_COLOR_HEX[node.type] ?? '#ffffff';
    const statusColor = STATUS_COLOR_HEX[node.status] ?? '#ffffff';

    const premisesHtml = node.premises.map(pid => {
      const p = this.getNodeById(pid);
      if (!p) return '';
      return `<div class="chip" data-jump="${escapeHtml(pid)}">${escapeHtml(shortText(p.title, 20))}</div>`;
    }).join('') || '<div class="chip empty">无前置（公理层或独立节点）</div>';

    const depsHtml = this.getNodes()
      .filter(n => n.premises.includes(id))
      .map(n => `<div class="chip" data-jump="${escapeHtml(n.id)}">${escapeHtml(shortText(n.title, 20))}</div>`)
      .join('') || '<div class="chip empty">暂无下游依赖节点</div>';

    const twinNodes = node.twinGroup
      ? this.getNodes().filter(n => n.twinGroup === node.twinGroup && n.id !== node.id)
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

    this.panelBody.innerHTML = `
      <div class="badge-row">
        <div class="badge" style="color:${typeColor};border-color:${typeColor}66;">${TYPE_LABEL[node.type]}</div>
        <div class="badge" style="color:${statusColor};border-color:${statusColor}66;">${STATUS_LABEL[node.status]}</div>
        <div class="badge" style="color:var(--brass);border-color:var(--brass-dim);">${safeText(node.domain) || 'general'}</div>
      </div>

      <div class="field">
        <label>掌握程度</label>
        <div class="mastery-display" id="masteryDisplay">${MASTERY_LABEL[node.mastery]}</div>
        <div class="mastery-demo-controls">
          <div class="chip ${node.mastery === 'none' ? 'active' : ''}" data-mastery="none">未接触</div>
          <div class="chip ${node.mastery === 'touched' ? 'active' : ''}" data-mastery="touched">接触过</div>
          <div class="chip ${node.mastery === 'mastered' ? 'active' : ''}" data-mastery="mastered">完全掌握</div>
        </div>
      </div>

      <div class="field">
        <label>最小推理过程</label>
        <div class="val">${escapeHtml(node.reasoning || '（未填写）')}</div>
      </div>

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
        <button class="btn ghost" id="btnEditNode">✎ 编辑节点</button>
        <button class="btn ghost" id="btnDeriveNode">↳ 推理新节点</button>
      </div>
      ${node.status !== 'falsified' && node.status !== 'suspended' ? `<button class="btn danger" id="btnFalsify">⚠ 否定该节点（级联悬置下游）</button>` : ''}
      ${node.status === 'suspended' ? `<button class="btn confirm" id="btnResolve">✓ 标记重新验证通过</button>` : ''}
      ${node.status === 'disputed' ? `<button class="btn confirm" id="btnDispute">✓ 标记争议中</button>` : ''}
      <div class="note-small">当前为本地演示控制层，后续会接入 GitHub/后端存储层。</div>
    `;

    this.bindPanelRuntimeEvents(id);
  }

  closeNodePanel(): void {
    this.panel.classList.remove('open');
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
    this.fType.value = 'fact';
    this.fReasoning.value = '';
    this.fLogicConfirm.checked = false;
    this.modalSubmit.disabled = true;
    this.renderPremiseList();
    this.modalOverlay.classList.add('show');
  }

  closeCreateModal(): void {
    this.modalOverlay.classList.remove('show');
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

    this.fLogicConfirm.addEventListener('change', () => {
      this.modalSubmit.disabled = !this.fLogicConfirm.checked;
    });

    this.modalSubmit.addEventListener('click', async () => {
      const title = this.fTitle.value.trim();
      const reasoning = this.fReasoning.value.trim();
      const type = this.fType.value as KnowledgeNodeType;
      const premises = Array.from(this.fPremises.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
        .map(el => el.value);

      if (!title) {
this.showToast('请填写节点结论标题。');
        return;
      }
      if (!this.fLogicConfirm.checked) {
        this.showToast('请先确认符合逻辑三大基本定律。');
        return;
      }

      await this.onCreateNode({
        title,
        type,
        reasoning,
        premises,
      });

      this.closeCreateModal();
      this.showToast(`节点已提交：${title}`);
    });

    this.bindPremiseChecks();
    this.bindSettingsControls();
  }

  private bindPanelRuntimeEvents(id: string): void {
    const editBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnEditNode');
    const deriveBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnDeriveNode');
    const falsifyBtn = this.panelActions.querySelector<HTMLButtonElement>('#btnFalsify');
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
          <label>类型</label>
          <select id="editType">
            ${Object.keys(TYPE_LABEL).map(t => `<option value="${escapeHtml(t)}" ${t === node.type ? 'selected' : ''}>${TYPE_LABEL[t as KnowledgeNodeType]}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>最小推理过程</label>
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
        await this.onEditNode(id, { title, type, reasoning });
        this.editMode = false;
        this.showToast('节点已更新');
        this.openNodePanel(id);
      });

      this.panelActions.querySelector<HTMLButtonElement>('#cancelEdit')?.addEventListener('click', () => {
        this.editMode = false;
        this.openNodePanel(id);
      });
    });

    deriveBtn?.addEventListener('click', () => this.openCreateModal(id));
    falsifyBtn?.addEventListener('click', async () => {
      await this.onFalsifyNode(id);
      this.showToast('节点已证伪');
    });
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

  private renderPremiseList(): void {
    const nodes = this.getNodes();
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