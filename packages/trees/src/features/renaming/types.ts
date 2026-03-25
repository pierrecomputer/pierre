import type { ItemInstance, SetStateFn } from '../../core/types/core';

export type RenamingFeatureDef<T> = {
  state: {
    renamingItem?: string | null;
    renamingValue?: string;
  };
  config: {
    setRenamingItem?: SetStateFn<string | null | undefined>;
    setRenamingValue?: SetStateFn<string | undefined>;
    canRename?: (item: ItemInstance<T>) => boolean;
    onRename?: (item: ItemInstance<T>, value: string) => void;
  };
  treeInstance: {
    // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents
    getRenamingItem: () => ItemInstance<T> | null;
    getRenamingValue: () => string;
    abortRenaming: () => void;
    completeRenaming: () => void;
    isRenamingItem: () => boolean;
  };
  itemInstance: {
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    getRenameInputProps: () => any;
    canRename: () => boolean;
    isRenaming: () => boolean;
    startRenaming: () => void;
  };
  hotkeys: 'renameItem' | 'abortRenaming' | 'completeRenaming';
};
