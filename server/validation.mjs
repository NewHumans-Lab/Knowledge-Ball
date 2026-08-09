const types = new Set(['axiom', 'definition', 'fact', 'theorem', 'hypothesis', 'prediction', 'opinion', 'value', 'reasoning', 'logic-symbol']);
const atomicTypes = new Set(['axiom', 'definition', 'fact', 'logic-symbol']);
const statuses = new Set(['pending', 'verified', 'suspended', 'disputed', 'falsified']);
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
    statuses.has(node.status) && domains.has(node.domain) && node.mastery === undefined &&
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

const issue = (code, path, entityId, details) => ({ code, ...(path ? { path } : {}), ...(entityId ? { entityId } : {}), ...(details ? { details } : {}) });

function canonicalText(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function validateNodeBatch(existingNodes, incomingNodes) {
  if (!Array.isArray(incomingNodes) || incomingNodes.length === 0 || incomingNodes.some(node => !validNode(node))) {
    const personal = incomingNodes?.find?.(node => node && Object.hasOwn(node, 'mastery'));
    return personal
      ? issue('PERSONAL_STATE_IN_PUBLIC_PAYLOAD', 'nodes.mastery', personal.id)
      : issue('INCOMPLETE_THEORY_CHAIN', 'nodes');
  }

  const existing = new Map(existingNodes.map(node => [node.id, node]));
  const combined = new Map(existing);
  const newTitles = new Map();
  const newDescriptions = new Map();
  const allTitles = new Map(existingNodes.map(node => [canonicalText(node.title), node.id]));
  const allDescriptions = new Map(existingNodes.map(node => [canonicalText(node.reasoning), node.id]));

  for (const node of incomingNodes) {
    const isNew = !existing.has(node.id);
    if (combined.has(node.id) && isNew) return issue('DUPLICATE_NODE_ID', 'nodes.id', node.id);
    if (new Set(node.premises).size !== node.premises.length) return issue('DUPLICATE_RELATION', 'nodes.premises', node.id);
    if (node.premises.includes(node.id)) return issue('SELF_REFERENCE', 'nodes.premises', node.id);

    const previous = existing.get(node.id);
    const title = canonicalText(node.title);
    const description = canonicalText(node.reasoning);
    if (isNew) {
      const titleOwner = allTitles.get(title) ?? newTitles.get(title);
      const descriptionOwner = allDescriptions.get(description) ?? newDescriptions.get(description);
      if (titleOwner) return issue('DUPLICATE_TITLE', 'nodes.title', node.id, { conflictingId: titleOwner });
      if (descriptionOwner) return issue('DUPLICATE_CONTENT', 'nodes.reasoning', node.id, { conflictingId: descriptionOwner });
      newTitles.set(title, node.id);
      newDescriptions.set(description, node.id);
    } else {
      if (title !== canonicalText(previous.title)) {
        const owner = existingNodes.find(candidate => candidate.id !== node.id && canonicalText(candidate.title) === title);
        const incomingOwner = newTitles.get(title);
        if (owner || incomingOwner) return issue('DUPLICATE_TITLE', 'nodes.title', node.id, { conflictingId: owner?.id ?? incomingOwner });
        newTitles.set(title, node.id);
      }
      if (description !== canonicalText(previous.reasoning)) {
        const owner = existingNodes.find(candidate => candidate.id !== node.id && canonicalText(candidate.reasoning) === description);
        const incomingOwner = newDescriptions.get(description);
        if (owner || incomingOwner) return issue('DUPLICATE_CONTENT', 'nodes.reasoning', node.id, { conflictingId: owner?.id ?? incomingOwner });
        newDescriptions.set(description, node.id);
      }
    }
    combined.set(node.id, node);
  }

  for (const node of incomingNodes) {
    for (const premiseId of node.premises) {
      if (!combined.has(premiseId)) return issue('REFERENCE_NOT_FOUND', 'nodes.premises', node.id, { referenceId: premiseId });
    }
    if (node.supersededBy && !combined.has(node.supersededBy)) return issue('REFERENCE_NOT_FOUND', 'nodes.supersededBy', node.id, { referenceId: node.supersededBy });
    for (const counterexampleId of node.negatedBy ?? []) {
      if (!combined.has(counterexampleId)) return issue('REFERENCE_NOT_FOUND', 'nodes.negatedBy', node.id, { referenceId: counterexampleId });
    }

    if (!existing.has(node.id) && node.type === 'reasoning') {
      const rule = node.logicRuleId ? combined.get(node.logicRuleId) : null;
      if (node.premises.length === 0) return issue('INCOMPLETE_THEORY_CHAIN', 'nodes.premises', node.id);
      if (node.premises.some(id => ['reasoning', 'logic-symbol'].includes(combined.get(id)?.type))) {
        return issue('INVALID_RELATION_ENDPOINT', 'nodes.premises', node.id);
      }
      if (!rule || rule.type !== 'logic-symbol' || rule.hidden || rule.status === 'falsified') {
        return issue(node.logicRuleId ? 'INVALID_LOGIC_RULE' : 'LOGIC_RULE_REQUIRED', 'nodes.logicRuleId', node.id);
      }
    }
    if (!existing.has(node.id) && atomicTypes.has(node.type) && node.premises.length !== 0) {
      return issue('INVALID_RELATION_ENDPOINT', 'nodes.premises', node.id);
    }
    if (!existing.has(node.id) && !atomicTypes.has(node.type) && node.type !== 'reasoning') {
      if (node.premises.length !== 1 || combined.get(node.premises[0])?.type !== 'reasoning') {
        return issue('INCOMPLETE_THEORY_CHAIN', 'nodes.premises', node.id);
      }
    }
  }

  // New theory components are transaction-scoped: neither half may be submitted alone
  // or connected to a reasoning process from an earlier transaction.
  const incomingIds = new Set(incomingNodes.map(node => node.id));
  for (const node of incomingNodes) {
    if (!existing.has(node.id) && node.type === 'reasoning') {
      const conclusions = incomingNodes.filter(candidate => candidate.premises?.length === 1 && candidate.premises[0] === node.id && candidate.type !== 'reasoning');
      if (conclusions.length !== 1) return issue('INCOMPLETE_THEORY_CHAIN', 'nodes', node.id);
    }
    if (!existing.has(node.id) && !atomicTypes.has(node.type) && node.type !== 'reasoning') {
      if (!incomingIds.has(node.premises[0])) return issue('INCOMPLETE_THEORY_CHAIN', 'nodes', node.id);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const hasCycle = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = combined.get(id);
    const dependencies = [...(node?.premises ?? []), ...(node?.logicRuleId ? [node.logicRuleId] : [])];
    for (const premiseId of dependencies) {
      if (hasCycle(premiseId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of combined.keys()) if (hasCycle(id)) return issue('DEPENDENCY_CYCLE', 'nodes', id);
  return null;
}
