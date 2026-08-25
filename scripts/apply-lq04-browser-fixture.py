from pathlib import Path

path = Path('scripts/verify-node-detail-relations-browser.mjs')
text = path.read_text()
old = """      for (const [id, role, proposal, title, rank, targetId] of fixtures) {
        debug.projection.state.nodesById[id] = makeDomainNode(id, role, proposal, title, rank, targetId);
        debug.renderNodes.push(makeRenderNode(id, role, proposal, title, rank, targetId));
      }
      debug.scene.markDirty();
      return { currentId, historyId, historyOlderId, oppositionId, oppositionOlderId };
"""
new = """      for (const [id, role, proposal, title, rank, targetId] of fixtures) {
        debug.projection.state.nodesById[id] = makeDomainNode(id, role, proposal, title, rank, targetId);
      }
      // The fixture mutates Projection truth directly, so cross the same
      // Projection -> render-generation boundary used by production events.
      // Do not push into renderNodes: that bypasses layout/relation-index ownership
      // and only worked when Scene rebuilt canonical topology every frame.
      debug.projectionRenderScheduler.request();
      debug.projectionRenderScheduler.flushNow();
      return { currentId, historyId, historyOlderId, oppositionId, oppositionOlderId };
"""
assert old in text
path.write_text(text.replace(old, new, 1))
