import type { TreeDataRef } from '../features/main/types';
import { treeFeature } from '../features/tree/feature';
import type { ItemMeta } from '../features/tree/types';
import { buildPackedVisibleItemMeta } from '../features/tree/visibleItemMeta';
import {
  getBenchmarkInstrumentation,
  setBenchmarkCounter,
  withBenchmarkPhase,
} from '../internal/benchmarkInstrumentation';
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

interface PackedItemMetaStore {
  cache: Array<ItemMeta | undefined>;
  indexById: Record<string, number | undefined>;
  levels: number[];
  parentIds: string[];
  posInSet: number[];
  setSizes: number[];
}

function createPackedItemMetaStore(): PackedItemMetaStore {
  return {
    cache: [],
    indexById: Object.create(null) as Record<string, number | undefined>,
    levels: [],
    parentIds: [],
    posInSet: [],
    setSizes: [],
  };
}

function createFallbackItemMeta(itemId: string): ItemMeta {
  return {
    itemId,
    parentId: null,
    level: -1,
    index: -1,
    posInSet: 0,
    setSize: 1,
  };
}

export const createTree = <T>(
  initialConfig: TreeConfig<T>
): TreeInstance<T> => {
  const benchmarkInstrumentation = getBenchmarkInstrumentation(initialConfig);
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
  let visibleItemIds: string[] = [];
  let itemInstances: ItemInstance<T>[] | null = null;
  const itemElementsMap: Record<string, HTMLElement | undefined | null> = {};
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  const itemDataRefs: Record<string, { current: any }> = {};
  let itemMetaStore = createPackedItemMetaStore();
  let rootItemMeta: ItemMeta = createFallbackItemMeta(initialConfig.rootItemId);

  const hotkeyPresets = {} as HotkeysConfig<T>;

  // Builds and caches a single item instance the first time a caller actually
  // needs it. This lets virtualized renders size/slice the visible tree using
  // IDs alone instead of eagerly materializing every visible item instance.
  const getOrCreateItemInstance = (itemId: string): ItemInstance<T> => {
    const existingInstance = itemInstancesMap[itemId];
    if (existingInstance != null) {
      return existingInstance;
    }

    const [instance, finalizeInstance] = buildInstance(
      features,
      'itemInstance',
      (builtItem) => ({
        item: builtItem,
        tree: treeInstance,
        itemId,
      })
    );
    finalizeInstance();
    itemInstancesMap[itemId] = instance;
    return instance;
  };

  // Rebuilds the synthetic root item instance on every tree rebuild so core's
  // existing instanceBuilder contract stays intact even when visible items are
  // materialized lazily.
  const rebuildRootItemInstance = (): void => {
    const [rootInstance, finalizeRootInstance] = buildInstance(
      features,
      'itemInstance',
      (builtItem) => ({
        item: builtItem,
        tree: treeInstance,
        itemId: config.rootItemId,
      })
    );
    finalizeRootInstance();
    itemInstancesMap[config.rootItemId] = rootInstance;
  };

  const rebuildItemMeta = () => {
    withBenchmarkPhase(benchmarkInstrumentation, 'core.rebuildItemMeta', () => {
      itemInstances = null;
      itemMetaStore = createPackedItemMetaStore();
      rootItemMeta = {
        itemId: config.rootItemId,
        index: -1,
        parentId: null!,
        level: -1,
        posInSet: 0,
        setSize: 1,
      };

      rebuildRootItemInstance();

      // FileTree does not expose generic core feature overrides, so the hot
      // rebuild path intentionally bypasses `tree.getItemsMeta()` and uses the
      // packed traversal directly. If FileTree needs alternate visible-item
      // derivation later, add a dedicated fast path here instead of routing
      // every rebuild through the generic feature hook.
      const packedVisibleMeta = buildPackedVisibleItemMeta(treeInstance);
      itemMetaStore.indexById = packedVisibleMeta.indexById;
      itemMetaStore.parentIds = packedVisibleMeta.parentIds;
      itemMetaStore.levels = packedVisibleMeta.levels;
      itemMetaStore.setSizes = packedVisibleMeta.setSizes;
      itemMetaStore.posInSet = packedVisibleMeta.posInSet;
      itemMetaStore.cache = new Array(packedVisibleMeta.visibleItemIds.length);

      visibleItemIds = packedVisibleMeta.visibleItemIds;
      (treeDataRef.current as TreeDataRef).visibleItemIds = visibleItemIds;
      setBenchmarkCounter(
        benchmarkInstrumentation,
        'workload.visibleItemMeta',
        visibleItemIds.length
      );
      rebuildScheduled = false;
    });
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
      getItemInstance: (_opts, itemId) => getOrCreateItemInstance(itemId),
      getItems: () => {
        if (rebuildScheduled) rebuildItemMeta();
        itemInstances ??= visibleItemIds.map((itemId) =>
          getOrCreateItemInstance(itemId)
        );
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
      getItemMeta: ({ itemId }) => {
        if (itemId === rootItemMeta.itemId) {
          return rootItemMeta;
        }

        const index = itemMetaStore.indexById[itemId];
        if (index === undefined) {
          return createFallbackItemMeta(itemId);
        }

        const cached = itemMetaStore.cache[index];
        if (cached != null) {
          return cached;
        }

        const meta: ItemMeta = {
          itemId,
          parentId: itemMetaStore.parentIds[index] ?? null,
          level: itemMetaStore.levels[index] ?? -1,
          index,
          posInSet: itemMetaStore.posInSet[index] ?? 0,
          setSize: itemMetaStore.setSizes[index] ?? 1,
        };
        itemMetaStore.cache[index] = meta;
        return meta;
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
