import './NodeDetailPanel.css';
import type { KnowledgeNodeStatus, KnowledgeNodeType } from '../config/KnowledgeUiConfig';

export type NodeDetailAction = 'edit' | 'derive' | 'negate' | 'decompose' | 'merge' | 'resolve' | 'dispute';

export interface NodeDetailNode {
  id: string;
  title: string;
  type: KnowledgeNodeType;
  status: KnowledgeNodeStatus;
  reasoning: string;
}

export interface NodeDetailMetadata {
  contributor: string;
  createdAt: string;
}

export interface NodeDetailControllerOptions {
  getNodeById: (id: string) => NodeDetailNode | null;
  getMetadata: (id: string) => NodeDetailMetadata | null;
  getScreenPosition: (id: string) => { x: number; y: number } | null;
  getActions: (id: string) => NodeDetailAction[];
  onAction: (id: string, action: NodeDetailAction) => void;
  onDetailNodeChange: (id: string | null) => void;
  onClose?: () => void;
}

const ACTION_LABEL: Readonly<Record<NodeDetailAction, string>> = Object.freeze({
  edit: '修改内容',
  derive: '基于此新增',
  negate: '否定',
  decompose: '分解',
  merge: '合并',
  resolve: '重新验证',
  dispute: '争议',
});

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatNodeContributionTime(value: string | undefined | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replaceAll('/', '-');
}

export class NodeDetailController {
  private readonly getNodeById: NodeDetailControllerOptions['getNodeById'];
  private readonly getMetadata: NodeDetailControllerOptions['getMetadata'];
  private readonly getScreenPosition: NodeDetailControllerOptions['getScreenPosition'];
  private readonly getActions: NodeDetailControllerOptions['getActions'];
  private readonly onAction: NodeDetailControllerOptions['onAction'];
  private readonly onDetailNodeChange: NodeDetailControllerOptions['onDetailNodeChange'];
  private readonly onClose?: NodeDetailControllerOptions['onClose'];
  private readonly root: HTMLElement;
  private currentId: string | null = null;
  private positionFrame: number | null = null;

  constructor(options: NodeDetailControllerOptions) {
    this.getNodeById = options.getNodeById;
    this.getMetadata = options.getMetadata;
    this.getScreenPosition = options.getScreenPosition;
    this.getActions = options.getActions;
    this.onAction = options.onAction;
    this.onDetailNodeChange = options.onDetailNodeChange;
    this.onClose = options.onClose;
    this.root = document.createElement('section');
    this.root.id = 'nodeDetailOverlay';
    this.root.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.root);
    window.addEventListener('resize', this.positionCurrent, { passive: true });
  }

  isOpen(): boolean {
    return this.currentId !== null && this.root.classList.contains('open');
  }

  isOpenFor(id: string): boolean {
    return this.isOpen() && this.currentId === id;
  }

  open(id: string): void {
    const node = this.getNodeById(id);
    if (!node) return;
    this.currentId = id;
    this.onDetailNodeChange(id);
    this.render(node);
    this.root.classList.add('open');
    this.positionCurrent();
    this.startPositionTracking();
  }

  refresh(id = this.currentId): void {
    if (!id || id !== this.currentId) return;
    const node = this.getNodeById(id);
    if (!node) {
      this.close();
      return;
    }
    this.render(node);
    this.positionCurrent();
  }

  close(): void {
    if (!this.currentId && !this.root.classList.contains('open')) return;
    this.currentId = null;
    this.root.classList.remove('open');
    this.root.innerHTML = '';
    this.stopPositionTracking();
    this.onDetailNodeChange(null);
    this.onClose?.();
  }

  destroy(): void {
    this.close();
    window.removeEventListener('resize', this.positionCurrent);
    this.root.remove();
  }

  private render(node: NodeDetailNode): void {
    const metadata = this.getMetadata(node.id);
    const contributor = metadata?.contributor || '—';
    const time = formatNodeContributionTime(metadata?.createdAt);
    const actions = this.getActions(node.id);
    this.root.innerHTML = `
      <button type="button" class="node-detail-close" aria-label="关闭知识节点详情">×</button>
      <h2 class="node-detail-title">${escapeHtml(node.title)}</h2>
      <div class="node-detail-meta">
        <span>贡献者 · <b>${escapeHtml(contributor)}</b></span>
        <span>时间 · <b>${escapeHtml(time)}</b></span>
      </div>
      <div class="node-detail-content-label">内容</div>
      <div class="node-detail-content">${escapeHtml(node.reasoning || '（未填写）')}</div>
      <button type="button" class="node-detail-edit" aria-expanded="false">编辑</button>
      <div class="node-detail-edit-menu" hidden></div>
    `;

    this.root.querySelector<HTMLButtonElement>('.node-detail-close')?.addEventListener('click', () => this.close());
    const editButton = this.root.querySelector<HTMLButtonElement>('.node-detail-edit');
    const menu = this.root.querySelector<HTMLElement>('.node-detail-edit-menu');
    editButton?.addEventListener('click', () => {
      if (!menu) return;
      menu.hidden = !menu.hidden;
      editButton.setAttribute('aria-expanded', String(!menu.hidden));
    });
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = ACTION_LABEL[action];
      button.dataset.nodeDetailAction = action;
      button.addEventListener('click', () => {
        const id = this.currentId;
        if (!id) return;
        this.close();
        this.onAction(id, action);
      });
      menu?.appendChild(button);
    }
  }

  private startPositionTracking(): void {
    this.stopPositionTracking();
    const tick = () => {
      if (!this.currentId || !this.root.classList.contains('open')) return;
      this.positionCurrent();
      this.positionFrame = requestAnimationFrame(tick);
    };
    this.positionFrame = requestAnimationFrame(tick);
  }

  private stopPositionTracking(): void {
    if (this.positionFrame !== null) cancelAnimationFrame(this.positionFrame);
    this.positionFrame = null;
  }

  private positionCurrent = (): void => {
    if (!this.currentId || !this.root.classList.contains('open')) return;
    const point = this.getScreenPosition(this.currentId);
    const halfWidth = Math.min(window.innerWidth * .30, 120);
    const halfHeight = 180;
    const x = Math.max(halfWidth + 6, Math.min(window.innerWidth - halfWidth - 6, point?.x ?? window.innerWidth / 2));
    const y = Math.max(halfHeight + 8, Math.min(window.innerHeight - halfHeight - 8, point?.y ?? window.innerHeight / 2));
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
  };
}
