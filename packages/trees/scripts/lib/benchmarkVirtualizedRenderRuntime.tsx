/** @jsxImportSource preact */
import type { JSX } from 'preact';
import { useCallback, useMemo, useRef } from 'preact/hooks';

import type { ItemInstance, TreeInstance } from '../../src/core/types/core';
import type { TreeDataRef } from '../../src/features/main/types';
import type { FileTreeOptions, FileTreeStateConfig } from '../../src/FileTree';
import type { SVGSpriteNames } from '../../src/sprite';
import type { FileTreeNode } from '../../src/types';
import type { ChildrenSortOption } from '../../src/utils/sortChildren';

const DEFAULT_ITEM_HEIGHT = 30;
const EMPTY_ANCESTORS: string[] = [];

// Reuses the last rebuild's visible ID list so the benchmark mirrors the real
// virtualized path without forcing full item-instance materialization first.
function getVisibleItemIds(tree: TreeInstance<FileTreeNode>): string[] {
  return (
    tree.getDataRef<TreeDataRef>().current.visibleItemIds ??
    tree.getItems().map((item) => item.getId())
  );
}

export interface BenchmarkVirtualRange {
  start: number;
  end: number;
}

export interface BenchmarkVirtualizedRootProps {
  fileTreeOptions: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  virtualizedRenderWindow: {
    range: BenchmarkVirtualRange;
    itemHeight?: number;
    viewportHeight?: number;
  };
}

interface BenchmarkRuntimeModules {
  FileTree: new (
    options: FileTreeOptions,
    stateConfig?: FileTreeStateConfig
  ) => {
    options: FileTreeOptions;
    stateConfig: FileTreeStateConfig;
  };
  normalizeInputPath: (
    path: string
  ) => { path: string; isDirectory: boolean } | null;
  forEachFolderInNormalizedPath: (
    path: string,
    isDirectory: boolean,
    visitFolder: (folderPath: string) => void
  ) => void;
  computeStickyWindowLayout: (args: {
    range: BenchmarkVirtualRange;
    itemCount: number;
    itemHeight: number;
    viewportHeight: number;
  }) => {
    totalHeight: number;
    offsetHeight: number;
    windowHeight: number;
    stickyInset: number;
  };
  syncDataLoaderFeature: unknown;
  selectionFeature: unknown;
  hotkeysCoreFeature: unknown;
  fileTreeSearchFeature: unknown;
  getSearchVisibleIdSet: (
    tree: TreeInstance<FileTreeNode>
  ) => Set<string> | null;
  gitStatusFeature: unknown;
  getGitStatusMap: (tree: TreeInstance<FileTreeNode>) => {
    statusById: Map<string, string>;
    foldersWithChanges: Set<string>;
  } | null;
  contextMenuFeature: unknown;
  propMemoizationFeature: unknown;
  generateLazyDataLoader: (
    files: string[],
    options: {
      flattenEmptyDirectories?: boolean;
      sortComparator?: ChildrenSortOption | undefined;
    }
  ) => unknown;
  generateSyncDataLoaderFromTreeData: (
    treeData: Record<string, FileTreeNode>,
    options: { flattenEmptyDirectories?: boolean }
  ) => unknown;
  fileListToTree: (
    files: string[],
    options: { sortComparator?: ChildrenSortOption | undefined }
  ) => Record<string, FileTreeNode>;
  getGitStatusSignature: (entries: FileTreeOptions['gitStatus']) => string;
  useTreeStateConfig: (args: {
    treeData: Record<string, FileTreeNode>;
    pathToId: Map<string, string>;
    stateConfig: FileTreeStateConfig | undefined;
    flattenEmptyDirectories: boolean | undefined;
  }) => {
    initialState?: Record<string, unknown>;
    state?: Record<string, unknown>;
  };
  useTree: (config: Record<string, unknown>) => TreeInstance<FileTreeNode>;
  TreeItem: (props: Record<string, unknown>) => JSX.Element;
}

export interface BenchmarkRenderRuntime {
  FileTree: BenchmarkRuntimeModules['FileTree'];
  normalizeInputPath: BenchmarkRuntimeModules['normalizeInputPath'];
  forEachFolderInNormalizedPath: BenchmarkRuntimeModules['forEachFolderInNormalizedPath'];
  BenchmarkVirtualizedRoot: (
    props: BenchmarkVirtualizedRootProps
  ) => JSX.Element;
}

function importDistModule(
  relativePath: string
): Promise<Record<string, unknown>> {
  return import(new URL(relativePath, import.meta.url).href) as Promise<
    Record<string, unknown>
  >;
}

function normalizeRange(
  range: BenchmarkVirtualRange,
  itemCount: number
): BenchmarkVirtualRange {
  if (itemCount <= 0 || range.end < range.start) {
    return { start: 0, end: -1 };
  }
  const start = Math.max(0, Math.min(range.start, itemCount - 1));
  const end = Math.max(start, Math.min(range.end, itemCount - 1));
  return { start, end };
}

function renderRangeChildren(
  range: BenchmarkVirtualRange,
  renderItem: (index: number) => JSX.Element | null
): JSX.Element[] {
  const children: JSX.Element[] = [];
  for (let index = range.start; index <= range.end; index++) {
    const item = renderItem(index);
    if (item != null) {
      children.push(item);
    }
  }
  return children;
}

function createStaticBenchmarkVirtualizedList(
  runtime: BenchmarkRuntimeModules
): (props: {
  itemCount: number;
  renderItem: (index: number) => JSX.Element | null;
  range: BenchmarkVirtualRange;
  itemHeight?: number;
  viewportHeight?: number;
}) => JSX.Element {
  return function StaticBenchmarkVirtualizedList({
    itemCount,
    renderItem,
    range,
    itemHeight,
    viewportHeight,
  }): JSX.Element {
    'use no memo';
    const resolvedHeight =
      itemHeight != null && itemHeight > 0 ? itemHeight : DEFAULT_ITEM_HEIGHT;
    const resolvedViewportHeight =
      viewportHeight != null && viewportHeight > 0
        ? viewportHeight
        : resolvedHeight;
    const normalizedRange = normalizeRange(range, itemCount);
    const { totalHeight, offsetHeight, windowHeight, stickyInset } =
      runtime.computeStickyWindowLayout({
        range: normalizedRange,
        itemCount,
        itemHeight: resolvedHeight,
        viewportHeight: resolvedViewportHeight,
      });

    return (
      <div
        data-file-tree-virtualized-list="true"
        style={{ height: `${totalHeight}px` }}
      >
        <div
          data-file-tree-virtualized-sticky-offset="true"
          aria-hidden="true"
          style={{ height: `${offsetHeight}px` }}
        />
        <div
          data-file-tree-virtualized-sticky="true"
          style={{
            height: `${windowHeight}px`,
            top: `${stickyInset}px`,
            bottom: `${stickyInset}px`,
          }}
        >
          {renderRangeChildren(normalizedRange, renderItem)}
        </div>
      </div>
    );
  };
}

function createBenchmarkVirtualizedRoot(
  runtime: BenchmarkRuntimeModules
): (props: BenchmarkVirtualizedRootProps) => JSX.Element {
  const StaticBenchmarkVirtualizedList =
    createStaticBenchmarkVirtualizedList(runtime);

  return function BenchmarkVirtualizedRoot({
    fileTreeOptions,
    stateConfig,
    virtualizedRenderWindow,
  }: BenchmarkVirtualizedRootProps): JSX.Element {
    'use no memo';
    const {
      initialFiles: files,
      flattenEmptyDirectories,
      fileTreeSearchMode,
      gitStatus,
      search,
      sort: sortOption,
      useLazyDataLoader,
      virtualize,
    } = fileTreeOptions;
    const iconRemap = fileTreeOptions.icons?.remap;

    const remapIcon = useCallback(
      (
        name: SVGSpriteNames
      ): {
        name: string;
        remappedFrom?: string;
        width?: number;
        height?: number;
        viewBox?: string;
      } => {
        const entry = iconRemap?.[name];
        if (entry == null) return { name };
        if (typeof entry === 'string') {
          return { name: entry, remappedFrom: name };
        }
        return { ...entry, remappedFrom: name };
      },
      [iconRemap]
    );

    const treeDomId = useMemo(() => {
      const base = fileTreeOptions.id ?? 'ft';
      const safe = base.replace(/[^A-Za-z0-9_-]/g, '_');
      return `ft-${safe}`;
    }, [fileTreeOptions.id]);

    const sortComparator = useMemo<ChildrenSortOption | undefined>(
      () =>
        sortOption === false
          ? false
          : sortOption != null && typeof sortOption === 'object'
            ? sortOption.comparator
            : undefined,
      [sortOption]
    );

    const treeData = useMemo(
      () => runtime.fileListToTree(files, { sortComparator }),
      [files, sortComparator]
    );

    const { pathToId, idToPath } = useMemo(() => {
      const p2i = new Map<string, string>();
      const i2p = new Map<string, string>();
      for (const [id, node] of Object.entries(treeData)) {
        p2i.set(node.path, id);
        i2p.set(id, node.path);
      }
      return { pathToId: p2i, idToPath: i2p };
    }, [treeData]);

    const ancestorChainsCacheRef = useRef<Map<string, string[]>>(new Map());
    const prevIdToPathForCacheRef = useRef(idToPath);
    if (prevIdToPathForCacheRef.current !== idToPath) {
      prevIdToPathForCacheRef.current = idToPath;
      ancestorChainsCacheRef.current.clear();
    }

    const restTreeConfig = runtime.useTreeStateConfig({
      treeData,
      pathToId,
      stateConfig,
      flattenEmptyDirectories,
    });

    const dataLoader = useMemo(
      () =>
        useLazyDataLoader === true
          ? runtime.generateLazyDataLoader(files, {
              flattenEmptyDirectories,
              sortComparator,
            })
          : runtime.generateSyncDataLoaderFromTreeData(treeData, {
              flattenEmptyDirectories,
            }),
      [
        files,
        flattenEmptyDirectories,
        sortComparator,
        treeData,
        useLazyDataLoader,
      ]
    );

    const features = useMemo(
      () => [
        runtime.syncDataLoaderFeature,
        runtime.selectionFeature,
        runtime.hotkeysCoreFeature,
        runtime.fileTreeSearchFeature,
        runtime.gitStatusFeature,
        runtime.contextMenuFeature,
        runtime.propMemoizationFeature,
      ],
      []
    );

    const tree = runtime.useTree({
      ...restTreeConfig,
      fileTreeSearchMode,
      search,
      gitStatus,
      gitStatusSignature: runtime.getGitStatusSignature(gitStatus),
      gitStatusPathToId: pathToId,
      contextMenuEnabled: false,
      rootItemId: 'root',
      dataLoader,
      getItemName: (item: ItemInstance<FileTreeNode>) =>
        item.getItemData().name,
      isItemFolder: (item: ItemInstance<FileTreeNode>) =>
        item.getItemData()?.children?.direct != null,
      hotkeys: {},
      features,
    });

    const getAncestors = useCallback(
      (itemId: string): string[] => {
        const cache = ancestorChainsCacheRef.current;
        const resolve = (id: string): string[] => {
          const cached = cache.get(id);
          if (cached != null) return cached;

          const parentId = tree.getItemInstance(id).getItemMeta().parentId;
          if (parentId == null || parentId === 'root') {
            cache.set(id, EMPTY_ANCESTORS);
            return EMPTY_ANCESTORS;
          }

          const chain = [...resolve(parentId), parentId];
          cache.set(id, chain);
          return chain;
        };
        return resolve(itemId);
      },
      [tree]
    );

    const focusedItemId = tree.getState().focusedItem ?? null;
    const hasFocusedItem = focusedItemId != null;
    const shouldVirtualize = virtualize != null && virtualize !== false;
    const virtualizeThreshold = shouldVirtualize
      ? Math.max(0, virtualize.threshold)
      : Number.POSITIVE_INFINITY;
    const containerProps = tree.getContainerProps();
    const visibleIdSet = runtime.getSearchVisibleIdSet(tree);
    const gitStatusMap = runtime.getGitStatusMap(tree);
    const allItemIds = getVisibleItemIds(tree);
    const itemIds =
      visibleIdSet != null
        ? allItemIds.filter((itemId) => visibleIdSet.has(itemId))
        : allItemIds;

    const renderItemAtIndex = (index: number) => {
      const itemId = itemIds[index];
      if (itemId == null) {
        return null;
      }

      const item = tree.getItemInstance(itemId);
      const itemData = item.getItemData();
      const itemMeta = item.getItemMeta();
      const hasChildren = itemData?.children?.direct != null;
      const itemGitStatus = gitStatusMap?.statusById.get(itemId);
      const itemContainsGitChange =
        hasChildren && (gitStatusMap?.foldersWithChanges.has(itemId) ?? false);

      return (
        <runtime.TreeItem
          key={itemId}
          item={item}
          tree={tree}
          itemId={itemId}
          hasChildren={hasChildren}
          isExpanded={hasChildren && item.isExpanded()}
          itemName={item.getItemName()}
          level={itemMeta.level}
          isSelected={item.isSelected()}
          isFocused={hasFocusedItem && item.isFocused()}
          isSearchMatch={item.isMatchingSearch()}
          isDragTarget={false}
          isDragging={false}
          isDnD={false}
          isRenaming={item.isRenaming?.() === true}
          isFlattenedDirectory={itemData?.flattens != null}
          isLocked={false}
          gitStatus={itemGitStatus}
          containsGitChange={itemContainsGitChange ?? false}
          flattens={itemData?.flattens}
          idToPath={idToPath}
          ancestors={getAncestors(itemId)}
          treeDomId={treeDomId}
          remapIcon={remapIcon}
          detectFlattenedSubfolder={() => {}}
          clearFlattenedSubfolder={() => {}}
        />
      );
    };

    return (
      <div
        {...containerProps}
        id={treeDomId}
        data-file-tree-virtualized-root={shouldVirtualize ? 'true' : undefined}
      >
        {shouldVirtualize &&
        itemIds.length > 0 &&
        itemIds.length >= virtualizeThreshold ? (
          <div data-file-tree-virtualized-scroll="true">
            <StaticBenchmarkVirtualizedList
              itemCount={itemIds.length}
              renderItem={renderItemAtIndex}
              range={virtualizedRenderWindow.range}
              itemHeight={virtualizedRenderWindow.itemHeight}
              viewportHeight={virtualizedRenderWindow.viewportHeight}
            />
          </div>
        ) : (
          itemIds.map((_, index) => renderItemAtIndex(index))
        )}
      </div>
    );
  };
}

export async function loadBenchmarkVirtualizedRenderRuntime(): Promise<BenchmarkRenderRuntime> {
  const [
    fileTreeModule,
    normalizeInputPathModule,
    virtualizedListModule,
    syncLoaderModule,
    lazyLoaderModule,
    fileListToTreeModule,
    searchFeatureModule,
    gitStatusFeatureModule,
    gitStatusSignatureModule,
    treeStateConfigModule,
    useTreeModule,
    treeItemModule,
    selectionFeatureModule,
    hotkeysCoreFeatureModule,
    contextMenuFeatureModule,
    propMemoizationFeatureModule,
    syncDataLoaderFeatureModule,
  ] = await Promise.all([
    importDistModule('../../dist/FileTree.js'),
    importDistModule('../../dist/utils/normalizeInputPath.js'),
    importDistModule('../../dist/components/VirtualizedList.js'),
    importDistModule('../../dist/loader/sync.js'),
    importDistModule('../../dist/loader/lazy.js'),
    importDistModule('../../dist/utils/fileListToTree.js'),
    importDistModule('../../dist/features/search/feature.js'),
    importDistModule('../../dist/features/git-status/feature.js'),
    importDistModule('../../dist/utils/getGitStatusSignature.js'),
    importDistModule('../../dist/components/hooks/useTreeStateConfig.js'),
    importDistModule('../../dist/components/hooks/useTree.js'),
    importDistModule('../../dist/components/TreeItem.js'),
    importDistModule('../../dist/features/selection/feature.js'),
    importDistModule('../../dist/features/hotkeys-core/feature.js'),
    importDistModule('../../dist/features/context-menu/feature.js'),
    importDistModule('../../dist/features/prop-memoization/feature.js'),
    importDistModule('../../dist/features/sync-data-loader/feature.js'),
  ]);

  const runtime: BenchmarkRuntimeModules = {
    FileTree: fileTreeModule.FileTree as BenchmarkRuntimeModules['FileTree'],
    normalizeInputPath:
      normalizeInputPathModule.normalizeInputPath as BenchmarkRuntimeModules['normalizeInputPath'],
    forEachFolderInNormalizedPath:
      normalizeInputPathModule.forEachFolderInNormalizedPath as BenchmarkRuntimeModules['forEachFolderInNormalizedPath'],
    computeStickyWindowLayout:
      virtualizedListModule.computeStickyWindowLayout as BenchmarkRuntimeModules['computeStickyWindowLayout'],
    syncDataLoaderFeature: syncDataLoaderFeatureModule.syncDataLoaderFeature,
    selectionFeature: selectionFeatureModule.selectionFeature,
    hotkeysCoreFeature: hotkeysCoreFeatureModule.hotkeysCoreFeature,
    fileTreeSearchFeature: searchFeatureModule.fileTreeSearchFeature,
    getSearchVisibleIdSet:
      searchFeatureModule.getSearchVisibleIdSet as BenchmarkRuntimeModules['getSearchVisibleIdSet'],
    gitStatusFeature: gitStatusFeatureModule.gitStatusFeature,
    getGitStatusMap:
      gitStatusFeatureModule.getGitStatusMap as BenchmarkRuntimeModules['getGitStatusMap'],
    contextMenuFeature: contextMenuFeatureModule.contextMenuFeature,
    propMemoizationFeature: propMemoizationFeatureModule.propMemoizationFeature,
    generateLazyDataLoader:
      lazyLoaderModule.generateLazyDataLoader as BenchmarkRuntimeModules['generateLazyDataLoader'],
    generateSyncDataLoaderFromTreeData:
      syncLoaderModule.generateSyncDataLoaderFromTreeData as BenchmarkRuntimeModules['generateSyncDataLoaderFromTreeData'],
    fileListToTree:
      fileListToTreeModule.fileListToTree as BenchmarkRuntimeModules['fileListToTree'],
    getGitStatusSignature:
      gitStatusSignatureModule.getGitStatusSignature as BenchmarkRuntimeModules['getGitStatusSignature'],
    useTreeStateConfig:
      treeStateConfigModule.useTreeStateConfig as BenchmarkRuntimeModules['useTreeStateConfig'],
    useTree: useTreeModule.useTree as BenchmarkRuntimeModules['useTree'],
    TreeItem: treeItemModule.TreeItem as BenchmarkRuntimeModules['TreeItem'],
  };

  return {
    FileTree: runtime.FileTree,
    normalizeInputPath: runtime.normalizeInputPath,
    forEachFolderInNormalizedPath: runtime.forEachFolderInNormalizedPath,
    BenchmarkVirtualizedRoot: createBenchmarkVirtualizedRoot(runtime),
  };
}
