import {
  type TreeConfig,
  type TreeInstance,
  type TreeState,
  createTree,
} from '@headless-tree/core';
import { useEffect, useState } from 'preact/hooks';

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
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      tree.current.setMounted(false);
    };
  }, [tree]);

  tree.current.setConfig((prev) => ({
    ...prev,
    ...config,
    state: {
      ...state,
      ...config.state,
    },
    setState: (state) => {
      setState(state);
      config.setState?.(state);
    },
  }));

  return tree.current;
};
