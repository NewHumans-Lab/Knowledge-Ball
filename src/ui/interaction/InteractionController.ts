import { STATUS_LABEL, TYPE_LABEL, type KnowledgeMastery, type KnowledgeNodeStatus, type KnowledgeNodeType } from '../config/KnowledgeUiConfig';
import type { KnowledgeSceneRuntime } from '../scene/KnowledgeScene';

export interface InteractionNodeSummary {
  id: string;
  title: string;
  type: KnowledgeNodeType;
  status: KnowledgeNodeStatus;
  mastery: KnowledgeMastery;
  reasoning: string;
}

export interface InteractionControllerOptions {
  scene: KnowledgeSceneRuntime;
  getNodes: () => InteractionNodeSummary[];

  searchInput: HTMLInputElement;
  searchResults: HTMLElement;

  personalButton?: HTMLButtonElement;
  settingsButton?: HTMLButtonElement;
  nodeRadiusInput?: HTMLInputElement;
  labelBrightnessInput?: HTMLInputElement;
  hideUntouchedButton?: HTMLButtonElement;

  onPickNode: (id: string) => void;
  onOpenCreateNode?: () => void;
  onOpenSettings?: () => void;
}

type Unbind = () => void;

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class InteractionController {
  private readonly scene: KnowledgeSceneRuntime;
  private readonly getNodes: () => InteractionNodeSummary[];
  private readonly searchInput: HTMLInputElement;
  private readonly searchResults: HTMLElement;
  private readonly personalButton?: HTMLButtonElement;
  private readonly settingsButton?: HTMLButtonElement;
  private readonly nodeRadiusInput?: HTMLInputElement;
  private readonly labelBrightnessInput?: HTMLInputElement;
  private readonly hideUntouchedButton?: HTMLButtonElement;
  private readonly onPickNode: (id: string) => void;
  private readonly onOpenCreateNode?: () => void;
  private readonly onOpenSettings?: () => void;

  private hideUntouched = false;
  private unbinders: Unbind[] = [];

  constructor(options: InteractionControllerOptions) {
    this.scene = options.scene;
    this.getNodes = options.getNodes;
    this.searchInput = options.searchInput;
    this.searchResults = options.searchResults;
    this.personalButton = options.personalButton;
    this.settingsButton = options.settingsButton;
    this.nodeRadiusInput = options.nodeRadiusInput;
    this.labelBrightnessInput = options.labelBrightnessInput;
    this.hideUntouchedButton = options.hideUntouchedButton;
    this.onPickNode = options.onPickNode;
    this.onOpenCreateNode = options.onOpenCreateNode;
    this.onOpenSettings = options.onOpenSettings;

    this.bind();
  }

  destroy(): void {
    this.unbinders.forEach(unbind => unbind());
    this.unbinders = [];
  }

  setHideUntouched(enabled: boolean): void {
    this.hideUntouched = enabled;
    this.scene.setHideUntouched(enabled);
    if (this.personalButton) {
      this.personalButton.classList.toggle('active', enabled);
    }
    if (this.hideUntouchedButton) {
      this.hideUntouchedButton.classList.toggle('active', enabled);
    }
  }

  private bind(): void {
    const onInput = () => this.renderSearchResults();
    const onFocus = () => this.renderSearchResults();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.pickFirstMatch();
      } else if (e.key === 'Escape') {
        this.searchInput.value = '';
        this.searchResults.classList.remove('show');
        this.searchResults.innerHTML = '';
      }
    };

    this.searchInput.addEventListener('input', onInput);
    this.searchInput.addEventListener('focus', onFocus);
    this.searchInput.addEventListener('keydown', onKeyDown);

    this.unbinders.push(() => {
      this.searchInput.removeEventListener('input', onInput);
      this.searchInput.removeEventListener('focus', onFocus);
      this.searchInput.removeEventListener('keydown', onKeyDown);
    });

    const onResultsClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const item = target?.closest<HTMLElement>('[data-node-id]');
      if (!item) return;
      const id = item.dataset.nodeId;
      if (!id) return;
      this.onPickNode(id);
      this.searchInput.value = '';
      this.searchResults.classList.remove('show');
      this.searchResults.innerHTML = '';
    };

    this.searchResults.addEventListener('click', onResultsClick);
    this.unbinders.push(() => this.searchResults.removeEventListener('click', onResultsClick));

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest('.ai-bar-inner')) {
        this.searchResults.classList.remove('show');
      }
    };

    document.addEventListener('click', onDocClick);
    this.unbinders.push(() => document.removeEventListener('click', onDocClick));

    if (this.personalButton) {
      const onPersonalClick = () => this.setHideUntouched(!this.hideUntouched);
      this.personalButton.addEventListener('click', onPersonalClick);
      this.unbinders.push(() => this.personalButton?.removeEventListener('click', onPersonalClick));
    }

    if (this.hideUntouchedButton) {
      const onHideToggle = () => this.setHideUntouched(!this.hideUntouched);
      this.hideUntouchedButton.addEventListener('click', onHideToggle);
      this.unbinders.push(() => this.hideUntouchedButton?.removeEventListener('click', onHideToggle));
    }

    if (this.settingsButton && this.onOpenSettings) {
      const onSettingsClick = () => this.onOpenSettings?.();
      this.settingsButton.addEventListener('click', onSettingsClick);
      this.unbinders.push(() => this.settingsButton?.removeEventListener('click', onSettingsClick));
    }

    if (this.nodeRadiusInput) {
      const onNodeRadiusInput = () => {
        const value = Number.parseFloat(this.nodeRadiusInput!.value);
        if (Number.isFinite(value)) this.scene.setNodeRadius(value);
      };
      this.nodeRadiusInput.addEventListener('input', onNodeRadiusInput);
      this.unbinders.push(() => this.nodeRadiusInput?.removeEventListener('input', onNodeRadiusInput));
    }

    if (this.labelBrightnessInput) {
      const onLabelBrightnessInput = () => {
        const value = Number.parseFloat(this.labelBrightnessInput!.value);
        if (Number.isFinite(value)) this.scene.setLabelBrightness(value / 100);
      };
      this.labelBrightnessInput.addEventListener('input', onLabelBrightnessInput);
      this.unbinders.push(() => this.labelBrightnessInput?.removeEventListener('input', onLabelBrightnessInput));
    }

    if (this.onOpenCreateNode) {
      const onCreateKey = (e: KeyboardEvent) => {
        if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.onOpenCreateNode?.();
        }
      };
      window.addEventListener('keydown', onCreateKey);
      this.unbinders.push(() => window.removeEventListener('keydown', onCreateKey));
    }
  }

  private renderSearchResults(): void {
    const q = this.searchInput.value.trim().toLowerCase();
    if (!q) {
      this.searchResults.classList.remove('show');
      this.searchResults.innerHTML = '';
      return;
    }

    const matches = this.getNodes().filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.reasoning.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q)
    );

    if (matches.length === 0) {
      this.searchResults.innerHTML = '<div class="search-item" style="color:var(--ink-faint)">未找到匹配的知识节点</div>';
      this.searchResults.classList.add('show');
      return;
    }

    this.searchResults.innerHTML = matches.slice(0, 8).map(n => `
      <div class="search-item" data-node-id="${escapeHtml(n.id)}">
        <span>${escapeHtml(n.title)}</span>
        <small>${TYPE_LABEL[n.type]} · ${STATUS_LABEL[n.status]}</small>
      </div>
    `).join('');

    this.searchResults.classList.add('show');
  }

  private pickFirstMatch(): void {
    const q = this.searchInput.value.trim().toLowerCase();
    if (!q) return;

    const match = this.getNodes().find(n =>
      n.title.toLowerCase().includes(q) ||
      n.reasoning.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q)
    );

    if (!match) return;
    this.onPickNode(match.id);
    this.searchResults.classList.remove('show');
    this.searchResults.innerHTML = '';
  }
}