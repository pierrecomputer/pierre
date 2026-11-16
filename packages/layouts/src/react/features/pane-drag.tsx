'use client';

// `paneDrag()`: move a pane beside another pane with a pointer drag from
// `Layout.MoveHandle`. It uses the drag engine of the view, which shows the
// drop and announces it, and `layout.move` from `edits()`.
import dropCss from '../../css/drop.css?inline';
import type { EditCommands } from '../../edits';
import { presentation } from '../../presentation';
import { treeIndex } from '../../tree-index';
import type { Edge, LayoutState } from '../../types';
import type {
  EdgeMessageValues,
  Feature,
  FeatureHooks,
  ViewContext,
  ViewRender,
} from '../contract';
import {
  type CanDrop,
  type Drag,
  DropPreview,
  startDrag,
  useDrag,
} from '../drag';

/** The options of `paneDrag()`. */
export interface PaneDragOptions {
  /** The app's rule for the places of a pane: false refuses a target. */
  readonly canDrop?: CanDrop;
}

const PANE = 'pane';

const moveText = ({
  paneTitle,
  targetTitle,
  edge,
}: EdgeMessageValues): string =>
  `Move ${paneTitle} to the ${edge} of ${targetTitle}`;

/** The title of a pane of a state, by ID. */
function titleOf(context: ViewContext, state: LayoutState, id: string): string {
  const pane = treeIndex(state.root).panes.get(id)?.pane;
  return pane === undefined ? id : context.title(pane);
}

function usePaneDrag(
  context: ViewContext,
  { state }: ViewRender,
  { canDrop }: PaneDragOptions
): FeatureHooks {
  const drag = useDrag(context, (value: Drag | null) =>
    value?.source.kind === PANE ? value : null
  );
  const target = drag?.target ?? null;
  return {
    startMove(id, event) {
      if (!presentation(context.store.getSnapshot()).rearrangeable) return;
      const source = { kind: PANE, id };
      startDrag(context, event, {
        source,
        accept: (target) =>
          canDrop?.(source, target, context.store.getSnapshot()) === false
            ? null
            : target,
        drop: ({ paneId, place }) =>
          (context.store as Partial<EditCommands>).move?.(
            id,
            paneId,
            place as Edge
          ),
      });
    },
    host:
      drag === null
        ? undefined
        : ({ pane }) =>
            pane.id === drag.source.id
              ? { attributes: { 'data-moving': true } }
              : undefined,
    layers: () => <DropPreview context={context} kind={PANE} />,
    status:
      drag === null || target === null
        ? null
        : (context.messages().move ?? moveText)({
            paneTitle: titleOf(context, state, drag.source.id),
            paneId: drag.source.id,
            targetTitle: titleOf(context, state, target.paneId),
            targetId: target.paneId,
            edge: target.place as Edge,
          }),
  };
}

/**
 * Move a pane with a pointer drag from `Layout.MoveHandle`, to an edge of
 * another pane. No drag starts while a pane fills the layout, or from a
 * pinned tab of a stack. `canDrop` refuses the places that the app does not
 * allow.
 */
export function paneDrag(options: PaneDragOptions = {}): Feature {
  return {
    name: 'pane-drag',
    requires: ['edits'],
    use: (context, render) => usePaneDrag(context, render, options),
    stylesheets: [['drop', dropCss]],
  };
}
