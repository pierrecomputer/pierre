import type {
  FileTreeLabels,
  FileTreeLabelsOption,
} from '../model/publicTypes';

export const DEFAULT_FILE_TREE_LABELS: FileTreeLabels = Object.freeze({
  searchPlaceholder: 'Search…',
  contextMenuTrigger: 'Options',
  renameItem: (itemName: string) => `Rename ${itemName}`,
  gitStatusTitles: Object.freeze({
    added: 'Git status: added',
    deleted: 'Git status: deleted',
    ignored: 'Git status: ignored',
    modified: 'Git status: modified',
    renamed: 'Git status: renamed',
    untracked: 'Git status: untracked',
  }),
  containsGitStatusTitle: 'Contains git status items',
});

// Fill in English defaults for any label the caller left out. Each key is
// resolved with `??` rather than an object spread so that an explicit
// `undefined` (allowed by the partial option type) still falls back to the
// default, and git status titles fall back one status at a time.
export function resolveFileTreeLabels(
  labels: FileTreeLabelsOption | undefined
): FileTreeLabels {
  if (labels == null) {
    return DEFAULT_FILE_TREE_LABELS;
  }
  const defaults = DEFAULT_FILE_TREE_LABELS;
  const titles = labels.gitStatusTitles;
  return {
    searchPlaceholder: labels.searchPlaceholder ?? defaults.searchPlaceholder,
    contextMenuTrigger:
      labels.contextMenuTrigger ?? defaults.contextMenuTrigger,
    renameItem: labels.renameItem ?? defaults.renameItem,
    gitStatusTitles:
      titles == null
        ? defaults.gitStatusTitles
        : {
            added: titles.added ?? defaults.gitStatusTitles.added,
            deleted: titles.deleted ?? defaults.gitStatusTitles.deleted,
            ignored: titles.ignored ?? defaults.gitStatusTitles.ignored,
            modified: titles.modified ?? defaults.gitStatusTitles.modified,
            renamed: titles.renamed ?? defaults.gitStatusTitles.renamed,
            untracked: titles.untracked ?? defaults.gitStatusTitles.untracked,
          },
    containsGitStatusTitle:
      labels.containsGitStatusTitle ?? defaults.containsGitStatusTitle,
  };
}
