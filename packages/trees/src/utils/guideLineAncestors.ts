import type { FileTreeData } from '../types';

/**
 * Build a child→parent map from treeData. When `flattenEmptyDirectories` is
 * enabled, intermediate nodes hidden inside flattened chains are skipped, and
 * children of composite flattened nodes map to the earliest segment
 * (`flattens[0]`) because that's the visual level where the flattened row sits.
 */
export function buildChildToParent(
  treeData: FileTreeData,
  flattenEmptyDirectories: boolean
): Map<string, string> {
  const flattenedIntermediates = new Set<string>();
  const flattenedFirstSegment = new Map<string, string>();
  if (flattenEmptyDirectories) {
    for (const [id, node] of Object.entries(treeData)) {
      if (node.flattens != null && node.flattens.length > 0) {
        flattenedFirstSegment.set(id, node.flattens[0]);
        for (const intermediateId of node.flattens) {
          flattenedIntermediates.add(intermediateId);
        }
      }
    }
  }
  const map = new Map<string, string>();
  for (const [id, node] of Object.entries(treeData)) {
    if (flattenedIntermediates.has(id) || node.flattens != null) continue;
    const childIds = flattenEmptyDirectories
      ? (node.children?.flattened ?? node.children?.direct ?? [])
      : (node.children?.direct ?? []);
    for (const childId of childIds) {
      map.set(childId, id);
    }
  }
  // Redirect: children of flattened nodes → first segment,
  // and first segment inherits the composite node's parent.
  for (const [compositeId, firstSegmentId] of flattenedFirstSegment) {
    const compositeParent = map.get(compositeId);
    if (compositeParent != null) {
      map.set(firstSegmentId, compositeParent);
    }
    const compositeNode = treeData[compositeId];
    const childIds = [
      ...(compositeNode?.children?.direct ?? []),
      ...(compositeNode?.children?.flattened ?? []),
    ];
    for (const childId of childIds) {
      map.set(childId, firstSegmentId);
    }
  }
  return map;
}

/**
 * Build per-item ancestor chains: itemId → [level0Ancestor, level1Ancestor, ...]
 * Uses childToParent to walk up the tree from each node.
 */
export function buildAncestorChains(
  treeData: FileTreeData,
  childToParent: Map<string, string>
): Map<string, string[]> {
  const chains = new Map<string, string[]>();
  const getChain = (id: string): string[] => {
    const cached = chains.get(id);
    if (cached != null) return cached;
    const parentId = childToParent.get(id);
    if (parentId == null || parentId === 'root') {
      const chain: string[] = [];
      chains.set(id, chain);
      return chain;
    }
    const chain = [...getChain(parentId), parentId];
    chains.set(id, chain);
    return chain;
  };
  for (const id of Object.keys(treeData)) {
    getChain(id);
  }
  return chains;
}
