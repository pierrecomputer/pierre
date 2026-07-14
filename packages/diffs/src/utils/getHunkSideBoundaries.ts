/** Converts a unified hunk side's start/count into its consumed-file range. */
export function getHunkSideStartBoundary(start: number, count: number): number {
  return start - (count === 0 ? 0 : 1);
}

export function getHunkSideEndBoundary(start: number, count: number): number {
  return getHunkSideStartBoundary(start, count) + count;
}
