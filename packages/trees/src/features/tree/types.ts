import type {
  ItemInstance,
  SetStateFn,
  TreeInstance,
} from '../../core/types/core';

export interface ItemMeta {
  itemId: string;
  parentId: string | null;
  level: number;
  index: number;
  setSize: number;
  posInSet: number;
}

export type TreeFeatureDef<T> = {
  state: {
    expandedItems: string[];
    focusedItem: string | null;
  };
  config: {
    isItemFolder: (item: ItemInstance<T>) => boolean; // TODO:breaking use item data as payload
    getItemName: (item: ItemInstance<T>) => string;

    onPrimaryAction?: (item: ItemInstance<T>) => void;
    scrollToItem?: (item: ItemInstance<T>) => void;

    setExpandedItems?: SetStateFn<string[]>;
    setFocusedItem?: SetStateFn<string | null>;
  };
  treeInstance: {
    /** @internal */
    getItemsMeta: () => ItemMeta[];

    getFocusedItem: () => ItemInstance<T>;
    getRootItem: () => ItemInstance<T>;
    focusNextItem: () => void;
    focusPreviousItem: () => void;
    updateDomFocus: () => void;

    /** Pass to the container rendering the tree children. The `treeLabel` parameter
     * will be passed as `aria-label` parameter, and is recommended to be set. */
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    getContainerProps: (treeLabel?: string) => Record<string, any>;
  };
  itemInstance: {
    getId: () => string;
    getKey: () => string;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    getProps: () => Record<string, any>;
    getItemName: () => string;
    getItemData: () => T;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any, typescript-eslint/no-redundant-type-constituents
    equals: (other?: ItemInstance<any> | null) => boolean;
    expand: () => void;
    collapse: () => void;
    isExpanded: () => boolean;
    isDescendentOf: (parentId: string) => boolean;
    isFocused: () => boolean;
    isFolder: () => boolean;
    setFocused: () => void;
    // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents
    getParent: () => ItemInstance<T> | undefined;
    getChildren: () => ItemInstance<T>[];
    getIndexInParent: () => number;
    primaryAction: () => void;
    getTree: () => TreeInstance<T>;
    // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents
    getItemAbove: () => ItemInstance<T> | undefined;
    // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents
    getItemBelow: () => ItemInstance<T> | undefined;
    scrollTo: (
      scrollIntoViewArg?: boolean | ScrollIntoViewOptions
    ) => Promise<void>;
  };
  hotkeys:
    | 'focusNextItem'
    | 'focusPreviousItem'
    | 'expandOrDown'
    | 'collapseOrUp'
    | 'focusFirstItem'
    | 'focusLastItem';
};
