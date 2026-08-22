import {
  createProductionAuthClient,
  type PendingKnowledgeVoteSnapshot,
  type PendingVoteSide,
} from '../../auth/AuthClient';
import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import {
  NodeDetailController as LegacyNodeDetailController,
  type NodeDetailControllerOptions,
} from './NodeDetailControllerLegacy';

export * from './NodeDetailControllerLegacy';

const CASCADE_REFRESH_MS = 3_000;

/**
 * Thin V3 detail adapter.
 *
 * The legacy controller still owns ordinary detail rendering, first-round V2
 * voting and human V1 gray/red revalidation. This adapter owns only the V3
 * semantic relabeling plus automatic dependency-cascade voting for a disputed
 * current node. The authoritative discriminator is the open pending-vote round:
 * ORIGINAL_DESIGN_V1 here means server-created CASCADE; human V1 reactivation
 * uses the separate knowledge_revalidation RPC/table family.
 */
export class NodeDetailController extends LegacyNodeDetailController {
  private readonly getNode: NodeDetailControllerOptions['getNodeById'];
  private cascadeTimer: number | null = null;
  private cascadeToken = 0;

  constructor(options: NodeDetailControllerOptions) {
    super(options);
    this.getNode = options.getNodeById;
  }

  override open(id: string): void {
    super.open(id);
    this.relabelLineageActions();
    this.armCascadeVoting(id);
  }

  override refresh(id?: string | null): void {
    super.refresh(id);
    this.relabelLineageActions();
    if (id) this.armCascadeVoting(id);
  }

  override close(): void {
    this.clearCascadeTimer();
    this.cascadeToken++;
    super.close();
  }

  private relabelLineageActions(): void {
    const root = document.getElementById('nodeDetailOverlay');
    const edit = root?.querySelector<HTMLButtonElement>('[data-node-detail-action="edit"]');
    const negate = root?.querySelector<HTMLButtonElement>('[data-node-detail-action="negate"]');
    if (edit) edit.textContent = '优化';
    if (negate) negate.textContent = '提出对立观点';
  }

  private armCascadeVoting(nodeId: string): void {
    this.clearCascadeTimer();
    const token = ++this.cascadeToken;
    const node = this.getNode(nodeId);
    if (!node || node.status !== 'disputed' || lineageRoleFor(node) !== 'current') return;
    const account = createProductionAuthClient();
    if (!account) return;

    void (async () => {
      try {
        const snapshot = await account.getPendingKnowledgeVote(nodeId);
        if (!this.isCurrentCascade(nodeId, token)) return;
        // First-round nodes are ORIGINAL_DESIGN_V2. Human gray/red V1 rounds use
        // a different RPC. Therefore a current disputed node + V1 pending round
        // is the automatic dependency cascade and has no creator/initiator lock.
        if (snapshot.policyVersion !== 'ORIGINAL_DESIGN_V1') return;
        this.renderCascadeVote(snapshot, token);
      } catch {
        // A manually disputed current node may have no automatic cascade round.
        // In that case the legacy "waiting for revalidation" message remains.
      }
    })();
  }

  private renderCascadeVote(snapshot: PendingKnowledgeVoteSnapshot, token: number): void {
    if (!this.isCurrentCascade(snapshot.nodeId, token)) return;
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
        if (side === 'AGREE' || side === 'DISAGREE') void this.castCascadeVote(snapshot.nodeId, side, token);
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

    if (open) this.scheduleCascadeRefresh(snapshot.nodeId, token);
    else this.signalCascadeFinalized(snapshot);
  }

  private async castCascadeVote(nodeId: string, side: PendingVoteSide, token: number): Promise<void> {
    if (!this.isCurrentCascade(nodeId, token)) return;
    const account = createProductionAuthClient();
    if (!account) return;
    const root = document.getElementById('nodeDetailOverlay');
    const buttons = Array.from(root?.querySelectorAll<HTMLButtonElement>('[data-cascade-vote-side]') ?? []);
    buttons.forEach(button => { button.disabled = true; });
    const status = root?.querySelector<HTMLElement>('.node-detail-cascade-vote .node-detail-vote-status');
    if (status) status.textContent = `${side === 'AGREE' ? '同意' : '反对'}票提交中 · 能量 −1…`;
    try {
      const snapshot = await account.castPendingKnowledgeVote(nodeId, side);
      if (!this.isCurrentCascade(nodeId, token)) return;
      this.renderCascadeVote(snapshot, token);
    } catch (error) {
      if (!this.isCurrentCascade(nodeId, token)) return;
      if (status) status.textContent = error instanceof Error ? `投票失败：${error.message}` : '投票失败';
      this.scheduleCascadeRefresh(nodeId, token);
    }
  }

  private scheduleCascadeRefresh(nodeId: string, token: number): void {
    this.clearCascadeTimer();
    this.cascadeTimer = window.setTimeout(() => {
      this.cascadeTimer = null;
      if (!this.isCurrentCascade(nodeId, token)) return;
      const account = createProductionAuthClient();
      if (!account) return;
      void account.getPendingKnowledgeVote(nodeId).then(snapshot => {
        if (!this.isCurrentCascade(nodeId, token) || snapshot.policyVersion !== 'ORIGINAL_DESIGN_V1') return;
        this.renderCascadeVote(snapshot, token);
      }).catch(() => {
        if (document.visibilityState !== 'hidden') this.scheduleCascadeRefresh(nodeId, token);
      });
    }, CASCADE_REFRESH_MS);
  }

  private signalCascadeFinalized(snapshot: PendingKnowledgeVoteSnapshot): void {
    this.clearCascadeTimer();
    window.dispatchEvent(new CustomEvent('knowledge-ball:verdict-finalized', {
      detail: { nodeId: snapshot.nodeId, verdict: snapshot.verdict, cascade: true },
    }));
  }

  private clearCascadeTimer(): void {
    if (this.cascadeTimer !== null) window.clearTimeout(this.cascadeTimer);
    this.cascadeTimer = null;
  }

  private isCurrentCascade(nodeId: string, token: number): boolean {
    const root = document.getElementById('nodeDetailOverlay');
    return token === this.cascadeToken
      && root?.dataset.nodeId === nodeId
      && root.classList.contains('open');
  }
}
