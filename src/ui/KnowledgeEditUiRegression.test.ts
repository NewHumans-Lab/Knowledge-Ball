import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync('index.html', 'utf8');
const panel = readFileSync('src/ui/panels/PanelController.ts', 'utf8');
const app = readFileSync('src/ui/app.ts', 'utf8');
const scene = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const systemCore = readFileSync('src/ui/systemCore/SystemCoreContent.ts', 'utf8');
const layerPolicy = readFileSync('src/domain/KnowledgeLayerPolicy.ts', 'utf8');
const classificationMigration = readFileSync('supabase/migrations/202608200002_three_layer_classification_contract.sql', 'utf8');

assert(!html.includes('fLogicConfirm'), 'legacy logic-law confirmation checkbox must be removed');
assert(!html.includes('我确认该结论及推理不违反逻辑三大基本定律'), 'legacy self-attestation text must be removed');
for (const id of ['fDescription', 'fReasoning', 'fPremises', 'fLogicRule', 'fType']) {
  assert(html.includes(`id="${id}"`), `create form is missing #${id}`);
}

assert(!html.includes('fCanonical'), 'submission UI must not expose a Canonical English field');
assert(!html.includes('Canonical English'), 'submission UI must not contain an English-only normalization gate');
assert(!panel.includes('canonicalTitle'), 'submission controller must not carry a canonical-English field');
assert(!panel.includes('containsNonEnglish'), 'submission controller must not reject non-English titles');
assert(!app.includes('fCanonical'), 'application wiring must not depend on the removed English field');
assert(html.includes('<button class="btn primary" id="modalSubmit">提交知识</button>'), 'submission button must not imply content-truth validation');

assert(html.includes('<option value="inner">第一层 · 语义与基础事实</option>'), 'raw submission form must expose the canonical first layer');
assert(html.includes('<option value="middle">第二层 · 严谨推理</option>'), 'raw submission form must expose the canonical second layer');
assert(html.includes('<option value="outer">第三层 · 概率与争议</option>'), 'raw submission form must expose the canonical third layer');
assert(!html.includes('<option value="fact">事实 Fact</option>'), 'submission form must not ask users for internal fine-grained node types');
assert(!html.includes('<option value="theorem">定理 Theorem</option>'), 'submission form must not ask users for internal fine-grained node types');
assert(!html.includes('<option value="prediction">预测 Prediction</option>'), 'submission form must not ask users for internal fine-grained node types');
assert(!panel.includes('id="editType"'), 'edit form must not expose an internal node-type field');
assert(!panel.includes('id="middleType"'), 'decomposition form must not ask users to classify intermediate conclusions');
assert(!panel.includes('id="mergeConclusionType"'), 'merge form must not display a fine-grained conclusion type selector');

assert(panel.includes('<option value="inner">第一层 · 语义与基础事实</option>'), 'submission UI must offer the canonical first layer');
assert(panel.includes('<option value="middle">第二层 · 严谨推理</option>'), 'submission UI must offer the canonical second layer');
assert(panel.includes('<option value="outer">第三层 · 概率与争议</option>'), 'submission UI must offer the canonical third layer');
assert(layerPolicy.includes('静态语义关系'), 'first layer must explicitly include static semantic relations');
assert(layerPolicy.includes('所有严谨推理'), 'second layer must explicitly include rigorous or claimed-rigorous reasoning');
assert(layerPolicy.includes('概率性 / 不确定性'), 'third layer must explicitly include probabilistic/uncertain author declarations');
assert(
  panel.includes("layer === 'inner'") &&
  panel.includes('premises.length > 0') &&
  panel.includes('第一层是非推导性的语义 / 基础事实层'),
  'first-layer submission must reject inferential premises',
);
assert(panel.includes('选择推理前提后已切换到第二层'), 'adding an inference premise in the create UI must move creation to the second layer');
assert(panel.includes("node.declaredLayer === 'inner' && premises.length > 0"), 'editing must not silently turn a first-layer node into a reasoning node');
assert(!panel.includes('已验证前提，因此按协议自动进入第二层'), 'verified-premise state must not silently rewrite semantic classification');
assert(!panel.includes('理论必须选择一个已有逻辑符号'), 'logic symbols must not remain a mandatory submission gate');

for (const action of ['openNegateForm', 'openDecomposeForm', 'openDefinitionMergeForm', 'openTheoryMergeForm']) {
  assert(panel.includes(action), `panel is missing the ${action} operation flow`);
}
assert(panel.includes('反例知识节点（至少一个）'), 'negation UI must collect counterexamples');
assert(panel.includes('原前提 → 步骤一 → 中间结论 → 步骤二 → 原结论'), 'decomposition UI must show the complete chain contract');
assert(panel.includes('推理过程语义等价标识（先检查）'), 'theory merge must check reasoning identity before conclusion identity');
assert(panel.includes('type: conclusionType'), 'decomposition must derive internal fine type from the existing conclusion rather than ask the user');
assert(panel.includes('type: node.type'), 'theory merge must preserve the source fine type internally rather than ask the user');

assert(app.includes('executeKnowledgeEdit(store, projection, edit, commitPublicEvent, declaredLayers)'), 'new knowledge writes must carry layer declarations through the unified server-first boundary');
assert(app.includes('effectiveLayerForNode(dn, projection.state.nodesById)'), 'application must calculate scene layer from the canonical domain policy');
assert(app.includes('layoutNodes = domainNodes.map'), 'all projected nodes must receive layout slots before visibility filtering');
assert(app.includes('applyUniformLayerLayout(layoutNodes)'), 'application must use the canonical uniform layer layout');
assert(app.includes('renderNodes = layoutNodes.filter'), 'render visibility must be separated from layout occupancy');
assert(app.includes('!hiddenIds.has(node.id)'), 'hidden history must stay out of rendering while remaining in layout occupancy');
assert(!app.includes('onFalsifyNode:'), 'UI must not expose the old evidence-free falsification callback');

for (const databaseObject of [
  'knowledge_layer_definitions',
  'public_knowledge_node_declarations',
  'first_layer_knowledge_nodes',
  'second_layer_knowledge_nodes',
  'third_layer_knowledge_nodes',
  'knowledge_classification_schema_version',
]) {
  assert(classificationMigration.includes(databaseObject), `classification migration is missing ${databaseObject}`);
}
assert(classificationMigration.includes("jsonb_typeof(layers) is distinct from 'object'"), 'server must reject KnowledgeAdded without declaredLayers');
assert(classificationMigration.includes('KnowledgeAdded node % must declare inner, middle, or outer'), 'server must validate every new node layer declaration');
assert(classificationMigration.includes('declaredLayers contains a node not created by this event'), 'server must reject stale/extra layer declarations');
assert(!classificationMigration.includes('update public.public_knowledge_events'), 'classification migration must not rewrite historical knowledge events');

assert(/if\s*\(node\.effectiveLayer\)\s*return\s+node\.effectiveLayer/.test(scene), 'scene must consume the application-computed effective layer');
assert(/type\s*===\s*'reasoning'\s*\?\s*conclusionRadius\s*\/\s*3\s*:\s*conclusionRadius/.test(scene), 'reasoning radius must be exactly one third of conclusion radius');
assert(scene.includes('callbacks.onNodeTap(nodeId)'), 'a node tap must use the single node-tap callback');
assert(!scene.includes('callbacks.onSelectNode(nodeId);callbacks.onOpenPanel(nodeId)'), 'a node tap must not synchronously render the panel twice');
assert(app.includes('onNodeTap') && app.includes('openNode'), 'the application must open a tapped node through one callback');
assert(!html.includes('.panel,.modal,.ai-results{'), 'the WebGL-overlaid node panel must not use the expensive shared backdrop filter');
assert(html.includes('.panel{top:12px;right:12px;bottom:72px;width:338px;background:#080D20'), 'the node panel must use an opaque GPU-safe deep-navy background');
assert(html.includes('--accent-primary:#55ECFF') && html.includes('--accent-secondary:#7C6CFF'), 'page chrome must use the shared promo-derived cyan and violet tokens');
assert(!html.includes('--brass:') && !html.includes('--brass-dim:'), 'legacy brass tokens must not remain authoritative for page chrome');
assert(!html.includes('backdrop-filter:blur'), 'page chrome must not backdrop-filter the live WebGL canvas');
assert(!systemCore.includes('backdrop-filter'), 'the system-core overlay must not backdrop-filter the live WebGL canvas');

console.log('Knowledge edit UI regression tests passed');
