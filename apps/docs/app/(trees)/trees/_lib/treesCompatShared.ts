import type {
  GitStatusEntry,
  FileTree as PackageFileTreeModel,
  FileTreeOptions as PackageFileTreeOptions,
} from '@pierre/trees';

export interface FileTreeOptions extends Omit<
  PackageFileTreeOptions,
  'paths' | 'initialExpandedPaths' | 'initialSearchQuery'
> {
  initialFiles?: string[];
  lockedPaths?: string[];
  onCollision?: (collision: {
    destination: string;
    origin: string | null;
  }) => boolean;
  useLazyDataLoader?: boolean;
  virtualize?: { threshold: number } | false;
}

export interface FileTreeSelectionItem {
  isFolder: boolean;
  path: string;
}

export interface FileTreeStateConfig {
  expandedItems?: string[];
  files?: string[];
  initialExpandedItems?: string[];
  initialSearchQuery?: string | null;
  initialSelectedItems?: string[];
  onExpandedItemsChange?: (items: string[]) => void;
  onFilesChange?: (files: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;
  selectedItems?: string[];
}

export interface FileTreeSsrPayload {
  domOuterStart: string;
  id: string;
  outerEnd: string;
  outerStart: string;
  shadowHtml: string;
}

export function resolvePaths(
  options: FileTreeOptions,
  stateConfig: FileTreeStateConfig | undefined,
  propsFiles: string[] | undefined
): readonly string[] {
  return propsFiles ?? stateConfig?.files ?? options.initialFiles ?? [];
}

export function toCanonicalOptions(
  options: Omit<FileTreeOptions, 'initialFiles'>,
  paths: readonly string[],
  initialExpandedItems: string[] | undefined,
  initialSearchQuery: string | null | undefined,
  gitStatus: readonly GitStatusEntry[] | undefined
): PackageFileTreeOptions {
  return {
    ...options,
    ...(gitStatus != null ? { gitStatus: [...gitStatus] } : {}),
    ...(initialExpandedItems != null
      ? { initialExpandedPaths: initialExpandedItems }
      : {}),
    ...(initialSearchQuery !== undefined ? { initialSearchQuery } : {}),
    paths,
  };
}

export function mapSelectionItems(
  model: PackageFileTreeModel,
  selectedPaths: readonly string[]
): FileTreeSelectionItem[] {
  return selectedPaths.map((path) => ({
    isFolder: model.getItem(path)?.isDirectory() ?? path.endsWith('/'),
    path,
  }));
}
