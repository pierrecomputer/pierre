'use client';

// Pane chrome parts: each reads its pane from the pane context, subscribes to
// the state that it shows, sets that state as data attributes, and takes a
// `render` prop.
import type { JSX, PointerEvent } from 'react';

import contentCss from '../../css/content.css?inline';
import headersCss from '../../css/headers.css?inline';
import { presentation } from '../../presentation';
import type { ZoomCommands } from '../../zoom';
import { Style } from '../contract';
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
          className: 'pierre-layout-header',
          'data-focused': focused || undefined,
          'data-zoomed': zoomed || undefined,
        }),
        { focused, zoomed }
      )}
    </>
  );
}

/** The title of a pane, from `getPaneTitle`. */
export function Title({
  render,
  children,
  ...props
}: PartProps<object>): JSX.Element {
  const value = usePaneContext('Layout.Title');
  const pane = usePaneState(value, (state) => state.pane);
  return renderPart(
    'span',
    render,
    mergeProps(props, {
      className: 'pierre-layout-title',
      children: children ?? value.context.title(pane),
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
          className: 'pierre-layout-content',
          ref: context.visibility.contentRef(id),
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
  const collapsed = usePaneState(value, (state) => state.collapsed);
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      'aria-label': (context.messages().collapse ?? collapseName)(
        context.title(pane)
      ),
      'aria-pressed': collapsed,
      'data-collapsed': collapsed || undefined,
      onClick: () => context.store.setCollapsed(id, !collapsed),
      children: children ?? (collapsed ? '▸' : '▾'),
    }),
    { collapsed }
  );
}

const collapseName = (title: string): string => `Collapse ${title}`;

const closeName = (title: string): string => `Close ${title}`;

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
  const disabled = !useLayoutState(context.store, (state) =>
    canClose(context, state, id)
  );
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      'aria-label': (context.messages().close ?? closeName)(
        context.title(pane)
      ),
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

const zoomName = (title: string, zoomed: boolean): string =>
  `${zoomed ? 'Restore' : 'Zoom'} ${title}`;

/** Zoom the pane, or restore the layout. It needs `zoom()`. */
export function ZoomButton({
  render,
  children,
  ...props
}: PartProps<ZoomButtonState>): JSX.Element {
  const value = usePaneContext('Layout.ZoomButton');
  const { id, context } = value;
  warnMissing(context.has('zoom'), 'Layout.ZoomButton', 'zoom()');
  const pane = usePaneState(value, (state) => state.pane);
  const zoomed = usePaneState(value, (state) => state.zoomed);
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      'aria-label': (context.messages().zoom ?? zoomName)(
        context.title(pane),
        zoomed
      ),
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
  /** No drag starts: the pane fills the layout. */
  disabled: boolean;
}

const dragName = (title: string): string => `Drag ${title}`;

/**
 * Move the pane with a pointer drag, beside another pane. It needs
 * `paneDrag()`. While its pane fills the layout, it is `aria-disabled`. No
 * drag starts while any pane fills the layout; the handles of the covered
 * panes do not change, so a zoom lays no other pane out, and the covered
 * panes are out of the accessibility tree.
 */
export function MoveHandle({
  render,
  children,
  ...props
}: PartProps<MoveHandleState>): JSX.Element {
  const value = usePaneContext('Layout.MoveHandle');
  const { id, context } = value;
  warnMissing(context.has('pane-drag'), 'Layout.MoveHandle', 'paneDrag()');
  const pane = usePaneState(value, (state) => state.pane);
  const disabled = useLayoutState(
    context.store,
    (state) => presentation(state).filled === id
  );
  const dragging = useDrag(
    context,
    (drag) => drag?.source.kind === 'pane' && drag.source.id === id
  );
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      className: 'pierre-layout-grip',
      'aria-label': (context.messages().drag ?? dragName)(context.title(pane)),
      // Not `disabled`: the handle keeps its place in the tab order.
      'aria-disabled': disabled || undefined,
      'data-dragging': dragging || undefined,
      style: disabled ? DISABLED_GRIP_STYLE : GRIP_STYLE,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (disabled) return;
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
