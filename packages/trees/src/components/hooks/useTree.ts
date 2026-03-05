import {
  createTree,
  type TreeConfig,
  type TreeInstance,
  type TreeState,
} from '@headless-tree/core';
import { useEffect, useRef, useState } from 'preact/hooks';

export const useTree = <T>(config: TreeConfig<T>): TreeInstance<T> => {
  'use no memo';
  const [tree] = useState(() => {
    const instance = createTree(config);
    // Initialize immediately for SSR support
    instance.setMounted(true);
    instance.rebuildTree();
    return { current: instance };
  });

  const [state, setState] = useState<Partial<TreeState<T>>>(() =>
    tree.current.getState()
  );

  useEffect(() => {
    const instance = tree.current;
    return () => {
      instance.setMounted(false);
    };
  }, [tree]);

  tree.current.setConfig((prev) => ({
    ...prev,
    ...config,
    state: {
      ...state,
      ...config.state,
    },
    setState: (nextStateOrUpdater) => {
      // headless-tree may emit partial state updates; merge to avoid dropping
      // unchanged keys (e.g. large expandedItems arrays in virtualized trees).
      setState((prev) => {
        const nextState =
          typeof nextStateOrUpdater === 'function'
            ? nextStateOrUpdater(prev)
            : nextStateOrUpdater;
        return { ...prev, ...nextState };
      });
      config.setState?.(nextStateOrUpdater);
    },
  }));

  // Rebuild when the dataLoader changes (e.g. files were updated via setFiles).
  // Skip the initial render — the constructor already calls rebuildTree().
  const prevDataLoaderRef = useRef(config.dataLoader);
  if (prevDataLoaderRef.current !== config.dataLoader) {
    prevDataLoaderRef.current = config.dataLoader;
    tree.current.rebuildTree();
  }

  return tree.current;
};
