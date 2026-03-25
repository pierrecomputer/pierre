export interface PropMemoizationDataRef {
  memo?: {
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    tree?: Record<string, any>;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    item?: Record<string, any>;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    search?: Record<string, any>;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    rename?: Record<string, any>;
  };
}

export type PropMemoizationFeatureDef = {
  state: {};
  config: {};
  treeInstance: {};
  itemInstance: {};
  hotkeys: never;
};
