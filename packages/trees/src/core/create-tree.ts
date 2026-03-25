import type { TreeDataRef } from '../features/main/types';
import { treeFeature } from '../features/tree/feature';
import type { ItemMeta } from '../features/tree/types';
/* oxlint-disable typescript-eslint/no-unsafe-return, typescript-eslint/strict-boolean-expressions */
import { buildStaticInstance } from './build-static-instance';
import {
  type FeatureImplementation,
  type HotkeysConfig,
  type ItemInstance,
  type TreeConfig,
  type TreeInstance,
  type TreeState,
  type Updater,
} from './types/core';
import { throwError } from './utilities/errors';

const verifyFeatures = (features: FeatureImplementation[] | undefined) => {
  const loadedFeatures = features?.map((feature) => feature.key);
  for (const feature of features ?? []) {
    const missingDependency = feature.deps?.find(
      (dep) => loadedFeatures?.includes(dep) !== true
    );
    if (missingDependency) {
      throw throwError(`${feature.key} needs ${missingDependency}`);
    }
  }
};

// Check all possible pairs and sort the array
const exhaustiveSort = <T>(
  arr: T[],
  compareFn: (param1: T, param2: T) => number
) => {
  const n = arr.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (compareFn(arr[j], arr[i]) < 0) {
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
  }

  return arr;
};

const compareFeatures =
  (originalOrder: FeatureImplementation[]) =>
  (feature1: FeatureImplementation, feature2: FeatureImplementation) => {
    if (feature2.key && feature1.overwrites?.includes(feature2.key) === true) {
      return 1;
    }
    if (feature1.key && feature2.overwrites?.includes(feature1.key) === true) {
      return -1;
    }

    return originalOrder.indexOf(feature1) - originalOrder.indexOf(feature2);
  };

const sortFeatures = (features: FeatureImplementation[] = []) =>
  exhaustiveSort(features, compareFeatures(features));

export const createTree = <T>(
  initialConfig: TreeConfig<T>
): TreeInstance<T> => {
  const buildInstance = initialConfig.instanceBuilder ?? buildStaticInstance;
  const additionalFeatures = [
    treeFeature,
    ...sortFeatures(initialConfig.features),
  ];
  verifyFeatures(additionalFeatures);
  const features = [...additionalFeatures];

  const [treeInstance, finalizeTree] = buildInstance(
    features,
    'treeInstance',
    (tree) => ({ tree })
  );

  let state = additionalFeatures.reduce(
    (acc, feature) => feature.getInitialState?.(acc, treeInstance) ?? acc,
    initialConfig.initialState ?? initialConfig.state ?? {}
  ) as TreeState<T>;
  let config = additionalFeatures.reduce(
    (acc, feature) =>
      (feature.getDefaultConfig?.(acc, treeInstance) as TreeConfig<T>) ?? acc,
    initialConfig
  );
  const stateHandlerNames = additionalFeatures.reduce(
    (acc, feature) => ({ ...acc, ...feature.stateHandlerNames }),
    {} as Record<string, keyof TreeConfig<T>>
  );

  let treeElement: HTMLElement | undefined | null;
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  const treeDataRef: { current: any } = { current: {} };

  let rebuildScheduled = false;
  const itemInstancesMap: Record<string, ItemInstance<T>> = {};
  let itemInstances: ItemInstance<T>[] = [];
  const itemElementsMap: Record<string, HTMLElement | undefined | null> = {};
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  const itemDataRefs: Record<string, { current: any }> = {};
  let itemMetaMap: Record<string, ItemMeta> = {};

  const hotkeyPresets = {} as HotkeysConfig<T>;

  const rebuildItemMeta = () => {
    itemInstances = [];
    itemMetaMap = {};

    const [rootInstance, finalizeRootInstance] = buildInstance(
      features,
      'itemInstance',
      (item) => ({ item, tree: treeInstance, itemId: config.rootItemId })
    );
    finalizeRootInstance();
    itemInstancesMap[config.rootItemId] = rootInstance;
    itemMetaMap[config.rootItemId] = {
      itemId: config.rootItemId,
      index: -1,
      parentId: null!,
      level: -1,
      posInSet: 0,
      setSize: 1,
    };

    for (const item of treeInstance.getItemsMeta()) {
      itemMetaMap[item.itemId] = item;
      if (itemInstancesMap[item.itemId] == null) {
        const [instance, finalizeInstance] = buildInstance(
          features,
          'itemInstance',
          (instance) => ({
            item: instance,
            tree: treeInstance,
            itemId: item.itemId,
          })
        );
        finalizeInstance();
        itemInstancesMap[item.itemId] = instance;
        itemInstances.push(instance);
      } else {
        itemInstances.push(itemInstancesMap[item.itemId]);
      }
    }

    rebuildScheduled = false;
  };

  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  const eachFeature = (fn: (feature: FeatureImplementation<any>) => void) => {
    for (const feature of additionalFeatures) {
      fn(feature);
    }
  };

  const mainFeature: FeatureImplementation<T> = {
    key: 'main',
    treeInstance: {
      getState: () => state,
      setState: (_opts, _updater) => {
        config.setState?.(state);
      },
      setMounted: (_opts, isMounted) => {
        const ref = treeDataRef.current as TreeDataRef;
        ref.isMounted = isMounted;
        if (isMounted) {
          ref.waitingForMount?.forEach((cb) => cb());
          ref.waitingForMount = [];
        }
      },
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      applySubStateUpdate: <K extends keyof TreeState<any>>(
        // oxlint-disable-next-line no-empty-pattern
        {},
        stateName: K,
        updater: Updater<TreeState<T>[K]>
      ) => {
        const apply = () => {
          state[stateName] =
            typeof updater === 'function' ? updater(state[stateName]) : updater;
          const externalStateSetter = config[
            stateHandlerNames[stateName]
          ] as Function;
          externalStateSetter?.(state[stateName]);
        };
        const ref = treeDataRef.current as TreeDataRef;
        if (ref.isMounted === true) {
          apply();
        } else {
          ref.waitingForMount ??= [];
          ref.waitingForMount.push(apply);
        }
      },
      rebuildTree: () => {
        const ref = treeDataRef.current as TreeDataRef;
        if (ref.isMounted === true) {
          rebuildItemMeta();
          config.setState?.(state);
        } else {
          ref.waitingForMount ??= [];
          ref.waitingForMount.push(() => {
            rebuildItemMeta();
            config.setState?.(state);
          });
        }
      },
      scheduleRebuildTree: () => {
        rebuildScheduled = true;
      },
      getConfig: () => config,
      setConfig: (_, updater) => {
        const newConfig =
          typeof updater === 'function' ? updater(config) : updater;
        const hasChangedExpandedItems =
          newConfig.state?.expandedItems != null &&
          newConfig.state?.expandedItems !== state.expandedItems;
        config = newConfig;

        if (newConfig.state != null) {
          state = { ...state, ...newConfig.state };
        }
        if (hasChangedExpandedItems === true) {
          // if expanded items where changed from the outside
          rebuildItemMeta();
          config.setState?.(state);
        }
      },
      getItemInstance: (_opts, itemId) => {
        const existingInstance = itemInstancesMap[itemId];
        if (existingInstance == null) {
          const [instance, finalizeInstance] = buildInstance(
            features,
            'itemInstance',
            (instance) => ({
              item: instance,
              tree: treeInstance,
              itemId,
            })
          );
          finalizeInstance();
          return instance;
        }
        return existingInstance;
      },
      getItems: () => {
        if (rebuildScheduled) rebuildItemMeta();
        return itemInstances;
      },
      registerElement: (_opts, element) => {
        if (treeElement === element) {
          return;
        }

        if (treeElement != null && element == null) {
          eachFeature((feature) =>
            feature.onTreeUnmount?.(treeInstance, treeElement!)
          );
        } else if (treeElement == null && element != null) {
          eachFeature((feature) =>
            feature.onTreeMount?.(treeInstance, element)
          );
        }
        treeElement = element;
      },
      getElement: () => treeElement,
      getDataRef: () => treeDataRef,
      getHotkeyPresets: () => hotkeyPresets,
    },
    itemInstance: {
      registerElement: ({ itemId, item }, element) => {
        if (itemElementsMap[itemId] === element) {
          return;
        }

        const oldElement = itemElementsMap[itemId];
        if (oldElement != null && element == null) {
          eachFeature((feature) =>
            feature.onItemUnmount?.(item, oldElement, treeInstance)
          );
        } else if (oldElement == null && element != null) {
          eachFeature((feature) =>
            feature.onItemMount?.(item, element, treeInstance)
          );
        }
        itemElementsMap[itemId] = element;
      },
      getElement: ({ itemId }) => itemElementsMap[itemId],
      getDataRef: ({ itemId }) => (itemDataRefs[itemId] ??= { current: {} }),
      getItemMeta: ({ itemId }) =>
        itemMetaMap[itemId] ?? {
          itemId,
          parentId: null,
          level: -1,
          index: -1,
          posInSet: 0,
          setSize: 1,
        },
    },
  };

  features.unshift(mainFeature);

  for (const feature of features) {
    Object.assign(hotkeyPresets, feature.hotkeys ?? {});
  }

  finalizeTree();

  // oxlint-disable-next-line typescript-eslint/no-unsafe-return
  return treeInstance;
};
