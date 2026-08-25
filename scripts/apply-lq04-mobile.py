from pathlib import Path

scene_path = Path('src/ui/scene/KnowledgeScene.ts')
scene = scene_path.read_text()
old = """    const forced = selectedRelationIds(eligible);
    mobileActiveNodeIds = selectMobileActiveNodeIds(mobileCandidates(eligible), mobileActiveNodeIds, forced);
"""
new = """    // `eligible` is a new filtered array each frame. Relation topology belongs
    // to the stable full graph generation; hidden/non-candidate forced IDs are
    // ignored by selectMobileActiveNodeIds because they are absent from candidates.
    const forced = selectedRelationIds(nodes);
    mobileActiveNodeIds = selectMobileActiveNodeIds(mobileCandidates(eligible), mobileActiveNodeIds, forced);
"""
assert old in scene
scene_path.write_text(scene.replace(old, new, 1))
