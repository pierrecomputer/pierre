import type { RefObject } from 'react';

interface NextRenderDataSource<TInput, TData> {
  __getNextRenderData(input: TInput): TData;
}

// Read the data the instance will display once render() receives this input.
// The instance can change it without new props, so this must not be memoized.
// Returns undefined before the instance exists.
export function useNextRenderData<TInput, TData>(
  instanceRef: RefObject<NextRenderDataSource<TInput, TData> | null>,
  input: TInput
): TData | undefined {
  'use no memo';
  // oxlint-disable-next-line react/refs -- the instance changes without new props
  return instanceRef.current?.__getNextRenderData(input);
}
