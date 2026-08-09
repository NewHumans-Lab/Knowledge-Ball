const types = new Set(['axiom', 'definition', 'fact', 'theorem', 'hypothesis', 'prediction', 'opinion', 'value', 'reasoning', 'logic-symbol']);
const atomicTypes = new Set(['axiom', 'definition', 'fact', 'logic-symbol']);
const statuses = new Set(['pending', 'verified', 'suspended', 'disputed', 'falsified']);
const masteryLevels = new Set(['none', 'touched', 'mastered']);
const domains = new Set(['logic', 'mathematics', 'physics', 'biology', 'chemistry', 'computer-science', 'economics', 'history', 'philosophy', 'general']);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function validKey(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !unsafeKeys.has(value);
}

export function validNamespace(value) {
  return validKey(value, 50) && /^[\w-]+$/.test(value);
}

export function validNode(node) {
  return node && validKey(node.id, 100) &&
    typeof node.title === 'string' && Boolean(node.title.trim()) && node.title.length <= 200 &&
    typeof node.reasoning === 'string' && Boolean(node.reasoning.trim()) && node.reasoning.length <= 10_000 && types.has(node.type) &&
    statuses.has(node.status) && masteryLevels.has(node.mastery) && domains.has(node.domain) &&
    Number.isInteger(node.version) && node.version >= 1 &&
    Array.isArray(node.tags) && node.tags.length <= 100 && node.tags.every(value => typeof value === 'string' && value.length <= 100) &&
    Array.isArray(node.premises) && node.premises.length <= 100 && node.premises.every(value => validKey(value, 100)) &&
    (node.hidden === undefined || typeof node.hidden === 'boolean') &&
    (node.aliases === undefined || (Array.isArray(node.aliases) && node.aliases.every(value => typeof value === 'string' && value.length <= 200))) &&
    (node.negatedBy === undefined || (Array.isArray(node.negatedBy) && node.negatedBy.every(value => validKey(value, 100)))) &&
    (node.supersededBy === undefined || validKey(node.supersededBy, 100)) &&
    (node.logicRuleId === undefined || validKey(node.logicRuleId, 100)) &&
    (node.semanticKey === undefined || (typeof node.semanticKey === 'string' && Boolean(node.semanticKey.trim()) && node.semanticKey.length <= 500));
}

function canonicalText(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function validateNodeBatch(existingNodes, incomingNodes) {
  if (!Array.isArray(incomingNodes) || incomingNodes.length === 0 || incomingNodes.some(node => !validNode(node))) {
    return 'Invalid node batch';
  }

  const existing = new Map(existingNodes.map(node => [node.id, node]));
  const combined = new Map(existing);
  const newTitles = new Map();
  const newDescriptions = new Map();
  const allTitles = new Map(existingNodes.map(node => [canonicalText(node.title), node.id]));
  const allDescriptions = new Map(existingNodes.map(node => [canonicalText(node.reasoning), node.id]));

  for (const node of incomingNodes) {
    const isNew = !existing.has(node.id);
    if (combined.has(node.id) && isNew) return `Duplicate node id: ${node.id}`;
    if (new Set(node.premises).size !== node.premises.length) return `Duplicate premise: ${node.id}`;
    if (node.premises.includes(node.id)) return `Self reference: ${node.id}`;

    const previous = existing.get(node.id);
    const title = canonicalText(node.title);
    const description = canonicalText(node.reasoning);
    if (isNew) {
      const titleOwner = allTitles.get(title) ?? newTitles.get(title);
      const descriptionOwner = allDescriptions.get(description) ?? newDescriptions.get(description);
      if (titleOwner) return `Duplicate node title: ${node.title}`;
      if (descriptionOwner) return `Duplicate node description: ${node.reasoning}`;
      newTitles.set(title, node.id);
      newDescriptions.set(description, node.id);
    } else {
      if (title !== canonicalText(previous.title)) {
        const owner = existingNodes.find(candidate => candidate.id !== node.id && canonicalText(candidate.title) === title);
        if (owner) return `Duplicate node title: ${node.title}`;
      }
      if (description !== canonicalText(previous.reasoning)) {
        const owner = existingNodes.find(candidate => candidate.id !== node.id && canonicalText(candidate.reasoning) === description);
        if (owner) return `Duplicate node description: ${node.reasoning}`;
      }
    }
    combined.set(node.id, node);
  }

  for (const node of incomingNodes) {
    for (const premiseId of node.premises) {
      if (!combined.has(premiseId)) return `Missing premise: ${premiseId}`;
    }
    if (node.supersededBy && !combined.has(node.supersededBy)) return `Missing successor: ${node.supersededBy}`;
    for (const counterexampleId of node.negatedBy ?? []) {
      if (!combined.has(counterexampleId)) return `Missing counterexample: ${counterexampleId}`;
    }

    if (!existing.has(node.id) && node.type === 'reasoning') {
      const rule = node.logicRuleId ? combined.get(node.logicRuleId) : null;
      if (node.premises.length === 0) return `Reasoning requires premises: ${node.id}`;
      if (!rule || rule.type !== 'logic-symbol' || rule.hidden || rule.status === 'falsified') {
        return `Invalid logic symbol: ${node.logicRuleId ?? ''}`;
      }
    }
    if (!existing.has(node.id) && atomicTypes.has(node.type) && node.premises.length !== 0) {
      return `Atomic node cannot have premises: ${node.id}`;
    }
    if (!existing.has(node.id) && !atomicTypes.has(node.type) && node.type !== 'reasoning') {
      if (node.premises.length !== 1 || combined.get(node.premises[0])?.type !== 'reasoning') {
        return `Derived conclusion must depend on one reasoning node: ${node.id}`;
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const hasCycle = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const premiseId of combined.get(id)?.premises ?? []) {
      if (hasCycle(premiseId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of combined.keys()) if (hasCycle(id)) return `Dependency cycle: ${id}`;
  return null;
}
