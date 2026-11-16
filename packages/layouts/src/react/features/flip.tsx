'use client';

// `flip()`: animate the changes of the layout with FLIP. Before React applies
// a change, the feature reads the box of each element of the layout; after
// the commit, it animates each element from its old box with a transform, so
// the compositor runs the animation and the content lays out once. A pane
// that shows again grows from the line where its neighbors met.
import { useEffect, useState } from 'react';

import type { CSSLayout } from '../../css-layout';
import flipCss from '../../css/flip.css?inline';
import {
  animateFromBoxes,
  cancelFlipAnimations,
  finishFlipAnimations,
} from '../../dom/flip';
import type { LayoutOperation } from '../../layout-operation';
import { stackOf } from '../../model';
import { presentation } from '../../presentation';
import type { LayoutState, Rect } from '../../types';
import { boxesBeforeChange } from '../boxes';
import { cell } from '../cell';
import type {
  Feature,
  FeatureHooks,
  FeatureModule,
  ViewContext,
} from '../contract';

/** Which changes `flip()` animates. */
export interface FlipOptions {
  /** The changes of the tree: a split, a close, a move, a hide, and a show. True by default. */
  readonly layout?: boolean;
  /** A zoom and its restore. True by default. */
  readonly zoom?: boolean;
}

/** The node that a zoom fills the layout with: the stack of the pane, or the pane. */
const zoomKey = (state: LayoutState): string | null => {
  const { filled } = presentation(state);
  return filled === null ? null : (stackOf(state.root, filled)?.id ?? filled);
};

/**
 * Whether a tree change moves or resizes an element that shows in both
 * trees. A change of tab, or a change inside a hidden pane, moves nothing, so
 * it needs no animation and no read of boxes.
 */
function boxesMove(before: CSSLayout, after: CSSLayout): boolean {
  const shown = (layout: CSSLayout): Map<string, string> =>
    new Map(
      layout.panes
        .filter(({ hidden }) => !hidden)
        .map(({ pane, rect }) => [pane.id, JSON.stringify(rect)])
    );
  const panesBefore = shown(before);
  for (const [id, rect] of shown(after)) {
    const old = panesBefore.get(id);
    if (old !== undefined && old !== rect) return true;
  }
  const separators = (layout: CSSLayout): string =>
    JSON.stringify(layout.separators.map(({ id, rect }) => [id, rect]));
  return separators(before) !== separators(after);
}

// The operations that move no box that shows: the tabs of a stack share one
// box.
const STILL: ReadonlySet<string> = new Set(['focus', 'activate', 'moveTab']);

/**
 * Whether the operations of a change move a box that shows. A `setRoot` does
 * not say what changes, so its boxes are compared.
 */
function operationsMove(
  context: ViewContext,
  previous: LayoutState,
  next: LayoutState,
  operations: readonly LayoutOperation[]
): boolean {
  return operations.some((operation) =>
    operation.type === 'setRoot'
      ? boxesMove(
          context.cssLayoutOf(previous.root),
          context.cssLayoutOf(next.root)
        )
      : !STILL.has(operation.type) &&
        !(
          operation.type === 'addTab' &&
          stackOf(previous.root, operation.target) !== null
        )
  );
}

function useFlip(context: ViewContext, options: FlipOptions): FeatureHooks {
  // The boxes before the change that React applies next, or null.
  const [before] = useState(() => cell<Map<string, Rect> | null>(null));
  // A container resize jumps the running animations to their end. It reads
  // no box and renders nothing. The first callback of the observer reports
  // the size that the layout has, which is no resize.
  useEffect(() => {
    const element = context.element();
    if (element === null) return;
    let size: string | null = null;
    const observer = new ResizeObserver(([entry]) => {
      const next = `${entry.contentRect.width} ${entry.contentRect.height}`;
      if (size !== null && next !== size) finishFlipAnimations(element);
      size = next;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [context]);
  // The animation keys of the panes that a change shows again, so that they
  // grow into their place.
  const [grown] = useState(() => cell<ReadonlySet<string>>(new Set()));
  return {
    beforeChange(previous, next, element, { operations }) {
      const zoomChanges = zoomKey(previous) !== zoomKey(next);
      const rootChanges = previous.root !== next.root;
      // A transient change, such as a frame of a pointer resize, follows the
      // pointer with no animation.
      const animatable =
        operations.length > 0 &&
        (rootChanges || zoomChanges) &&
        (!rootChanges || options.layout !== false) &&
        (!zoomChanges || options.zoom !== false) &&
        !context.resizing() &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (
        animatable &&
        (zoomChanges || operationsMove(context, previous, next, operations))
      ) {
        before.set(boxesBeforeChange(context, element));
        grown.set(
          new Set(
            operations.flatMap((operation) =>
              operation.type === 'hide' && !operation.hidden
                ? [`pane:${operation.pane}`]
                : []
            )
          )
        );
        // The new animation starts from the current boxes.
        cancelFlipAnimations(element);
      }
    },
    afterChange(_previous, _next, element) {
      const boxes = before.get();
      before.set(null);
      if (boxes !== null) animateFromBoxes(element, boxes, true, grown.get());
    },
  };
}

/**
 * Animate the changes of the layout: each element moves from its old box
 * with a transform, and a pane that shows again grows into its place. A
 * pointer resize, and a user who prefers reduced motion, get no animation.
 */
export function flip(options: FlipOptions = {}): Feature {
  function useFlipView(context: ViewContext): FeatureHooks {
    return useFlip(context, options);
  }
  const feature: FeatureModule = {
    name: 'flip',
    use: useFlipView,
    stylesheets: [['flip', flipCss]],
  };
  return feature;
}
