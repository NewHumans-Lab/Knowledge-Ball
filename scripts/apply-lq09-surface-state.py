from pathlib import Path

p = Path('src/ui/app.ts')
s = p.read_text()
anchor = '  onSelectRelatedNode: openNode,\n  onOverlayVisibilityChange: updateSceneOverlayState,\n\n  panel: must<HTMLElement>(\'panel\'),\n'
replacement = "  onSelectRelatedNode: openNode,\n  onOverlayVisibilityChange: updateSceneOverlayState,\n  onNodePanelChange: id => id ? knowledgeSurfaceState.open('panel', id) : knowledgeSurfaceState.close('panel'),\n\n  panel: must<HTMLElement>('panel'),\n"
if s.count(anchor) != 1:
    raise SystemExit('Panel lifecycle app wiring anchor mismatch')
p.write_text(s.replace(anchor, replacement, 1))
