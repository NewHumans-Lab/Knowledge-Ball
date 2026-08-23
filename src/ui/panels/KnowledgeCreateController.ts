import './KnowledgeCreateController.css';
import {
  KNOWLEDGE_LAYER_HELP,
  isUserKnowledgeLayer,
  type UserKnowledgeLayer,
} from '../../domain/KnowledgeLayerPolicy';
import {
  lineageRoleFor,
  type KnowledgeLineageMeta,
} from '../../domain/KnowledgeLineage';
import type {
  KnowledgeNodeStatus,
  KnowledgeNodeType,
} from '../config/KnowledgeUiConfig';

export interface KnowledgeCreateNode {
  id: string;
  title: string;
  type: KnowledgeNodeType;
  status: KnowledgeNodeStatus;
  lineage?: KnowledgeLineageMeta;
}

export interface CreateStandaloneKnowledgePayload {
  title: string;
  layer: UserKnowledgeLayer;
  description: string;
}

export interface CreateReasoningKnowledgePayload {
  title: string;
  premiseIds: string[];
  reasoning: string;
  conclusionIds: string[];
}

export interface KnowledgeCreateControllerOptions {
  getNodes: () => KnowledgeCreateNode[];
  onCreateStandalone: (payload: CreateStandaloneKnowledgePayload) => Promise<void> | void;
  onCreateReasoning: (payload: CreateReasoningKnowledgePayload) => Promise<void> | void;
  onOverlayVisibilityChange?: (visible: boolean) => void;
  onToast?: (message: string) => void;
}

type PickerKind = 'premise' | 'conclusion';
type CreateMode = 'standalone' | 'reasoning';

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function canonicalSearch(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

/**
 * A premise is an accepted/current knowledge statement, never another inference
 * process, an initial pending claim, or a historical/opposition version.
 */
export function isReasoningPremiseCandidate(node: KnowledgeCreateNode): boolean {
  if (node.type === 'reasoning') return false;
  if (node.status === 'pending' || node.status === 'falsified' || node.status === 'suspended') return false;
  return lineageRoleFor(node) === 'current';
}

/**
 * Product rule: conclusions are existing knowledge balls. Their review/lineage
 * state is intentionally not filtered; only reasoning-process balls are invalid.
 */
export function isReasoningConclusionCandidate(node: KnowledgeCreateNode): boolean {
  return node.type !== 'reasoning';
}

export class KnowledgeCreateController {
  private readonly getNodes: KnowledgeCreateControllerOptions['getNodes'];
  private readonly onCreateStandalone: KnowledgeCreateControllerOptions['onCreateStandalone'];
  private readonly onCreateReasoning: KnowledgeCreateControllerOptions['onCreateReasoning'];
  private readonly onOverlayVisibilityChange?: KnowledgeCreateControllerOptions['onOverlayVisibilityChange'];
  private readonly onToast?: KnowledgeCreateControllerOptions['onToast'];
  private readonly root: HTMLElement;
  private mode: CreateMode = 'standalone';
  private readonly selectedPremises = new Set<string>();
  private readonly selectedConclusions = new Set<string>();

  constructor(options: KnowledgeCreateControllerOptions) {
    this.getNodes = options.getNodes;
    this.onCreateStandalone = options.onCreateStandalone;
    this.onCreateReasoning = options.onCreateReasoning;
    this.onOverlayVisibilityChange = options.onOverlayVisibilityChange;
    this.onToast = options.onToast;
    this.root = document.createElement('div');
    this.root.id = 'knowledgeCreateOverlay';
    this.root.className = 'knowledge-create-overlay';
    this.root.addEventListener('click', event => {
      if (event.target === this.root) this.close();
    });
    document.body.appendChild(this.root);
  }

  isOpen(): boolean {
    return this.root.classList.contains('show');
  }

  openStandalone(): void {
    this.mode = 'standalone';
    this.selectedPremises.clear();
    this.selectedConclusions.clear();
    this.render();
    this.show();
  }

  openReasoning(prefillPremiseId: string | null = null): void {
    this.mode = 'reasoning';
    this.selectedPremises.clear();
    this.selectedConclusions.clear();
    if (prefillPremiseId) {
      const candidate = this.getNodes().find(node => node.id === prefillPremiseId);
      if (candidate && isReasoningPremiseCandidate(candidate)) {
        this.selectedPremises.add(candidate.id);
      }
    }
    this.render();
    this.show();
  }

  close(): void {
    if (!this.isOpen()) return;
    this.root.classList.remove('show');
    this.root.innerHTML = '';
    this.onOverlayVisibilityChange?.(false);
  }

  destroy(): void {
    this.close();
    this.root.remove();
  }

  private show(): void {
    this.onOverlayVisibilityChange?.(true);
    this.root.classList.add('show');
    window.setTimeout(() => {
      this.root.querySelector<HTMLInputElement>('[data-create-title]')?.focus();
    }, 0);
  }

  private render(): void {
    this.root.innerHTML = this.mode === 'standalone'
      ? this.standaloneMarkup()
      : this.reasoningMarkup();
    this.bindCommonEvents();
    if (this.mode === 'reasoning') this.bindReasoningPickers();
  }

  private standaloneMarkup(): string {
    return `
      <section class="knowledge-create-modal" role="dialog" aria-modal="true" aria-labelledby="knowledgeCreateTitle">
        <header class="knowledge-create-header">
          <h3 id="knowledgeCreateTitle">新增知识</h3>
          <button type="button" class="knowledge-create-close" data-create-close aria-label="关闭">✕</button>
        </header>
        <div class="knowledge-create-body">
          <div class="knowledge-create-field">
            <label for="standaloneTitle">名称</label>
            <input id="standaloneTitle" data-create-title type="text" autocomplete="off" placeholder="填写知识名称">
          </div>
          <div class="knowledge-create-field">
            <label for="standaloneLayer">层级</label>
            <select id="standaloneLayer" data-create-layer>
              <option value="inner">第一层 · 语义与基础事实</option>
              <option value="middle">第二层 · 严谨推理</option>
              <option value="outer">第三层 · 概率与争议</option>
            </select>
            <div class="knowledge-create-help">第一层：${escapeHtml(KNOWLEDGE_LAYER_HELP.inner)}<br><br>第二层：${escapeHtml(KNOWLEDGE_LAYER_HELP.middle)}<br><br>第三层：${escapeHtml(KNOWLEDGE_LAYER_HELP.outer)}</div>
          </div>
          <div class="knowledge-create-field">
            <label for="standaloneDescription">内容</label>
            <textarea id="standaloneDescription" data-create-description placeholder="填写知识本身的完整内容…"></textarea>
          </div>
          <div class="knowledge-create-note">新增只创建一个独立知识球，不自动建立任何前提、推理或结论连线。</div>
        </div>
        ${this.footerMarkup('提交知识')}
      </section>
    `;
  }

  private reasoningMarkup(): string {
    return `
      <section class="knowledge-create-modal reasoning" role="dialog" aria-modal="true" aria-labelledby="knowledgeCreateTitle">
        <header class="knowledge-create-header">
          <h3 id="knowledgeCreateTitle">新增推理</h3>
          <button type="button" class="knowledge-create-close" data-create-close aria-label="关闭">✕</button>
        </header>
        <div class="knowledge-create-body">
          <div class="knowledge-create-field">
            <label for="reasoningTitle">名字</label>
            <input id="reasoningTitle" data-create-title type="text" autocomplete="off" placeholder="填写这个推理过程的名称">
          </div>
          ${this.pickerMarkup('premise', '前提', '搜索已有前提节点…')}
          <div class="knowledge-create-field">
            <label for="reasoningBody">推理过程</label>
            <textarea id="reasoningBody" data-create-reasoning placeholder="逐步写清楚从前提到结论的推理过程…"></textarea>
          </div>
          ${this.pickerMarkup('conclusion', '结论', '搜索已有结论节点…')}
          <div class="knowledge-create-note">搜索框只用于筛选已有节点，不能把输入文字直接当作新节点。选中的节点会固定显示在列表顶部。</div>
        </div>
        ${this.footerMarkup('提交推理')}
      </section>
    `;
  }

  private footerMarkup(label: string): string {
    return `
      <footer class="knowledge-create-footer">
        <button type="button" class="btn" data-create-cancel>取消</button>
        <button type="button" class="btn primary" data-create-submit>${label}</button>
      </footer>
    `;
  }

  private pickerMarkup(kind: PickerKind, label: string, placeholder: string): string {
    return `
      <div class="knowledge-create-field knowledge-picker" data-picker="${kind}">
        <label>${label}</label>
        <div class="knowledge-picker-selected" data-picker-selected aria-live="polite"></div>
        <input type="search" data-picker-search autocomplete="off" placeholder="${placeholder}">
        <div class="knowledge-picker-options" data-picker-options></div>
      </div>
    `;
  }

  private bindCommonEvents(): void {
    this.root.querySelectorAll<HTMLElement>('[data-create-close],[data-create-cancel]').forEach(element => {
      element.addEventListener('click', () => this.close());
    });
    this.root.querySelector<HTMLButtonElement>('[data-create-submit]')?.addEventListener('click', () => {
      void this.submit();
    });
  }

  private bindReasoningPickers(): void {
    this.bindPicker('premise');
    this.bindPicker('conclusion');
  }

  private bindPicker(kind: PickerKind): void {
    const picker = this.root.querySelector<HTMLElement>(`[data-picker="${kind}"]`);
    const search = picker?.querySelector<HTMLInputElement>('[data-picker-search]');
    if (!picker || !search) return;
    const refresh = () => this.renderPicker(kind, search.value);
    search.addEventListener('input', refresh);
    picker.addEventListener('click', event => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-picker-node-id]');
      if (!target) return;
      const id = target.dataset.pickerNodeId;
      if (!id) return;
      const selected = kind === 'premise' ? this.selectedPremises : this.selectedConclusions;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      this.renderPicker(kind, search.value);
      search.focus();
    });
    this.renderPicker(kind, '');
  }

  private renderPicker(kind: PickerKind, query: string): void {
    const picker = this.root.querySelector<HTMLElement>(`[data-picker="${kind}"]`);
    const selectedContainer = picker?.querySelector<HTMLElement>('[data-picker-selected]');
    const optionsContainer = picker?.querySelector<HTMLElement>('[data-picker-options]');
    if (!picker || !selectedContainer || !optionsContainer) return;

    const selected = kind === 'premise' ? this.selectedPremises : this.selectedConclusions;
    const eligible = this.eligibleNodes(kind);
    const byId = new Map(eligible.map(node => [node.id, node]));
    for (const id of [...selected]) {
      if (!byId.has(id)) selected.delete(id);
    }

    selectedContainer.innerHTML = selected.size
      ? [...selected].map(id => {
          const node = byId.get(id)!;
          return `<button type="button" class="knowledge-picker-chip" data-picker-node-id="${escapeHtml(node.id)}" title="点击移除">${escapeHtml(node.title)} <span>×</span></button>`;
        }).join('')
      : '<span class="knowledge-picker-empty">尚未选择</span>';

    const needle = canonicalSearch(query);
    const matching = eligible.filter(node => {
      if (!needle) return true;
      return canonicalSearch(`${node.title} ${node.id}`).includes(needle);
    });
    matching.sort((left, right) => {
      const selectedOrder = Number(selected.has(right.id)) - Number(selected.has(left.id));
      return selectedOrder || left.title.localeCompare(right.title, 'zh-CN');
    });

    optionsContainer.innerHTML = matching.length
      ? matching.map(node => {
          const active = selected.has(node.id);
          return `
            <button type="button" class="knowledge-picker-option${active ? ' selected' : ''}" data-picker-node-id="${escapeHtml(node.id)}" aria-pressed="${active}">
              <span>${escapeHtml(node.title)}</span>
              <small>${active ? '已选择 · 点击取消' : '点击选择'}</small>
            </button>
          `;
        }).join('')
      : '<div class="knowledge-picker-no-results">没有匹配的已有节点</div>';
  }

  private eligibleNodes(kind: PickerKind): KnowledgeCreateNode[] {
    const predicate = kind === 'premise'
      ? isReasoningPremiseCandidate
      : isReasoningConclusionCandidate;
    return this.getNodes().filter(predicate);
  }

  private async submit(): Promise<void> {
    const submit = this.root.querySelector<HTMLButtonElement>('[data-create-submit]');
    const title = this.root.querySelector<HTMLInputElement>('[data-create-title]')?.value.trim() ?? '';
    if (!title) {
      this.notify('请填写名称。');
      return;
    }

    submit && (submit.disabled = true);
    try {
      if (this.mode === 'standalone') {
        const layerValue = this.root.querySelector<HTMLSelectElement>('[data-create-layer]')?.value ?? '';
        const description = this.root.querySelector<HTMLTextAreaElement>('[data-create-description]')?.value.trim() ?? '';
        if (!isUserKnowledgeLayer(layerValue)) throw new Error('请选择知识层级。');
        if (!description) throw new Error('请填写内容。');
        await this.onCreateStandalone({ title, layer: layerValue, description });
        this.close();
        this.notify(`节点已提交：${title}`);
        return;
      }

      const reasoning = this.root.querySelector<HTMLTextAreaElement>('[data-create-reasoning]')?.value.trim() ?? '';
      const currentPremiseIds = new Set(this.eligibleNodes('premise').map(node => node.id));
      const currentConclusionIds = new Set(this.eligibleNodes('conclusion').map(node => node.id));
      const premiseIds = [...this.selectedPremises].filter(id => currentPremiseIds.has(id));
      const conclusionIds = [...this.selectedConclusions].filter(id => currentConclusionIds.has(id));
      if (premiseIds.length === 0) throw new Error('请从已有节点中选择至少一个前提。');
      if (!reasoning) throw new Error('请填写推理过程。');
      if (conclusionIds.length === 0) throw new Error('请从已有节点中选择至少一个结论。');
      if (premiseIds.some(id => conclusionIds.includes(id))) {
        throw new Error('同一个节点不能同时作为这条推理的前提和结论。');
      }
      await this.onCreateReasoning({ title, premiseIds, reasoning, conclusionIds });
      this.close();
      this.notify(`推理已提交：${title}`);
    } catch (error) {
      console.error('[Knowledge-Ball] knowledge creation failed:', error);
      this.notify(error instanceof Error ? error.message : '提交失败');
      if (submit) submit.disabled = false;
    }
  }

  private notify(message: string): void {
    this.onToast?.(message);
  }
}
