import type { SetStateFn, TreeState, Updater } from './types/core';

// oxlint-disable-next-line typescript-eslint/no-explicit-any
export const memo = <D extends readonly any[], P extends readonly any[], R>(
  deps: (...args: [...P]) => [...D],
  fn: (...args: [...D]) => R
) => {
  let value: R | undefined;
  let oldDeps: D | null = null;

  return (...a: [...P]) => {
    const newDeps = deps(...a);

    if (value == null) {
      value = fn(...newDeps);
      oldDeps = newDeps;
      return value;
    }

    const match =
      oldDeps != null &&
      oldDeps.length === newDeps.length &&
      !oldDeps.some((dep, i) => dep !== newDeps[i]);

    if (match) {
      return value;
    }

    value = fn(...newDeps);
    oldDeps = newDeps;
    return value;
  };
};

function functionalUpdate<T>(updater: Updater<T>, input: T): T {
  return typeof updater === 'function'
    ? (updater as (input: T) => T)(input)
    : updater;
}
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export function makeStateUpdater<K extends keyof TreeState<any>>(
  key: K,
  instance: unknown
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
): SetStateFn<TreeState<any>[K]> {
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  return (updater: Updater<TreeState<any>[K]>) => {
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    (instance as any).setState(<TTableState>(old: TTableState) => {
      return {
        ...old,
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
        [key]: functionalUpdate(updater, (old as any)[key]),
      };
    });
  };
}

export const poll = (fn: () => boolean, interval = 100, timeout = 1000) =>
  new Promise<void>((resolve) => {
    let clear: ReturnType<typeof setTimeout>;
    const i = setInterval(() => {
      if (fn()) {
        resolve();
        clearInterval(i);
        clearTimeout(clear);
      }
    }, interval);
    clear = setTimeout(() => {
      clearInterval(i);
      resolve();
    }, timeout);
  });
