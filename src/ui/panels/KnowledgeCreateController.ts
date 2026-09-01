import './KnowledgeCreateController.css';
import {
  isUserKnowledgeLayer,
  type UserKnowledgeLayer,
} from '../../domain/KnowledgeLayerPolicy';
import {
  lineageRoleFor,
  type KnowledgeLineageMeta,
} from '../../domain/KnowledgeLineage';
import { getLocale, subscribeLocale } from '../../i18n/Locale';
import {
  knowledgeLayerHelp,
  knowledgeLayerLabel,
  systemUiText,
} from '../../i18n/SystemUiText';
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
  /** Kept as an array for command/event compatibility; UI always supplies exactly one. */
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
  return value.normalize('NFKC').trim().toLocaleLowerCase(getLocale());
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
 * Conclusions are existing Knowledge balls. Their review/lineage state is not
 * filtered; a Reasoning ball itself cannot be selected as another Reasoning's
 * concrete conclusion.
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
  private readonly unsubscribeLocale: () => void;
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
    this.unsubscribeLocale = subscribeLocale(() => this.refreshLocale());
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
    this.unsubscribeLocale();
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

  /**
   * Re-render system-owned copy when the locale changes without mutating or
   * translating user-authored draft values or picker selections.
   */
  private refreshLocale(): void {
    if (!this.isOpen()) return;
    const title = this.root.querySelector<HTMLInputElement>('[data-create-title]')?.value ?? '';
    const description = this.root.querySelector<HTMLTextAreaElement>('[data-create-description]')?.value ?? '';
    const reasoning = this.root.querySelector<HTMLTextAreaElement>('[data-create-reasoning]')?.value ?? '';
    const layer = this.root.querySelector<HTMLSelectElement>('[data-create-layer]')?.value ?? '';
    const premiseQuery = this.root.querySelector<HTMLInputElement>('[data-picker="premise"] [data-picker-search]')?.value ?? '';
    const conclusionQuery = this.root.querySelector<HTMLInputElement>('[data-picker="conclusion"] [data-picker-search]')?.value ?? '';
    const submitDisabled = this.root.querySelector<HTMLButtonElement>('[data-create-submit]')?.disabled ?? false;

    this.render();

    const titleInput = this.root.querySelector<HTMLInputElement>('[data-create-title]');
    if (titleInput) titleInput.value = title;
    const submit = this.root.querySelector<HTMLButtonElement>('[data-create-submit]');
    if (submit) submit.disabled = submitDisabled;

    if (this.mode === 'standalone') {
      const layerInput = this.root.querySelector<HTMLSelectElement>('[data-create-layer]');
      if (layerInput && isUserKnowledgeLayer(layer)) layerInput.value = layer;
      const descriptionInput = this.root.querySelector<HTMLTextAreaElement>('[data-create-description]');
      if (descriptionInput) descriptionInput.value = description;
      return;
    }

    const reasoningInput = this.root.querySelector<HTMLTextAreaElement>('[data-create-reasoning]');
    if (reasoningInput) reasoningInput.value = reasoning;
    const premiseSearch = this.root.querySelector<HTMLInputElement>('[data-picker="premise"] [data-picker-search]');
    if (premiseSearch) premiseSearch.value = premiseQuery;
    const conclusionSearch = this.root.querySelector<HTMLInputElement>('[data-picker="conclusion"] [data-picker-search]');
    if (conclusionSearch) conclusionSearch.value = conclusionQuery;
    this.renderPicker('premise', premiseQuery);
    this.renderPicker('conclusion', conclusionQuery);
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
          <h3 id="knowledgeCreateTitle">${escapeHtml(systemUiText('create.addKnowledge'))}</h3>
          <button type="button" class="knowledge-create-close" data-create-close aria-label="${escapeHtml(systemUiText('common.close'))}">✕</button>
        </header>
        <div class="knowledge-create-body">
          <div class="knowledge-create-field">
            <label for="standaloneTitle">${escapeHtml(systemUiText('create.nameShort'))}</label>
            <input id="standaloneTitle" data-create-title type="text" autocomplete="off" placeholder="${escapeHtml(systemUiText('create.nameShortPlaceholder'))}">
          </div>
          <div class="knowledge-create-field">
            <label for="standaloneLayer">${escapeHtml(systemUiText('create.layerShort'))}</label>
            <select id="standaloneLayer" data-create-layer>
              <option value="inner">${escapeHtml(knowledgeLayerLabel('inner'))}</option>
              <option value="middle">${escapeHtml(knowledgeLayerLabel('middle'))}</option>
              <option value="outer">${escapeHtml(knowledgeLayerLabel('outer'))}</option>
            </select>
            <div class="knowledge-create-help">${escapeHtml(knowledgeLayerLabel('inner'))}: ${escapeHtml(knowledgeLayerHelp('inner'))}<br><br>${escapeHtml(knowledgeLayerLabel('middle'))}: ${escapeHtml(knowledgeLayerHelp('middle'))}<br><br>${escapeHtml(knowledgeLayerLabel('outer'))}: ${escapeHtml(knowledgeLayerHelp('outer'))}</div>
          </div>
          <div class="knowledge-create-field">
            <label for="standaloneDescription">${escapeHtml(systemUiText('create.content'))}</label>
            <textarea id="standaloneDescription" data-create-description placeholder="${escapeHtml(systemUiText('create.contentPlaceholder'))}"></textarea>
          </div>
          <div class="knowledge-create-note">${escapeHtml(systemUiText('create.standaloneNote'))}</div>
        </div>
        ${this.footerMarkup(systemUiText('create.submitKnowledge'))}
      </section>
    `;
  }

  private reasoningMarkup(): string {
    return `
      <section class="knowledge-create-modal reasoning" role="dialog" aria-modal="true" aria-labelledby="knowledgeCreateTitle">
        <header class="knowledge-create-header">
          <h3 id="knowledgeCreateTitle">${escapeHtml(systemUiText('create.addReasoning'))}</h3>
          <button type="button" class="knowledge-create-close" data-create-close aria-label="${escapeHtml(systemUiText('common.close'))}">✕</button>
        </header>
        <div class="knowledge-create-body">
          <div class="knowledge-create-field">
            <label for="reasoningTitle">${escapeHtml(systemUiText('create.reasoningName'))}</label>
            <input id="reasoningTitle" data-create-title type="text" autocomplete="off" placeholder="${escapeHtml(systemUiText('create.reasoningNamePlaceholder'))}">
          </div>
          ${this.pickerMarkup('premise', systemUiText('create.premise'), systemUiText('create.searchPremise'))}
          <div class="knowledge-create-field">
            <label for="reasoningBody">${escapeHtml(systemUiText('type.reasoning'))}</label>
            <textarea id="reasoningBody" data-create-reasoning placeholder="${escapeHtml(systemUiText('create.reasoningBodyPlaceholder'))}"></textarea>
          </div>
          ${this.pickerMarkup('conclusion', systemUiText('create.conclusionSingle'), systemUiText('create.searchConclusion'))}
          <div class="knowledge-create-note">${escapeHtml(systemUiText('create.reasoningSingleConclusionNote'))}</div>
        </div>
        ${this.footerMarkup(systemUiText('create.submitReasoning'))}
      </section>
    `;
  }

  private footerMarkup(label: string): string {
    return `
      <footer class="knowledge-create-footer">
        <button type="button" class="btn" data-create-cancel>${escapeHtml(systemUiText('common.cancel'))}</button>
        <button type="button" class="btn primary" data-create-submit>${escapeHtml(label)}</button>
      </footer>
    `;
  }

  private pickerMarkup(kind: PickerKind, label: string, placeholder: string): string {
    return `
      <div class="knowledge-create-field knowledge-picker" data-picker="${kind}">
        <label>${escapeHtml(label)}</label>
        <div class="knowledge-picker-selected" data-picker-selected aria-live="polite"></div>
        <input type="search" data-picker-search autocomplete="off" placeholder="${escapeHtml(placeholder)}">
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
      if (selected.has(id)) {
        selected.delete(id);
      } else {
        if (kind === 'conclusion') selected.clear();
        selected.add(id);
      }
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
          return `<button type="button" class="knowledge-picker-chip" data-picker-node-id="${escapeHtml(node.id)}" title="${escapeHtml(systemUiText('create.remove'))}">${escapeHtml(node.title)} <span>×</span></button>`;
        }).join('')
      : `<span class="knowledge-picker-empty">${escapeHtml(systemUiText('create.noneSelected'))}</span>`;

    const needle = canonicalSearch(query);
    const matching = eligible.filter(node => {
      if (!needle) return true;
      return canonicalSearch(`${node.title} ${node.id}`).includes(needle);
    });
    matching.sort((left, right) => {
      const selectedOrder = Number(selected.has(right.id)) - Number(selected.has(left.id));
      return selectedOrder || left.title.localeCompare(right.title, getLocale());
    });

    optionsContainer.innerHTML = matching.length
      ? matching.map(node => {
          const active = selected.has(node.id);
          return `
            <button type="button" class="knowledge-picker-option${active ? ' selected' : ''}" data-picker-node-id="${escapeHtml(node.id)}" aria-pressed="${active}">
              <span>${escapeHtml(node.title)}</span>
              <small>${escapeHtml(systemUiText(active ? 'create.selectedCancel' : 'create.select'))}</small>
            </button>
          `;
        }).join('')
      : `<div class="knowledge-picker-no-results">${escapeHtml(systemUiText('create.noExisting'))}</div>`;
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
      this.notify(systemUiText('create.nameRequired'));
      return;
    }

    submit && (submit.disabled = true);
    try {
      if (this.mode === 'standalone') {
        const layerValue = this.root.querySelector<HTMLSelectElement>('[data-create-layer]')?.value ?? '';
        const description = this.root.querySelector<HTMLTextAreaElement>('[data-create-description]')?.value.trim() ?? '';
        if (!isUserKnowledgeLayer(layerValue)) throw new Error(systemUiText('create.layerRequired'));
        if (!description) throw new Error(systemUiText('create.contentRequired'));
        await this.onCreateStandalone({ title, layer: layerValue, description });
        this.close();
        this.notify(systemUiText('create.nodeSubmitted', { title }));
        return;
      }

      const reasoning = this.root.querySelector<HTMLTextAreaElement>('[data-create-reasoning]')?.value.trim() ?? '';
      const currentPremiseIds = new Set(this.eligibleNodes('premise').map(node => node.id));
      const currentConclusionIds = new Set(this.eligibleNodes('conclusion').map(node => node.id));
      const premiseIds = [...this.selectedPremises].filter(id => currentPremiseIds.has(id));
      const conclusionIds = [...this.selectedConclusions].filter(id => currentConclusionIds.has(id));
      if (premiseIds.length === 0) throw new Error(systemUiText('create.premiseRequired'));
      if (!reasoning) throw new Error(systemUiText('create.reasoningRequired'));
      if (conclusionIds.length !== 1) throw new Error(systemUiText('create.conclusionSingleRequired'));
      if (premiseIds.includes(conclusionIds[0]!)) {
        throw new Error(systemUiText('create.sameNodeError'));
      }
      await this.onCreateReasoning({ title, premiseIds, reasoning, conclusionIds });
      this.close();
      this.notify(systemUiText('create.reasoningSubmitted', { title }));
    } catch (error) {
      console.error('[Knowledge-Ball] knowledge creation failed:', error);
      this.notify(error instanceof Error ? error.message : systemUiText('create.submitFailed'));
      if (submit) submit.disabled = false;
    }
  }

  private notify(message: string): void {
    this.onToast?.(message);
  }
}
