/**
 * The event that the layout element receives when F6 or Shift+F6 reaches the
 * last or the first pane, before the focus wraps to the other end.
 * `detail.direction` is `next` for F6 and `previous` for Shift+F6. An app
 * with other regions, such as a sidebar, cancels it with `preventDefault()`
 * and moves the focus there itself; the focus then stays where it is.
 */
export const FOCUS_EDGE_EVENT = 'pierre-layouts-focus-edge';
export type FocusEdgeEvent = CustomEvent<{
  readonly direction: 'next' | 'previous';
}>;
