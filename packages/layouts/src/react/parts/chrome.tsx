'use client';

// Pane chrome parts: each reads its pane from the pane context, subscribes to
// the state that it shows, sets that state as data attributes, and takes a
// `render` prop.
import { type JSX, type PointerEvent, useCallback } from 'react';

import contentCss from '../../css/content.css?inline';
import headersCss from '../../css/headers.css?inline';
import { presentation } from '../../presentation';
import { treeIndex } from '../../tree-index';
import type { ZoomCommands } from '../../zoom';
import { paneIdOf, type PaneMessageValues, Style } from '../contract';
import { useDrag } from '../drag';
import { DISABLED_GRIP_STYLE, GRIP_STYLE } from '../gesture-styles';
import { usePaneContext, usePaneState } from '../use-pane';
import { canClose, closePane, closes } from './close';
import {
  mergeProps,
  type PartProps,
  renderPart,
  useLayoutState,
  warnMissing,
} from './part';

export interface HeaderState {
  /** The pane has the focus of the layout. */
  focused: boolean;
  zoomed: boolean;
}

/**
 * The header of a pane: a row for its title, tabs, and buttons. It stays when
 * the pane collapses, as the strip of the collapsed pane.
 */
export function Header({
  render,
  ...props
}: PartProps<HeaderState>): JSX.Element {
  const value = usePaneContext('Layout.Header');
  const focused = usePaneState(value, (pane) => pane.focused);
  const zoomed = usePaneState(value, (pane) => pane.zoomed);
  return (
    <>
      <Style
        name="headers"
        css={headersCss}
        settings={value.context.stylesheets()}
      />
      {renderPart(
        'header',
        render,
        mergeProps(props, {
          className: 'pierre-layouts-header',
          'data-focused': focused || undefined,
          'data-zoomed': zoomed || undefined,
        }),
        { focused, zoomed }
      )}
    </>
  );
}

/**
 * The title of a pane, from `getPaneTitle`, as a heading: an `h2`, or the
 * element of `render`. The host of the pane takes its name from the heading
 * with `aria-labelledby`, except a tab panel, which takes the name of its
 * tab. Without a title, the host keeps the `aria-label` of the view.
 */
export function Title({
  render,
  children,
  ...props
}: PartProps<object>): JSX.Element {
  const value = usePaneContext('Layout.Title');
  const { id, context } = value;
  const title = usePaneState(value, (state) => state.title);
  // An encoded pane ID has no colon, so no other ID of the layout is this one.
  const headingId = `${paneIdOf(context.prefix, id)}:title`;
  const nameHost = useCallback(
    (heading: HTMLElement | null) => {
      const host = heading?.closest('.pierre-layouts-pane');
      if (host == null || host.getAttribute('role') === 'tabpanel') return;
      host.setAttribute('aria-labelledby', headingId);
      return () => {
        if (host.getAttribute('aria-labelledby') === headingId)
          host.removeAttribute('aria-labelledby');
      };
    },
    [headingId]
  );
  return renderPart(
    'h2',
    render,
    mergeProps(props, {
      className: 'pierre-layouts-title',
      id: headingId,
      ref: nameHost,
      children: children ?? title,
    }),
    {}
  );
}

/**
 * The content area of a pane: the element that scrolls. When the pane
 * collapses, the content keeps its DOM, its state, and its scroll position,
 * and becomes inert and skips its style, layout, and paint, while
 * `Layout.Header` stays as the collapsed strip. The view sets
 * `data-collapsed` on it; the content does not render for a collapse.
 *
 * F6 focuses it when its pane has no element that had the focus, so it is
 * focusable from script (`tabIndex` -1), and the arrow keys scroll it. A
 * read-only pane that scrolls gives it `tabIndex={0}`, as Safari does not
 * make a scroll container a tab stop.
 */
export function Content({ render, ...props }: PartProps<object>): JSX.Element {
  const { id, context } = usePaneContext('Layout.Content');
  return (
    <>
      <Style name="content" css={contentCss} settings={context.stylesheets()} />
      {renderPart(
        'div',
        render,
        mergeProps(props, {
          className: 'pierre-layouts-content',
          ref: context.visibility.contentRef(id),
          tabIndex: props.tabIndex ?? -1,
        }),
        {}
      )}
    </>
  );
}

export interface CollapseButtonState {
  /** The pane, or its stack, is collapsed. */
  collapsed: boolean;
}

/** Collapse the pane (or its stack) to its collapsed size, or expand it. */
export function CollapseButton({
  render,
  children,
  ...props
}: PartProps<CollapseButtonState>): JSX.Element {
  const value = usePaneContext('Layout.CollapseButton');
  const { id, context } = value;
  const pane = usePaneState(value, (state) => state.pane);
  const title = usePaneState(value, (state) => state.title);
  const collapsed = usePaneState(value, (state) => state.collapsed);
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      'aria-label': (context.messages().collapse ?? collapseName)({
        paneTitle: title,
        paneId: pane.id,
      }),
      'aria-pressed': collapsed,
      'data-collapsed': collapsed || undefined,
      onClick: () => context.store.setCollapsed(id, !collapsed),
      children: children ?? (collapsed ? '▸' : '▾'),
    }),
    { collapsed }
  );
}

const collapseName = ({ paneTitle }: PaneMessageValues): string =>
  `Collapse ${paneTitle}`;

const closeName = ({ paneTitle }: PaneMessageValues): string =>
  `Close ${paneTitle}`;

export interface CloseButtonState {
  /** The pane cannot close: it is the last pane that shows. */
  disabled: boolean;
}

/**
 * Close the pane: the app's `onPaneClose`, or `layout.close` from
 * `edits()`. The last pane that shows does not close.
 */
export function CloseButton({
  render,
  children,
  ...props
}: PartProps<CloseButtonState>): JSX.Element {
  const value = usePaneContext('Layout.CloseButton');
  const { id, context } = value;
  warnMissing(
    closes(context),
    'Layout.CloseButton',
    'edits() or the onPaneClose prop'
  );
  const pane = usePaneState(value, (state) => state.pane);
  const title = usePaneState(value, (state) => state.title);
  const disabled = !useLayoutState(context.store, (state) =>
    canClose(context, state, id)
  );
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      'aria-label': (context.messages().close ?? closeName)({
        paneTitle: title,
        paneId: pane.id,
      }),
      disabled,
      'data-disabled': disabled || undefined,
      onClick: () => {
        if (!disabled) closePane(context, id);
      },
      children: children ?? '×',
    }),
    { disabled }
  );
}

export interface ZoomButtonState {
  zoomed: boolean;
}

const zoomName = ({ paneTitle }: PaneMessageValues): string =>
  `Zoom ${paneTitle}`;

/**
 * Zoom the pane, or restore the layout. It needs `zoom()`. A toggle button:
 * its name stays the same, and `aria-pressed` and the icon give the state.
 */
export function ZoomButton({
  render,
  children,
  ...props
}: PartProps<ZoomButtonState>): JSX.Element {
  const value = usePaneContext('Layout.ZoomButton');
  const { id, context } = value;
  warnMissing(context.has('zoom'), 'Layout.ZoomButton', 'zoom()');
  const pane = usePaneState(value, (state) => state.pane);
  const title = usePaneState(value, (state) => state.title);
  const zoomed = usePaneState(value, (state) => state.zoomed);
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      'aria-label': (context.messages().zoom ?? zoomName)({
        paneTitle: title,
        paneId: pane.id,
      }),
      'aria-pressed': zoomed,
      'data-zoomed': zoomed || undefined,
      onClick: () => (context.store as Partial<ZoomCommands>).toggleZoom?.(id),
      children: children ?? (zoomed ? '↙' : '↗'),
    }),
    { zoomed }
  );
}

export interface MoveHandleState {
  /** The pane moves in a drag. */
  dragging: boolean;
  /**
   * The handle does nothing: no drag starts, as the pane fills the layout or
   * is a pinned tab, and the layout has no `arrange()` for a menu.
   */
  disabled: boolean;
}

const dragName = ({ paneTitle }: PaneMessageValues): string =>
  `Drag ${paneTitle}`;

const menuName = ({ paneTitle }: PaneMessageValues): string =>
  `Arrange ${paneTitle}`;

/**
 * Move the pane with a pointer drag, beside another pane, with `paneDrag()`.
 * With `arrange()`, it is also the trigger of the app's pane menu
 * (`Layout.usePaneMenu()`): a press and release with no move is a click,
 * its name is "Arrange Editor" (`messages.paneMenu`), and it has
 * `aria-haspopup="menu"`; the app's menu sets `aria-expanded`. No drag
 * starts while any pane fills the layout, or from a pinned tab of a stack.
 * Without `arrange()`, the handle is then `aria-disabled`, and a development
 * build warns that the handle gives no path with no drag (WCAG 2.5.7). The
 * handles of the covered panes do not change, so a zoom lays no other pane
 * out, and the covered panes are out of the accessibility tree. An app's
 * `onPointerDown` that calls `preventDefault()` starts no drag.
 */
export function MoveHandle({
  render,
  children,
  ...props
}: PartProps<MoveHandleState>): JSX.Element {
  const value = usePaneContext('Layout.MoveHandle');
  const { id, context } = value;
  const menu = context.has('arrange');
  warnMissing(
    menu || context.has('pane-drag'),
    'Layout.MoveHandle',
    'paneDrag()'
  );
  warnMissing(menu, 'Layout.MoveHandle', 'arrange() for a move with no drag');
  const pane = usePaneState(value, (state) => state.pane);
  const title = usePaneState(value, (state) => state.title);
  // No drag: a pane fills the layout, or a pinned tab of a stack stays in
  // its stack.
  const blocked = useLayoutState(context.store, (state) => {
    const entry = treeIndex(state.root).panes.get(id);
    return (
      presentation(state).filled === id ||
      (entry?.pane.pinned === true && entry.stack !== null)
    );
  });
  const dragging = useDrag(
    context,
    (drag) => drag?.source.kind === 'pane' && drag.source.id === id
  );
  const disabled = blocked && !menu;
  const messages = context.messages();
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      className: 'pierre-layouts-grip',
      'aria-label': (
        (menu ? messages.paneMenu : messages.drag) ??
        (menu ? menuName : dragName)
      )({
        paneTitle: title,
        paneId: pane.id,
      }),
      'aria-haspopup': menu ? 'menu' : undefined,
      // Not `disabled`: the handle keeps its place in the tab order.
      'aria-disabled': disabled || undefined,
      'data-dragging': dragging || undefined,
      style: blocked ? DISABLED_GRIP_STYLE : GRIP_STYLE,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (blocked) return;
        context
          .hooks()
          .find((hook) => hook.startMove !== undefined)
          ?.startMove?.(id, event);
      },
      children: children ?? '⠿',
    }),
    { dragging, disabled }
  );
}
