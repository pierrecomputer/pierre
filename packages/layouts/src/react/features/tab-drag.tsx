'use client';

// `tabDrag()`: drag a tab with the drag engine of the view: within its tab
// list to change the order of the tabs, into another tab list or the center
// of another pane to join its stack, or to an edge of a pane to leave the
// stack. While a pane fills the layout, only the tab list of the tab's own
// stack takes a drop. A pinned tab of a stack drops only in its own tab list,
// and a place in a tab list clamps to the run of pinned tabs.
import { type ReactNode, useCallback, useState } from 'react';

import dropCss from '../../css/drop.css?inline';
import tabDragCss from '../../css/tab-drag.css?inline';
import type { EditCommands } from '../../edits';
import { presentation } from '../../presentation';
import type { StackCommands } from '../../stacks';
import { pinnedRun, tabInsertIndex, tabMoveIndex } from '../../stacks-model';
import { treeIndex } from '../../tree-index';
import type { LayoutState, PaneNode } from '../../types';
import { type Cell, cell } from '../cell';
import type {
  EdgeMessageValues,
  Feature,
  FeatureHooks,
  TargetMessageValues,
  ViewContext,
  ViewRender,
} from '../contract';
import {
  type CanDrop,
  type Drag,
  DropPreview,
  type DropTarget,
  startDrag,
  useDrag,
} from '../drag';
import { touchHold } from '../touch-hold';

/** The options of `tabDrag()`. */
export interface TabDragOptions {
  /**
   * The app's rule for the places of a tab: false refuses a target. It runs
   * after the rule of pinned tabs.
   */
  readonly canDrop?: CanDrop;
  /**
   * The still press in milliseconds that starts a touch drag of a tab, 250 by
   * default, so a swipe on a tab list scrolls it. A mouse or a pen starts a
   * drag after a move of 4 pixels.
   */
  readonly touchDelay?: number;
  /**
   * The app's element beside the pointer during a drag of a tab. By default, a
   * copy of the tab follows the pointer.
   */
  readonly preview?: (tab: PaneNode) => ReactNode;
}

// The image of the drag that runs: the pressed tab, its size and styles at
// the press, the pointer in the layout, and the element of the image.
interface DragImageState {
  source: HTMLElement | null;
  look: Partial<CSSStyleDeclaration>;
  x: number;
  y: number;
  element: HTMLElement | null;
}

// The image sits below and after the pointer, so the drop marker at the
// pointer stays in view.
const IMAGE_OFFSET_PX = 12;

// The styles of a tab that its copy keeps outside its tab list.
const COPIED = [
  'boxSizing',
  'display',
  'alignItems',
  'gap',
  'padding',
  'border',
  'background',
  'font',
  'color',
  'boxShadow',
] as const;

const placeImage = ({ element, x, y }: DragImageState): void => {
  if (element !== null)
    element.style.transform = `translate(${x + IMAGE_OFFSET_PX}px, ${y + IMAGE_OFFSET_PX}px)`;
};

/**
 * The image of a tab drag, beside the pointer: the app's preview, or a copy of
 * the pressed tab with no IDs, at the size of the tab. The drag moves it with
 * a transform at each pointer move, with no render. It is inert and hidden
 * from assistive technology, as the drop marker is.
 */
function DragImage({
  context,
  image,
  preview,
}: {
  context: ViewContext;
  image: Cell<DragImageState>;
  preview: TabDragOptions['preview'];
}): ReactNode {
  const id = useDrag(context, (drag) =>
    drag?.source.kind === TAB ? drag.source.id : null
  );
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      const next = { ...image.get(), element };
      image.set(next);
      const { source } = next;
      if (element === null || source === null) return;
      placeImage(next);
      if (preview !== undefined) return;
      const copy = source.cloneNode(true) as HTMLElement;
      for (const node of [copy, ...copy.querySelectorAll('[id]')])
        node.removeAttribute('id');
      copy.removeAttribute('data-dragging');
      Object.assign(copy.style, next.look);
      element.replaceChildren(copy);
    },
    [image, preview]
  );
  if (id === null) return null;
  const pane = treeIndex(context.store.getSnapshot().root).panes.get(id)?.pane;
  return (
    <div className="pierre-layouts-drag-image" aria-hidden inert ref={ref}>
      {preview !== undefined && pane !== undefined && preview(pane)}
    </div>
  );
}

const TAB = 'tab';

const moveText = ({
  paneTitle,
  targetTitle,
  edge,
}: EdgeMessageValues): string =>
  `Move ${paneTitle} to the ${edge} of ${targetTitle}`;

const moveIntoText = ({
  paneTitle,
  targetTitle,
}: TargetMessageValues): string =>
  `Move ${paneTitle} into the group of ${targetTitle}`;

function titleOf(context: ViewContext, state: LayoutState, id: string): string {
  const pane = treeIndex(state.root).panes.get(id)?.pane;
  return pane === undefined ? id : context.title(pane);
}

/** Apply the drop of a tab, and focus the tab after the change. */
function dropTab(context: ViewContext, id: string, target: DropTarget): void {
  const store = context.store as unknown as Partial<
    StackCommands & EditCommands
  >;
  const hooks = context.hooks();
  const focusTab = hooks.find((hook) => hook.focusTab !== undefined)?.focusTab;
  const { panes } = treeIndex(context.store.getSnapshot().root);
  const stack = panes.get(id)?.stack ?? null;
  const targetStack = panes.get(target.paneId)?.stack ?? null;
  if (target.boundary !== undefined && target.tabs !== undefined) {
    if (stack !== null && stack === targetStack) {
      const index = tabMoveIndex(
        stack.children.map((tab) => tab.id),
        target.tabs,
        id,
        target.boundary
      );
      if (index !== null)
        hooks.find((hook) => hook.moveTab !== undefined)?.moveTab?.(id, index);
      return;
    }
    focusTab?.(id);
    store.moveToStack?.(
      id,
      target.paneId,
      tabInsertIndex(
        targetStack?.children.map((tab) => tab.id) ?? [target.paneId],
        target.tabs,
        target.boundary
      )
    );
    return;
  }
  focusTab?.(id);
  if (target.place === 'center') store.moveToStack?.(id, target.paneId);
  else store.move?.(id, target.paneId, target.place);
}

/**
 * The pinned rule of a tab drag, as the folds of `stacks()` apply it: a pinned
 * tab of a stack takes only a place in the tab list of its own stack, and a
 * place in a tab list moves to the end of the pinned run when the tab is
 * pinned and is past it, or when the tab is not pinned and is before it.
 */
function pinnedRule(
  context: ViewContext,
  id: string
): (target: DropTarget) => DropTarget | null {
  return (target) => {
    const { panes } = treeIndex(context.store.getSnapshot().root);
    const stack = panes.get(id)?.stack ?? null;
    const pinned = panes.get(id)?.pane.pinned === true;
    const { boundary, tabs } = target;
    if (boundary === undefined || tabs === undefined)
      return pinned && stack !== null ? null : target;
    if (pinned && stack !== null && panes.get(target.paneId)?.stack !== stack)
      return null;
    const run = pinnedRun(tabs.map((tab) => panes.get(tab)?.pane ?? {}));
    const place = pinned ? Math.min(boundary, run) : Math.max(boundary, run);
    return place === boundary ? target : { ...target, boundary: place };
  };
}

function useTabDrag(
  context: ViewContext,
  { state }: ViewRender,
  { canDrop, touchDelay = 250, preview }: TabDragOptions
): FeatureHooks {
  const [image] = useState(() =>
    cell<DragImageState>({
      source: null,
      look: {},
      x: 0,
      y: 0,
      element: null,
    })
  );
  const drag = useDrag(context, (value: Drag | null) =>
    value?.source.kind === TAB ? value : null
  );
  // A move inside the tab list of the tab's own stack announces nothing, as
  // the tab list shows the place.
  const { panes } = treeIndex(state.root);
  const stack =
    drag === null ? null : (panes.get(drag.source.id)?.stack ?? null);
  const own =
    drag?.target?.boundary !== undefined &&
    stack !== null &&
    panes.get(drag.target.paneId)?.stack === stack;
  const target = own ? null : (drag?.target ?? null);
  const messages = context.messages();
  return {
    startTabDrag(tab, _tabs, event) {
      const current = context.store.getSnapshot();
      const stack = treeIndex(current.root).panes.get(tab.id)?.stack;
      const source = { kind: TAB, id: tab.id };
      const pinned = pinnedRule(context, tab.id);
      // The size and the styles of the tab for its copy, read at the press,
      // while the layout is clean. The exact width: a rounded one can cut
      // the title.
      const pressed = event.currentTarget;
      const style = getComputedStyle(pressed);
      const { width, height } = pressed.getBoundingClientRect();
      const look: Partial<CSSStyleDeclaration> = {
        width: `${width}px`,
        height: `${height}px`,
      };
      for (const key of COPIED) look[key] = style[key];
      const layout = context.element()?.getBoundingClientRect();
      image.set({
        ...image.get(),
        source: pressed,
        look,
        x: event.clientX - (layout?.left ?? 0),
        y: event.clientY - (layout?.top ?? 0),
      });
      startDrag(context, event, {
        source,
        center: true,
        group: stack?.children
          .filter((other) => other.hidden !== true)
          .map((other) => other.id) ?? [tab.id],
        rearrange: presentation(current).rearrangeable,
        wait: touchHold(touchDelay),
        follow(x, y) {
          const next = { ...image.get(), x, y };
          image.set(next);
          placeImage(next);
        },
        accept(target) {
          const place = pinned(target);
          return place === null ||
            canDrop?.(source, place, context.store.getSnapshot()) === false
            ? null
            : place;
        },
        drop: (to) => dropTab(context, tab.id, to),
      });
    },
    host:
      drag === null
        ? undefined
        : ({ pane }) =>
            pane.id === drag.source.id
              ? { attributes: { 'data-moving': true } }
              : undefined,
    layers: () => (
      <>
        <DropPreview context={context} kind={TAB} />
        <DragImage context={context} image={image} preview={preview} />
      </>
    ),
    status:
      drag === null || target === null
        ? null
        : target.place === 'center'
          ? (messages.moveInto ?? moveIntoText)({
              paneTitle: titleOf(context, state, drag.source.id),
              paneId: drag.source.id,
              targetTitle: titleOf(context, state, target.paneId),
              targetId: target.paneId,
            })
          : (messages.move ?? moveText)({
              paneTitle: titleOf(context, state, drag.source.id),
              paneId: drag.source.id,
              targetTitle: titleOf(context, state, target.paneId),
              targetId: target.paneId,
              edge: target.place,
            }),
  };
}

/**
 * Drag a tab: within its tab list to change the order, into another stack,
 * or to an edge of a pane. It requires `stacks()`. `canDrop` refuses the
 * places that the app does not allow.
 */
export function tabDrag(options: TabDragOptions = {}): Feature {
  return {
    name: 'tab-drag',
    requires: ['stacks'],
    use: (context, render) => useTabDrag(context, render, options),
    stylesheets: [
      ['drop', dropCss],
      ['tab-drag', tabDragCss],
    ],
  };
}
