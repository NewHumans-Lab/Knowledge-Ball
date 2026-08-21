import './NodeDetailPanel.css';
import {
  createProductionAuthClient,
  type PendingKnowledgeVoteSnapshot,
  type PendingVoteSide,
} from '../../auth/AuthClient';
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
  actorId: string;
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
const LABEL_SWITCH_CLASS = 'node-detail-labels-off';
const VOTE_REFRESH_MS = 3_000;
let voteAccount: ReturnType<typeof createProductionAuthClient> | undefined;

function currentVoteAccount(): ReturnType<typeof createProductionAuthClient> {
  if (voteAccount !== undefined) return voteAccount;
  if (typeof window === 'undefined') return null;
  voteAccount = createProductionAuthClient();
  return voteAccount;
}

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
  private voteRefreshTimer: number | null = null;
  private voteRenderToken = 0;

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
    this.setKnowledgeLabelsVisible(false);
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
    const wasOpen = this.currentId !== null || this.root.classList.contains('open');
    this.setKnowledgeLabelsVisible(true);
    this.clearVoteRefresh();
    this.voteRenderToken++;
    if (!wasOpen) return;
    this.currentId = null;
    this.root.classList.remove('open');
    this.root.innerHTML = '';
    this.root.removeAttribute('data-node-id');
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
    this.clearVoteRefresh();
    const token = ++this.voteRenderToken;
    const metadata = this.getMetadata(node.id);
    const contributor = metadata?.contributor || '—';
    const time = formatNodeContributionTime(metadata?.createdAt);
    const actions = this.getActions(node.id);
    const account = node.status === 'pending' ? currentVoteAccount() : null;
    const interaction = node.status === 'pending'
      ? `
        <div class="node-detail-vote">
          <div class="node-detail-vote-title">投票</div>
          <div class="node-detail-vote-actions">
            <button type="button" class="node-detail-vote-button agree" data-vote-side="AGREE" disabled><span>同意</span><small>能量 −1</small></button>
            <button type="button" class="node-detail-vote-button disagree" data-vote-side="DISAGREE" disabled><span>反对</span><small>能量 −1</small></button>
          </div>
          <div class="node-detail-vote-status" role="status" aria-live="polite">${account ? '正在同步投票状态…' : '共享服务未配置，暂不能投票'}</div>
        </div>
      `
      : `
        <button type="button" class="node-detail-edit" aria-expanded="false">编辑</button>
        <div class="node-detail-edit-menu" hidden></div>
      `;

    this.root.dataset.nodeId = node.id;
    delete this.root.dataset.voteCreator;
    this.root.innerHTML = `
      <button type="button" class="node-detail-close" aria-label="关闭知识节点详情">×</button>
      <h2 class="node-detail-title">${escapeHtml(node.title)}</h2>
      <div class="node-detail-content">${escapeHtml(node.reasoning || '（未填写）')}</div>
      ${interaction}
      <div class="node-detail-meta">
        <span>贡献者 · <b>${escapeHtml(contributor)}</b></span>
        <span>时间 · <b>${escapeHtml(time)}</b></span>
      </div>
    `;

    this.root.querySelector<HTMLButtonElement>('.node-detail-close')?.addEventListener('click', () => this.close());

    if (node.status === 'pending') {
      void this.bindPendingVote(node.id, token, account, metadata?.actorId);
      return;
    }

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

  private async bindPendingVote(
    nodeId: string,
    token: number,
    account: ReturnType<typeof createProductionAuthClient>,
    creatorActorId: string | undefined,
  ): Promise<void> {
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-vote-side]'));
    if (!account) {
      buttons.forEach(button => { button.disabled = true; });
      return;
    }

    if (creatorActorId) {
      try {
        const actorId = await account.currentUserId();
        if (!this.isCurrentVote(nodeId, token)) return;
        if (actorId === creatorActorId) this.root.dataset.voteCreator = '1';
      } catch {
        if (!this.isCurrentVote(nodeId, token)) return;
        const status = this.root.querySelector<HTMLElement>('.node-detail-vote-status');
        if (status) status.textContent = '身份确认失败，暂不能投票';
        return;
      }
    }

    if (this.root.dataset.voteCreator !== '1') {
      buttons.forEach(button => button.addEventListener('click', () => {
        const side = button.dataset.voteSide as PendingVoteSide | undefined;
        if (side === 'AGREE' || side === 'DISAGREE') void this.castPendingVote(nodeId, side, token);
      }));
    }
    await this.refreshPendingVote(nodeId, token);
  }

  private async refreshPendingVote(nodeId: string, token: number): Promise<void> {
    const account = currentVoteAccount();
    if (!account || !this.isCurrentVote(nodeId, token)) return;
    try {
      const snapshot = await account.getPendingKnowledgeVote(nodeId);
      if (!this.isCurrentVote(nodeId, token)) return;
      this.applyVoteSnapshot(snapshot);
      if (snapshot.verdict === 'PENDING') this.scheduleVoteRefresh(nodeId, token);
      else this.handleFinalizedVote(snapshot);
    } catch (error) {
      if (!this.isCurrentVote(nodeId, token)) return;
      const status = this.root.querySelector<HTMLElement>('.node-detail-vote-status');
      if (status) status.textContent = error instanceof Error ? `同步失败：${error.message}` : '投票状态同步失败';
      if (document.visibilityState !== 'hidden') this.scheduleVoteRefresh(nodeId, token);
    }
  }

  private async castPendingVote(nodeId: string, side: PendingVoteSide, token: number): Promise<void> {
    const account = currentVoteAccount();
    if (!account || !this.isCurrentVote(nodeId, token) || this.root.dataset.voteBusy === '1') return;
    this.root.dataset.voteBusy = '1';
    this.clearVoteRefresh();
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-vote-side]'));
    buttons.forEach(button => { button.disabled = true; });
    const status = this.root.querySelector<HTMLElement>('.node-detail-vote-status');
    if (status) status.textContent = `${side === 'AGREE' ? '同意' : '反对'}票提交中 · 能量 −1…`;
    try {
      const snapshot = await account.castPendingKnowledgeVote(nodeId, side);
      if (!this.isCurrentVote(nodeId, token)) return;
      this.applyVoteSnapshot(snapshot, true);
      if (snapshot.verdict === 'PENDING') this.scheduleVoteRefresh(nodeId, token);
      else this.handleFinalizedVote(snapshot);
    } catch (error) {
      if (!this.isCurrentVote(nodeId, token)) return;
      if (status) status.textContent = error instanceof Error ? `投票失败：${error.message}` : '投票失败';
      buttons.forEach(button => { button.disabled = false; });
      this.scheduleVoteRefresh(nodeId, token);
    } finally {
      delete this.root.dataset.voteBusy;
    }
  }

  private applyVoteSnapshot(snapshot: PendingKnowledgeVoteSnapshot, justVoted = false): void {
    const open = snapshot.verdict === 'PENDING';
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-vote-side]'));
    for (const button of buttons) {
      const side = button.dataset.voteSide as PendingVoteSide | undefined;
      button.classList.toggle('active', Boolean(snapshot.mySide && side === snapshot.mySide));
      button.disabled = !open || snapshot.mySide !== null || this.root.dataset.voteCreator === '1';
    }
    const status = this.root.querySelector<HTMLElement>('.node-detail-vote-status');
    if (!status) return;
    const tally = `同意 ${snapshot.agreeCount}/${snapshot.requiredVotes} · 反对 ${snapshot.disagreeCount}/${snapshot.requiredVotes}`;
    if (!open) {
      const reason = snapshot.closeReason === 'TIMEOUT' ? '时间到期' : '达到票数';
      status.textContent = `${snapshot.verdict === 'CORRECT' ? '已判定正确' : '已判定错误'} · ${reason} · ${tally}`;
      return;
    }
    if (this.root.dataset.voteCreator === '1') {
      status.textContent = `你是该知识的提交者，不能参与本轮投票 · ${tally}`;
      return;
    }
    if (snapshot.mySide) {
      status.textContent = `${justVoted ? '投票成功 · ' : ''}已投${snapshot.mySide === 'AGREE' ? '同意' : '反对'} · ${tally}`;
    } else {
      status.textContent = tally;
    }
  }

  private handleFinalizedVote(snapshot: PendingKnowledgeVoteSnapshot): void {
    if (this.root.dataset.finalizedVote === snapshot.nodeId) return;
    this.root.dataset.finalizedVote = snapshot.nodeId;
    this.clearVoteRefresh();
    window.dispatchEvent(new CustomEvent('knowledge-ball:verdict-finalized', {
      detail: { nodeId:snapshot.nodeId, verdict:snapshot.verdict },
    }));
  }

  private scheduleVoteRefresh(nodeId: string, token: number): void {
    this.clearVoteRefresh();
    this.voteRefreshTimer = window.setTimeout(() => {
      this.voteRefreshTimer = null;
      void this.refreshPendingVote(nodeId, token);
    }, VOTE_REFRESH_MS);
  }

  private clearVoteRefresh(): void {
    if (this.voteRefreshTimer !== null) window.clearTimeout(this.voteRefreshTimer);
    this.voteRefreshTimer = null;
  }

  private isCurrentVote(nodeId: string, token: number): boolean {
    return token === this.voteRenderToken
      && this.currentId === nodeId
      && this.root.dataset.nodeId === nodeId
      && this.root.isConnected;
  }

  private setKnowledgeLabelsVisible(visible: boolean): void {
    document.documentElement.classList.toggle(LABEL_SWITCH_CLASS, !visible);
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
