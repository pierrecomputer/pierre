// The name of the pane visibility event, in a module of its own: the cover of
// the root entry sends it, and must not reach the DOM code of the view, which
// an app's bundler would then put in the chunk of an app module that imports
// only the root entry.

/**
 * The event that a pane host receives when its content stops or starts
 * rendering. `detail.hidden` is true when the zoom animation of another pane
 * ends, when the pane is hidden or collapsed, or when another tab of its
 * stack becomes active, and false before the pane shows again.
 *
 * The event comes before the paint of the frame that shows the change, as a
 * `ResizeObserver` callback does, also for a change from outside a React
 * event. So a listener must stay cheap, and schedule heavy work itself, for
 * example in an idle callback.
 */
export const PANE_VISIBILITY_EVENT = 'pierre-layout-visibility';
export type PaneVisibilityEvent = CustomEvent<{ hidden: boolean }>;
