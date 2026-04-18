import {
  type FileTreeBuiltInIconSet,
  type FileTreeIconConfig,
  type FileTreeIcons,
  type FileTreeSearchMode,
  type GitStatusEntry,
  themeToTreeStyles,
  type TreeThemeStyles,
} from '@pierre/trees';
import { preloadFileTree as preloadCanonicalFileTree } from '@pierre/trees/ssr';

import {
  type FileTreeOptions,
  type FileTreeSelectionItem,
  type FileTreeSsrPayload,
  type FileTreeStateConfig,
  resolvePaths,
  toCanonicalOptions,
} from './treesCompatShared';

export {
  themeToTreeStyles,
  type FileTreeBuiltInIconSet,
  type FileTreeIconConfig,
  type FileTreeIcons,
  type FileTreeSearchMode,
  type GitStatusEntry,
  type TreeThemeStyles,
};
export type {
  FileTreeOptions,
  FileTreeSelectionItem,
  FileTreeSsrPayload,
  FileTreeStateConfig,
};

export function preloadFileTree(
  options: FileTreeOptions,
  stateConfig?: FileTreeStateConfig
): FileTreeSsrPayload {
  const paths = resolvePaths(options, stateConfig, undefined);
  return preloadCanonicalFileTree(
    toCanonicalOptions(
      options,
      paths,
      stateConfig?.expandedItems ?? stateConfig?.initialExpandedItems,
      stateConfig?.initialSearchQuery,
      options.gitStatus
    )
  );
}
