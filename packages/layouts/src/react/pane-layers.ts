// When each pane host is its own compositor layer: an internal policy of
// `Root` (`DEC-layouts-experiments-internal`). Pane layers save compositing
// time from about 6 visible panes, and cost tile memory below that. The bench
// and the demos override it.

/** `true`, `false`, or the count of visible panes from which the layers start. */
export type PaneLayers = boolean | { readonly minPanes: number };

let policy: PaneLayers = { minPanes: 6 };

/** For the bench and the demos: the pane layers of the views that render next. Internal. */
export function setPaneLayers(next: PaneLayers): void {
  policy = next;
}

/** The pane layers policy that `Root` reads when it renders. */
export const paneLayers = (): PaneLayers => policy;
