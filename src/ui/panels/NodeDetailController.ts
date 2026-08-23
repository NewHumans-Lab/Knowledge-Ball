import './NodeDetailPanel.css';
import {
  createProductionAuthClient,
  type KnowledgeRevalidationSnapshot,
  type PendingKnowledgeVoteSnapshot,
  type PendingVoteSide,
} from '../../auth/AuthClient';
import { inferLegacyDeclaredLayer } from '../../domain/KnowledgeLayerPolicy';
import type { KnowledgeLineageMeta } from '../../domain/KnowledgeLineage';
import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import type { KnowledgeRelationItem, KnowledgeRelations } from '../../domain/KnowledgeRelations';
import {
  KNOWLEDGE_HISTORY_COLOR,
  KNOWLEDGE_OPPOSITION_COLOR,
} from '../KnowledgeLineageView';
import {
  NODE_LAYER_COLOR_HEX,
  NODE_SPECIAL_COLOR_HEX,
  type KnowledgeNodeStatus,
  type KnowledgeNodeType,
} from '../config/KnowledgeUiConfig';

export type NodeDetailAction = 'edit' | 'derive' | 'derive-reasoning' | 'negate' | 'decompose' | 'merge' | 'resolve' | 'dispute';

export interface NodeDetailNode {
  id: string;
  title: string;
  type: KnowledgeNodeType;
  status: KnowledgeNodeStatus;
  reasoning: string;
  lineage?: KnowledgeLineageMeta;
}

export interface NodeDetailMetadata {
  contributor: string;
  createdAt: string;
  actorId: string;
}

export interface NodeDetailControllerOptions {
  getNodeById: (id: string) => NodeDetailNode | null;
  getMetadata: (id: string) => NodeDetailMetadata | null;
  getRelations: (id: string) => KnowledgeRelations;
  getScreenPosition: (id: string) => { x: number; y: number } | null;
  getActions: (id: string) => NodeDetailAction[];
  onAction: (id: string, action: NodeDetailAction) => void;
  onSelectRelatedNode: (id: string) => void;
  onDetailNodeChange: (id: string | null) => void;
  onClose?: () => void;
}

const ACTION_LABEL: Readonly<Record<NodeDetailAction, string>> = Object.freeze({
  edit: '优化',
  derive: '新增',
  'derive-reasoning': '新增推理',
  negate: '提出对立观点',
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

function displayEnergy(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');
}

function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0').toUpperCase()}`;
}

/**
 * The text around the ellipse is another presentation of the exact same real
 * node ball. Preserve the scene colour priority instead of assigning relation-
 * direction colours: lineage role, falsified state, structural white, then the
 * authoritative declared/effective layer.
 */
export function relationNodeTextColor(item: KnowledgeRelationItem): string | null {
  const role = lineageRoleFor(item);
  if (role === 'history' || role === 'candidate-history') return toHex(KNOWLEDGE_HISTORY_COLOR);
  if (role === 'opposition' || role === 'candidate-opposition') return toHex(KNOWLEDGE_OPPOSITION_COLOR);
  if (item.status === 'falsified') return NODE_SPECIAL_COLOR_HEX.falsified;
  if (item.type === 'reasoning' || item.type === 'logic-symbol') return NODE_SPECIAL_COLOR_HEX.structural;
  if (!item.type) return null;
  const layer = item.status === 'disputed'
    ? 'outer'
    : item.declaredLayer ?? inferLegacyDeclaredLayer({ type: item.type });
  return NODE_LAYER_COLOR_HEX[layer];
}

function relationMarkup(relations: KnowledgeRelations): string {
  const render = (
    className: string,
    relationKind: keyof KnowledgeRelations,
    label: string,
  ) => {
    const items = relations[relationKind];
    if (items.length === 0) return '';
    return `<div class="node-detail-relations ${className}" role="group" aria-label="${label}" data-relation-count="${items.length}">${items.map(item => {
      const color = relationNodeTextColor(item);
      const colorStyle = color ? ` style="--relation-node-color:${color}"` : '';
      return `<button type="button" class="node-detail-relation" data-relation-kind="${relationKind}" data-related-node-id="${escapeHtml(item.id)}" title="${escapeHtml(item.title)}"${colorStyle}>${escapeHtml(item.title)}</button>`;
    }).join('')}</div>`;
  };
  return [
    render('left', 'previous', '上一个节点'),
    render('top', 'history', '历史版本'),
    render('right', 'next', '下一个节点'),
    render('bottom', 'opposition', '否定历史'),
  ].join('');
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
  private readonly getRelations: NodeDetailControllerOptions['getRelations'];
  private readonly getScreenPosition: NodeDetailControllerOptions['getScreenPosition'];
  private readonly getActions: NodeDetailControllerOptions['getActions'];
  private readonly onAction: NodeDetailControllerOptions['onAction'];
  private readonly onSelectRelatedNode: NodeDetailControllerOptions['onSelectRelatedNode'];
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
    this.getRelations = options.getRelations;
    this.getScreenPosition = options.getScreenPosition;
    this.getActions = options.getActions;
    this.onAction = options.onAction;
    this.onSelectRelatedNode = options.onSelectRelatedNode;
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
    const account = currentVoteAccount();
    const role = lineageRoleFor(node);
    const oldLineage = role === 'history' || role === 'opposition';
    const relations = this.getRelations(node.id);

    let interaction: string;
    if (node.status === 'pending') {
      interaction = `
        <div class="node-detail-vote node-detail-interaction">
          <div class="node-detail-vote-title">投票</div>
          <div class="node-detail-vote-actions">
            <button type="button" class="node-detail-vote-button agree" data-vote-side="AGREE" disabled><span>同意</span><small>能量 −1</small></button>
            <button type="button" class="node-detail-vote-button disagree" data-vote-side="DISAGREE" disabled><span>反对</span><small>能量 −1</small></button>
          </div>
          <div class="node-detail-vote-status" role="status" aria-live="polite">${account ? '正在同步投票状态…' : '共享服务未配置，暂不能投票'}</div>
        </div>
      `;
    } else if (oldLineage && node.status === 'verified') {
      interaction = `
        <div class="node-detail-reactivation node-detail-interaction">
          <div class="node-detail-vote-title">设为当前最优</div>
          <div class="node-detail-vote-actions">
            <button type="button" class="node-detail-vote-button agree" data-reactivate-intent="1" disabled><span>同意</span><small data-reactivation-stake>能量 −10</small></button>
            <button type="button" class="node-detail-vote-button disagree" disabled><span>反对</span><small>此处不可用</small></button>
          </div>
          <div class="node-detail-confirm" hidden>
            <div>请确认该知识点为当前最优</div>
            <div class="node-detail-confirm-actions">
              <button type="button" data-reactivate-cancel>取消</button>
              <button type="button" data-reactivate-confirm>确认</button>
            </div>
          </div>
          <div class="node-detail-vote-status" role="status" aria-live="polite">${account ? '正在同步本轮能量…' : '共享服务未配置，暂不能重新验证'}</div>
        </div>
      `;
    } else if (oldLineage && node.status === 'disputed') {
      interaction = this.revalidationMarkup(null, account !== null);
    } else if (role === 'current' && node.status === 'disputed') {
      interaction = `
        <div class="node-detail-cascade-status node-detail-interaction" role="status">
          前提的当前版本已经变化，此知识正在等待重新验证。
        </div>
      `;
    } else {
      interaction = `
        <button type="button" class="node-detail-edit" aria-expanded="false">编辑</button>
        <div class="node-detail-edit-menu" hidden></div>
      `;
    }

    this.root.dataset.nodeId = node.id;
    delete this.root.dataset.voteCreator;
    delete this.root.dataset.revalidationInitiator;
    this.root.innerHTML = `
      ${relationMarkup(relations)}
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
    this.root.querySelectorAll<HTMLButtonElement>('[data-related-node-id]').forEach(button => {
      button.addEventListener('click', () => {
        const relatedId = button.dataset.relatedNodeId;
        if (!relatedId || relatedId === this.currentId) return;
        this.onSelectRelatedNode(relatedId);
      });
    });

    if (node.status === 'pending') {
      void this.bindPendingVote(node.id, token, account, metadata?.actorId);
      return;
    }

    if (oldLineage && node.status === 'verified') {
      void this.bindReactivation(node.id, token, account);
      return;
    }

    if (oldLineage && node.status === 'disputed') {
      void this.bindRevalidationVote(node.id, token, account);
      return;
    }

    if (role === 'current' && node.status === 'disputed') return;

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

  private async bindReactivation(
    nodeId: string,
    token: number,
    account: ReturnType<typeof createProductionAuthClient>,
  ): Promise<void> {
    const intent = this.root.querySelector<HTMLButtonElement>('[data-reactivate-intent]');
    const stakeLabel = this.root.querySelector<HTMLElement>('[data-reactivation-stake]');
    const confirm = this.root.querySelector<HTMLElement>('.node-detail-confirm');
    const cancel = this.root.querySelector<HTMLButtonElement>('[data-reactivate-cancel]');
    const submit = this.root.querySelector<HTMLButtonElement>('[data-reactivate-confirm]');
    const status = this.root.querySelector<HTMLElement>('.node-detail-vote-status');
    if (!account || !intent || !stakeLabel || !confirm || !submit) return;

    try {
      const quote = await account.getKnowledgeRevalidationQuote(nodeId);
      if (!this.isCurrentVote(nodeId, token)) return;
      stakeLabel.textContent = `能量 −${displayEnergy(quote.stake)}`;
      intent.disabled = false;
      if (status) status.textContent = '确认后启动重新验证';
    } catch (error) {
      if (!this.isCurrentVote(nodeId, token)) return;
      intent.disabled = true;
      if (status) status.textContent = error instanceof Error ? `同步失败：${error.message}` : '本轮能量同步失败';
      return;
    }

    intent.addEventListener('click', () => { confirm.hidden = false; });
    cancel?.addEventListener('click', () => { confirm.hidden = true; });
    submit.addEventListener('click', async () => {
      if (!this.isCurrentVote(nodeId, token) || this.root.dataset.voteBusy === '1') return;
      this.root.dataset.voteBusy = '1';
      intent.disabled = true;
      submit.disabled = true;
      if (status) status.textContent = '正在启动重新验证…';
      try {
        const snapshot = await account.startKnowledgeRevalidation(nodeId);
        if (!this.isCurrentVote(nodeId, token)) return;
        this.root.dataset.revalidationInitiator = '1';
        this.showRevalidationSnapshot(snapshot, token, account);
        window.dispatchEvent(new CustomEvent('knowledge-ball:verdict-finalized', {
          detail: { nodeId, revalidationStarted: true },
        }));
      } catch (error) {
        if (!this.isCurrentVote(nodeId, token)) return;
        intent.disabled = false;
        submit.disabled = false;
        if (status) status.textContent = error instanceof Error ? `启动失败：${error.message}` : '重新验证启动失败';
      } finally {
        delete this.root.dataset.voteBusy;
      }
    });
  }

  private revalidationMarkup(snapshot: KnowledgeRevalidationSnapshot | null, configured: boolean): string {
    const stake = snapshot ? displayEnergy(snapshot.stake) : '…';
    return `
      <div class="node-detail-revalidation node-detail-interaction">
        <div class="node-detail-vote-title">重新验证 · ORIGINAL_DESIGN_V1</div>
        <div class="node-detail-vote-actions">
          <button type="button" class="node-detail-vote-button agree" data-revalidation-side="AGREE" disabled><span>同意</span><small>能量 −${stake}</small></button>
          <button type="button" class="node-detail-vote-button disagree" data-revalidation-side="DISAGREE" disabled><span>反对</span><small>能量 −${stake}</small></button>
        </div>
        <div class="node-detail-vote-status" role="status" aria-live="polite">${configured ? '正在同步重新验证状态…' : '共享服务未配置，暂不能投票'}</div>
      </div>
    `;
  }

  private async bindRevalidationVote(
    nodeId: string,
    token: number,
    account: ReturnType<typeof createProductionAuthClient>,
  ): Promise<void> {
    if (!account) return;
    try {
      const snapshot = await account.getKnowledgeRevalidation(nodeId);
      if (!this.isCurrentVote(nodeId, token)) return;
      this.showRevalidationSnapshot(snapshot, token, account);
    } catch (error) {
      if (!this.isCurrentVote(nodeId, token)) return;
      const status = this.root.querySelector<HTMLElement>('.node-detail-vote-status');
      if (status) status.textContent = error instanceof Error ? `同步失败：${error.message}` : '重新验证状态同步失败';
    }
  }

  private showRevalidationSnapshot(
    snapshot: KnowledgeRevalidationSnapshot,
    token: number,
    account: NonNullable<ReturnType<typeof createProductionAuthClient>>,
  ): void {
    const interaction = this.root.querySelector<HTMLElement>('.node-detail-interaction');
    if (!interaction) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = this.revalidationMarkup(snapshot, true);
    interaction.replaceWith(wrapper.firstElementChild!);

    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-revalidation-side]'));
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const side = button.dataset.revalidationSide as PendingVoteSide | undefined;
        if (side === 'AGREE' || side === 'DISAGREE') void this.castRevalidationVote(snapshot.nodeId, side, token, account);
      });
    }
    this.applyRevalidationSnapshot(snapshot);
    if (snapshot.verdict === 'PENDING') this.scheduleRevalidationRefresh(snapshot.nodeId, token, account);
    else this.handleFinalizedRevalidation(snapshot);
  }

  private async refreshRevalidationVote(
    nodeId: string,
    token: number,
    account: NonNullable<ReturnType<typeof createProductionAuthClient>>,
  ): Promise<void> {
    if (!this.isCurrentVote(nodeId, token)) return;
    try {
      const snapshot = await account.getKnowledgeRevalidation(nodeId);
      if (!this.isCurrentVote(nodeId, token)) return;
      this.applyRevalidationSnapshot(snapshot);
      if (snapshot.verdict === 'PENDING') this.scheduleRevalidationRefresh(nodeId, token, account);
      else this.handleFinalizedRevalidation(snapshot);
    } catch (error) {
      if (!this.isCurrentVote(nodeId, token)) return;
      const status = this.root.querySelector<HTMLElement>('.node-detail-vote-status');
      if (status) status.textContent = error instanceof Error ? `同步失败：${error.message}` : '重新验证状态同步失败';
      if (document.visibilityState !== 'hidden') this.scheduleRevalidationRefresh(nodeId, token, account);
    }
  }

  private async castRevalidationVote(
    nodeId: string,
    side: PendingVoteSide,
    token: number,
    account: NonNullable<ReturnType<typeof createProductionAuthClient>>,
  ): Promise<void> {
    if (!this.isCurrentVote(nodeId, token) || this.root.dataset.voteBusy === '1') return;
    this.root.dataset.voteBusy = '1';
    this.clearVoteRefresh();
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-revalidation-side]'));
    buttons.forEach(button => { button.disabled = true; });
    const status = this.root.querySelector<HTMLElement>('.node-detail-vote-status');
    if (status) status.textContent = `${side === 'AGREE' ? '同意' : '反对'}票提交中…`;
    try {
      const snapshot = await account.castKnowledgeRevalidationVote(nodeId, side);
      if (!this.isCurrentVote(nodeId, token)) return;
      this.applyRevalidationSnapshot(snapshot, true);
      if (snapshot.verdict === 'PENDING') this.scheduleRevalidationRefresh(nodeId, token, account);
      else this.handleFinalizedRevalidation(snapshot);
    } catch (error) {
      if (!this.isCurrentVote(nodeId, token)) return;
      if (status) status.textContent = error instanceof Error ? `投票失败：${error.message}` : '重新验证投票失败';
      buttons.forEach(button => { button.disabled = this.root.dataset.revalidationInitiator === '1'; });
      this.scheduleRevalidationRefresh(nodeId, token, account);
    } finally {
      delete this.root.dataset.voteBusy;
    }
  }

  private applyRevalidationSnapshot(snapshot: KnowledgeRevalidationSnapshot, justVoted = false): void {
    const open = snapshot.verdict === 'PENDING';
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-revalidation-side]'));
    for (const button of buttons) {
      const side = button.dataset.revalidationSide as PendingVoteSide | undefined;
      button.querySelector('small')!.textContent = `能量 −${displayEnergy(snapshot.stake)}`;
      button.classList.toggle('active', Boolean(snapshot.mySide && side === snapshot.mySide));
      button.disabled = !open
        || snapshot.mySide !== null
        || this.root.dataset.revalidationInitiator === '1';
    }
    const status = this.root.querySelector<HTMLElement>('.node-detail-vote-status');
    if (!status) return;
    const gate = snapshot.accuracyGate === undefined ? '' : ` · 准确率≥${snapshot.accuracyGate}%`;
    const scope = snapshot.scope === 'LOCAL_10' ? 'LOCAL_10' : 'GLOBAL';
    const tally = `同意 ${snapshot.agreeCount}/${snapshot.requiredVotes} · 反对 ${snapshot.disagreeCount}/${snapshot.requiredVotes}`;
    if (!open) {
      const reason = snapshot.closeReason === 'TIMEOUT' ? '时间到期' : '达到票数';
      status.textContent = `${snapshot.verdict === 'CORRECT' ? '旧知识重新成为当前' : '当前知识保持不变'} · ${reason} · ${tally}`;
      return;
    }
    if (this.root.dataset.revalidationInitiator === '1') {
      status.textContent = `已发起 · 第 ${snapshot.stage} 阶段 · ${scope}${gate} · ${tally}`;
      return;
    }
    if (snapshot.mySide) {
      status.textContent = `${justVoted ? '投票成功 · ' : ''}已投${snapshot.mySide === 'AGREE' ? '同意' : '反对'} · ${scope}${gate} · ${tally}`;
    } else {
      status.textContent = `第 ${snapshot.stage} 阶段 · ${scope}${gate} · ${tally}`;
    }
  }

  private handleFinalizedRevalidation(snapshot: KnowledgeRevalidationSnapshot): void {
    this.clearVoteRefresh();
    window.dispatchEvent(new CustomEvent('knowledge-ball:verdict-finalized', {
      detail: { nodeId: snapshot.nodeId, verdict: snapshot.verdict, revalidation: true },
    }));
  }

  private scheduleRevalidationRefresh(
    nodeId: string,
    token: number,
    account: NonNullable<ReturnType<typeof createProductionAuthClient>>,
  ): void {
    this.clearVoteRefresh();
    this.voteRefreshTimer = window.setTimeout(() => {
      this.voteRefreshTimer = null;
      void this.refreshRevalidationVote(nodeId, token, account);
    }, VOTE_REFRESH_MS);
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
