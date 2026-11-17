'use client';

// `arrange()`: pane commands that need no drag (`DEC-layouts-pane-commands`).
// Directional focus, Grow and Shrink, the list of recent panes, and the items
// of a pane menu, which `Layout.usePaneMenu()` gives to the app's own menu
// component. A move item carries its `Place`, and runs `moveTo`.
import { useEffect, useMemo } from 'react';

import { stepChild } from '../../gestures';
import type { LayoutTreeOperation } from '../../layout-operation';
import { findNode, slotOf, stackOf } from '../../model';
import { moveTo, type PlaceCommands } from '../../place';
import { presentation } from '../../presentation';
import { neighbor, visualOrder } from '../../spatial';
import type { StackCommands } from '../../stacks';
import {
  type ContextOfStore,
  STORE_CONTEXT,
  type StoreContext,
} from '../../store';
import type {
  Edge,
  LayoutNode,
  LayoutState,
  Place,
  SplitNode,
} from '../../types';
import type { ZoomCommands } from '../../zoom';
import type {
  Feature,
  FeatureHooks,
  FeatureModule,
  KeyCommand,
  PaneMessageValues,
  ViewContext,
} from '../contract';
import { useLayoutState } from '../parts/part';
import { usePaneContext } from '../use-pane';

/** An axis of a split: `horizontal` for the width, `vertical` for the height. */
export type Axis = 'horizontal' | 'vertical';

export interface ArrangeCommands {
  /**
   * Move the focus, with the DOM focus, to the pane across an edge of the
   * focused pane (`neighbor`, with the recent panes). False at an edge of the
   * layout, or while a pane fills it.
   */
  focusToward(edge: Edge): boolean;
  /**
   * Grow a pane along an axis by 10% of the space of the nearest split of
   * that axis that holds it: the separator after it moves, or the one before
   * it for the last child. The pane next to it gives the space, as for a
   * key on the separator. False at a limit, or with no view.
   */
  grow(id: string, axis: Axis): boolean;
  /** Shrink a pane along an axis by 10%, as `grow` does. */
  shrink(id: string, axis: Axis): boolean;
}

/** An item of the pane menu, for the app's own menu component. */
export interface PaneMenuItem {
  /** A stable ID, for example `move:left`, `tabs:files`, or `size:wider`. */
  readonly id: string;
  /**
   * The group of the item: `move`, `size`, or `zoom`. An item of "Move to…"
   * has the ID of its target pane as its group.
   */
  readonly group: string;
  readonly label: string;
  readonly disabled: boolean;
  /** Where a move item puts the pane, for an app that writes its own label. */
  readonly place?: Place;
  /** The items of a submenu: "Move to…". */
  readonly items?: readonly PaneMenuItem[];
  /** Run the item. The app's menu closes and gives the focus back to its trigger. */
  run(): void;
}

const EDGES: readonly Edge[] = ['left', 'right', 'top', 'bottom'];
// The ID of a node that a probe of a place makes, so that a probe takes no
// new ID from the store.
const PROBE = '\u0000probe';
const KEY_EDGES: Readonly<Record<string, Edge>> = {
  left: 'left',
  right: 'right',
  up: 'top',
  down: 'bottom',
};

// The view of each store, for Grow and Shrink, and its recent panes, most
// recent first. A layout object has one of each.
const views = new WeakMap<StoreContext, ViewContext>();
const recents = new WeakMap<StoreContext, string[]>();

const contextOf = (context: ViewContext): StoreContext =>
  (context.store as unknown as ContextOfStore)[STORE_CONTEXT];

/** The splits on the path from the root to a node, each with its child on the path. */
function splitsTo(root: LayoutNode, id: string): [SplitNode, number][] {
  if (root.type !== 'split') return [];
  for (let index = 0; index < root.children.length; index++) {
    const child = root.children[index];
    if (child.id === id) return [[root, index]];
    const rest = splitsTo(child, id);
    if (rest.length > 0) return [[root, index], ...rest];
  }
  return [];
}

/** The nearest split of an axis that holds a pane, with the index of its child. */
const splitOf = (
  root: LayoutNode,
  id: string,
  axis: Axis
): [SplitNode, number] | undefined =>
  splitsTo(root, slotOf(root, id))
    .filter(([split]) => split.direction === axis)
    .at(-1);

// The shape of a tree with no sizes and no split IDs: two places that give
// the same shape give the same layout.
const shapeOf = (node: LayoutNode): string =>
  node.type === 'pane'
    ? node.id
    : node.type === 'stack'
      ? `[${node.children.map(({ id }) => id).join()}]`
      : `${node.direction}(${node.children.map(shapeOf).join()})`;

const NAMES: Readonly<Record<Edge, string>> = {
  left: 'left of',
  right: 'right of',
  top: 'above',
  bottom: 'below',
};
const PLACES: Readonly<Record<Edge, string>> = {
  left: 'Left of',
  right: 'Right of',
  top: 'Above',
  bottom: 'Below',
};
const line = (edge: Edge): string =>
  `a new ${edge === 'left' || edge === 'right' ? 'column' : 'row'} at the ${edge}`;
const SIZES: Readonly<Record<string, string>> = {
  'horizontal true': 'Wider',
  'horizontal false': 'Narrower',
  'vertical true': 'Taller',
  'vertical false': 'Shorter',
};
const resizedText = ({
  paneTitle,
  axis,
  percent,
}: PaneMessageValues & { axis: Axis; percent: number }): string =>
  `${paneTitle} ${axis === 'horizontal' ? 'width' : 'height'} ${percent}%`;

// The announcement of the next resize of a Grow or a Shrink.
let resized: (PaneMessageValues & { axis: Axis; percent: number }) | null =
  null;

/** The view part of `arrange()`: the view of Grow and Shrink, the recent panes, and the keys. */
function useArrange(context: ViewContext): FeatureHooks {
  const store = contextOf(context);
  useEffect(() => {
    views.set(store, context);
    return () => {
      views.delete(store);
    };
  }, [store, context]);
  const layout = context.store as unknown as ArrangeCommands;
  const focused = (): string => context.store.getSnapshot().focusedPane;
  const keys: KeyCommand[] = [
    ...Object.entries(KEY_EDGES).map(([name, edge]) => ({
      id: `focus.${name}`,
      keys: [],
      run: () => layout.focusToward(edge),
    })),
    ...Object.entries(SIZES).map(([key, label]) => {
      const [axis, grow] = key.split(' ');
      return {
        id: `pane.${label.toLowerCase()}`,
        keys: [],
        run: () =>
          (grow === 'true' ? layout.grow : layout.shrink)(
            focused(),
            axis as Axis
          ),
      };
    }),
    {
      id: 'pane.menu',
      keys: [],
      // The menu belongs to the app: its trigger is the move handle.
      run: () => {
        const handle = context.visibility
          .host(focused())
          ?.querySelector<HTMLElement>('.pierre-layouts-grip');
        handle?.focus();
        handle?.click();
        return handle != null;
      },
    },
  ];
  return {
    keys,
    beforeChange(previous, next) {
      if (next.focusedPane === previous.focusedPane) return;
      recents.set(store, [
        next.focusedPane,
        ...(recents.get(store) ?? [])
          .filter((id) => id !== next.focusedPane)
          .slice(0, 31),
      ]);
    },
  };
}

/**
 * Pane commands that need no drag: `focusToward`, `grow`, and `shrink`, the
 * items of `Layout.usePaneMenu()`, and their key commands, with no default
 * keys (`focus.left`, `focus.right`, `focus.up`, `focus.down`,
 * `pane.wider`, `pane.narrower`, `pane.taller`, `pane.shorter`, and
 * `pane.menu`). It needs `edits()`.
 */
export function arrange(): Feature<ArrangeCommands> {
  const feature: FeatureModule<ArrangeCommands> = {
    name: 'arrange',
    requires: ['edits'],
    store: {
      commands(context) {
        const step = (id: string, axis: Axis, grow: boolean): boolean => {
          const state = context.get();
          const view = views.get(context);
          const at = splitOf(state.root, id, axis);
          if (
            view === undefined ||
            at === undefined ||
            !presentation(state).rearrangeable
          )
            return false;
          const next = stepChild(
            view.readGeometry().separators,
            at[0].id,
            at[1],
            grow ? 0.1 : -0.1
          );
          if (next === null) return false;
          const operation: LayoutTreeOperation = {
            type: 'resize',
            sizes: { [at[0].id]: next.sizes },
          };
          const pane = findNode(state.root, id);
          resized = {
            paneTitle: pane?.type === 'pane' ? view.title(pane) : id,
            paneId: id,
            axis,
            percent: next.percent,
          };
          try {
            context.commit({ ...state, root: context.fold(operation) }, [
              operation,
            ]);
          } finally {
            resized = null;
          }
          return true;
        };
        return {
          focusToward(edge) {
            const state = context.get();
            const pane = presentation(state).rearrangeable
              ? neighbor(
                  state.root,
                  state.focusedPane,
                  edge,
                  recents.get(context)
                )
              : null;
            if (pane === null) return false;
            context.commit({ ...state, focusedPane: pane.id }, [
              { type: 'focus', pane: pane.id, reveal: true },
            ]);
            return true;
          },
          grow: (id, axis) => step(id, axis, true),
          shrink: (id, axis) => step(id, axis, false),
        };
      },
    },
    announce(operation, { messages }) {
      return operation.type === 'resize' && resized !== null
        ? (messages.resized ?? resizedText)(resized)
        : null;
    },
    use: useArrange,
  };
  return feature;
}

/**
 * The items of the pane menu of the pane of the calling component, for the
 * app's own menu component, with `Layout.MoveHandle` as its trigger. It needs
 * `arrange()`. The move items list each place that changes the layout once:
 * beside the pane across each edge, at each edge of the layout, into the tabs
 * of each neighbor with `stacks()`, and "Move to…" with a place beside each
 * other pane. While a pane fills the layout, the move and size items are
 * disabled and "Restore" stays. The items read the layout's boxes for the
 * limits of Grow and Shrink, so render them only while the menu is open.
 */
export function usePaneMenu(): readonly PaneMenuItem[] {
  const { id, context } = usePaneContext('Layout.usePaneMenu');
  const state = useLayoutState(context.store, (each) => each);
  return useMemo(() => menuItems(context, state, id), [context, state, id]);
}

function menuItems(
  context: ViewContext,
  state: LayoutState,
  id: string
): PaneMenuItem[] {
  const layout = context.store as unknown as PlaceCommands &
    Partial<ArrangeCommands & StackCommands & ZoomCommands>;
  const store = contextOf(context);
  const messages = context.messages();
  const { root } = state;
  const title = (paneId: string): string => {
    const node = findNode(root, paneId);
    return node?.type === 'pane' ? context.title(node) : paneId;
  };
  const self: PaneMessageValues = { paneTitle: title(id), paneId: id };
  const target = (paneId: string) => ({
    ...self,
    targetTitle: title(paneId),
    targetId: paneId,
  });
  const frozen = !presentation(state).rearrangeable;
  // Each place once, and only a place that changes the layout.
  const shapes = new Set([shapeOf(root)]);
  const changes = (place: Place): boolean => {
    const operation: LayoutTreeOperation =
      'beside' in place
        ? {
            type: 'move',
            pane: id,
            target: place.beside,
            edge: place.edge,
            id: PROBE,
          }
        : {
            type: 'moveToStack',
            pane: id,
            target: place.into,
            activate: true,
            id: PROBE,
          };
    try {
      const shape = shapeOf(store.fold(operation));
      if (shapes.has(shape)) return false;
      shapes.add(shape);
      return true;
    } catch {
      return false;
    }
  };
  const tabs = context.has('stacks');
  const item = (
    itemId: string,
    group: string,
    label: string,
    run: () => void,
    place?: Place,
    disabled = frozen
  ): PaneMenuItem => ({ id: itemId, group, label, disabled, place, run });
  const move = (itemId: string, group: string, label: string, place: Place) =>
    item(itemId, group, label, () => moveTo(layout, id, place), place);
  const items: PaneMenuItem[] = [];
  const near: string[] = [];
  for (const edge of EDGES) {
    const pane = neighbor(root, id, edge, recents.get(store));
    if (pane === null) continue;
    if (!near.includes(pane.id)) near.push(pane.id);
    const place: Place = { beside: pane.id, edge };
    if (changes(place))
      items.push(
        move(
          `move:${edge}`,
          'move',
          (
            messages.moveBeside ??
            ((values) => `Move ${NAMES[values.edge]} ${values.targetTitle}`)
          )({
            ...target(pane.id),
            edge,
          }),
          place
        )
      );
  }
  for (const edge of EDGES) {
    const place: Place = { beside: root.id, edge };
    if (changes(place))
      items.push(
        move(
          `move:edge:${edge}`,
          'move',
          (messages.moveToEdge ?? ((values) => `Move to ${line(values.edge)}`))(
            { ...self, edge }
          ),
          place
        )
      );
  }
  if (tabs)
    for (const pane of near) {
      const place: Place = { into: pane };
      if (changes(place))
        items.push(
          move(
            `tabs:${pane}`,
            'move',
            (
              messages.moveToTabs ??
              ((values) => `Move to the tabs of ${values.targetTitle}`)
            )(target(pane)),
            place
          )
        );
      if (
        stackOf(root, id) !== null &&
        stackOf(root, pane) !== stackOf(root, id) &&
        // The layout's rule allows each tab that the merge moves.
        (stackOf(root, id)?.children ?? [])
          .filter((tab) => tab.pinned !== true)
          .every((tab) => store.canPlace(tab, { into: pane }))
      )
        items.push(
          item(
            `merge:${pane}`,
            'move',
            (
              messages.mergeInto ??
              ((values) => `Merge tabs into ${values.targetTitle}`)
            )(target(pane)),
            () => layout.mergeStack?.(id, pane)
          )
        );
    }
  // "Move to…": a place beside each other pane, and its tabs.
  const places = visualOrder(root)
    .filter((pane) => pane.id !== id)
    .flatMap((pane) =>
      [...EDGES, ...(tabs ? (['tabs'] as const) : [])].flatMap((edge) => {
        const place: Place =
          edge === 'tabs' ? { into: pane.id } : { beside: pane.id, edge };
        return changes(place)
          ? [
              move(
                `place:${edge}:${pane.id}`,
                pane.id,
                (
                  messages.place ??
                  ((values) =>
                    values.edge === 'tabs'
                      ? `Tabs of ${values.targetTitle}`
                      : `${PLACES[values.edge]} ${values.targetTitle}`)
                )({
                  ...target(pane.id),
                  edge,
                }),
                place
              ),
            ]
          : [];
      })
    );
  if (places.length > 0)
    items.push({
      ...item(
        'move-to',
        'move',
        (messages.moveToMenu ?? (() => 'Move to…'))(self),
        () => {}
      ),
      items: places,
    });
  // Grow and Shrink along each axis of a split that holds the pane, disabled
  // at a limit.
  const separators = frozen ? [] : context.readGeometry().separators;
  for (const [key, label] of Object.entries(SIZES)) {
    const [axis, grow] = key.split(' ') as [Axis, string];
    const at = splitOf(root, id, axis);
    if (at === undefined) continue;
    const growing = grow === 'true';
    items.push(
      item(
        `size:${label.toLowerCase()}`,
        'size',
        messages.resize?.({ ...self, axis, grow: growing }) ?? label,
        () => (growing ? layout.grow : layout.shrink)?.(id, axis),
        undefined,
        stepChild(separators, at[0].id, at[1], growing ? 0.1 : -0.1) === null
      )
    );
  }
  if (context.has('zoom')) {
    const zoomed = presentation(state).filled === id;
    items.push(
      item(
        'zoom',
        'zoom',
        (
          messages.maximize ??
          ((values) => (values.zoomed ? 'Restore' : 'Maximize'))
        )({
          ...self,
          zoomed,
        }),
        () => layout.toggleZoom?.(id),
        undefined,
        frozen && !zoomed
      )
    );
  }
  return items;
}
