import {
  builtInMissingMetadataRule,
  MAX_LIBRARY_RULE_DEPTH,
  MAX_LIBRARY_RULE_NODES,
  type LibraryRuleDocument,
  type LibraryRuleEntity,
  type LibraryRuleGroup,
  type LibraryRuleNode,
  type LibraryRulePredicate,
} from './libraryRuleModel';

export type LibraryRulePath = readonly number[];

export function defaultLibraryRulePredicate(entity: LibraryRuleEntity): LibraryRulePredicate {
  return entity === 'album'
    ? { kind: 'predicate', field: 'albumName', operator: 'isPresent' }
    : { kind: 'predicate', field: 'trackArtist', operator: 'isPresent' };
}

export function libraryRuleNodeCount(node: LibraryRuleNode): number {
  return node.kind === 'predicate'
    ? 1
    : 1 + node.children.reduce((total, child) => total + libraryRuleNodeCount(child), 0);
}

function nodeDepth(node: LibraryRuleNode): number {
  return node.kind === 'predicate'
    ? 1
    : 1 + Math.max(0, ...node.children.map(nodeDepth));
}

function editNode(
  node: LibraryRuleNode,
  path: LibraryRulePath,
  edit: (node: LibraryRuleNode) => LibraryRuleNode | null,
): LibraryRuleNode | null {
  if (path.length === 0) return edit(node);
  if (node.kind !== 'group') return null;
  const [index, ...remaining] = path;
  if (!Number.isInteger(index) || index < 0 || index >= node.children.length) return null;
  const updated = editNode(node.children[index], remaining, edit);
  if (!updated) return null;
  return {
    ...node,
    children: node.children.map((child, i) => i === index ? updated : child),
  };
}

function asDocument(
  document: LibraryRuleDocument,
  updated: LibraryRuleNode | null,
): LibraryRuleDocument {
  return updated?.kind === 'group' ? { ...document, root: updated } : document;
}

/** Immutable, no-op on invalid paths; the document root must stay a group. */
export function replaceLibraryRuleNode(
  document: LibraryRuleDocument,
  path: LibraryRulePath,
  next: LibraryRuleNode,
): LibraryRuleDocument {
  if (path.length === 0 && next.kind !== 'group') return document;
  const delta = libraryRuleNodeCount(next);
  const updated = editNode(document.root, path, () => next);
  if (!updated || libraryRuleNodeCount(updated) > MAX_LIBRARY_RULE_NODES ||
      path.length + nodeDepth(next) > MAX_LIBRARY_RULE_DEPTH) return document;
  if (delta === 0) return document;
  return asDocument(document, updated);
}

/** Appending a group also appends one valid default predicate inside it. */
export function appendLibraryRuleNode(
  document: LibraryRuleDocument,
  groupPath: LibraryRulePath,
  kind: 'predicate' | 'group',
): LibraryRuleDocument {
  const predicate = defaultLibraryRulePredicate(document.entity);
  const next: LibraryRuleNode = kind === 'predicate'
    ? predicate
    : { kind: 'group', combinator: 'all', children: [predicate] };
  if (libraryRuleNodeCount(document.root) + libraryRuleNodeCount(next) > MAX_LIBRARY_RULE_NODES ||
      groupPath.length + 1 + nodeDepth(next) > MAX_LIBRARY_RULE_DEPTH) return document;
  const updated = editNode(document.root, groupPath, node => node.kind === 'group'
    ? { ...node, children: [...node.children, next] }
    : null);
  return asDocument(document, updated);
}

/** Never leave a group empty; root cannot be deleted. */
export function removeLibraryRuleNode(
  document: LibraryRuleDocument,
  path: LibraryRulePath,
): LibraryRuleDocument {
  if (path.length === 0) return document;
  const index = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  const updated = editNode(document.root, parentPath, node => {
    if (node.kind !== 'group' || node.children.length < 2 ||
        !Number.isInteger(index) || index < 0 || index >= node.children.length) return null;
    return { ...node, children: node.children.filter((_, i) => i !== index) };
  });
  return asDocument(document, updated);
}

/** Entity changes reset invalid cross-entity fields to a known preset. */
export function changeLibraryRuleEntity(
  document: LibraryRuleDocument,
  entity: LibraryRuleEntity,
): LibraryRuleDocument {
  return document.entity === entity ? document : builtInMissingMetadataRule(entity);
}

/** Used to disable controls before reaching the backend-enforced budgets. */
export function canAppendLibraryRuleNode(
  document: LibraryRuleDocument,
  groupPath: LibraryRulePath,
  kind: 'predicate' | 'group',
): boolean {
  const nextCount = kind === 'group' ? 2 : 1;
  const nextDepth = kind === 'group' ? 2 : 1;
  if (libraryRuleNodeCount(document.root) + nextCount > MAX_LIBRARY_RULE_NODES ||
      groupPath.length + 1 + nextDepth > MAX_LIBRARY_RULE_DEPTH) return false;
  let current: LibraryRuleNode = document.root;
  for (const index of groupPath) {
    if (current.kind !== 'group' || !current.children[index]) return false;
    current = current.children[index];
  }
  return current.kind === 'group';
}

export function libraryRuleGroupAt(
  document: LibraryRuleDocument,
  path: LibraryRulePath,
): LibraryRuleGroup | null {
  let node: LibraryRuleNode = document.root;
  for (const index of path) {
    if (node.kind !== 'group' || !node.children[index]) return null;
    node = node.children[index];
  }
  return node.kind === 'group' ? node : null;
}
