from pathlib import Path

detail_path = Path('src/ui/panels/NodeDetailController.ts')
detail = detail_path.read_text()
anchor = "import './NodeDetailPanel.css';\n"
replacement = "import './NodeDetailPanel.css';\nimport './LineageV3Hardening.css';\n"
if detail.count(anchor) != 1:
    raise SystemExit('NodeDetailPanel css import anchor mismatch')
detail = detail.replace(anchor, replacement, 1)

old = "    if (role === 'current' && node.status === 'disputed') return;\n"
new = "    if (role === 'current' && node.status === 'disputed') {\n      void this.bindCascadeVote(node.id, token, account);\n      return;\n    }\n"
if detail.count(old) != 1:
    raise SystemExit('current disputed return anchor mismatch')
detail = detail.replace(old, new, 1)

insert_anchor = "  private async bindPendingVote(\n"
if detail.count(insert_anchor) != 1:
    raise SystemExit('bindPendingVote anchor mismatch')

cascade_methods = r'''  private async bindCascadeVote(
    nodeId: string,
    token: number,
    account: ReturnType<typeof createProductionAuthClient>,
  ): Promise<void> {
    if (!account) return;
    try {
      const snapshot = await account.getPendingKnowledgeVote(nodeId);
      if (!this.isCurrentVote(nodeId, token)) return;
      if (snapshot.roundKind !== 'CASCADE') return;
      this.showCascadeSnapshot(snapshot, token, account);
    } catch {
      // A manually disputed current node can legitimately have no cascade round.
      // Keep the controller-rendered waiting message in that case.
    }
  }

  private showCascadeSnapshot(
    snapshot: PendingKnowledgeVoteSnapshot,
    token: number,
    account: NonNullable<ReturnType<typeof createProductionAuthClient>>,
  ): void {
    if (!this.isCurrentVote(snapshot.nodeId, token)) return;
    const existing = this.root.querySelector<HTMLElement>('.node-detail-cascade-status, .node-detail-cascade-vote');
    if (!existing) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="node-detail-vote node-detail-interaction node-detail-cascade-vote">
        <div class="node-detail-vote-title">自动级联重审</div>
        <div class="node-detail-vote-actions">
          <button type="button" class="node-detail-vote-button agree" data-cascade-vote-side="AGREE"><span>同意</span><small>能量 −1</small></button>
          <button type="button" class="node-detail-vote-button disagree" data-cascade-vote-side="DISAGREE"><span>反对</span><small>能量 −1</small></button>
        </div>
        <div class="node-detail-vote-status" role="status" aria-live="polite"></div>
      </div>
    `;
    existing.replaceWith(wrapper.firstElementChild!);

    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cascade-vote-side]'));
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const side = button.dataset.cascadeVoteSide as PendingVoteSide | undefined;
        if (side === 'AGREE' || side === 'DISAGREE') void this.castCascadeVote(snapshot.nodeId, side, token, account);
      });
    }
    this.applyCascadeSnapshot(snapshot);
    if (snapshot.verdict === 'PENDING') this.scheduleCascadeRefresh(snapshot.nodeId, token, account);
    else this.handleFinalizedCascade(snapshot);
  }

  private async refreshCascadeVote(
    nodeId: string,
    token: number,
    account: NonNullable<ReturnType<typeof createProductionAuthClient>>,
  ): Promise<void> {
    if (!this.isCurrentVote(nodeId, token)) return;
    try {
      const snapshot = await account.getPendingKnowledgeVote(nodeId);
      if (!this.isCurrentVote(nodeId, token) || snapshot.roundKind !== 'CASCADE') return;
      this.applyCascadeSnapshot(snapshot);
      if (snapshot.verdict === 'PENDING') this.scheduleCascadeRefresh(nodeId, token, account);
      else this.handleFinalizedCascade(snapshot);
    } catch {
      if (!this.isCurrentVote(nodeId, token)) return;
      if (document.visibilityState !== 'hidden') this.scheduleCascadeRefresh(nodeId, token, account);
    }
  }

  private async castCascadeVote(
    nodeId: string,
    side: PendingVoteSide,
    token: number,
    account: NonNullable<ReturnType<typeof createProductionAuthClient>>,
  ): Promise<void> {
    if (!this.isCurrentVote(nodeId, token) || this.root.dataset.voteBusy === '1') return;
    this.root.dataset.voteBusy = '1';
    this.clearVoteRefresh();
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cascade-vote-side]'));
    buttons.forEach(button => { button.disabled = true; });
    const status = this.root.querySelector<HTMLElement>('.node-detail-cascade-vote .node-detail-vote-status');
    if (status) status.textContent = `${side === 'AGREE' ? '同意' : '反对'}票提交中 · 能量 −1…`;
    try {
      const snapshot = await account.castPendingKnowledgeVote(nodeId, side);
      if (!this.isCurrentVote(nodeId, token) || snapshot.roundKind !== 'CASCADE') return;
      this.applyCascadeSnapshot(snapshot);
      if (snapshot.verdict === 'PENDING') this.scheduleCascadeRefresh(nodeId, token, account);
      else this.handleFinalizedCascade(snapshot);
    } catch (error) {
      if (!this.isCurrentVote(nodeId, token)) return;
      if (status) status.textContent = error instanceof Error ? `投票失败：${error.message}` : '投票失败';
      this.scheduleCascadeRefresh(nodeId, token, account);
    } finally {
      delete this.root.dataset.voteBusy;
    }
  }

  private applyCascadeSnapshot(snapshot: PendingKnowledgeVoteSnapshot): void {
    const open = snapshot.verdict === 'PENDING';
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cascade-vote-side]'));
    for (const button of buttons) {
      const side = button.dataset.cascadeVoteSide as PendingVoteSide | undefined;
      button.classList.toggle('active', Boolean(snapshot.mySide && side === snapshot.mySide));
      button.disabled = !open || snapshot.mySide !== null;
    }
    const status = this.root.querySelector<HTMLElement>('.node-detail-cascade-vote .node-detail-vote-status');
    if (!status) return;
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

  private scheduleCascadeRefresh(
    nodeId: string,
    token: number,
    account: NonNullable<ReturnType<typeof createProductionAuthClient>>,
  ): void {
    this.clearVoteRefresh();
    this.voteRefreshTimer = window.setTimeout(() => {
      this.voteRefreshTimer = null;
      void this.refreshCascadeVote(nodeId, token, account);
    }, VOTE_REFRESH_MS);
  }

  private handleFinalizedCascade(snapshot: PendingKnowledgeVoteSnapshot): void {
    if (this.root.dataset.finalizedCascade === snapshot.nodeId) return;
    this.root.dataset.finalizedCascade = snapshot.nodeId;
    this.clearVoteRefresh();
    window.dispatchEvent(new CustomEvent('knowledge-ball:verdict-finalized', {
      detail: { nodeId: snapshot.nodeId, verdict: snapshot.verdict, cascade: true },
    }));
  }

'''
detail = detail.replace(insert_anchor, cascade_methods + insert_anchor, 1)
detail_path.write_text(detail)

app_path = Path('src/ui/app.ts')
app = app_path.read_text()
for old in [
    "import { NodeDetailLineageUi } from './panels/NodeDetailLineageUi';\n",
    "let nodeDetailLineageUi: NodeDetailLineageUi | null = null;\n",
    "    nodeDetailLineageUi?.open(id);\n",
    "  nodeDetailLineageUi = new NodeDetailLineageUi({ getNodeById: getNodeDetailById });\n",
    "    nodeDetailLineageUi?.refresh(currentPanelId);\n",
    "  nodeDetailLineageUi,\n",
]:
    app = app.replace(old, '')
app = app.replace("      nodeDetailLineageUi?.close();\n", '')
app = app.replace("    nodeDetailLineageUi?.close();\n", '')
if 'nodeDetailLineageUi' in app or 'NodeDetailLineageUi' in app:
    raise SystemExit('app still contains NodeDetailLineageUi ownership')
app_path.write_text(app)

conv_path = Path('scripts/verify-lineage-spec-convergence.mjs')
conv = conv_path.read_text()
conv = conv.replace("const lineageUi = await readFile('src/ui/panels/NodeDetailLineageUi.ts', 'utf8');\n", '')
old_block = "assert.match(lineageUi, /class NodeDetailLineageUi/);\nassert.doesNotMatch(lineageUi, /relabelActions|data-node-detail-action=\"edit\"|data-node-detail-action=\"negate\"/);\nassert.match(lineageUi, /snapshot\\.roundKind !== 'CASCADE'/);\nassert.doesNotMatch(lineageUi, /snapshot\\.policyVersion !== 'ORIGINAL_DESIGN_V1'/);\nassert.match(lineageUi, /data-cascade-vote-side=\"AGREE\"/);\nassert.match(lineageUi, /data-cascade-vote-side=\"DISAGREE\"/);\nassert.match(lineageUi, /account\\.castPendingKnowledgeVote\\(nodeId, side\\)/);\n"
new_block = "assert.equal(existsSync('src/ui/panels/NodeDetailLineageUi.ts'), false, 'NodeDetail must not regain a second DOM/lifecycle owner');\nassert.match(detail, /snapshot\\.roundKind !== 'CASCADE'/);\nassert.doesNotMatch(detail, /snapshot\\.policyVersion !== 'ORIGINAL_DESIGN_V1'/);\nassert.match(detail, /data-cascade-vote-side=\"AGREE\"/);\nassert.match(detail, /data-cascade-vote-side=\"DISAGREE\"/);\nassert.match(detail, /account\\.castPendingKnowledgeVote\\(nodeId, side\\)/);\n"
if old_block not in conv:
    raise SystemExit('convergence lineageUi assertion block mismatch')
conv = conv.replace(old_block, new_block, 1)
old_app_assert = "assert.match(app, /nodeDetailLineageUi\\?\\.open\\(id\\)/);\n"
new_app_assert = "assert.doesNotMatch(app, /NodeDetailLineageUi|nodeDetailLineageUi/, 'app must have one NodeDetail lifecycle owner');\n"
if old_app_assert not in conv:
    raise SystemExit('convergence app helper assertion mismatch')
conv = conv.replace(old_app_assert, new_app_assert, 1)
conv_path.write_text(conv)

hard_path = Path('scripts/verify-lineage-v3-final-hardening.mjs')
hard = hard_path.read_text()
hard = hard.replace("const lineageUi = readFileSync('src/ui/panels/NodeDetailLineageUi.ts', 'utf8');\n", "const detail = readFileSync('src/ui/panels/NodeDetailController.ts', 'utf8');\n")
hard = hard.replace('assert.match(lineageUi,', 'assert.match(detail,')
hard = hard.replace('assert.doesNotMatch(lineageUi,', 'assert.doesNotMatch(detail,')
hard = hard.replace("  'the product UI must load the legacy direct-status action guard');", "  'the sole NodeDetail owner must load the legacy direct-status action guard');")
hard_path.write_text(hard)

reg_path = Path('src/ui/panels/NodeDetailRegression.test.ts')
reg = reg_path.read_text()
reg = reg.replace("const lineageUi = readFileSync('src/ui/panels/NodeDetailLineageUi.ts', 'utf8');\n", '')
old = "assert(!lineageUi.includes('relabelActions'), 'cascade helper must not rewrite ordinary detail action labels after render');\nassert(!lineageUi.includes('data-node-detail-action=\"edit\"') && !lineageUi.includes('data-node-detail-action=\"negate\"'), 'cascade helper must not own ordinary edit/opposition presentation');\n"
new = "assert.equal(existsSync('src/ui/panels/NodeDetailLineageUi.ts'), false, 'near-node detail must have exactly one DOM/lifecycle owner');\nassert(!app.includes('NodeDetailLineageUi') && !app.includes('nodeDetailLineageUi'), 'app must not coordinate a second detail lifecycle');\n"
if old not in reg:
    raise SystemExit('NodeDetailRegression early helper assertions mismatch')
reg = reg.replace(old, new, 1)
old_block = "assert(lineageUi.includes('class NodeDetailLineageUi'), 'lineage detail enhancement must have one narrow owner');\nassert(lineageUi.includes(\"node.status !== 'disputed' || lineageRoleFor(node) !== 'current'\"), 'cascade UI must attach only to disputed current nodes');\nassert(lineageUi.includes(\"snapshot.roundKind !== 'CASCADE'\"), 'cascade UI must require the explicit server-created CASCADE round kind');\nassert(!lineageUi.includes(\"snapshot.policyVersion !== 'ORIGINAL_DESIGN_V1'\"), 'cascade UI must not infer round semantics from human V1 policy identity');\nassert(lineageUi.includes('data-cascade-vote-side=\"AGREE\"'), 'cascade UI must expose agree');\nassert(lineageUi.includes('data-cascade-vote-side=\"DISAGREE\"'), 'cascade UI must expose disagree');\nassert(lineageUi.includes('能量 −1'), 'cascade ordinary vote cost must remain one energy');\nassert(lineageUi.includes('无发起人、无发起人票'), 'cascade UI must state the no-initiator rule');\nassert(lineageUi.includes('account.castPendingKnowledgeVote(nodeId, side)'), 'cascade must reuse the authoritative pending-vote RPC');\nassert(lineageUi.includes('REFRESH_MS = 3_000'), 'cascade tally must refresh without a permanent interval');\nassert(lineageUi.includes(\"knowledge-ball:verdict-finalized\"), 'cascade finalization must request public-stream convergence');\nassert(!lineageUi.includes('setInterval('), 'cascade must not add a permanent polling interval');\nassert(app.includes('nodeDetailLineageUi?.open(id)') && app.includes('nodeDetailLineageUi?.refresh(currentPanelId)'), 'app must explicitly start and refresh lineage detail enhancement with the detail lifecycle');\n"
new_block = "assert(detail.includes(\"role === 'current' && node.status === 'disputed'\"), 'cascade interaction must attach only to disputed current nodes');\nassert(detail.includes(\"snapshot.roundKind !== 'CASCADE'\"), 'cascade interaction must require the explicit server-created CASCADE round kind');\nassert(!detail.includes(\"snapshot.policyVersion !== 'ORIGINAL_DESIGN_V1'\"), 'cascade interaction must not infer round semantics from human V1 policy identity');\nassert(detail.includes('data-cascade-vote-side=\"AGREE\"'), 'cascade interaction must expose agree');\nassert(detail.includes('data-cascade-vote-side=\"DISAGREE\"'), 'cascade interaction must expose disagree');\nassert(detail.includes('能量 −1'), 'cascade ordinary vote cost must remain one energy');\nassert(detail.includes('无发起人、无发起人票'), 'cascade interaction must state the no-initiator rule');\nassert(detail.includes('account.castPendingKnowledgeVote(nodeId, side)'), 'cascade must reuse the authoritative pending-vote RPC');\nassert(detail.includes('VOTE_REFRESH_MS = 3_000'), 'cascade tally must reuse the detail owner polling cadence without a permanent interval');\nassert(detail.includes(\"knowledge-ball:verdict-finalized\"), 'cascade finalization must request public-stream convergence');\nassert(!detail.includes('setInterval('), 'single detail owner must not add a permanent polling interval');\nassert.equal((detail.match(/private currentId:/g) ?? []).length, 1, 'single detail owner must keep exactly one selected-node lifecycle state');\nassert.equal((detail.match(/private voteRefreshTimer:/g) ?? []).length, 1, 'INITIAL, V1 and CASCADE interactions must share one refresh timer owner');\n"
if old_block not in reg:
    raise SystemExit('NodeDetailRegression cascade helper assertion block mismatch')
reg = reg.replace(old_block, new_block, 1)
reg_path.write_text(reg)

lineage_path = Path('src/ui/panels/NodeDetailLineageUi.ts')
if not lineage_path.exists():
    raise SystemExit('NodeDetailLineageUi.ts already absent')
lineage_path.unlink()
