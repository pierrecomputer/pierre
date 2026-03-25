/* oxlint-disable typescript-eslint/no-unsafe-return, typescript-eslint/strict-boolean-expressions */
import type { FeatureImplementation } from '../../types/core';
import { makeStateUpdater, memo } from '../../utils';
import type { SearchFeatureDataRef } from './types';

export const searchFeature: FeatureImplementation = {
  key: 'search',

  getInitialState: (initialState) => ({
    search: null,
    ...initialState,
  }),

  getDefaultConfig: (defaultConfig, tree) => ({
    setSearch: makeStateUpdater('search', tree),
    isSearchMatchingItem: (search, item) =>
      search.length > 0 &&
      item.getItemName().toLowerCase().includes(search.toLowerCase()),
    ...defaultConfig,
  }),

  stateHandlerNames: {
    search: 'setSearch',
  },

  treeInstance: {
    setSearch: ({ tree }, search) => {
      tree.applySubStateUpdate('search', search);
      tree
        .getItems()
        .find((item) =>
          tree.getConfig().isSearchMatchingItem?.(tree.getSearchValue(), item)
        )
        ?.setFocused();
    },
    openSearch: ({ tree }, initialValue = '') => {
      tree.setSearch(initialValue);
      tree.getConfig().onOpenSearch?.();
      setTimeout(() => {
        tree.getDataRef<SearchFeatureDataRef>().current.searchInput?.focus();
      });
    },
    closeSearch: ({ tree }) => {
      tree.setSearch(null);
      tree.getConfig().onCloseSearch?.();
      tree.updateDomFocus();
    },
    isSearchOpen: ({ tree }) => tree.getState().search !== null,
    getSearchValue: ({ tree }) => tree.getState().search ?? '',
    registerSearchInputElement: ({ tree }, element) => {
      const dataRef = tree.getDataRef<SearchFeatureDataRef>();
      dataRef.current.searchInput = element;
      if (element != null && dataRef.current.keydownHandler != null) {
        element.addEventListener('keydown', dataRef.current.keydownHandler);
      }
    },
    getSearchInputElement: ({ tree }) =>
      tree.getDataRef<SearchFeatureDataRef>().current.searchInput ?? null,

    // TODO memoize with propMemoizationFeature
    getSearchInputElementProps: ({ tree }) => ({
      value: tree.getSearchValue(),
      onChange: (e: { target: { value: string } }) =>
        tree.setSearch(e.target.value),
      onBlur: () => tree.closeSearch(),
      ref: tree.registerSearchInputElement,
    }),

    getSearchMatchingItems: memo(
      ({ tree }) => [
        tree.getSearchValue(),
        tree.getItems(),
        tree.getConfig().isSearchMatchingItem,
      ],
      (search, items, isSearchMatchingItem) =>
        items.filter(
          (item) =>
            search.length > 0 && isSearchMatchingItem?.(search, item) === true
        )
    ),
  },

  itemInstance: {
    isMatchingSearch: ({ tree, item }) =>
      tree.getSearchMatchingItems().some((i) => i.getId() === item.getId()),
  },

  hotkeys: {
    openSearch: {
      hotkey: 'LetterOrNumber',
      preventDefault: true, // TODO make true default
      isEnabled: (tree) => !tree.isSearchOpen(),
      handler: (e, tree) => {
        e.stopPropagation();
        tree.openSearch(e.key);
      },
    },

    closeSearch: {
      // TODO allow multiple, i.e. Enter
      hotkey: 'Escape',
      allowWhenInputFocused: true,
      isEnabled: (tree) => tree.isSearchOpen(),
      handler: (e, tree) => {
        tree.closeSearch();
      },
    },

    submitSearch: {
      hotkey: 'Enter',
      allowWhenInputFocused: true,
      isEnabled: (tree) => tree.isSearchOpen(),
      handler: (e, tree) => {
        tree.closeSearch();
        tree.setSelectedItems([tree.getFocusedItem().getId()]);
      },
    },

    nextSearchItem: {
      hotkey: 'ArrowDown',
      allowWhenInputFocused: true,
      canRepeat: true,
      isEnabled: (tree) => tree.isSearchOpen(),
      handler: (e, tree) => {
        const focusItem = tree
          .getSearchMatchingItems()
          .find(
            (item) =>
              item.getItemMeta().index >
              tree.getFocusedItem().getItemMeta().index
          );
        focusItem?.setFocused();
        void focusItem?.scrollTo({ block: 'nearest', inline: 'nearest' });
      },
    },

    previousSearchItem: {
      hotkey: 'ArrowUp',
      allowWhenInputFocused: true,
      canRepeat: true,
      isEnabled: (tree) => tree.isSearchOpen(),
      handler: (e, tree) => {
        const focusItem = [...tree.getSearchMatchingItems()]
          .reverse()
          .find(
            (item) =>
              item.getItemMeta().index <
              tree.getFocusedItem().getItemMeta().index
          );
        focusItem?.setFocused();
        void focusItem?.scrollTo({ block: 'nearest', inline: 'nearest' });
      },
    },
  },
};
