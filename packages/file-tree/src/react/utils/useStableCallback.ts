import { useCallback, useInsertionEffect, useRef } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T
): T {
  const callbackRef = useRef(callback);
  useInsertionEffect(() => void (callbackRef.current = callback));
  return useCallback((...args: Parameters<T>): ReturnType<T> => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return callbackRef.current(...args);
  }, []) as T;
}
