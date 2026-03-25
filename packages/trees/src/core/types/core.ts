import type { AsyncDataLoaderFeatureDef } from '../../features/async-data-loader/types';
import type { DragAndDropFeatureDef } from '../../features/drag-and-drop/types';
import type { ExpandAllFeatureDef } from '../../features/expand-all/types';
import {
  type HotkeyConfig,
  type HotkeysCoreFeatureDef,
} from '../../features/hotkeys-core/types';
import type { KeyboardDragAndDropFeatureDef } from '../../features/keyboard-drag-and-drop/types';
import type { MainFeatureDef } from '../../features/main/types';
import type { PropMemoizationFeatureDef } from '../../features/prop-memoization/types';
import type { RenamingFeatureDef } from '../../features/renaming/types';
import type { SearchFeatureDef } from '../../features/search/types';
import type { SelectionFeatureDef } from '../../features/selection/types';
import type { SyncDataLoaderFeatureDef } from '../../features/sync-data-loader/types';
import type { TreeFeatureDef } from '../../features/tree/types';

export type Updater<T> = T | ((old: T) => T);
export type SetStateFn<T> = (updaterOrValue: Updater<T>) => void;

export type FeatureDef = {
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  state: any;
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  config: any;
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  treeInstance: any;
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  itemInstance: any;
  hotkeys: string;
};

export type EmptyFeatureDef = {
  state: {};
  config: {};
  treeInstance: {};
  itemInstance: {};
  hotkeys: never;
};

// oxlint-disable-next-line typescript-eslint/no-explicit-any
type UnionToIntersection<T> = (T extends any ? (x: T) => any : never) extends (
  x: infer R
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
) => any
  ? R
  : never;

type MergedFeatures<F extends FeatureDef> = {
  // type can't be removed because it's used for individual feature sets as feature deps in feature implementations
  // to my future self, yes I'm already aware this sounds dumb when I first write this
  state: UnionToIntersection<F['state']>;
  config: UnionToIntersection<F['config']>;
  treeInstance: UnionToIntersection<F['treeInstance']>;
  itemInstance: UnionToIntersection<F['itemInstance']>;
  hotkeys: F['hotkeys'];
};

export type RegisteredFeatures<T> =
  | MainFeatureDef<T>
  | TreeFeatureDef<T>
  | SelectionFeatureDef<T>
  | DragAndDropFeatureDef<T>
  | KeyboardDragAndDropFeatureDef<T>
  | HotkeysCoreFeatureDef<T>
  | SyncDataLoaderFeatureDef<T>
  | AsyncDataLoaderFeatureDef<T>
  | SearchFeatureDef<T>
  | RenamingFeatureDef<T>
  | ExpandAllFeatureDef
  | PropMemoizationFeatureDef;

type TreeStateType<T> = MergedFeatures<RegisteredFeatures<T>>['state'];
export interface TreeState<T> extends TreeStateType<T> {}

type TreeConfigType<T> = MergedFeatures<RegisteredFeatures<T>>['config'];
export interface TreeConfig<T> extends TreeConfigType<T> {}

type TreeInstanceType<T> = MergedFeatures<
  RegisteredFeatures<T>
>['treeInstance'];
export interface TreeInstance<T> extends TreeInstanceType<T> {}

type ItemInstanceType<T> = MergedFeatures<
  RegisteredFeatures<T>
>['itemInstance'];
export interface ItemInstance<T> extends ItemInstanceType<T> {}

// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type HotkeyName = MergedFeatures<RegisteredFeatures<any>>['hotkeys'];

export type HotkeysConfig<T> = Record<HotkeyName, HotkeyConfig<T>>;

export type CustomHotkeysConfig<T> = Partial<
  Record<HotkeyName | `custom${string}`, Partial<HotkeyConfig<T>>>
>;

// oxlint-disable-next-line typescript-eslint/no-explicit-any
type MayReturnNull<T extends (...x: any[]) => any> = (
  ...args: Parameters<T>
) => ReturnType<T> | null;

// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type ItemInstanceOpts<T, Key extends keyof ItemInstance<any>> = {
  item: ItemInstance<T>;
  tree: TreeInstance<T>;
  itemId: string;
  prev?: MayReturnNull<ItemInstance<T>[Key]>;
};

// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type TreeInstanceOpts<Key extends keyof TreeInstance<any>> = {
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  tree: TreeInstance<any>;
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  prev?: MayReturnNull<TreeInstance<any>[Key]>;
};

// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type FeatureImplementation<T = any> = {
  key?: string;
  deps?: string[];
  overwrites?: string[];

  stateHandlerNames?: Partial<Record<keyof TreeState<T>, keyof TreeConfig<T>>>;

  getInitialState?: (
    initialState: Partial<TreeState<T>>,
    tree: TreeInstance<T>
  ) => Partial<TreeState<T>>;

  getDefaultConfig?: (
    defaultConfig: Partial<TreeConfig<T>>,
    tree: TreeInstance<T>
  ) => Partial<TreeConfig<T>>;

  treeInstance?: {
    [key in keyof TreeInstance<T>]?: (
      opts: TreeInstanceOpts<key>,
      ...args: Parameters<TreeInstance<T>[key]>
    ) => void;
  };

  itemInstance?: {
    [key in keyof ItemInstance<T>]?: (
      opts: ItemInstanceOpts<T, key>,
      ...args: Parameters<ItemInstance<T>[key]>
    ) => void;
  };

  onTreeMount?: (instance: TreeInstance<T>, treeElement: HTMLElement) => void;

  onTreeUnmount?: (instance: TreeInstance<T>, treeElement: HTMLElement) => void;

  onItemMount?: (
    instance: ItemInstance<T>,
    itemElement: HTMLElement,
    tree: TreeInstance<T>
  ) => void;

  onItemUnmount?: (
    instance: ItemInstance<T>,
    itemElement: HTMLElement,
    tree: TreeInstance<T>
  ) => void;

  hotkeys?: Partial<HotkeysConfig<T>>;
};
