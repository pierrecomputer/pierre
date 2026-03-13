export const FILE_TREE_TAG_NAME = 'file-tree-container' as const;
export const FILE_TREE_STYLE_ATTRIBUTE = 'data-file-tree-style' as const;
export const FILE_TREE_UNSAFE_CSS_ATTRIBUTE =
  'data-file-tree-unsafe-css' as const;

/**
 * Prefix used for flattened node IDs.
 * Flattened nodes represent collapsed chains of single-child folders.
 * Example: 'f::src/utils/deep' represents the chain src → utils → deep
 */
export const FLATTENED_PREFIX = 'f::' as const;
