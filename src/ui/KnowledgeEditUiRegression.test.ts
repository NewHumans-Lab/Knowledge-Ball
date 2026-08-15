import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync('index.html', 'utf8');
const panel = readFileSync('src/ui/panels/PanelController.ts', 'utf8');
const app = readFileSync('src/ui/app.ts', 'utf8');
const scene = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');

assert(!html.includes('fLogicConfirm'), 'legacy logic-law confirmation checkbox must be removed');
assert(!html.includes('我确认该结论及推理不违反逻辑三大基本定律'), 'legacy self-attestation text must be removed');
for (const id of ['fDescription', 'fReasoning', 'fPremises', 'fLogicRule']) {
  assert(html.includes(`id="${id}"`), `create form is missing #${id}`);
}
assert(html.includes('value="logic-symbol"'), 'logic-symbol must be addable from the create form');

for (const action of ['openNegateForm', 'openDecomposeForm', 'openDefinitionMergeForm', 'openTheoryMergeForm']) {
  assert(panel.includes(action), `panel is missing the ${action} operation flow`);
}
assert(panel.includes('反例知识节点（至少一个）'), 'negation UI must collect counterexamples');
assert(panel.includes('原前提 → 步骤一 → 中间结论 → 步骤二 → 原结论'), 'decomposition UI must show the complete chain contract');
assert(panel.includes('推理过程语义等价标识（先验证）'), 'theory merge must validate reasoning identity before conclusion identity');

assert(app.includes('executeKnowledgeEdit(store, projection, edit)'), 'UI writes must pass through the unified command/event boundary');
assert(app.includes('domainNodes.filter(dn => !dn.hidden)'), 'superseded and negated history must be hidden by default');
assert(!app.includes('onFalsifyNode:'), 'UI must not expose the old evidence-free falsification callback');

assert(scene.includes("type==='reasoning'?conclusionRadius/3:conclusionRadius"), 'reasoning radius must be exactly one third of conclusion radius');
assert(scene.includes('callbacks.onNodeTap(nodeId)'), 'a node tap must use the single node-tap callback');
assert(!scene.includes('callbacks.onSelectNode(nodeId);callbacks.onOpenPanel(nodeId)'), 'a node tap must not synchronously render the panel twice');
assert(app.includes('onNodeTap: openNode'), 'the application must open a tapped node through one callback');
assert(!html.includes('.panel,.modal,.ai-results{'), 'the WebGL-overlaid node panel must not use the expensive shared backdrop filter');
assert(html.includes('.panel{top:12px;right:12px;bottom:72px;width:338px;background:rgb(5,18,23)'), 'the node panel must use an opaque GPU-safe background');

console.log('Knowledge edit UI regression tests passed');
