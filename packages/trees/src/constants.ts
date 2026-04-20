export const FILE_TREE_TAG_NAME = 'file-tree-container' as const;
export const FILE_TREE_STYLE_ATTRIBUTE = 'data-file-tree-style' as const;
export const FILE_TREE_UNSAFE_CSS_ATTRIBUTE =
  'data-file-tree-unsafe-css' as const;
export const FILE_TREE_SCROLLBAR_MEASURE_ATTRIBUTE =
  'data-file-tree-scrollbar-measure' as const;

export const FILE_TREE_SCROLLBAR_GUTTER_MEASURED_PROPERTY =
  '--trees-scrollbar-gutter-measured';

/**
 * Prefix used for flattened node IDs.
 * Flattened nodes represent collapsed chains of single-child folders.
 * Example: 'f::src/utils/deep' represents the chain src → utils → deep
 */
export const FLATTENED_PREFIX = 'f::' as const;

export const HEADER_SLOT_NAME = 'header' as const;
export const CONTEXT_MENU_SLOT_NAME = 'context-menu' as const;
export const CONTEXT_MENU_TRIGGER_TYPE = 'context-menu-trigger' as const;
