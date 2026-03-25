import type { SetStateFn } from '../../types/core';

export enum CheckedState {
  Checked = 'checked',
  Unchecked = 'unchecked',
  Indeterminate = 'indeterminate',
}

// oxlint-disable-next-line no-unused-vars -- T required by RegisteredFeatures<T> union
export type CheckboxesFeatureDef<T> = {
  state: {
    checkedItems: string[];
    loadingCheckPropagationItems: string[];
  };
  config: {
    setCheckedItems?: SetStateFn<string[]>;
    setLoadingCheckPropagationItems?: SetStateFn<string[]>;
    canCheckFolders?: boolean;
    propagateCheckedState?: boolean;
  };
  treeInstance: {
    setCheckedItems: (checkedItems: string[]) => void;
  };
  itemInstance: {
    /** Will recursively load descendants if propagateCheckedState=true and async data loader is used. If not,
     * this will return immediately. */
    setChecked: () => Promise<void>;

    /** Will recursively load descendants if propagateCheckedState=true and async data loader is used. If not,
     * this will return immediately. */
    setUnchecked: () => Promise<void>;

    /** Will recursively load descendants if propagateCheckedState=true and async data loader is used. If not,
     * this will return immediately. */
    toggleCheckedState: () => Promise<void>;

    getCheckedState: () => CheckedState;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    getCheckboxProps: () => Record<string, any>;

    isLoadingCheckPropagation: () => boolean;
  };
  hotkeys: never;
};
