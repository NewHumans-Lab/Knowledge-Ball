import {
  createProductionAuthClient,
  type PendingKnowledgeVoteSnapshot,
  type PendingVoteSide,
} from '../../auth/AuthClient';
import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import type { NodeDetailNode } from './NodeDetailController';

const REFRESH_MS = 3_000;

export interface NodeDetailLineageUiOptions {
  getNodeById: (id: string) => NodeDetailNode | null;
}

/**
 * Narrow V3 enhancement for the single NodeDetailController surface.
 *
 * NodeDetailController remains the sole renderer/lifecycle owner for the detail
 * itself, initial V2 voting and human V1 revalidation. This helper only maps the
 * two head-changing action labels to their immutable-lineage meaning and owns
 * the server-created CASCADE pending-vote interaction for disputed CURRENT nodes.
 */
export class NodeDetailLineageUi {
  private readonly getNodeById: NodeDetailLineageUiOptions['getNodeById'];
  private currentId: string | null = null;
  private refreshTimer: number | null = null;
  private renderToken = 0;

  constructor(options: NodeDetailLineageUiOptions) {
    this.getNodeById = options.getNodeById;
  }

  open(nodeId: string): void {
    this.currentId = nodeId;
    this.clearRefresh();
    const token = ++this.renderToken;
    this.relabelActions();
    void this.refreshSnapshot(nodeId, token);
  }

  refresh(nodeId: string): void {
    if (this.currentId !== nodeId) {
      this.open(nodeId);
      return;
    }
    this.clearRefresh();
    const token = ++this.renderToken;
    this.relabelActions();
    void this.refreshSnapshot(nodeId, token);
  }

  close(): void {
    this.currentId = null;
    this.clearRefresh();
    this.renderToken++;
  }

  private relabelActions(): void {
    const root = document.getElementById('nodeDetailOverlay');
    const optimize = root?.querySelector<HTMLButtonElement>('[data-node-detail-action="edit"]');
    const oppose = root?.querySelector<HTMLButtonElement>('[data-node-detail-action="negate"]');
    if (optimize) optimize.textContent = '优化';
    if (oppose) oppose.textContent = '提出对立观点';
  }

  private async refreshSnapshot(nodeId: string, token: number): Promise<void> {
    const node = this.getNodeById(nodeId);
    if (!node || node.status !== 'disputed' || lineageRoleFor(node) !== 'current') return;
    const account = createProductionAuthClient();
    if (!account) return;

    try {
      const snapshot = await account.getPendingKnowledgeVote(nodeId);
      if (!this.isCurrent(nodeId, token)) return;
      // Human ORIGINAL_DESIGN_V1 revalidation uses a separate RPC/table family.
      // A V1 round returned by the generic pending-vote RPC is the server-created
      // CASCADE round and has no creator/initiator lock.
      if (snapshot.policyVersion !== 'ORIGINAL_DESIGN_V1') return;
      this.renderSnapshot(snapshot, token);
    } catch {
      // A manually disputed current node can legitimately have no cascade round.
      // In that case NodeDetailController's waiting message remains authoritative.
    }
  }

  private renderSnapshot(snapshot: PendingKnowledgeVoteSnapshot, token: number): void {
    if (!this.isCurrent(snapshot.nodeId, token)) return;
    const root = document.getElementById('nodeDetailOverlay');
    const existing = root?.querySelector<HTMLElement>('.node-detail-cascade-status, .node-detail-cascade-vote');
    if (!root || !existing) return;

    const open = snapshot.verdict === 'PENDING';
    existing.outerHTML = `
      <div class="node-detail-vote node-detail-interaction node-detail-cascade-vote">
        <div class="node-detail-vote-title">自动级联重审</div>
        <div class="node-detail-vote-actions">
          <button type="button" class="node-detail-vote-button agree" data-cascade-vote-side="AGREE"><span>同意</span><small>能量 −1</small></button>
          <button type="button" class="node-detail-vote-button disagree" data-cascade-vote-side="DISAGREE"><span>反对</span><small>能量 −1</small></button>
        </div>
        <div class="node-detail-vote-status" role="status" aria-live="polite"></div>
      </div>
    `;

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-cascade-vote-side]'));
    for (const button of buttons) {
      const side = button.dataset.cascadeVoteSide as PendingVoteSide | undefined;
      button.classList.toggle('active', Boolean(snapshot.mySide && side === snapshot.mySide));
      button.disabled = !open || snapshot.mySide !== null;
      button.addEventListener('click', () => {
        if (side === 'AGREE' || side === 'DISAGREE') void this.castVote(snapshot.nodeId, side, token);
      });
    }

    const status = root.querySelector<HTMLElement>('.node-detail-cascade-vote .node-detail-vote-status');
    if (status) {
      const tally = `同意 ${snapshot.agreeCount}/${snapshot.requiredVotes} · 反对 ${snapshot.disagreeCount}/${snapshot.requiredVotes}`;
      if (!open) {
        const reason = snapshot.closeReason === 'TIMEOUT' ? '时间到期' : '达到票数';
        status.textContent = `${snapshot.verdict === 'CORRECT' ? '级联重审通过' : '级联重审未通过，知识已悬置'} · ${reason} · ${tally}`;
      } else if (snapshot.mySide) {
        status.textContent = `已投${snapshot.mySide === 'AGREE' ? '同意' : '反对'} · ${tally}`;
      } else {
        status.textContent = `无发起人、无发起人票 · ${tally}`;
      }
    }

    if (open) this.scheduleRefresh(snapshot.nodeId, token);
    else this.signalFinalized(snapshot);
  }

  private async castVote(nodeId: string, side: PendingVoteSide, token: number): Promise<void> {
    if (!this.isCurrent(nodeId, token)) return;
    const account = createProductionAuthClient();
    if (!account) return;
    this.clearRefresh();

    const root = document.getElementById('nodeDetailOverlay');
    const buttons = Array.from(root?.querySelectorAll<HTMLButtonElement>('[data-cascade-vote-side]') ?? []);
    buttons.forEach(button => { button.disabled = true; });
    const status = root?.querySelector<HTMLElement>('.node-detail-cascade-vote .node-detail-vote-status');
    if (status) status.textContent = `${side === 'AGREE' ? '同意' : '反对'}票提交中 · 能量 −1…`;

    try {
      const snapshot = await account.castPendingKnowledgeVote(nodeId, side);
      if (!this.isCurrent(nodeId, token)) return;
      if (snapshot.policyVersion !== 'ORIGINAL_DESIGN_V1') return;
      this.renderSnapshot(snapshot, token);
    } catch (error) {
      if (!this.isCurrent(nodeId, token)) return;
      if (status) status.textContent = error instanceof Error ? `投票失败：${error.message}` : '投票失败';
      this.scheduleRefresh(nodeId, token);
    }
  }

  private scheduleRefresh(nodeId: string, token: number): void {
    this.clearRefresh();
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (!this.isCurrent(nodeId, token)) return;
      void this.refreshSnapshot(nodeId, token);
    }, REFRESH_MS);
  }

  private signalFinalized(snapshot: PendingKnowledgeVoteSnapshot): void {
    this.clearRefresh();
    window.dispatchEvent(new CustomEvent('knowledge-ball:verdict-finalized', {
      detail: { nodeId: snapshot.nodeId, verdict: snapshot.verdict, cascade: true },
    }));
  }

  private clearRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private isCurrent(nodeId: string, token: number): boolean {
    const root = document.getElementById('nodeDetailOverlay');
    return token === this.renderToken
      && this.currentId === nodeId
      && root?.dataset.nodeId === nodeId
      && root.classList.contains('open');
  }
}
