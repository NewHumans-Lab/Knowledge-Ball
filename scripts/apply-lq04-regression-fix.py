from pathlib import Path

relation_path = Path('src/domain/KnowledgeRelations.ts')
relation = relation_path.read_text()
needle = """/**
 * Build canonical relation topology once for one graph generation.
 *
"""
replacement = """/**
 * Build canonical relation topology once for one graph generation.
 * logicRuleId is metadata on a reasoning node and never becomes a visual edge.
 *
"""
assert needle in relation
relation_path.write_text(relation.replace(needle, replacement, 1))

test_path = Path('src/ui/panels/NodeDetailRegression.test.ts')
test = test_path.read_text()
old_app = "assert(app.includes('buildKnowledgeRelations(id, nodeList(projection.state))'), 'detail must consume the canonical domain relation projection');"
new_app = "assert(app.includes('knowledgeRelationIndex.relationsFor(id)'), 'detail must consume the canonical indexed domain relation projection');"
old_scene = "assert(scene.includes('collectKnowledgeChainEdges(nodes)'), 'scene lines must consume the same canonical domain chain');"
new_scene = "assert(scene.includes('relationIndexFor(nodes).edges'), 'scene lines must consume the same canonical indexed domain chain');"
assert old_app in test
assert old_scene in test
test = test.replace(old_app, new_app, 1).replace(old_scene, new_scene, 1)
test_path.write_text(test)
