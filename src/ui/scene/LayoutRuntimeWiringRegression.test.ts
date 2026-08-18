import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const appSource = readFileSync('src/ui/app.ts', 'utf8');
const uniformSource = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
const relationSource = readFileSync('src/ui/scene/RelationLengthLayout.ts', 'utf8');

assert(appSource.includes("import { applyUniformLayerLayout } from './scene/UniformLayerLayout';"), 'user app must import the uniform layout entry point');
const allNodesIndex = appSource.indexOf('layoutNodes = domainNodes.map');
const layoutCallIndex = appSource.indexOf('applyUniformLayerLayout(layoutNodes)');
const renderFilterIndex = appSource.indexOf('renderNodes = layoutNodes.filter');
assert(allNodesIndex >= 0, 'user app must build layout from every projected node');
assert(layoutCallIndex > allNodesIndex, 'uniform layout must run after the full projected graph is materialized');
assert(renderFilterIndex > layoutCallIndex, 'hidden rendering filter must run only after full-graph layout optimization');

assert(uniformSource.includes("import { optimizeRelationLengthLayout } from './RelationLengthLayout';"), 'uniform layout must import the relation-length optimizer used by the user page');
const slotAssignmentIndex = uniformSource.indexOf('ordered.forEach((node, index) =>');
const relationOptimizeIndex = uniformSource.indexOf('optimizeRelationLengthLayout(nodes)');
assert(slotAssignmentIndex >= 0 && relationOptimizeIndex > slotAssignmentIndex, 'relation-length optimization must run after fixed uniform slots are assigned');
assert(relationSource.includes('collectRelationLayoutEdges'), 'relation optimizer implementation must retain the complete graph edge collector');
assert(!relationSource.includes('filter(node => !node.hidden)'), 'relation optimizer must not drop hidden historical nodes from its objective');

console.log('User-page uniform and relation-length layout wiring regression tests passed.');
