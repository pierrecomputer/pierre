import {
  type FeatureImplementation,
  type HotkeysConfig,
  type ItemInstance,
  type SetStateFn,
  type TreeConfig,
  type TreeInstance,
  type TreeState,
  type Updater,
} from '../../core/types/core';
import type { ItemMeta } from '../tree/types';

export interface TreeDataRef {
  isMounted?: boolean;
  waitingForMount?: (() => void)[];
  /**
   * Cached visible item IDs from the latest rebuild. Virtualized renderers can
   * use this to size and slice the visible tree without materializing every
   * item instance up front.
   */
  visibleItemIds?: string[];
}

export type InstanceTypeMap = {
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  itemInstance: ItemInstance<any>;
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  treeInstance: TreeInstance<any>;
};

export type InstanceBuilder = <T extends keyof InstanceTypeMap>(
  features: FeatureImplementation[],
  instanceType: T,
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  buildOpts: (self: any) => any
) => [instance: InstanceTypeMap[T], finalize: () => void];

// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type MainFeatureDef<T = any> = {
  state: {};
  config: {
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    features?: FeatureImplementation<any>[];
    initialState?: Partial<TreeState<T>>;
    state?: Partial<TreeState<T>>;
    setState?: SetStateFn<Partial<TreeState<T>>>;
    instanceBuilder?: InstanceBuilder;
  };
  treeInstance: {
    /** @internal */
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    applySubStateUpdate: <K extends keyof TreeState<any>>(
      stateName: K,
      updater: Updater<TreeState<T>[K]>
    ) => void;
    setState: SetStateFn<TreeState<T>>;
    getState: () => TreeState<T>;
    setConfig: SetStateFn<TreeConfig<T>>;
    getConfig: () => TreeConfig<T>;
    getItemInstance: (itemId: string) => ItemInstance<T>;
    getItems: () => ItemInstance<T>[];
    registerElement: (element: HTMLElement | null) => void;
    getElement: () => HTMLElement | undefined | null;
    /** @internal */
    getDataRef: <D>() => { current: D };
    /* @internal */
    getHotkeyPresets: () => HotkeysConfig<T>;
    rebuildTree: () => void;
    /** @deprecated Experimental feature, might get removed or changed in the future. */
    scheduleRebuildTree: () => void;
    /** @internal */
    setMounted: (isMounted: boolean) => void;
  };
  itemInstance: {
    registerElement: (element: HTMLElement | null) => void;
    getItemMeta: () => ItemMeta;
    getElement: () => HTMLElement | undefined | null;
    /** @internal */
    getDataRef: <D>() => { current: D };
  };
  hotkeys: never;
};
