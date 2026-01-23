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
    // currently we are doing this right away, but it also feels like we should do it
    // when the component is *re-mounted* - so maybe let's look into a way to check for that
    // tree.current.setMounted(true);
    // tree.current.rebuildTree();
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
