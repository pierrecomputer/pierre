import type {
  FeatureImplementation,
  ItemInstance,
  SearchFeatureDataRef,
  TreeConfig,
  TreeInstance,
} from '@headless-tree/core';
import { makeStateUpdater } from '@headless-tree/core';

import type { FileTreeSearchMode } from '../FileTree';
import type { FileTreeNode } from '../types';

type SearchIndex = {
  orderedIds: string[];
  indexById: Map<string, number>;
  parentById: Map<string, string>;
};

type SearchCache<T> = {
  search: string;
  rootItemId: string;
  dataLoader: TreeConfig<T>['dataLoader'];
  matcher: (search: string, item: ItemInstance<T>) => boolean;
  index: SearchIndex;
  matchItems: ItemInstance<T>[];
  matchIds: string[];
  matchIdSet: Set<string>;
};

type FileTreeSearchDataRef<T> = SearchFeatureDataRef<T> & {
  previousExpandedItems?: string[] | null;
  searchCache?: SearchCache<T>;
};

type FileTreeSearchConfig = {
  fileTreeSearchMode?: FileTreeSearchMode;
};

const defaultSearchMatcher = <T>(
  search: string,
  item: ItemInstance<T>
): boolean =>
  search.length > 0 &&
  item.getItemName().toLowerCase().includes(search.toLowerCase());

const getSearchMode = <T>(tree: TreeInstance<T>): FileTreeSearchMode =>
  (tree.getConfig() as FileTreeSearchConfig).fileTreeSearchMode ??
  'expand-matches';

const buildSearchIndex = <T>(
  tree: TreeInstance<T>,
  rootItemId: string
): SearchIndex => {
  const orderedIds: string[] = [];
  const indexById = new Map<string, number>();
  const parentById = new Map<string, string>();

  const walk = (parentId: string) => {
    const children = tree.retrieveChildrenIds(parentId) ?? [];
    for (const childId of children) {
      parentById.set(childId, parentId);
      indexById.set(childId, orderedIds.length);
      orderedIds.push(childId);
      walk(childId);
    }
  };

  walk(rootItemId);

  return { orderedIds, indexById, parentById };
};

const getSearchCache = <T>(tree: TreeInstance<T>): SearchCache<T> => {
  const dataRef = tree.getDataRef<FileTreeSearchDataRef<T>>();
  const config = tree.getConfig();
  const search = tree.getSearchValue();
  const matcher = config.isSearchMatchingItem ?? defaultSearchMatcher;
  const rootItemId = config.rootItemId;
  const dataLoader = config.dataLoader;
  const cached = dataRef.current.searchCache;

  if (
    cached != null &&
    cached.search === search &&
    cached.matcher === matcher &&
    cached.rootItemId === rootItemId &&
    cached.dataLoader === dataLoader
  ) {
    return cached;
  }

  const index = buildSearchIndex(tree, rootItemId);
  const matchIds =
    search.length > 0
      ? index.orderedIds.filter((itemId) =>
          matcher(search, tree.getItemInstance(itemId))
        )
      : [];
  const matchItems = matchIds.map((itemId) => tree.getItemInstance(itemId));
  const matchIdSet = new Set(matchIds);
  const nextCache: SearchCache<T> = {
    search,
    rootItemId,
    dataLoader,
    matcher,
    index,
    matchItems,
    matchIds,
    matchIdSet,
  };

  dataRef.current.searchCache = nextCache;
  dataRef.current.matchingItems = matchItems;
  return nextCache;
};

const addAncestorFolders = (
  parentById: Map<string, string>,
  rootItemId: string,
  itemId: string,
  expandedItems: Set<string>
) => {
  let parentId = parentById.get(itemId);
  while (parentId != null && parentId !== rootItemId) {
    expandedItems.add(parentId);
    parentId = parentById.get(parentId);
  }
};

const expandForMatches = <T>(
  tree: TreeInstance<T>,
  cache: SearchCache<T>,
  baselineExpandedItems: string[],
  expandMatchingFolders: boolean
) => {
  const expandedItems = new Set(baselineExpandedItems);
  const { parentById } = cache.index;
  for (const matchId of cache.matchIds) {
    if (expandMatchingFolders) {
      const children = tree.retrieveChildrenIds(matchId) ?? [];
      if (children.length > 0) {
        expandedItems.add(matchId);
      }
    }
    addAncestorFolders(parentById, cache.rootItemId, matchId, expandedItems);
  }

  tree.applySubStateUpdate('expandedItems', [...expandedItems]);
  tree.rebuildTree();
};

const restoreExpandedItems = <T>(
  tree: TreeInstance<T>,
  previousExpandedItems: string[] | null | undefined,
  keepSelectedOpen: boolean
) => {
  if (previousExpandedItems == null) {
    return;
  }

  const expandedItems = new Set(previousExpandedItems);
  if (keepSelectedOpen) {
    const index = buildSearchIndex(tree, tree.getConfig().rootItemId);
    for (const selectedItem of tree.getSelectedItems()) {
      addAncestorFolders(
        index.parentById,
        tree.getConfig().rootItemId,
        selectedItem.getId(),
        expandedItems
      );
    }
  }

  tree.applySubStateUpdate('expandedItems', [...expandedItems]);
  tree.rebuildTree();
};

export const fileTreeSearchFeature: FeatureImplementation = {
  key: 'file-tree-search',

  getInitialState: (initialState) => ({
    search: null,
    ...initialState,
  }),

  getDefaultConfig: (defaultConfig, tree) => ({
    setSearch: makeStateUpdater('search', tree),
    isSearchMatchingItem: defaultSearchMatcher,
    ...defaultConfig,
  }),

  stateHandlerNames: {
    search: 'setSearch',
  },

  treeInstance: {
    setSearch: ({ tree }, search) => {
      const previousSearch = tree.getState().search;
      const dataRef = tree.getDataRef<FileTreeSearchDataRef<FileTreeNode>>();
      tree.applySubStateUpdate('search', search);

      if (previousSearch == null && search != null) {
        dataRef.current.previousExpandedItems = tree.getState().expandedItems;
      }

      if (search == null) {
        restoreExpandedItems(tree, dataRef.current.previousExpandedItems, true);
        dataRef.current.previousExpandedItems = null;
        dataRef.current.searchCache = undefined;
        dataRef.current.matchingItems = [];
        tree.updateDomFocus();
        return;
      }

      if (search.length === 0) {
        restoreExpandedItems(
          tree,
          dataRef.current.previousExpandedItems,
          false
        );
        dataRef.current.searchCache = undefined;
        dataRef.current.matchingItems = [];
        return;
      }

      const cache = getSearchCache(tree);
      const searchMode = getSearchMode(tree);
      const baselineExpandedItems =
        searchMode === 'collapse-non-matches'
          ? []
          : (dataRef.current.previousExpandedItems ??
            tree.getState().expandedItems);
      expandForMatches(
        tree,
        cache,
        baselineExpandedItems,
        searchMode === 'expand-matches'
      );
      cache.matchItems[0]?.setFocused();
      void cache.matchItems[0]?.scrollTo({
        block: 'nearest',
        inline: 'nearest',
      });
    },
    openSearch: ({ tree }, initialValue = '') => {
      tree.setSearch(initialValue);
      tree.getConfig().onOpenSearch?.();
      setTimeout(() => {
        tree
          .getDataRef<FileTreeSearchDataRef<FileTreeNode>>()
          .current.searchInput?.focus();
      });
    },
    closeSearch: ({ tree }) => {
      tree.setSearch(null);
      tree.getConfig().onCloseSearch?.();
    },
    isSearchOpen: ({ tree }) => tree.getState().search !== null,
    getSearchValue: ({ tree }) => tree.getState().search ?? '',
    registerSearchInputElement: ({ tree }, element) => {
      const dataRef = tree.getDataRef<FileTreeSearchDataRef<FileTreeNode>>();
      dataRef.current.searchInput = element;
      if (element != null && dataRef.current.keydownHandler != null) {
        element.addEventListener('keydown', dataRef.current.keydownHandler);
      }
    },
    getSearchInputElement: ({ tree }) =>
      tree.getDataRef<FileTreeSearchDataRef<FileTreeNode>>().current
        .searchInput ?? null,

    getSearchInputElementProps: ({ tree }) => ({
      value: tree.getSearchValue(),
      onChange: (event: Event) => {
        const target = event.target as HTMLInputElement | null;
        tree.setSearch(target?.value ?? '');
      },
      onBlur: () => tree.closeSearch(),
      ref: tree.registerSearchInputElement,
    }),

    getSearchMatchingItems: ({ tree }) => {
      if (!tree.isSearchOpen()) {
        return [];
      }
      return getSearchCache(tree).matchItems;
    },
  },

  itemInstance: {
    isMatchingSearch: ({ tree, item }) => {
      if (!tree.isSearchOpen()) {
        return false;
      }
      return getSearchCache(tree).matchIdSet.has(item.getId());
    },
  },

  hotkeys: {
    openSearch: {
      hotkey: 'LetterOrNumber',
      preventDefault: true,
      isEnabled: (tree) => !tree.isSearchOpen(),
      handler: (event, tree) => {
        event.stopPropagation();
        tree.openSearch(event.key);
      },
    },
    closeSearch: {
      hotkey: 'Escape',
      allowWhenInputFocused: true,
      isEnabled: (tree) => tree.isSearchOpen(),
      handler: (_event, tree) => {
        tree.closeSearch();
      },
    },
    submitSearch: {
      hotkey: 'Enter',
      allowWhenInputFocused: true,
      isEnabled: (tree) => tree.isSearchOpen(),
      handler: (_event, tree) => {
        tree.setSelectedItems([tree.getFocusedItem().getId()]);
        tree.closeSearch();
      },
    },
    nextSearchItem: {
      hotkey: 'ArrowDown',
      allowWhenInputFocused: true,
      canRepeat: true,
      isEnabled: (tree) => tree.isSearchOpen(),
      handler: (_event, tree) => {
        const cache = getSearchCache(tree);
        const focusedId = tree.getFocusedItem().getId();
        const focusedIndex = cache.index.indexById.get(focusedId) ?? -1;
        const nextMatchId = cache.matchIds.find((matchId) => {
          const matchIndex = cache.index.indexById.get(matchId) ?? -1;
          return matchIndex > focusedIndex;
        });
        if (nextMatchId) {
          const item = tree.getItemInstance(nextMatchId);
          item.setFocused();
          void item.scrollTo({ block: 'nearest', inline: 'nearest' });
        }
      },
    },
    previousSearchItem: {
      hotkey: 'ArrowUp',
      allowWhenInputFocused: true,
      canRepeat: true,
      isEnabled: (tree) => tree.isSearchOpen(),
      handler: (_event, tree) => {
        const cache = getSearchCache(tree);
        const focusedId = tree.getFocusedItem().getId();
        const focusedIndex = cache.index.indexById.get(focusedId) ?? -1;
        for (let i = cache.matchIds.length - 1; i >= 0; i -= 1) {
          const matchId = cache.matchIds[i];
          const matchIndex = cache.index.indexById.get(matchId) ?? -1;
          if (matchIndex < focusedIndex) {
            const item = tree.getItemInstance(matchId);
            item.setFocused();
            void item.scrollTo({ block: 'nearest', inline: 'nearest' });
            break;
          }
        }
      },
    },
  },
};
