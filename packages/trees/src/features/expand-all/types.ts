export type ExpandAllFeatureDef = {
  state: {};
  config: {};
  treeInstance: {
    expandAll: (cancelToken?: { current: boolean }) => Promise<void>;
    collapseAll: () => void;
  };
  itemInstance: {
    expandAll: (cancelToken?: { current: boolean }) => Promise<void>;
    collapseAll: () => void;
  };
  hotkeys: 'expandSelected' | 'collapseSelected';
};
