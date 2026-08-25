from pathlib import Path
p = Path('src/ui/panels/NodeDetailController.ts')
s = p.read_text()
old = "  private handleFinalizedCascade(snapshot: PendingKnowledgeVoteSnapshot): void {\n    if (this.root.dataset.finalizedCascade === snapshot.nodeId) return;\n    this.root.dataset.finalizedCascade = snapshot.nodeId;\n    this.clearVoteRefresh();\n"
new = "  private handleFinalizedCascade(snapshot: PendingKnowledgeVoteSnapshot): void {\n    this.clearVoteRefresh();\n"
if s.count(old) != 1:
    raise SystemExit('cascade finalization parity anchor mismatch')
p.write_text(s.replace(old, new, 1))
