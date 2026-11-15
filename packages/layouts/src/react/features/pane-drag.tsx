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
  Feature,
  FeatureHooks,
  ViewContext,
  ViewRender,
} from '../contract';
import { type Drag, DropPreview, startDrag, useDrag } from '../drag';

const PANE = 'pane';

const moveText = (title: string, edge: Edge, target: string): string =>
  `Move ${title} to the ${edge} of ${target}`;

/** The title of a pane of a state, by ID. */
function titleOf(context: ViewContext, state: LayoutState, id: string): string {
  const pane = treeIndex(state.root).panes.get(id)?.pane;
  return pane === undefined ? id : context.title(pane);
}

function usePaneDrag(
  context: ViewContext,
  { state }: ViewRender
): FeatureHooks {
  const drag = useDrag(context, (value: Drag | null) =>
    value?.source.kind === PANE ? value : null
  );
  const target = drag?.target ?? null;
  return {
    startMove(id, event) {
      if (!presentation(context.store.getSnapshot()).rearrangeable) return;
      startDrag(context, event, {
        source: { kind: PANE, id },
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
        : (context.messages().move ?? moveText)(
            titleOf(context, state, drag.source.id),
            target.place as Edge,
            titleOf(context, state, target.paneId)
          ),
  };
}

/**
 * Move a pane with a pointer drag from `Layout.MoveHandle`, to an edge of
 * another pane. No drag starts while a pane fills the layout.
 */
export function paneDrag(): Feature {
  return {
    name: 'pane-drag',
    requires: ['edits'],
    use: usePaneDrag,
    stylesheets: [['drop', dropCss]],
  };
}
