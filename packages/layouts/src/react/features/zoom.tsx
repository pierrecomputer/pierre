'use client';

// `zoom()`: one pane fills the layout, and the others wait under it. The store
// part has `toggleZoom` and `setZoom`. The view part gives the zoomed pane the
// box of the layout, moves each covered pane past the nearest edge of the
// layout, hides the covered panes when the zoom animation ends, moves the
// focus into the zoomed pane, hides the separators, restores on Escape, and
// announces the zoom. The store commit owns the rules of the zoom.
import { type CSSProperties, useEffect, useState } from 'react';

import zoomCss from '../../css/zoom.css?inline';
import { flipAnimations, readBoxes } from '../../dom/flip';
import { focusOwner, focusZoomedPane } from '../../dom/panes';
import { ZOOM } from '../../dom/visibility';
import { stackOf } from '../../model';
import { presentation } from '../../presentation';
import { treeIndex } from '../../tree-index';
import type { Edge, LayoutState } from '../../types';
import { getExitEdges, type ZoomCommands, zoom as zoomStore } from '../../zoom';
import type {
  Feature,
  FeatureHooks,
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

const zoomedText = (title: string): string => `${title} zoomed`;

/** What the zoom of one view keeps between its renders and its callbacks. */
interface ZoomMemory {
  /** The edge past which each covered pane leaves, from the boxes before the zoom. */
  edges: Readonly<Record<string, Edge>>;
  /** The pane that had the focus before the zoom, or null. */
  owner: string | null;
  /** The panes that this feature hides. */
  covered: ReadonlySet<string>;
}

function useZoom(
  context: ViewContext,
  { state, gap }: ViewRender
): FeatureHooks {
  const { filled, covered } = presentation(state);
  const [memory] = useState<ZoomMemory>(() => ({
    edges: {},
    owner: null,
    covered: new Set(),
  }));
  // Hide exactly the panes in `ids` for the zoom.
  const cover = (ids: ReadonlySet<string>): void => {
    for (const id of memory.covered)
      if (!ids.has(id)) context.visibility.set(id, ZOOM, 0);
    for (const id of ids) context.visibility.set(id, ZOOM, ZOOM);
    memory.covered = ids;
  };
  // After React commits a zoom: move the focus into the zoomed pane first,
  // because a focused element in a pane that skips its rendering loses the
  // focus to `body`. Then hide the covered panes when the zoom animation
  // ends. A tree change during the zoom cancels its animations, and the
  // covered panes then hide at once.
  useEffect(() => {
    const element = context.element();
    const owner = memory.owner;
    memory.owner = null;
    if (element === null || filled === null) return;
    focusZoomedPane(element, filled, owner);
    let current = true;
    void Promise.allSettled(
      flipAnimations(element).map((animation) => animation.finished)
    ).then(() => {
      if (current) cover(covered);
    });
    return () => {
      current = false;
    };
    // `cover` reads only `memory` and the context.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [filled, covered, context, memory]);
  const title = (id: string): string => {
    const pane = treeIndex(state.root).panes.get(id)?.pane;
    return pane === undefined ? id : context.title(pane);
  };
  return {
    beforeChange(previous, next, element) {
      if (zoomKey(previous) === zoomKey(next)) return;
      if (presentation(next).filled !== null) {
        // The boxes are clean here, before React applies the change.
        memory.owner = focusOwner(element);
        const bounds = element.getBoundingClientRect();
        memory.edges = getExitEdges(
          readBoxes(element),
          bounds.width,
          bounds.height
        );
      }
      // Show the covered panes before React commits a zoom change, so that
      // they render during its animation.
      cover(new Set());
    },
    host({ pane, rect }) {
      if (pane.id === filled)
        return {
          attributes: { 'data-zoomed': true, 'data-layout-edges': ALL_EDGES },
          style: FULL_SIZE,
        };
      if (covered.has(pane.id))
        return {
          style: {
            ...rect,
            transform: exitTransform(memory.edges[pane.id] ?? 'left', gap),
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
    announce:
      filled === null
        ? null
        : (context.messages().zoomed ?? zoomedText)(title(filled)),
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
    use: useZoom,
    stylesheets: [['zoom', zoomCss]],
  };
}
