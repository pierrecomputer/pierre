export const FILE_TREE_TAG_NAME = 'file-tree-container' as const;
export const FILE_TREE_STYLE_ATTRIBUTE = 'data-file-tree-style' as const;
export const FILE_TREE_UNSAFE_CSS_ATTRIBUTE =
  'data-file-tree-unsafe-css' as const;
export const FILE_TREE_SCROLLBAR_MEASURE_ATTRIBUTE =
  'data-file-tree-scrollbar-measure' as const;
export const FILE_TREE_SCROLLBAR_GUTTER_STYLE_ATTRIBUTE =
  'data-file-tree-scrollbar-gutter-measured' as const;

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

export const DEFAULT_LOCALE = 'en';

// Every user-visible string the tree renders or reports, as ICU MessageFormat
// templates. This object defines the translation keys; `FileTreeTranslations`
// is derived from it. Supported syntax is `{name}` arguments and one
// `{name, plural, one {...} other {...}}` block per string, with `#` standing
// for the number inside a branch.
export const DEFAULT_TRANSLATIONS = {
  /** Placeholder of the built-in search input. */
  searchPlaceholder: 'Search…',
  /** Accessible name of the row action button that opens the context menu. */
  contextMenuTrigger: 'Options',
  /** Accessible name of the inline rename input. Receives `name`. */
  renameItem: 'Rename {name}',
  /** Tooltip of the git status badge on an added row. */
  gitStatusAdded: 'Git status: added',
  /** Tooltip of the git status badge on a deleted row. */
  gitStatusDeleted: 'Git status: deleted',
  /** Tooltip of the git status badge on a modified row. */
  gitStatusModified: 'Git status: modified',
  /** Tooltip of the git status badge on a renamed row. */
  gitStatusRenamed: 'Git status: renamed',
  /** Tooltip of the git status badge on an untracked row. */
  gitStatusUntracked: 'Git status: untracked',
  /** Tooltip of the dot on a directory that contains git status changes. */
  containsGitStatus: 'Contains git status items',
  /** Rename error when the new name is empty. */
  renameEmptyName: 'Name cannot be empty.',
  /** Rename error when the new name contains a path separator. */
  renameNameWithSlash: 'Name cannot include "/".',
  /** Rename error when the destination is taken. Receives `path`. */
  renamePathExists: '"{path}" already exists.',
  /** Rename error when the file being renamed is no longer in the tree. */
  renameFileNotFound: 'Could not find the selected file to rename.',
  /** Rename error when the folder being renamed is no longer in the tree. */
  renameFolderNotFound: 'Could not find the selected folder to rename.',
};
