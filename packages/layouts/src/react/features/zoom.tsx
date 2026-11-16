'use client';

// `zoom()`: one pane fills the layout, and the others wait under it. The store
// part has `toggleZoom` and `setZoom`. The view part gives the zoomed pane the
// box of the layout, moves each covered pane past the nearest edge of the
// layout, hides the covered panes when the zoom animation ends, moves the
// focus into the zoomed pane, hides the separators, restores on Escape, and
// announces the zoom. The covered panes leave the accessibility tree and the
// tab order at the start of the zoom, and stop rendering at the end of its
// animation. The store commit owns the rules of the zoom.
import { type CSSProperties, useEffect, useState } from 'react';

import zoomCss from '../../css/zoom.css?inline';
import { flipAnimations } from '../../dom/flip';
import { focusOwner, focusPane, focusZoomedPane } from '../../dom/panes';
import { COVERED, ZOOM } from '../../dom/visibility';
import { stackOf } from '../../model';
import { presentation } from '../../presentation';
import type { Edge, LayoutState } from '../../types';
import { getExitEdges, type ZoomCommands, zoomStore } from '../../zoom';
import { boxesBeforeChange } from '../boxes';
import { cell } from '../cell';
import type {
  Feature,
  FeatureHooks,
  PaneMessageValues,
  ViewContext,
  ViewRender,
} from '../contract';

// The box of the zoomed pane.
const FULL_SIZE: CSSProperties = {
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
};

const ALL_EDGES = 'top right bottom left';

/**
 * The node that a zoom fills the layout with: the stack of the zoomed pane,
 * or the pane. A change of tab in a zoomed stack is not a zoom change.
 */
const zoomKey = (state: LayoutState): string | null => {
  const { filled } = presentation(state);
  return filled === null ? null : (stackOf(state.root, filled)?.id ?? filled);
};

// A covered pane keeps its box and moves past an edge with a transform, so
// that it does not lay out its content again. One size of the container is
// always enough to leave it.
const exitTransform = (edge: Edge, gap: number): string =>
  edge === 'left' || edge === 'right'
    ? `translateX(calc(${edge === 'left' ? '-' : ''}100cqw ${edge === 'left' ? '-' : '+'} ${gap}px))`
    : `translateY(calc(${edge === 'top' ? '-' : ''}100cqh ${edge === 'top' ? '-' : '+'} ${gap}px))`;

const zoomedText = ({ paneTitle }: PaneMessageValues): string =>
  `${paneTitle} zoomed`;
const restoredText = ({ paneTitle }: PaneMessageValues): string =>
  `${paneTitle} restored`;

function useZoom(
  context: ViewContext,
  { state, gap }: ViewRender
): FeatureHooks {
  const { filled, covered } = presentation(state);
  const { visibility } = context;
  // The edge past which each covered pane leaves, from the boxes before the
  // zoom; the pane that had the focus before the zoom; the panes that this
  // feature covers; and a count of the commits of a zoom, so that the end of
  // an old animation does nothing.
  const [edges] = useState(() => cell<Readonly<Record<string, Edge>>>({}));
  const [owner] = useState(() => cell<string | null>(null));
  const [marked] = useState(() => cell<ReadonlySet<string>>(new Set()));
  const [commits] = useState(() => cell(0));
  // While the zoom animation runs, the covered panes still render, so their
  // controls could take the focus. A focus that enters a covered pane goes
  // to the zoomed pane.
  useEffect(() => {
    const element = context.element();
    if (element === null) return;
    const guard = (event: FocusEvent): void => {
      const host = (event.target as Element).closest('[data-layouts-pane]');
      const zoomed = presentation(context.store.getSnapshot()).filled;
      if (
        zoomed !== null &&
        host?.parentElement === element &&
        host.getAttribute('aria-hidden') === 'true'
      )
        focusPane(element, zoomed);
    };
    element.addEventListener('focusin', guard);
    return () => element.removeEventListener('focusin', guard);
  }, [context]);
  return {
    beforeChange(previous, next, element) {
      if (zoomKey(previous) === zoomKey(next)) return;
      if (presentation(next).filled !== null) {
        // The boxes are clean here, before React applies the change.
        owner.set(focusOwner(element));
        const bounds = element.getBoundingClientRect();
        edges.set(
          getExitEdges(
            boxesBeforeChange(context, element),
            bounds.width,
            bounds.height
          )
        );
      }
      // Show the covered panes before React commits a zoom change, so that
      // they render during its animation.
      for (const id of marked.get()) visibility.set(id, COVERED | ZOOM, 0);
      marked.set(new Set());
      commits.set(commits.get() + 1);
    },
    // After each commit of a zoom: the covered panes leave the accessibility
    // tree and the tab order at once, the focus moves into the zoomed pane,
    // and the covered panes stop rendering when the animations of the layout
    // end. A pane that a change uncovers renders again at once.
    afterChange(_previous, next, element) {
      const { filled: zoomed, covered: panes } = presentation(next);
      if (zoomed === null) return;
      for (const id of marked.get())
        if (!panes.has(id)) visibility.set(id, COVERED | ZOOM, 0);
      for (const id of panes) visibility.set(id, COVERED, COVERED);
      marked.set(panes);
      // Move the focus into the zoomed pane first: a focused element in a
      // pane that skips its rendering loses the focus to `body`.
      focusZoomedPane(element, zoomed, owner.get());
      owner.set(null);
      const commit = commits.get() + 1;
      commits.set(commit);
      void Promise.allSettled(
        flipAnimations(element).map((animation) => animation.finished)
      ).then(() => {
        if (commits.get() === commit)
          for (const id of panes) visibility.set(id, ZOOM, ZOOM);
      });
    },
    host({ pane, rect }) {
      if (pane.id === filled)
        return {
          attributes: { 'data-zoomed': true, 'data-edges': ALL_EDGES },
          style: FULL_SIZE,
        };
      if (covered.has(pane.id))
        return {
          style: {
            ...rect,
            transform: exitTransform(edges.get()[pane.id] ?? 'left', gap),
          },
        };
      return undefined;
    },
    keys:
      filled === null
        ? undefined
        : {
            Escape: () =>
              (context.store as unknown as ZoomCommands).setZoom(null),
          },
    separators: filled === null,
  };
}

/**
 * Zoom a pane: `layout.toggleZoom(id)` and `layout.setZoom(id | null)`, and
 * `Layout.ZoomButton`. Escape restores the layout.
 */
export function zoom(): Feature<ZoomCommands> {
  return {
    name: 'zoom',
    store: zoomStore,
    announce(operation, { previous, pane, messages }) {
      if (operation.type !== 'zoom') return null;
      if (operation.pane !== null)
        return (messages.zoomed ?? zoomedText)(pane(operation.pane));
      return previous.zoomedPane === null
        ? null
        : (messages.restored ?? restoredText)(pane(previous.zoomedPane));
    },
    use: useZoom,
    stylesheets: [['zoom', zoomCss]],
  };
}
