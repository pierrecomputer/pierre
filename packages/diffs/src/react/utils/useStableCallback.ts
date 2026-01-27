import { useCallback, useInsertionEffect, useRef } from 'react';

// oxlint-disable-next-line typescript/no-explicit-any
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T
): T {
  const callbackRef = useRef(callback);
  useInsertionEffect(() => void (callbackRef.current = callback));
  return useCallback((...args: Parameters<T>): ReturnType<T> => {
    // oxlint-disable-next-line typescript/no-unsafe-return
    return callbackRef.current(...args);
  }, []) as T;
}
