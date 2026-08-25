from pathlib import Path

path = Path('src/ui/scene/KnowledgeSceneRegression.test.ts')
text = path.read_text()
old = "assert(syncEdgesSource.includes('collectKnowledgeChainEdges(nodes)'), 'scene must get horizontal lines from the canonical domain chain');"
new = "assert(syncEdgesSource.includes('relationIndexFor(nodes).edges'), 'scene must get horizontal lines from the canonical indexed domain chain');"
assert old in text
path.write_text(text.replace(old, new, 1))
